/**
 * Run Hound against Fernway (fixtures/fernway/CONTRACT.md): an app built the way Lovable, Bolt and v0 build them
 * (Vite, React, Tailwind CSS v4, shadcn/ui-style components on Radix, react-hook-form + zod, sonner, React Router).
 *
 * Clean mode is well built on purpose, so for each of the eight routes, with every scenario approved
 * (allowDestructive false):
 *   - no scenario errored
 *   - ZERO confirmed findings (any is a Run Hound false positive or a real Fernway defect: triage it)
 *   - every skipped scenario says why, in plain language
 *   - discovery found every form CONTRACT.md lists as "in DOM on load" (by name), with its fields (by label),
 *     including the Radix widgets (Select, Checkbox, RadioGroup) that stand in for native controls
 *   - discovery found the forms behind a trigger (DiscoveredForm.opener, 0.4.0): "Book a demo" and "New project"
 *
 * The public routes (/, /signup, /login, /onboarding) run signed out, exactly as in 0.3.0. /app, /app/settings,
 * /app/help and /app/upgraded need a session (V2, docs/v2-spec.md "Fernway V2"): they run signed in as Alex (test
 * account A, RunOptions.signInAs "a") with Sam as account B (isolated), every scenario approved including
 * mass-assignment and the 0.5.0 write-side checks (unticked by default), and both access-control scenarios
 * (other-account, signed-out) must pass.
 *
 * The write-side checks (0.5.0, docs/v2-spec.md "Acceptance (0.5.0 additions)") also run on their own on clean
 * Fernway: every write-access, csrf and paywall-trust scenario of /app and /app/settings approved, no confirmed
 * finding, and a re-read through Fernway's API shows Alex's and Sam's pre-existing records and plan as they were.
 * `csrf` on Fernway reached at a non-loopback address (no localhost/127.0.0.1 twin) reports inconclusive, never a
 * finding and never a pass.
 *
 * Then each planted bug alone (FERNWAY_BUGS=<id>, fixtures/fernway/bugs.json): only the scenarios of the bug's
 * `detectedBy` check run on its page ("*" = every page, tested on /; V03 also on its `alsoOn` page), signed in on /app
 * pages, and that check must report a confirmed finding (from `scenario` when the bug names one, while the check's
 * other scenarios stay clean). For the write-side bugs (V06-V09), Alex's and Sam's data is re-read afterwards and must
 * be as it was: the check restored Alex's test record and plan.
 *
 * Last, no run folder, log line, Plan or Report of any signed-in run holds either account's password, a session
 * cookie value of the run (every secret the engine registered while it ran: sign-in's cookies and tokens) or a CSRF
 * token.
 *
 * Env:
 *   ACCEPTANCE_FERNWAY=/,/app,W01   run only these routes and bugs (default: all); "clean" = every route, "bugs" = every bug,
 *                                   "write-side" = the write-side clean runs and the inconclusive csrf run
 *   FERNWAY_SKIP_BUILD=1            reuse fixtures/fernway/dist instead of running `vite build`
 *   ACCEPTANCE_FERNWAY_DIR=<dir>    build and start Fernway from a copy of fixtures/fernway instead
 *   KEEP_RUNS=1                     keep the runs/ directories (paths are printed)
 */
import { mkdtemp, rm } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { AccountsConfig } from "../../../app/src/accounts/types.js";
import { checks } from "../../../app/src/checks/index.js";
import type { CheckId, DiscoveredForm, Plan, Report } from "../../../app/src/core/types.js";
import { registeredLiterals } from "../../../app/src/engine/redact.js";
import { discoverAndPlan, runPlan } from "../../../app/src/engine/runner.js";
import {
  accountState,
  buildFernway,
  csrfTokensIn,
  FERNWAY_ACCOUNTS,
  fernwayAccounts,
  filesContaining,
  loadFernwayBugs,
  needsSignIn,
  startFernway,
  stateChanges,
  type AccountState,
  type FernwayBug,
} from "./fernway.js";

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
  // 0.5.0: the upgrade success page (no form). Clean mode confirms only a paid checkout, so loading it changes nothing.
  { route: "/app/upgraded", forms: [] },
];

/** The two access-control scenarios (docs/v2-spec.md "access-control"). */
const ACCESS_SCENARIOS = ["access-control:other-account", "access-control:signed-out"] as const;

/** The 0.5.0 write-side checks (docs/v2-spec.md "Checks (0.5.0)"): unticked by default, they change Account A's data. */
const WRITE_SIDE: readonly CheckId[] = ["write-access", "csrf", "paywall-trust"];
const isWriteSide = (checkId: string) => (WRITE_SIDE as readonly string[]).includes(checkId);

/**
 * Where each write-side check must plan on clean Fernway, signed in as Alex with Sam as B (docs/v2-spec.md "Checks
 * (0.5.0)"): write-access and csrf on /app (Quick add saves a task), paywall-trust on /app/settings (the profile
 * holds Alex's plan). The profile form changes the account's email, so csrf and write-access don't use it.
 */
const WRITE_SIDE_PAGES: { route: string; checks: CheckId[] }[] = [
  { route: "/app", checks: ["write-access", "csrf"] },
  { route: "/app/settings", checks: ["paywall-trust"] },
];

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
const writeSide = !only || only.includes("write-side");
const keepRuns = process.env.KEEP_RUNS === "1";
const anySignedIn = selectedRoutes.some((r) => needsSignIn(r.route)) || selectedBugs.some((c) => needsSignIn(c.route)) || writeSide;

/** A non-loopback IPv4 address of this machine: it reaches Fernway but has no localhost/127.0.0.1 twin (csrf). */
const lanAddress = Object.values(networkInterfaces())
  .flat()
  .find((n) => n && n.family === "IPv4" && !n.internal)?.address;

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
 * Every secret the engine held registered while a signed-in plan or run was going: the passwords and the session
 * values sign-in produced (cookies, bearer tokens, in every encoding redactSecrets knows). Sampled from the log and
 * progress callbacks, so it holds the real session cookie values of these runs without the test ever reading a
 * cookie. Values shorter than 8 characters are left out: they could turn up by chance in an image's bytes.
 */
const runSecrets = new Set<string>();
function sampleSecrets(): void {
  for (const secret of registeredLiterals().secrets) if (secret.length >= 8) runSecrets.add(secret);
}
function logInto(logs: string[]): (line: string) => void {
  return (line) => {
    logs.push(line);
    sampleSecrets();
  };
}

/** Alex's (A) and Sam's (B) data, read through Fernway's API: the write-side checks must leave it as it was. */
async function bothAccounts(url: string): Promise<{ alex: AccountState; sam: AccountState }> {
  const [alex, sam] = await Promise.all([accountState(url, "alex"), accountState(url, "sam")]);
  return { alex, sam };
}

/** What changed in Alex's and Sam's pre-existing data between two reads (test records created by the run are not). */
function accountChanges(before: { alex: AccountState; sam: AccountState }, after: { alex: AccountState; sam: AccountState }): string[] {
  return [...stateChanges(before.alex, after.alex).map((c) => `Alex (A) ${c}`), ...stateChanges(before.sam, after.sam).map((c) => `Sam (B) ${c}`)];
}

/**
 * Discovers and plans `route` on a running Fernway, signed in as Alex (A, with Sam as B) when the route needs a
 * session, else signed out as in 0.3.0.
 */
async function planRoute(url: string, route: string, logs: string[], allowedHosts?: string[]): Promise<{ plan: Plan; accounts: AccountsConfig | undefined }> {
  const accounts = needsSignIn(route) ? fernwayAccounts(url) : undefined;
  const plan = await discoverAndPlan(`${url}${route}`, {
    checks,
    log: logInto(logs),
    ...(accounts ? { signInAs: "a" as const, accounts } : {}),
    ...(allowedHosts ? { allowedHosts } : {}),
  });
  return { plan, accounts };
}

/** Runs the approved scenarios of `plan` (with the accounts it was planned with) into runsRoot/<name>. */
async function runRoute(
  label: string,
  plan: Plan,
  approved: string[],
  accounts: AccountsConfig | undefined,
  name: string,
  logs: string[],
  allowedHosts?: string[],
) {
  const { report, dir } = await runPlan(plan, {
    checks,
    approved,
    allowDestructive: false,
    runsDir: join(runsRoot, name),
    log: logInto(logs),
    onProgress: sampleSecrets,
    ...(accounts ? { accounts } : {}),
    ...(allowedHosts ? { allowedHosts } : {}),
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

describe.skipIf(selectedRoutes.length === 0).concurrent("Run Hound against Fernway in clean mode", () => {
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

      // Every scenario approved: on /app pages that includes mass-assignment and the write-side checks (unticked by
      // default) and both access checks.
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

describe.skipIf(selectedBugs.length === 0).concurrent("Run Hound catches each Fernway planted bug", () => {
  it.for(selectedBugs)("$label: $bug.detectedBy reports it", async ({ bug, route, label }, { expect }) => {
    const fw = await startFernway(bug.id);
    const logs: string[] = [];
    try {
      await fw.reset();
      // The write-side bugs (0.5.0): Alex's and Sam's data before the run, to hold the check to restoring it.
      const before = isWriteSide(bug.detectedBy) ? await bothAccounts(fw.url) : null;
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
      if (before) {
        expect.soft(
          accountChanges(before, await bothAccounts(fw.url)),
          `${bug.id}: Alex's and Sam's records and plan after the run (the check must restore what it changed)`,
        ).toEqual([]);
      }
    } finally {
      await fw.stop();
    }
  });
});

describe.skipIf(!writeSide).concurrent("the write-side checks on clean Fernway (0.5.0)", () => {
  it.for(WRITE_SIDE_PAGES)("$route: all three ticked, no confirmed finding, Alex's and Sam's data unchanged", async (spec, { expect }) => {
    const fw = await startFernway("none");
    const logs: string[] = [];
    try {
      await fw.reset();
      const before = await bothAccounts(fw.url);
      const { plan, accounts } = await planRoute(fw.url, spec.route, logs);
      expect.soft(plan.account?.id, `${spec.route} discovered signed in as account A`).toBe("a");
      const writes = plan.scenarios.filter((s) => isWriteSide(s.checkId));
      for (const checkId of spec.checks) {
        expect.soft(writes.some((s) => s.checkId === checkId), `${checkId} is planned on ${spec.route} (docs/v2-spec.md "Checks (0.5.0)")`).toBe(true);
      }
      expect.soft(
        writes.filter((s) => s.defaultSelected || s.destructive).map((s) => s.id),
        "write-side scenarios are unticked by default and not destructive",
      ).toEqual([]);
      if (writes.length === 0) return;

      const label = `write-side ${spec.route}`;
      const report = await runRoute(label, plan, writes.map((s) => s.id), accounts, `write-side${spec.route.replace(/\//g, "_")}`, logs);
      console.log(describeRun(label, plan, report));

      expect.soft(
        report.results.filter((r) => r.status === "error").map((r) => `${r.scenarioId}: ${r.notes ?? "(no notes)"}`),
        "errored scenarios",
      ).toEqual([]);
      expect.soft(
        report.findings.filter((f) => f.confidence === "confirmed").map((f) => `${f.checkId}: ${f.title}${f.location ? ` @ ${f.location}` : ""}`),
        "confirmed write-side findings on clean Fernway",
      ).toEqual([]);
      expect.soft(
        report.results
          .filter((r) => r.status === "skipped")
          .filter((r) => !r.notes || r.notes.trim().length < 10 || TECHNICAL.test(r.notes))
          .map((r) => `${r.scenarioId}: ${JSON.stringify(r.notes ?? null)}`),
        "skipped scenarios without a plain-language reason",
      ).toEqual([]);
      // A pass never stands next to something that could not be undone (docs/v2-spec.md "Safety contract").
      expect.soft(
        report.results.filter((r) => r.status === "pass" && /could not be undone|check Account A/i.test(r.notes ?? "")).map((r) => `${r.scenarioId}: ${r.notes}`),
        "passing scenarios that say something could not be undone",
      ).toEqual([]);
      expect.soft(accountChanges(before, await bothAccounts(fw.url)), "Alex's and Sam's records and plan after the run").toEqual([]);
    } finally {
      await fw.stop();
    }
  });

  // docs/v2-spec.md "csrf": with no truly cross-site local origin, the scenario is inconclusive, never confirmed or pass.
  // Fernway reached at this machine's own non-loopback address has no localhost/127.0.0.1 twin. V08 is on, so a
  // missing defence is there to be found: the check must still not report it.
  it.skipIf(!lanAddress)("csrf on a target with no cross-site twin reports inconclusive (V08 on, non-loopback address)", async ({ expect }) => {
    const fw = await startFernway("V08");
    const logs: string[] = [];
    try {
      await fw.reset();
      const url = fw.url.replace("localhost", lanAddress!);
      const allowedHosts = [lanAddress!];
      const { plan, accounts } = await planRoute(url, "/app", logs, allowedHosts);
      expect(plan.account?.id, "/app discovered signed in as account A at the non-loopback address").toBe("a");
      const approved = plan.scenarios.filter((s) => s.checkId === "csrf").map((s) => s.id);
      expect(approved, "csrf is planned on /app").not.toEqual([]);

      const label = "csrf inconclusive /app";
      const report = await runRoute(label, plan, approved, accounts, "csrf-inconclusive", logs, allowedHosts);
      console.log(describeRun(label, plan, report));
      const results = report.results.filter((r) => r.checkId === "csrf");
      expect(results.map((r) => r.scenarioId).sort(), "every csrf scenario has a result").toEqual([...approved].sort());
      for (const r of results) {
        expect.soft(r.status, `${r.scenarioId}: neither pass nor fail (${r.notes ?? "no notes"})`).toBe("skipped");
        expect.soft(r.notes ?? "", `${r.scenarioId}: says it is inconclusive, and why`).toMatch(/inconclusive[\s\S]*cross-site/i);
        expect.soft(r.findings.map((f) => `${f.confidence} ${f.title}`), `${r.scenarioId}: no finding`).toEqual([]);
      }
    } finally {
      await fw.stop();
    }
  });
});

describe("the signed-in runs never write a password, a session value or a CSRF token", () => {
  it.skipIf(!anySignedIn)("no report, evidence file, spec, log line, Plan or Report of a signed-in run holds a password, a session cookie value or a CSRF token", async ({ expect }) => {
    expect(
      signedInRuns.filter((r) => r.signedIn).map((r) => r.label),
      `runs that really ran signed in as account A (none: signing in failed or never happened; runs with the accounts: ${signedInRuns.map((r) => r.label).join(", ") || "none"})`,
    ).not.toEqual([]);
    // The session values (0.5.0 widening): sampled while the runs held them registered. Signing in always registers
    // the session cookie, so an empty set means the sampling broke, not that there was nothing to find.
    expect(runSecrets.size, "session values registered during the signed-in runs").toBeGreaterThan(2);
    const passwords: Record<string, string> = { "Alex's password": FERNWAY_ACCOUNTS.alex.password, "Sam's password": FERNWAY_ACCOUNTS.sam.password };
    const needles: Record<string, string> = { ...passwords };
    let n = 0;
    for (const secret of runSecrets) if (!Object.values(passwords).includes(secret)) needles[`a session value (#${++n}, never printed)`] = secret;
    for (const run of signedInRuns) {
      expect.soft(await filesContaining(run.dir, needles), `${run.label}: files in ${run.dir}`).toEqual([]);
      expect.soft(await csrfTokensIn(run.dir), `${run.label}: CSRF tokens in the clear in ${run.dir}`).toEqual([]);
      expect.soft(
        run.logs.filter((line) => Object.values(needles).some((p) => line.includes(p))).length,
        `${run.label}: log lines holding a password or a session value`,
      ).toBe(0);
      expect.soft(
        Object.entries(needles).filter(([, p]) => run.json.includes(p)).map(([label]) => label),
        `${run.label}: the Plan and Report objects`,
      ).toEqual([]);
    }
  });
});
