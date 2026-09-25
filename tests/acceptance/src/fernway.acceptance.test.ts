/**
 * Run Hound against Fernway (fixtures/fernway/CONTRACT.md): an app built the way Lovable, Bolt and v0 build them
 * (Vite, React, Tailwind CSS v4, shadcn/ui-style components on Radix, react-hook-form + zod, sonner, React Router).
 *
 * Clean mode is well built on purpose, so for each of the six routes, with every scenario approved
 * (allowDestructive false):
 *   - no scenario errored
 *   - ZERO confirmed findings (any is a Run Hound false positive or a real Fernway defect: triage it)
 *   - every skipped scenario says why, in plain language
 *   - discovery found every form CONTRACT.md lists as "in DOM on load" (by name), with its fields (by label),
 *     including the Radix widgets (Select, Checkbox, RadioGroup) that stand in for native controls
 *   - discovery found the forms behind a trigger (DiscoveredForm.opener, 0.4.0): "Book a demo" and "New project"
 *
 * Then each planted bug alone (FERNWAY_BUGS=<id>, fixtures/fernway/bugs.json): only the scenarios of the bug's
 * `detectedBy` check run on its page ("*" = every page, tested on /), and that check must report a confirmed finding.
 *
 * Env:
 *   ACCEPTANCE_FERNWAY=/,/app,W01   run only these routes and bugs (default: all); "clean" = every route, "bugs" = every bug
 *   FERNWAY_SKIP_BUILD=1            reuse fixtures/fernway/dist instead of running `vite build`
 *   KEEP_RUNS=1                     keep the runs/ directories (paths are printed)
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import { checks } from "../../../app/src/checks/index.js";
import type { DiscoveredForm, Plan, Report } from "../../../app/src/core/types.js";
import { discoverAndPlan, runPlan } from "../../../app/src/engine/runner.js";
import { buildFernway, loadFernwayBugs, startFernway } from "./fernway.js";

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
];

const bugs = await loadFernwayBugs();

const only = process.env.ACCEPTANCE_FERNWAY?.split(",").map((s) => s.trim()).filter(Boolean);
const selectedRoutes = only ? ROUTES.filter((r) => only.includes(r.route) || only.includes("clean")) : ROUTES;
const selectedBugs = only ? bugs.filter((b) => only.includes(b.id) || only.includes("bugs")) : bugs;
const keepRuns = process.env.KEEP_RUNS === "1";

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
  const lines = [`[fernway] ${label}: ${report.target}`];
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
    try {
      await fw.reset();
      const plan = await discoverAndPlan(`${fw.url}${spec.route}`, { checks });
      const forms = plan.page?.forms ?? [plan.form];

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

      const approved = plan.scenarios.map((s) => s.id);
      const { report } = await runPlan(plan, {
        checks,
        approved,
        allowDestructive: false,
        runsDir: join(runsRoot, `clean${spec.route.replace(/\//g, "_")}`),
        log: () => undefined,
      });
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
    } finally {
      await fw.stop();
    }
  });
});

describe.concurrent("Run Hound catches each Fernway planted bug", () => {
  it.for(selectedBugs)("$id: $detectedBy reports it on $page", async (bug, { expect }) => {
    const fw = await startFernway(bug.id);
    try {
      await fw.reset();
      const route = bug.page === "*" ? "/" : bug.page;
      const plan = await discoverAndPlan(`${fw.url}${route}`, { checks });
      const approved = plan.scenarios.filter((s) => s.checkId === bug.detectedBy).map((s) => s.id);
      expect(approved, `scenarios planned for ${bug.detectedBy} on ${route}`).not.toEqual([]);

      const { report } = await runPlan(plan, {
        checks,
        approved,
        allowDestructive: false,
        runsDir: join(runsRoot, bug.id),
        log: () => undefined,
      });
      console.log(describeRun(`${bug.id} (${bug.detectedBy})`, plan, report));

      expect.soft(
        report.results.filter((r) => r.status === "error").map((r) => `${r.scenarioId}: ${r.notes ?? "(no notes)"}`),
        "errored scenarios",
      ).toEqual([]);
      const caught = report.findings.filter((f) => f.checkId === bug.detectedBy && f.confidence === "confirmed");
      expect(
        caught.map((f) => f.title),
        `${bug.id} "${bug.title}": a confirmed ${bug.detectedBy} finding (results: ${report.results.map((r) => `${r.scenarioId}=${r.status}${r.notes ? ` (${r.notes})` : ""}`).join("; ")})`,
      ).not.toEqual([]);
    } finally {
      await fw.stop();
    }
  });
});
