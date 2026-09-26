/**
 * Run Hound against Fernway (fixtures/fernway/CONTRACT.md): an app built the way Lovable, Bolt and v0 build them
 * (Vite, React, Tailwind CSS v4, shadcn/ui-style components on Radix, react-hook-form + zod, sonner, React Router).
 *
 * Clean mode is well built on purpose, so for each of the seven routes, with every scenario approved
 * (allowDestructive false):
 *   - no scenario errored
 *   - ZERO confirmed findings (any is a Run Hound false positive or a real Fernway defect: triage it)
 *   - every skipped scenario says why, in plain language
 *   - discovery found every form CONTRACT.md lists as "in DOM on load" (by name), with its fields (by label),
 *     including the Radix widgets (Select, Checkbox, RadioGroup) that stand in for native controls
 *   - discovery found the forms behind a trigger (DiscoveredForm.opener, 0.4.0): "Book a demo" and "New project"
 *
 * The public routes (/, /signup, /login, /onboarding) run signed out, exactly as in 0.3.0. /app, /app/settings and
 * /app/help need a session (V2, docs/v2-spec.md "Fernway V2"): they run signed in as Alex (test account A,
 * RunOptions.signInAs "a") with Sam as account B (isolated), every scenario approved including mass-assignment (planned
 * where a form saves: not on /app/help, which has no form), and both access-control scenarios (other-account,
 * signed-out) must pass.
 *
 * Then each planted bug alone (FERNWAY_BUGS=<id>, fixtures/fernway/bugs.json): only the scenarios of the bug's
 * `detectedBy` check run on its page ("*" = every page, tested on /; V03 also on its `alsoOn` page), signed in on /app
 * pages, and that check must report a confirmed finding (from `scenario` when the bug names one, while the check's
 * other scenarios stay clean).
 *
 * Last, no run folder, log line, Plan or Report of any signed-in run holds either account's password.
 *
 * Env:
 *   ACCEPTANCE_FERNWAY=/,/app,W01   run only these routes and bugs (default: all); "clean" = every route, "bugs" = every bug
 *   FERNWAY_SKIP_BUILD=1            reuse fixtures/fernway/dist instead of running `vite build`
 *   ACCEPTANCE_FERNWAY_DIR=<dir>    build and start Fernway from a copy of fixtures/fernway instead
 *   KEEP_RUNS=1                     keep the runs/ directories (paths are printed)
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { AccountsConfig } from "../../../app/src/accounts/types.js";
import { checks } from "../../../app/src/checks/index.js";
import type { DiscoveredForm, Plan, Report } from "../../../app/src/core/types.js";
import { discoverAndPlan, runPlan } from "../../../app/src/engine/runner.js";
import { buildFernway, FERNWAY_ACCOUNTS, fernwayAccounts, filesContaining, loadFernwayBugs, needsSignIn, startFernway, type FernwayBug } from "./fernway.js";

interface FormSpec {
  /** The discovered form's name must match this. */
  name: RegExp;
  /** Labels of the fields discovery must find in it (compared without case, spacing or a required marker). */
  fields: string[];
}

interface TriggerFormSpec extends FormSpec {
  /** The accessible name of the control that opens it (DiscoveredForm.opener.name). */
  opener: RegExp;
}

interface RouteSpec {
  route: string;
  /** CONTRACT.md "Forms on the page (in DOM on load)". */
  forms: FormSpec[];
  /** Forms inside a dialog or sheet that only exist after a click (CONTRACT.md "Notable controls outside forms"). */
  behindTrigger?: TriggerFormSpec[];
}

const ROUTES: RouteSpec[] = [
  {
    route: "/",
    forms: [
      { name: /join the waitlist/i, fields: ["Work email", "Team size"] },
      { name: /get product updates/i, fields: ["Email address"] },
    ],
    behindTrigger: [
      {
        opener: /^book a demo$/i,
        name: /book a demo/i,
        fields: ["Full name", "Work email", "Company size", "Preferred date", "What would you like to see?", "I agree to be contacted"],
      },
    ],
  },
  {
    route: "/signup",
    forms: [{ name: /create (your )?account/i, fields: ["Full name", "Work email", "Password", "Company", "I agree to the Terms and Privacy Policy"] }],
  },
  { route: "/login", forms: [{ name: /welcome back|sign in/i, fields: ["Email", "Password", "Remember me"] }] },
  { route: "/onboarding", forms: [{ name: /workspace/i, fields: ["Workspace name", "Workspace URL", "What will you use Fernway for?"] }] },
  {
    route: "/app",
    forms: [{ name: /quick add/i, fields: ["Task", "Project"] }],
    behindTrigger: [
      {
        opener: /^new project$/i,
        name: /new project/i,
        fields: ["Project name", "Description", "Status", "Priority", "Owner", "Due date", "Budget", "Notify the team"],
      },
    ],
  },
  { route: "/app/settings", forms: [{ name: /profile/i, fields: ["Display name", "Email", "Bio", "Time zone"] }] },
  // No form: page-wide checks only. V05 makes a direct load of it answer 404 (caught by deep-links on /app).
  { route: "/app/help", forms: [] },
];

/** The two access-control scenarios (docs/v2-spec.md "access-control"). */
const ACCESS_SCENARIOS = ["access-control:other-account", "access-control:signed-out"] as const;

const bugs = await loadFernwayBugs();

/** One (bug, page) pair: a bug is tested on its page and on every `alsoOn` page. */
interface BugCase {
  bug: FernwayBug;
  route: string;
  /** "V03 on /app/settings" style label for the test name. */
  label: string;
}
const bugCases: BugCase[] = bugs.flatMap((bug) => {
  const pages = [bug.page === "*" ? "/" : bug.page, ...(bug.alsoOn ?? [])];
  return pages.map((route) => ({ bug, route, label: `${bug.id} on ${route}` }));
});

const only = process.env.ACCEPTANCE_FERNWAY?.split(",").map((s) => s.trim()).filter(Boolean);
const selectedRoutes = only ? ROUTES.filter((r) => only.includes(r.route) || only.includes("clean")) : ROUTES;
const selectedBugs = only ? bugCases.filter((c) => only.includes(c.bug.id) || only.includes("bugs")) : bugCases;
const keepRuns = process.env.KEEP_RUNS === "1";
const anySignedIn = selectedRoutes.some((r) => needsSignIn(r.route)) || selectedBugs.some((c) => needsSignIn(c.route));

/** Notes a person can read: not empty, and not a stack trace, a raw error class or a Playwright call log. */
const TECHNICAL = /\n\s+at |\b(TypeError|ReferenceError|SyntaxError|TimeoutError)\b|Call log:|locator\(|page\.\w+:|undefined|\[object Object\]/;

/** A field label without case, extra spaces or a trailing required marker ("*", "(required)"). */
function norm(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s*(\*|\(required\))\s*$/i, "")
    .trim()
    .toLowerCase();
}

function fieldNames(form: DiscoveredForm): string[] {
  return form.fields.map((f) => norm(f.accessibleName ?? f.label));
}

/** Expected labels discovery did not find in `form`. */
function missingFields(form: DiscoveredForm, expected: string[]): string[] {
  const found = fieldNames(form);
  return expected.filter((label) => !found.includes(norm(label)));
}

/** One line per form, field, scenario and finding, printed for every run so a failure shows the whole picture. */
function describeRun(label: string, plan: Plan, report: Report): string {
  const who = report.accounts?.signedInAs ? ` (signed in as ${report.accounts.signedInAs.label}${report.accounts.other ? `, other: ${report.accounts.other.label}` : ""})` : " (signed out)";
  const lines = [`[fernway] ${label}: ${report.target}${who}`];
  for (const form of plan.page?.forms ?? [plan.form]) {
    const opener = form.opener ? ` (opened by "${form.opener.name ?? form.opener.selector}")` : "";
    lines.push(`  form #${form.index ?? 0} "${form.name ?? "(no name)"}"${opener}${form.search ? " [search]" : ""} ${form.selector}`);
    for (const f of form.fields) {
      const widget = f.widget ? ` widget=${f.widget}` : "";
      const required = f.required ? ` required${f.requiredBy ? `(${f.requiredBy})` : ""}` : "";
      lines.push(`      field ${f.key}: "${f.accessibleName ?? f.label ?? "(no name)"}" ${f.type}/${f.role}${widget}${required}`);
    }
  }
  lines.push(`  controls outside forms: ${(plan.page?.controls ?? []).map((c) => `"${c.accessibleName ?? c.text}"`).join(", ") || "(none)"}`);
  for (const r of report.results) {
    lines.push(`  ${r.status.padEnd(7)} ${r.scenarioId}${r.notes ? ` - ${r.notes}` : ""}`);
    for (const f of r.findings) {
      lines.push(`           ${f.confidence} ${f.severity} "${f.title}"${f.location ? ` @ ${f.location}` : ""}`);
    }
  }
  return lines.join("\n");
}

let runsRoot: string;
/**
 * The run folders, log lines and Plan/Report objects (as JSON: what the web API hands the browser) of every run
 * started with the test accounts, grepped for the passwords at the end. `signedIn` is whether the report says it
 * really ran as account A.
 */
const signedInRuns: { label: string; dir: string; logs: string[]; json: string; signedIn: boolean }[] = [];

/**
 * Discovers and plans `route` on a running Fernway, signed in as Alex (A, with Sam as B) when the route needs a
 * session, else signed out as in 0.3.0.
 */
async function planRoute(url: string, route: string, logs: string[]): Promise<{ plan: Plan; accounts: AccountsConfig | undefined }> {
  const accounts = needsSignIn(route) ? fernwayAccounts(url) : undefined;
  const plan = await discoverAndPlan(`${url}${route}`, {
    checks,
    log: (line) => logs.push(line),
    ...(accounts ? { signInAs: "a" as const, accounts } : {}),
  });
  return { plan, accounts };
}

/** Runs the approved scenarios of `plan` (with the accounts it was planned with) into runsRoot/<name>. */
async function runRoute(label: string, plan: Plan, approved: string[], accounts: AccountsConfig | undefined, name: string, logs: string[]) {
  const { report, dir } = await runPlan(plan, {
    checks,
    approved,
    allowDestructive: false,
    runsDir: join(runsRoot, name),
    log: (line) => logs.push(line),
    ...(accounts ? { accounts } : {}),
  });
  if (accounts) {
    signedInRuns.push({ label, dir, logs, json: JSON.stringify({ plan, report }), signedIn: report.accounts?.signedInAs?.id === "a" });
  }
  return report;
}

beforeAll(async () => {
  await buildFernway();
  runsRoot = await mkdtemp(join(tmpdir(), "rh-fernway-"));
});

afterAll(async () => {
  if (!runsRoot) return;
  if (keepRuns) console.log(`[fernway] runs kept in ${runsRoot}`);
  else await rm(runsRoot, { recursive: true, force: true });
});

describe.concurrent("Run Hound against Fernway in clean mode", () => {
  it.for(selectedRoutes)("$route: zero confirmed findings, nothing errored, every form found", async (spec, { expect }) => {
    const fw = await startFernway("none");
    const signedIn = needsSignIn(spec.route);
    const logs: string[] = [];
    try {
      await fw.reset();
      const { plan, accounts } = await planRoute(fw.url, spec.route, logs);
      const forms = plan.page?.forms ?? [plan.form];

      if (signedIn) {
        expect.soft(plan.account, "Plan.account: discovered signed in as account A").toEqual({ id: "a", label: "Account A" });
      } else {
        expect.soft(plan.account, "a public route is discovered signed out").toBeUndefined();
        expect.soft(
          plan.scenarios.filter((s) => s.checkId === "access-control" || s.checkId === "mass-assignment").map((s) => s.id),
          "signed out, no access-control or mass-assignment scenario is planned",
        ).toEqual([]);
      }

      for (const expected of spec.forms) {
        const form = forms.find((f) => !f.opener && expected.name.test(f.name ?? ""));
        expect.soft(form, `form ${expected.name} on load (found: ${forms.map((f) => JSON.stringify(f.name)).join(", ")})`).toBeDefined();
        if (form) {
          expect.soft(missingFields(form, expected.fields), `fields of "${form.name}" discovery missed (found: ${fieldNames(form).join(", ")})`).toEqual([]);
        }
      }
      for (const expected of spec.behindTrigger ?? []) {
        const form = forms.find((f) => f.opener && expected.opener.test(f.opener.name ?? ""));
        expect.soft(form, `form behind "${expected.opener.source}" (DiscoveredForm.opener)`).toBeDefined();
        if (form) {
          expect.soft(form.name ?? "", "name of the form behind a trigger").toMatch(expected.name);
          expect.soft(missingFields(form, expected.fields), `fields of "${form.name}" discovery missed (found: ${fieldNames(form).join(", ")})`).toEqual([]);
        }
      }

      // Every scenario approved: on /app pages that includes mass-assignment (unticked by default) and both access checks.
      const approved = plan.scenarios.map((s) => s.id);
      if (signedIn) {
        expect.soft(approved.filter((id) => (ACCESS_SCENARIOS as readonly string[]).includes(id)).sort(), "both access-control scenarios planned").toEqual([...ACCESS_SCENARIOS].sort());
        expect.soft(plan.scenarios.some((s) => s.checkId === "mass-assignment"), "mass-assignment planned (a form that saves)").toBe(spec.forms.length > 0);
      }
      const report = await runRoute(`clean ${spec.route}`, plan, approved, accounts, `clean${spec.route.replace(/\//g, "_")}`, logs);
      console.log(describeRun(`clean ${spec.route}`, plan, report));

      expect.soft(
        report.results.filter((r) => r.status === "error").map((r) => `${r.scenarioId}: ${r.notes ?? "(no notes)"}`),
        "errored scenarios",
      ).toEqual([]);

      expect.soft(
        report.findings.filter((f) => f.confidence === "confirmed").map((f) => `${f.checkId}: ${f.title}${f.location ? ` @ ${f.location}` : ""}`),
        "confirmed findings on clean Fernway (false positives, or a Fernway defect)",
      ).toEqual([]);

      expect.soft(
        report.results
          .filter((r) => r.status === "skipped")
          .filter((r) => !r.notes || r.notes.trim().length < 10 || TECHNICAL.test(r.notes))
          .map((r) => `${r.scenarioId}: ${JSON.stringify(r.notes ?? null)}`),
        "skipped scenarios without a plain-language reason",
      ).toEqual([]);

      if (signedIn) {
        expect.soft(report.accounts, "Report.accounts: signed in as A, with B used by access-control").toEqual({
          signedInAs: { id: "a", label: "Account A" },
          other: { id: "b", label: "Account B" },
        });
        expect.soft(
          ACCESS_SCENARIOS.map((id) => {
            const result = report.results.find((r) => r.scenarioId === id);
            return `${id}: ${result ? result.status : "(no result)"}${result?.notes ? ` (${result.notes})` : ""}`;
          }),
          "both access-control scenarios pass (Sam and a signed-out visitor can't read Alex's data)",
        ).toEqual(ACCESS_SCENARIOS.map((id) => expect.stringMatching(new RegExp(`^${id}: pass\\b`))));
      }
    } finally {
      await fw.stop();
    }
  });
});

describe.concurrent("Run Hound catches each Fernway planted bug", () => {
  it.for(selectedBugs)("$label: $bug.detectedBy reports it", async ({ bug, route, label }, { expect }) => {
    const fw = await startFernway(bug.id);
    const logs: string[] = [];
    try {
      await fw.reset();
      const { plan, accounts } = await planRoute(fw.url, route, logs);
      if (needsSignIn(route)) expect.soft(plan.account?.id, `${route} discovered signed in as account A`).toBe("a");
      const approved = plan.scenarios.filter((s) => s.checkId === bug.detectedBy).map((s) => s.id);
      expect(approved, `scenarios planned for ${bug.detectedBy} on ${route}`).not.toEqual([]);
      if (bug.scenario) expect(approved, `the ${bug.scenario} scenario is planned`).toContain(bug.scenario);

      const report = await runRoute(label, plan, approved, accounts, `${bug.id}${route.replace(/\//g, "_")}`, logs);
      console.log(describeRun(`${label} (${bug.detectedBy})`, plan, report));

      expect.soft(
        report.results.filter((r) => r.status === "error").map((r) => `${r.scenarioId}: ${r.notes ?? "(no notes)"}`),
        "errored scenarios",
      ).toEqual([]);
      const results = bug.scenario ? report.results.filter((r) => r.scenarioId === bug.scenario) : report.results;
      const caught = results.flatMap((r) => r.findings).filter((f) => f.checkId === bug.detectedBy && f.confidence === "confirmed");
      expect(
        caught.map((f) => f.title),
        `${bug.id} "${bug.title}": a confirmed ${bug.scenario ?? bug.detectedBy} finding (results: ${report.results.map((r) => `${r.scenarioId}=${r.status}${r.notes ? ` (${r.notes})` : ""}`).join("; ")})`,
      ).not.toEqual([]);

      if (bug.version === "V2") {
        expect.soft(caught.map((f) => f.severity), `severity of the ${bug.id} finding`).toContain(bug.severity);
      }
      if (bug.scenario) {
        // Nothing else changes: the check's other scenarios (e.g. signed-out for V01) find nothing.
        expect.soft(
          report.results
            .filter((r) => r.scenarioId !== bug.scenario)
            .flatMap((r) => r.findings.filter((f) => f.confidence === "confirmed").map((f) => `${r.scenarioId}: ${f.title}`)),
          `${bug.id} changes only ${bug.scenario}`,
        ).toEqual([]);
      }
    } finally {
      await fw.stop();
    }
  });
});

describe("the signed-in runs never write a password", () => {
  it.skipIf(!anySignedIn)("no report, evidence file, spec, log line, Plan or Report of a signed-in run holds either account's password", async ({ expect }) => {
    expect(
      signedInRuns.filter((r) => r.signedIn).map((r) => r.label),
      `runs that really ran signed in as account A (none: signing in failed or never happened; runs with the accounts: ${signedInRuns.map((r) => r.label).join(", ") || "none"})`,
    ).not.toEqual([]);
    const needles = { "Alex's password": FERNWAY_ACCOUNTS.alex.password, "Sam's password": FERNWAY_ACCOUNTS.sam.password };
    for (const run of signedInRuns) {
      expect.soft(await filesContaining(run.dir, needles), `${run.label}: files in ${run.dir}`).toEqual([]);
      expect.soft(
        run.logs.filter((line) => Object.values(needles).some((p) => line.includes(p))).length,
        `${run.label}: log lines holding a password`,
      ).toBe(0);
      expect.soft(
        Object.entries(needles).filter(([, p]) => run.json.includes(p)).map(([label]) => label),
        `${run.label}: the Plan and Report objects`,
      ).toEqual([]);
    }
  });
});
