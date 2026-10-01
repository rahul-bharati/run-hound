/**
 * Runs controller: starts, lists, polls, stops and reruns runs, plus report/spec/artifact serving. The runs model
 * holds state; this controller parses requests, calls services, and serialises the response.
 *
 * Behaviour preserved byte-for-byte from the pre-refactor app.ts:
 * - Plans/runs in-memory maps behave identically (insertion order, pruning of finished first).
 * - startRun's redacted plan copy, hideInJson on report, password registration/unregistration unchanged.
 * - REDACTED check on rerun target unchanged.
 * - /api/runs/:id/live.jpg is only served for in-memory runs (no frames in disk summaries).
 * - /api/runs/:id/{report.json,report.md,report.html} only serve when state.status === "done".
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Hono } from "hono";
import { planAccount, usernameHider } from "../accounts.js";
import { resolveAccounts } from "../../config/accounts.js";
import { redactSecrets } from "../../engine/redact.js";
import {
  aiForRequest,
  planBounded,
  type SignedInForPlanning,
} from "../models/ai-session.js";
import {
  ARTIFACT_TYPES,
  REPORT_FILES,
  SAFE_FILE,
} from "../models/runs.js";
import { registerPasswords } from "../accounts.js";
import { notReadyMessage } from "../../config/accounts.js";
import { NO_DISPLAY_MESSAGE } from "../../engine/runner.js";
import type { Services } from "../models/services.js";
import { REPORT_CSP } from "../middleware/security.js";
import type { Plan } from "../../core/types.js";
import type { AccountsConfig } from "../../interfaces/accounts.js";

export interface RunsControllerDeps {
  services: Services;
}

export function registerRunsRoutes(app: Hono, deps: RunsControllerDeps): void {
  const { services } = deps;
  app.post("/api/runs", async (c) => {
    let body: {
      planId?: unknown;
      approved?: unknown;
      allowDestructive?: unknown;
      headed?: unknown;
    };
    try {
      body = ((await c.req.json()) ?? {}) as typeof body;
    } catch {
      return c.json({ error: "The request body must be JSON." }, 400);
    }
    const stored =
      typeof body.planId === "string"
        ? services.plans.get(body.planId)
        : undefined;
    if (!stored)
      return c.json({ error: "Unknown plan. Create a plan first." }, 404);
    const plan = stored.plan;
    if (
      body.approved !== undefined &&
      !(
        Array.isArray(body.approved) &&
        body.approved.every((a) => typeof a === "string")
      )
    ) {
      return c.json(
        { error: "approved must be a list of scenario ids." },
        400,
      );
    }
    for (const flag of ["allowDestructive", "headed"] as const) {
      if (body[flag] !== undefined && typeof body[flag] !== "boolean")
        return c.json({ error: `${flag} must be true or false.` }, 400);
    }
    if (body.headed === true && !services.canShowBrowser)
      return c.json({ error: NO_DISPLAY_MESSAGE }, 400);

    const approved = body.approved as string[] | undefined;
    const unknown = (approved ?? []).filter(
      (id) => !plan.scenarios.some((s) => s.id === id),
    );
    if (unknown.length > 0)
      return c.json(
        {
          error: `Unknown scenario id(s): ${redactSecrets(unknown.join(", "))}.`,
        },
        400,
      );
    const approvedIds =
      approved ??
      plan.scenarios.filter((s) => s.defaultSelected).map((s) => s.id);
    // An empty run would report "0 findings" and look like a clean pass.
    if (approvedIds.length === 0)
      return c.json(
        { error: "Select at least one scenario to run." },
        400,
      );
    // A run signs in again as the account its plan was made as, with the accounts as they are now.
    let accounts: AccountsConfig | undefined;
    if (plan.account) {
      const { config, status } = await resolveAccounts();
      const why = notReadyMessage(status.accounts[plan.account.id]);
      if (why) return c.json({ error: redactSecrets(why) }, 400);
      accounts = config;
    }
    const session = stored.ai ? (await aiForRequest(true)).ai : undefined;
    const started = services.startRun(plan, approvedIds, {
      allowDestructive: body.allowDestructive === true,
      headed: body.headed === true,
      ai: stored.ai,
      session,
      ...(accounts ? { accounts } : {}),
    });
    if ("error" in started)
      return c.json({ error: started.error }, started.code);
    return c.json({ runId: started.runId }, 202);
  });

  app.get("/api/runs", async (c) =>
    c.json(
      { runs: await services.listRuns() },
      200,
      { "cache-control": "no-store" },
    ),
  );

  app.post("/api/runs/:runId/stop", async (c) => {
    const state = await services.runState(c.req.param("runId"));
    if (!state) return c.json({ error: "Unknown run." }, 404);
    if (state.status !== "running" || !state.controller)
      return c.json({ error: "This run has already ended." }, 409);
    if (state.controller.signal.aborted)
      return c.json({ error: "This run is already stopping." }, 409);
    state.controller.abort();
    state.live.updatedAt = new Date().toISOString();
    return c.json({ runId: c.req.param("runId") }, 202);
  });

  app.post("/api/runs/:runId/rerun", async (c) => {
    const state = await services.runState(c.req.param("runId"));
    if (!state) return c.json({ error: "Unknown run." }, 404);
    // A run read back from disk has the redacted target: planning it would test the wrong address.
    if (services.isRedactedPlan(state)) {
      return c.json(
        {
          error:
            "This run's address had a secret in it (a token or key), which is hidden in saved reports, so the run can't be planned again from here. Start a new run with the full address.",
        },
        400,
      );
    }
    // Don't open a browser to plan when the run couldn't start anyway (startRun checks again after planning).
    const running = [...services.runs.runs.values()].filter(
      (r) => r.status === "running",
    ).length;
    if (running >= services.runs.maxConcurrentRuns)
      return c.json(
        {
          error: `${running} run${running === 1 ? " is" : "s are"} already in progress. Wait for ${running === 1 ? "it" : "one"} to finish.`,
        },
        409,
      );
    // Signed in as the same account as before, with the accounts as they are now.
    const account = planAccount(state.plan);
    let signedIn: SignedInForPlanning | undefined;
    if (account) {
      const { config, status } = await resolveAccounts();
      const why = notReadyMessage(status.accounts[account.id]);
      if (why) return c.json({ error: redactSecrets(why) }, 400);
      signedIn = { id: account.id, accounts: config };
    }
    let plan: Plan;
    // Whether AI was used carries over; it can't be used now (turned off since) → the rerun goes without it.
    const { ai: session } = await aiForRequest(state.ai);
    const unregister = signedIn
      ? registerPasswords(signedIn.accounts, [signedIn.id])
      : () => undefined;
    try {
      plan = (
        await planBounded(
          state.plan.target,
          session,
          c.req.raw.signal,
          services.host.aiPlanBudgetMs,
          (target, opts) =>
            services.discoverAndPlan(target, {
              checks: services.options.checks,
              allowedHosts: services.options.allowedHosts,
              ...opts,
            }),
          signedIn,
        )
      ).plan;
    } catch (err) {
      const message = usernameHider(signedIn?.accounts)(
        redactSecrets(
          services.cleanErrorMessage(
            err instanceof Error ? err.message : String(err),
          ),
        ),
      );
      if (services.isUserError(err))
        return c.json({ error: message }, 400);
      return c.json(
        { error: `Could not plan the run again: ${message}` },
        500,
      );
    } finally {
      unregister();
    }
    const known = new Set(plan.scenarios.map((s) => s.id));
    const approved = state.approved.filter((id) => known.has(id));
    if (approved.length === 0) {
      return c.json(
        {
          error:
            "None of this run's scenarios are in the new plan (the page has changed). Start a new run instead.",
        },
        400,
      );
    }
    const started = services.startRun(plan, approved, {
      allowDestructive: state.allowDestructive,
      headed: state.headed && services.canShowBrowser,
      ai: session !== undefined,
      session,
      ...(signedIn ? { accounts: signedIn.accounts } : {}),
    });
    if ("error" in started)
      return c.json({ error: started.error }, started.code);
    return c.json({ runId: started.runId }, 202);
  });

  app.get("/api/runs/:runId", async (c) => {
    const state = await services.runState(c.req.param("runId"));
    if (!state) return c.json({ error: "Unknown run." }, 404);
    const {
      dir: _dir,
      live: _live,
      plan: _plan,
      approved: _approved,
      allowDestructive: _d,
      headed: _h,
      ai: _ai,
      controller: _c,
      ...status
    } = state;
    return c.json(status);
  });

  app.get("/api/runs/:runId/live", async (c) => {
    const state = await services.runState(c.req.param("runId"));
    if (!state) return c.json({ error: "Unknown run." }, 404);
    const { frame: _frame, ...live } = state.live;
    const elapsedMs =
      state.durationMs ?? Math.max(0, Date.now() - Date.parse(state.startedAt));
    return c.json(
      {
        status: state.status,
        startedAt: state.startedAt,
        elapsedMs,
        ...live,
      },
      200,
      { "cache-control": "no-store" },
    );
  });

  // The latest screencast frame. Pixels can't be redacted, which is why this is only served on loopback-guarded hosts.
  app.get("/api/runs/:runId/live.jpg", (c) => {
    const frame = services.runs.runs.get(c.req.param("runId"))?.live.frame;
    if (!frame) return c.json({ error: "No frame yet." }, 404);
    return c.body(new Uint8Array(frame), 200, {
      "content-type": "image/jpeg",
      "cache-control": "no-store",
    });
  });

  app.get("/api/runs/:runId/:file{report\\.(?:json|md|html)}", async (c) => {
    const state = await services.runState(c.req.param("runId"));
    const file = c.req.param("file");
    const type = REPORT_FILES[file];
    if (!state || state.status !== "done" || !type)
      return c.json({ error: "Not found." }, 404);
    return c.body(await readFile(join(state.dir, file), "utf8"), 200, {
      "content-type": type,
      ...(file === "report.html"
        ? { "content-security-policy": REPORT_CSP }
        : {}),
    });
  });

  app.get("/api/runs/:runId/specs/:file", async (c) => {
    const state = await services.runState(c.req.param("runId"));
    if (!state || state.status !== "done")
      return c.json({ error: "Not found." }, 404);
    const file = c.req.param("file");
    if (!SAFE_FILE.test(file))
      return c.json({ error: "Invalid file name." }, 400);
    try {
      const source = await readFile(join(state.dir, "specs", file), "utf8");
      return c.body(source, 200, {
        "content-type": "text/plain; charset=utf-8",
      });
    } catch {
      return c.json({ error: "Not found." }, 404);
    }
  });

  // Evidence referenced from report.html (artifacts/<file>.png|.gif), served next to the report.
  app.get("/api/runs/:runId/artifacts/:file", async (c) => {
    const state = await services.runState(c.req.param("runId"));
    const file = c.req.param("file");
    if (!state || state.status !== "done")
      return c.json({ error: "Not found." }, 404);
    const type =
      ARTIFACT_TYPES[file.slice(file.lastIndexOf(".")).toLowerCase()];
    if (!SAFE_FILE.test(file) || !type)
      return c.json({ error: "Invalid file name." }, 400);
    try {
      const bytes = await readFile(join(state.dir, "artifacts", file));
      return c.body(new Uint8Array(bytes), 200, { "content-type": type });
    } catch {
      return c.json({ error: "Not found." }, 404);
    }
  });
}

