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
 * mass-assignment and the write-side checks (csrf, write-access, paywall-trust: unticked by default), and both
 * access-control scenarios (other-account, signed-out) must pass.
 *
 * The write-side checks (docs/v2-spec.md "Acceptance (0.5.0 additions)" and "Acceptance (0.6.0)") also run on their
 * own on clean Fernway, every one ticked: on /app (csrf, write-access), /app/settings, /app/help and /app/upgraded
 * (paywall-trust) no confirmed finding, the scenarios that catch V06-V09 in bug mode pass (so the clean result isn't a
 * skip), and a re-read through Fernway's API shows Alex's and Sam's pre-existing tasks, projects and profiles (Alex's
 * plan included) as they were, and the run's own test records holding none of the checks' probe values.
 * `csrf` on Fernway reached at a non-loopback address (no localhost/127.0.0.1 twin) reports inconclusive, never a
 * finding and never a pass.
 *
 * Then each planted bug alone (FERNWAY_BUGS=<id>, fixtures/fernway/bugs.json; every bug's check is built from 0.6.0,
 * so none is skipped): the scenarios of the bug's `detectedBy` check run on its page ("*" = every page, tested on /;
 * V03 also on its `alsoOn` page), signed in on /app pages, and that check must report a confirmed finding from the
 * bug's `scenario` when it names one. For a write-side bug (V06-V09) every write-side scenario planned on the page is
 * ticked, as a user testing the writes would. Either way, only the named scenario (or, when the bug names none, only
 * its check) may report a confirmed finding. For V06-V09, Alex's and Sam's data is re-read afterwards and must be as it
 * was: the checks restored what they changed (Alex's plan after V09 included), the run's own test records (the ones
 * csrf and write-access write to) hold no probe value, and no scenario says something could not be undone. V09's
 * finding names the success page that granted the plan (/app/upgraded).
 *
 * Sign-in modes (0.6.0, docs/v2-spec.md "Sign-in: two-step and sessionStorage" and "Fernway (0.6.0)"): with
 * FERNWAY_LOGIN=two-step, and separately with FERNWAY_SESSION=session-storage, signing in as Alex works, the signed-in
 * plan for /app matches the one a cookie session gets, and V02 (a read bug access-control catches) is caught the same
 * way as with a cookie session. With FERNWAY_SESSION=session-storage, csrf passes on V08 (no cookie rides along) and
 * leaves Alex's and Sam's data as it was. The sessionStorage plans and runs go one at a time with nothing else going,
 * so each one's sample of the registered secrets is its own.
 *
 * Last, no run folder, log line, progress event, Plan or Report of any signed-in run holds either account's password,
 * a session value of the run (every secret the engine registered while it ran: sign-in's cookies and tokens,
 * sessionStorage tokens included), a CSRF token, or a session value in the clear by its shape (a bearer or
 * sessionStorage token, or a cookie-mode session id: a grep that doesn't depend on what the engine registered, on the
 * run folders and on the Plan/Report JSON, log lines and progress events). The progress events (steps, pages, scenario
 * ends) are what the web UI streams to the browser as the run's live log; frames are pixels, a documented limit, and
 * are left out.
 *
 * Env:
 *   ACCEPTANCE_FERNWAY=/,/app,W01   run only these routes and bugs (default: all); "clean" = every route, "bugs" = every bug,
 *                                   "write-side" = the clean write-side runs and the inconclusive csrf run,
 *                                   "modes" = the sign-in mode runs ("two-step" or "session-storage" = one of them)
 *   FERNWAY_SKIP_BUILD=1            reuse fixtures/fernway/dist instead of running `vite build`
 *   ACCEPTANCE_FERNWAY_DIR=<dir>    build and start Fernway from a copy of fixtures/fernway instead
 *   KEEP_RUNS=1                     keep the runs/ directories (paths are printed)
 */
import { mkdtemp, rm } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { AccountsConfig } from "../../../app/src/interfaces/accounts.js";
import { checks } from "../../../app/src/checks/index.js";
import type { CheckId, DiscoveredForm, Plan, Report } from "../../../app/src/core/types.js";
import { registeredLiterals } from "../../../app/src/engine/redact.js";
import { discoverAndPlan, runPlan, type ProgressEvent } from "../../../app/src/engine/runner.js";
import {
  accountState,
  buildFernway,
  csrfTokensIn,
  FERNWAY_ACCOUNTS,
  fernwayAccounts,
  filesContaining,
  leftChanged,
  loadFernwayBugs,
  needsSignIn,
  probeValuesLeft,
  SESSION_TOKEN_SHAPE,
  sessionTokenShapesIn,
  sessionTokensIn,
  startFernway,
  stateChanges,
  type AccountState,
  type FernwayBug,
  type FernwayModes,
  type FernwaySession,
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

/**
 * The write-side checks (docs/v2-spec.md "Checks (0.5.0)", "Registration (0.6.0)"): unticked by default, they change
 * Account A's data (paywall-trust: its plan) and put it back.
 */
const WRITE_SIDE: readonly CheckId[] = ["csrf", "write-access", "paywall-trust"];
const isWriteSide = (checkId: string) => (WRITE_SIDE as readonly string[]).includes(checkId);

/**
 * Where the write-side checks must plan on clean Fernway, signed in as Alex with Sam as B, and the scenarios that must
 * pass there (docs/v2-spec.md "Checks (0.5.0)", "Acceptance (0.6.0)"): on /app, Quick add saves a task and then sends
 * the app's own PATCH for it, so csrf and both write-access scenarios run on it (the scenarios that catch V08, V06 and
 * V07); paywall-trust is planned on every signed-in page, and on /app/settings (V09's page) it finds Alex's plan in the
 * profile the page loads. The profile form edits a record Alex already had, so csrf and write-access don't use it.
 * A pass here is what makes "no confirmed finding" mean something: a skipped scenario would find nothing either.
 * paywall-trust also runs on /app/help and on /app/upgraded, the success page itself (the page most likely to change
 * the plan): neither loads Alex's plan, so the scenario may skip there (with its reason), and no scenario has to pass;
 * what holds there is that Alex's and Sam's data, Alex's plan included, reads the same afterwards.
 */
const WRITE_SIDE_PAGES: { route: string; checks: CheckId[]; pass: string[] }[] = [
  { route: "/app", checks: ["csrf", "write-access", "paywall-trust"], pass: ["csrf:cross-site", "write-access:other-account", "write-access:signed-out"] },
  { route: "/app/settings", checks: ["paywall-trust"], pass: ["paywall-trust:success-page"] },
  { route: "/app/help", checks: ["paywall-trust"], pass: [] },
  { route: "/app/upgraded", checks: ["paywall-trust"], pass: [] },
];

/** Checks this build has. From 0.6.0 every planted bug's check is built: a test holds that, and no bug is skipped. */
const built = new Set<string>(checks.map((c) => c.id));
const allBugs = await loadFernwayBugs();

/** One (bug, page) pair: a bug is tested on its page and on every `alsoOn` page. */
interface BugCase {
  bug: FernwayBug;
  route: string;
  /** "V03 on /app/settings" style label for the test name. */
  label: string;
}
const bugCases: BugCase[] = allBugs.flatMap((bug) => {
  const pages = [bug.page === "*" ? "/" : bug.page, ...(bug.alsoOn ?? [])];
  return pages.map((route) => ({ bug, route, label: `${bug.id} on ${route}` }));
});

/**
 * The sign-in and session modes (docs/v2-spec.md "Fernway (0.6.0)"), each tested on its own against a cookie session
 * with the one-step form.
 */
const MODES: { name: string; keyword: string; modes: FernwayModes }[] = [
  { name: "FERNWAY_LOGIN=two-step", keyword: "two-step", modes: { login: "two-step" } },
  { name: "FERNWAY_SESSION=session-storage", keyword: "session-storage", modes: { session: "session-storage" } },
];

/**
 * The read bug the sign-in mode runs must catch as a cookie session does (docs/v2-spec.md "Acceptance (0.6.0)"): V02,
 * every user's tasks in GET /api/tasks, caught by access-control:other-account on /app. It needs both accounts' sessions
 * to work in the mode (Alex's to find the data, Sam's to read it), and the signed-out scenario beside it must stay clean.
 */
const MODE_BUG = "V02";

const only = process.env.ACCEPTANCE_FERNWAY?.split(",").map((s) => s.trim()).filter(Boolean);
const selectedRoutes = only ? ROUTES.filter((r) => only.includes(r.route) || only.includes("clean")) : ROUTES;
const selectedBugs = only ? bugCases.filter((c) => only.includes(c.bug.id) || only.includes("bugs")) : bugCases;
const writeSide = !only || only.includes("write-side");
const selectedModes = only ? MODES.filter((m) => only.includes("modes") || only.includes(m.keyword)) : MODES;
/** csrf on V08 with a sessionStorage session (it passes: no cookie rides along). */
const csrfSessionStorage = !only || only.includes("modes") || only.includes("session-storage");
const keepRuns = process.env.KEEP_RUNS === "1";
const anySignedIn =
  selectedRoutes.some((r) => needsSignIn(r.route)) || selectedBugs.some((c) => needsSignIn(c.route)) || writeSide || selectedModes.length > 0 || csrfSessionStorage;

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
 * What one plan or run printed (its log lines and its progress events, see progressInto), and the secrets the engine
 * held registered while it went (sampled, see runSecrets).
 */
interface RunLog {
  lines: string[];
  secrets: Set<string>;
}
const newLog = (): RunLog => ({ lines: [], secrets: new Set() });

/**
 * The run folders, log lines (progress events included) and Plan/Report objects (as JSON: what the web API hands the
 * browser) of every plan and run started with the test accounts, grepped for the passwords and session values at the
 * end. `dir` is null for a
 * plan that wasn't run. `signedIn` is whether the plan or report says it really was account A; `session` is where
 * Fernway kept the session (a sessionStorage run must have registered its token); `identities` is how many accounts it
 * signed in (a plan signs in A only; a run signs B in too when an approved scenario needs it, and Report.accounts.other
 * says so), each with a session of its own that must have been registered.
 */
const signedInRuns: {
  label: string;
  dir: string | null;
  log: RunLog;
  json: string;
  signedIn: boolean;
  session: FernwaySession;
  identities: 1 | 2;
}[] = [];

/**
 * Every secret the engine held registered while a signed-in plan or run was going: the passwords and the session
 * values sign-in produced (cookies, bearer tokens, sessionStorage tokens, in every encoding redactSecrets knows).
 * Sampled from the log and progress callbacks, so it holds the real session values of these runs without the test ever
 * reading a cookie or a sessionStorage item. Values shorter than 8 characters are left out: they could turn up by
 * chance in an image's bytes. Each run keeps its own sample too (RunLog.secrets); runs going at the same time share
 * the engine's registry, so a sample may hold another run's values as well. The sessionStorage plans and runs go one
 * at a time with nothing else going, so theirs hold their own values only.
 */
const runSecrets = new Set<string>();
function sampleSecrets(log?: RunLog): void {
  for (const secret of registeredLiterals().secrets) {
    if (secret.length < 8) continue;
    runSecrets.add(secret);
    log?.secrets.add(secret);
  }
}
function logInto(log: RunLog): (line: string) => void {
  return (line) => {
    log.lines.push(line);
    sampleSecrets(log);
  };
}
/**
 * A plan's or run's progress events, kept as log lines ("[progress] <event as JSON>") so the password, session-value
 * and shape greps cover them too: the step, page and scenario-end events are what the web UI streams to the browser as
 * the run's live log. Frames are pixels (a documented limit: secrets can't be redacted from them) and are left out.
 * Sampling here is also what catches discovery's own session values: it reports its steps, the one after signing in
 * included, through onProgress, not the log.
 */
function progressInto(log: RunLog): (event: ProgressEvent) => void {
  return (event) => {
    if (event.type !== "frame") log.lines.push(`[progress] ${JSON.stringify(event)}`);
    sampleSecrets(log);
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
async function planRoute(url: string, route: string, log: RunLog, allowedHosts?: string[]): Promise<{ plan: Plan; accounts: AccountsConfig | undefined }> {
  const accounts = needsSignIn(route) ? fernwayAccounts(url) : undefined;
  const plan = await discoverAndPlan(`${url}${route}`, {
    checks,
    log: logInto(log),
    // The plan's own session values (its sign-in is not the run's) are sampled here, and its steps grepped.
    onProgress: progressInto(log),
    ...(accounts ? { signInAs: "a" as const, accounts } : {}),
    ...(allowedHosts ? { allowedHosts } : {}),
  });
  return { plan, accounts };
}

/** Keeps a signed-in plan that isn't run for the password and session-value grep. */
function recordPlan(label: string, plan: Plan, log: RunLog, session: FernwaySession): void {
  signedInRuns.push({ label, dir: null, log, json: JSON.stringify({ plan }), signedIn: plan.account?.id === "a", session, identities: 1 });
}

/** Runs the approved scenarios of `plan` (with the accounts it was planned with) into runsRoot/<name>. */
async function runRoute(
  label: string,
  plan: Plan,
  approved: string[],
  accounts: AccountsConfig | undefined,
  name: string,
  log: RunLog,
  options: { allowedHosts?: string[]; session?: FernwaySession } = {},
) {
  const { report, dir } = await runPlan(plan, {
    checks,
    approved,
    allowDestructive: false,
    runsDir: join(runsRoot, name),
    log: logInto(log),
    onProgress: progressInto(log),
    ...(accounts ? { accounts } : {}),
    ...(options.allowedHosts ? { allowedHosts: options.allowedHosts } : {}),
  });
  if (accounts) {
    signedInRuns.push({
      label,
      dir,
      log,
      json: JSON.stringify({ plan, report }),
      signedIn: report.accounts?.signedInAs?.id === "a",
      session: options.session ?? "cookie",
      // runner.ts sets Report.accounts.other only when Account B really signed in for this run.
      identities: report.accounts?.other ? 2 : 1,
    });
  }
  return report;
}

/**
 * A plan as the sign-in modes must reproduce it (docs/v2-spec.md "Acceptance (0.6.0)": "the signed-in plan for /app
 * matches a cookie-session plan"): who it was discovered as, every form (name, opener, fields) and every scenario (id,
 * what it tests, whether it is destructive or ticked). Selectors, texts and timings are left out.
 */
function planShape(plan: Plan) {
  return {
    account: plan.account ?? null,
    signInHint: plan.signInHint ?? false,
    forms: (plan.page?.forms ?? [plan.form]).map((f) => ({
      name: f.name ?? null,
      opener: f.opener?.name ?? null,
      fields: f.fields.map((x) => `${norm(x.accessibleName ?? x.label)} (${x.type}/${x.role}${x.widget ? `, ${x.widget}` : ""}${x.required ? ", required" : ""})`),
    })),
    scenarios: plan.scenarios.map((s) => `${s.id}${s.scopeLabel ? ` on ${s.scopeLabel}` : ""}${s.destructive ? " (destructive)" : ""}${s.defaultSelected ? " (ticked)" : ""}`),
  };
}
type PlanShape = ReturnType<typeof planShape>;

/** Each scenario's status and confirmed findings (severity, title), Fernway's own address left out: "caught the same way". */
function resultShape(report: Report, origin: string): string[] {
  return report.results
    .map((r) => {
      const confirmed = r.findings.filter((f) => f.confidence === "confirmed").map((f) => `${f.checkId} ${f.severity} "${f.title.split(origin).join("<fernway>")}"`);
      return `${r.scenarioId}: ${r.status}${confirmed.length > 0 ? ` [${confirmed.join("; ")}]` : ""}`;
    })
    .sort();
}

/**
 * Cookie-session references the sign-in mode runs are compared with ("plan /app", "V02 /app"), each made once: by the
 * clean /app run or the V02 bug run when they ran first, else by the mode test that needs it.
 */
const references = new Map<string, Promise<unknown>>();
function reference<T>(key: string, make: () => Promise<T>): Promise<T> {
  if (!references.has(key)) references.set(key, make());
  return references.get(key) as Promise<T>;
}
function keepReference<T>(key: string, value: T): void {
  if (!references.has(key)) references.set(key, Promise.resolve(value));
}

/** The approved scenarios of a bug run: its check's; for a write-side bug, every write-side scenario on the page too. */
function bugScenarios(plan: Plan, bug: FernwayBug): string[] {
  return plan.scenarios.filter((s) => s.checkId === bug.detectedBy || (isWriteSide(bug.detectedBy) && isWriteSide(s.checkId))).map((s) => s.id);
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
    const log = newLog();
    try {
      await fw.reset();
      const { plan, accounts } = await planRoute(fw.url, spec.route, log);
      const forms = plan.page?.forms ?? [plan.form];
      // The cookie session's plan for /app, which the sign-in modes must reproduce.
      if (signedIn && plan.account?.id === "a") keepReference(`plan ${spec.route}`, planShape(plan));

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

      // Every scenario approved: on /app pages that includes mass-assignment, the write-side checks (csrf, write-access,
      // paywall-trust: unticked by default) and both access checks.
      const approved = plan.scenarios.map((s) => s.id);
      if (signedIn) {
        expect.soft(approved.filter((id) => (ACCESS_SCENARIOS as readonly string[]).includes(id)).sort(), "both access-control scenarios planned").toEqual([...ACCESS_SCENARIOS].sort());
        expect.soft(plan.scenarios.some((s) => s.checkId === "mass-assignment"), "mass-assignment planned (a form that saves)").toBe(spec.forms.length > 0);
      }
      const report = await runRoute(`clean ${spec.route}`, plan, approved, accounts, `clean${spec.route.replace(/\//g, "_")}`, log);
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

// docs/v2-spec.md "Acceptance (0.6.0)": V06, V07 and V09 leave the skip list. Every bug's check is built, so every bug
// in bugs.json is tested, each with the check and scenario the spec names.
describe("every planted bug is tested", () => {
  it("each bug's detectedBy check is built, and V06, V07 and V09 name the scenarios the spec gives them", ({ expect }) => {
    expect(allBugs.filter((b) => !built.has(b.detectedBy)).map((b) => `${b.id} (${b.detectedBy})`), "bugs whose check isn't built (they would go untested)").toEqual([]);
    const pick = (id: string) => {
      const b = allBugs.find((x) => x.id === id);
      return b ? { detectedBy: b.detectedBy, scenario: b.scenario ?? null, page: b.page } : null;
    };
    expect({ V06: pick("V06"), V07: pick("V07"), V09: pick("V09") }).toEqual({
      V06: { detectedBy: "write-access", scenario: "write-access:other-account", page: "/app" },
      V07: { detectedBy: "write-access", scenario: "write-access:signed-out", page: "/app" },
      V09: { detectedBy: "paywall-trust", scenario: null, page: "/app/settings" },
    });
    expect(bugCases.map((c) => c.label), "bug runs").toEqual(expect.arrayContaining(["V06 on /app", "V07 on /app", "V08 on /app", "V09 on /app/settings"]));
  });
});

describe.skipIf(selectedBugs.length === 0).concurrent("Run Hound catches each Fernway planted bug", () => {
  it.for(selectedBugs)("$label: $bug.detectedBy reports it", async ({ bug, route, label }, { expect }) => {
    const fw = await startFernway(bug.id);
    const log = newLog();
    const writes = isWriteSide(bug.detectedBy);
    try {
      await fw.reset();
      // The write-side bugs (0.5.0, 0.6.0): Alex's and Sam's data before the run, to hold the checks to restoring it.
      const before = writes ? await bothAccounts(fw.url) : null;
      const { plan, accounts } = await planRoute(fw.url, route, log);
      if (needsSignIn(route)) expect.soft(plan.account?.id, `${route} discovered signed in as account A`).toBe("a");
      const approved = bugScenarios(plan, bug);
      expect(approved.filter((id) => plan.scenarios.find((s) => s.id === id)?.checkId === bug.detectedBy), `scenarios planned for ${bug.detectedBy} on ${route}`).not.toEqual([]);
      if (bug.scenario) expect(approved, `the ${bug.scenario} scenario is planned`).toContain(bug.scenario);

      const report = await runRoute(label, plan, approved, accounts, `${bug.id}${route.replace(/\//g, "_")}`, log);
      console.log(describeRun(`${label} (${bug.detectedBy})`, plan, report));
      // The cookie session's V02 result on its page, which the sign-in modes must reproduce.
      if (bug.id === MODE_BUG && route === bug.page && report.accounts?.signedInAs?.id === "a") keepReference(`${bug.id} ${route}`, resultShape(report, fw.url));

      expect.soft(
        report.results.filter((r) => r.status === "error").map((r) => `${r.scenarioId}: ${r.notes ?? "(no notes)"}`),
        "errored scenarios",
      ).toEqual([]);
      // The named scenario catches it: the bug's `scenario`, or when it names none, its check's.
      const named = (r: { scenarioId: string; checkId: string }) => (bug.scenario ? r.scenarioId === bug.scenario : r.checkId === bug.detectedBy);
      const caught = report.results.filter(named).flatMap((r) => r.findings).filter((f) => f.checkId === bug.detectedBy && f.confidence === "confirmed");
      expect(
        caught.map((f) => f.title),
        `${bug.id} "${bug.title}": a confirmed ${bug.scenario ?? bug.detectedBy} finding (results: ${report.results.map((r) => `${r.scenarioId}=${r.status}${r.notes ? ` (${r.notes})` : ""}`).join("; ")})`,
      ).not.toEqual([]);

      if (bug.version === "V2") {
        expect.soft(caught.map((f) => f.severity), `severity of the ${bug.id} finding`).toContain(bug.severity);
      }
      // V09 is the success page granting the plan on load: the finding names that page (paywall-trust's location).
      if (bug.id === "V09") {
        expect.soft(caught.map((f) => f.location ?? ""), "V09: the finding names the success page that granted the plan").toContainEqual(expect.stringMatching(/\/app\/upgraded/));
      }
      // Nothing else catches it: the check's other scenarios (e.g. signed-out for V01 and V06, other-account for V07)
      // and, for a write-side bug, the other write-side checks ticked beside it find nothing.
      expect.soft(
        report.results
          .filter((r) => !named(r))
          .flatMap((r) => r.findings.filter((f) => f.confidence === "confirmed").map((f) => `${r.scenarioId}: ${f.title}`)),
        `${bug.id} is caught only by ${bug.scenario ?? bug.detectedBy}`,
      ).toEqual([]);
      if (before) {
        const after = await bothAccounts(fw.url);
        expect.soft(
          accountChanges(before, after),
          `${bug.id}: Alex's and Sam's tasks, projects and profiles (Alex's plan included) after the run: the checks must restore what they changed`,
        ).toEqual([]);
        // The run's own test records are the ones csrf and write-access write to, and accountChanges leaves them out:
        // re-read, none may still hold a probe value (on V08, csrf's forged create is a new record and may keep its own).
        expect.soft(probeValuesLeft(after, bug.id === "V08"), `${bug.id}: the run's test records still holding a probe value (not put back)`).toEqual([]);
        expect.soft(
          report.results.filter((r) => leftChanged(r.notes, r.checkId)).map((r) => `${r.scenarioId}: ${r.notes}`),
          `${bug.id}: scenarios that say something could not be undone`,
        ).toEqual([]);
      }
    } finally {
      await fw.stop();
    }
  });
});

describe.skipIf(!writeSide).concurrent("the write-side checks on clean Fernway (0.5.0, 0.6.0)", () => {
  it.for(WRITE_SIDE_PAGES)("$route: the write-side checks ticked, no confirmed finding, Alex's and Sam's data unchanged", async (spec, { expect }) => {
    const fw = await startFernway("none");
    const log = newLog();
    try {
      await fw.reset();
      const before = await bothAccounts(fw.url);
      const { plan, accounts } = await planRoute(fw.url, spec.route, log);
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
      const report = await runRoute(label, plan, writes.map((s) => s.id), accounts, `write-side${spec.route.replace(/\//g, "_")}`, log);
      console.log(describeRun(label, plan, report));

      expect.soft(
        report.results.filter((r) => r.status === "error").map((r) => `${r.scenarioId}: ${r.notes ?? "(no notes)"}`),
        "errored scenarios",
      ).toEqual([]);
      expect.soft(
        report.findings.filter((f) => f.confidence === "confirmed").map((f) => `${f.checkId}: ${f.title}${f.location ? ` @ ${f.location}` : ""}`),
        "confirmed write-side findings on clean Fernway",
      ).toEqual([]);
      // The scenarios that catch V06-V09 in bug mode really ran here, and passed.
      expect.soft(
        spec.pass.map((id) => {
          const r = report.results.find((x) => x.scenarioId === id);
          return `${id}: ${r ? r.status : "(no result)"}${r?.notes ? ` (${r.notes})` : ""}`;
        }),
        `the scenarios that catch the write-side bugs pass on clean ${spec.route}`,
      ).toEqual(spec.pass.map((id) => expect.stringMatching(new RegExp(`^${id}: pass\\b`))));
      expect.soft(
        report.results
          .filter((r) => r.status === "skipped")
          .filter((r) => !r.notes || r.notes.trim().length < 10 || TECHNICAL.test(r.notes))
          .map((r) => `${r.scenarioId}: ${JSON.stringify(r.notes ?? null)}`),
        "skipped scenarios without a plain-language reason",
      ).toEqual([]);
      // Nothing stands that could not be undone (docs/v2-spec.md "Safety contract"), and never next to a pass.
      expect.soft(
        report.results.filter((r) => leftChanged(r.notes, r.checkId)).map((r) => `${r.scenarioId} (${r.status}): ${r.notes}`),
        "scenarios that say something could not be undone",
      ).toEqual([]);
      const after = await bothAccounts(fw.url);
      expect.soft(accountChanges(before, after), "Alex's and Sam's tasks, projects and profiles (Alex's plan included) after the run").toEqual([]);
      expect.soft(probeValuesLeft(after), "the run's test records still holding a probe value (not put back)").toEqual([]);
    } finally {
      await fw.stop();
    }
  });

  // docs/v2-spec.md "csrf": with no truly cross-site local origin, the scenario is inconclusive, never confirmed or pass.
  // Fernway reached at this machine's own non-loopback address has no localhost/127.0.0.1 twin. V08 is on, so a
  // missing defence is there to be found: the check must still not report it.
  it.skipIf(!lanAddress)("csrf on a target with no cross-site twin reports inconclusive (V08 on, non-loopback address)", async ({ expect }) => {
    const fw = await startFernway("V08");
    const log = newLog();
    try {
      await fw.reset();
      const url = fw.url.replace("localhost", lanAddress!);
      const allowedHosts = [lanAddress!];
      const { plan, accounts } = await planRoute(url, "/app", log, allowedHosts);
      expect(plan.account?.id, "/app discovered signed in as account A at the non-loopback address").toBe("a");
      const approved = plan.scenarios.filter((s) => s.checkId === "csrf").map((s) => s.id);
      expect(approved, "csrf is planned on /app").not.toEqual([]);

      const label = "csrf inconclusive /app";
      const report = await runRoute(label, plan, approved, accounts, "csrf-inconclusive", log, { allowedHosts });
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

/**
 * The cookie session's plan for `route` (clean Fernway, one-step sign-in), for the sign-in modes to match: the clean
 * route run keeps it when it runs first (keepReference), else this plans it.
 */
async function cookiePlan(route: string): Promise<PlanShape> {
  const fw = await startFernway("none");
  const log = newLog();
  try {
    await fw.reset();
    const { plan } = await planRoute(fw.url, route, log);
    recordPlan(`cookie reference plan ${route}`, plan, log, "cookie");
    return planShape(plan);
  } finally {
    await fw.stop();
  }
}

/** The cookie session's result for a read bug on its page (its check's scenarios only), as the bug run makes it. */
async function cookieBugResults(bug: FernwayBug): Promise<string[]> {
  const fw = await startFernway(bug.id);
  const log = newLog();
  try {
    await fw.reset();
    const { plan, accounts } = await planRoute(fw.url, bug.page, log);
    const report = await runRoute(`cookie reference ${bug.id}`, plan, bugScenarios(plan, bug), accounts, `reference-${bug.id}`, log);
    return resultShape(report, fw.url);
  } finally {
    await fw.stop();
  }
}

type Mode = (typeof MODES)[number];

/**
 * The tests of each sign-in mode in `modes` (docs/v2-spec.md "Acceptance (0.6.0)" and "Sign-in: two-step and
 * sessionStorage (0.6.0)"): signing in works and /app plans as with a cookie session, and V02 is caught the same way.
 */
function modeTests(modes: Mode[]): void {
  it.for(modes)("$name: signing in as Alex works, and /app plans as it does with a cookie session", async ({ name, modes }, { expect }) => {
    const fw = await startFernway("none", modes);
    const log = newLog();
    try {
      expect(await fw.config(), `Fernway runs with ${name}`).toEqual({ bugs: [], login: fw.login, session: fw.session });
      await fw.reset();
      // discoverAndPlan fails when signing in fails, or when /app still shows the sign-in form afterwards.
      const { plan } = await planRoute(fw.url, "/app", log);
      recordPlan(`${name} plan /app`, plan, log, fw.session);
      expect(plan.account, "Plan.account: discovered signed in as account A").toEqual({ id: "a", label: "Account A" });
      expect.soft(
        (plan.page?.forms ?? [plan.form]).map((f) => f.name ?? ""),
        "the signed-in dashboard was discovered (Quick add), not the sign-in page",
      ).toEqual(expect.arrayContaining([expect.stringMatching(/quick add/i)]));
      const cookie = await reference("plan /app", () => cookiePlan("/app"));
      expect(planShape(plan), `the plan for /app with ${name}, against a cookie session's`).toEqual(cookie);
    } finally {
      await fw.stop();
    }
  });

  it.for(modes)(`$name: ${MODE_BUG} is caught the same way as with a cookie session`, async ({ name, modes }, { expect }) => {
    const bug = allBugs.find((b) => b.id === MODE_BUG);
    expect(bug, `${MODE_BUG} in bugs.json`).toBeDefined();
    const fw = await startFernway(bug!.id, modes);
    // The plan and the run each keep their own log and sample, so the grep test holds each to registering its own
    // session (the run signs in again, as A and as B).
    const planLog = newLog();
    const log = newLog();
    const label = `${name} ${bug!.id} on ${bug!.page}`;
    try {
      expect(await fw.config(), `Fernway runs with ${name} and ${bug!.id}`).toEqual({ bugs: [bug!.id], login: fw.login, session: fw.session });
      await fw.reset();
      const { plan, accounts } = await planRoute(fw.url, bug!.page, planLog);
      recordPlan(`${label} (plan)`, plan, planLog, fw.session);
      expect(plan.account?.id, `${bug!.page} discovered signed in as account A`).toBe("a");
      const approved = bugScenarios(plan, bug!);
      expect(approved, `the ${bug!.scenario} scenario is planned`).toContain(bug!.scenario);

      const report = await runRoute(label, plan, approved, accounts, `${fw.session}-${fw.login}-${bug!.id}`, log, { session: fw.session });
      console.log(describeRun(`${label} (${bug!.detectedBy})`, plan, report));
      expect.soft(report.accounts, "Report.accounts: signed in as A, with B signed in for the other-account scenario").toEqual({
        signedInAs: { id: "a", label: "Account A" },
        other: { id: "b", label: "Account B" },
      });
      const caught = report.results
        .filter((r) => r.scenarioId === bug!.scenario)
        .flatMap((r) => r.findings)
        .filter((f) => f.checkId === bug!.detectedBy && f.confidence === "confirmed");
      expect(
        caught.map((f) => f.severity),
        `${bug!.id}: a confirmed ${bug!.scenario} finding (results: ${report.results.map((r) => `${r.scenarioId}=${r.status}${r.notes ? ` (${r.notes})` : ""}`).join("; ")})`,
      ).toContain(bug!.severity);
      const cookie = await reference(`${bug!.id} ${bug!.page}`, () => cookieBugResults(bug!));
      expect(resultShape(report, fw.url), `each scenario's status and confirmed findings with ${name}, against a cookie session's`).toEqual(cookie);
    } finally {
      await fw.stop();
    }
  });
}

/** The sessionStorage mode goes on its own (below); the other modes go at the same time as the bug and write-side runs. */
const tokenModes = selectedModes.filter((m) => m.modes.session === "session-storage");
const otherModes = selectedModes.filter((m) => m.modes.session !== "session-storage");

describe.skipIf(otherModes.length === 0).concurrent("sign-in modes (0.6.0)", () => modeTests(otherModes));

/**
 * A sessionStorage session, one plan or run at a time with nothing else going: this describe is not concurrent, so
 * vitest runs it after the concurrent describes before it have finished, and its tests one after the other. Signing in
 * registers the session's values until that plan or run ends (runner.ts releases them), so while one of these goes the
 * only sessionStorage token the engine holds registered is its own, and its sample (RunLog.secrets) proves that its own
 * token was registered, not another run's (the grep test below).
 */
describe.skipIf(tokenModes.length === 0 && !csrfSessionStorage)("a sessionStorage session (0.6.0), one plan or run at a time", () => {
  modeTests(tokenModes);

  // docs/v2-spec.md "Fernway (0.6.0)": with no cookie there is nothing for a cross-site page to ride on, so csrf passes
  // on V08 in session-storage mode (V08 still takes a form body with no Origin check).
  it.skipIf(!csrfSessionStorage)("FERNWAY_SESSION=session-storage: csrf passes on V08, and Alex's and Sam's data is unchanged", async ({ expect }) => {
    const fw = await startFernway("V08", { session: "session-storage" });
    // The plan and the run each keep their own log and sample (see the V02 run above).
    const planLog = newLog();
    const log = newLog();
    const label = "session-storage V08 csrf /app";
    try {
      expect(await fw.config(), "Fernway runs V08 with a sessionStorage session").toEqual({ bugs: ["V08"], login: "one-step", session: "session-storage" });
      await fw.reset();
      const before = await bothAccounts(fw.url);
      const { plan, accounts } = await planRoute(fw.url, "/app", planLog);
      recordPlan(`${label} (plan)`, plan, planLog, fw.session);
      expect(plan.account?.id, "/app discovered signed in as account A").toBe("a");
      const approved = plan.scenarios.filter((s) => s.checkId === "csrf").map((s) => s.id);
      expect(approved, "csrf:cross-site is planned on /app (Quick add)").toContain("csrf:cross-site");

      const report = await runRoute(label, plan, approved, accounts, "session-storage-V08-csrf", log, { session: fw.session });
      console.log(describeRun(label, plan, report));
      expect.soft(
        report.results.filter((r) => r.status === "error" || r.status === "fail").map((r) => `${r.scenarioId} (${r.status}): ${r.notes ?? "(no notes)"}`),
        "csrf scenarios that failed or errored",
      ).toEqual([]);
      expect.soft(
        report.findings.filter((f) => f.confidence === "confirmed").map((f) => `${f.checkId}: ${f.title}`),
        "confirmed csrf findings on V08 with a sessionStorage session",
      ).toEqual([]);
      const quickAdd = report.results.find((r) => r.scenarioId === "csrf:cross-site");
      expect(`${quickAdd?.status ?? "(no result)"}${quickAdd?.notes ? ` (${quickAdd.notes})` : ""}`, "csrf:cross-site on Quick add passes").toMatch(/^pass\b/);
      expect.soft(
        report.results.filter((r) => leftChanged(r.notes, r.checkId)).map((r) => `${r.scenarioId} (${r.status}): ${r.notes}`),
        "scenarios that say something could not be undone",
      ).toEqual([]);
      const after = await bothAccounts(fw.url);
      expect.soft(accountChanges(before, after), "Alex's and Sam's tasks, projects and profiles after the run").toEqual([]);
      // csrf passes here, so not even its forged create may be left: no test record holds a probe value.
      expect.soft(probeValuesLeft(after), "the run's test records still holding a probe value (not put back)").toEqual([]);
    } finally {
      await fw.stop();
    }
  });
});

describe("the signed-in runs never write a password, a session value or a CSRF token", () => {
  it.skipIf(!anySignedIn)(
    "no report, evidence file, spec, log line, progress event, Plan or Report of a signed-in run holds a password, a session value (sessionStorage tokens included) or a CSRF token",
    async ({ expect }) => {
      expect(
        signedInRuns.filter((r) => r.signedIn).map((r) => r.label),
        `runs that really ran signed in as account A (none: signing in failed or never happened; runs with the accounts: ${signedInRuns.map((r) => r.label).join(", ") || "none"})`,
      ).not.toEqual([]);
      // The session values (0.5.0 widening): sampled while the runs held them registered. Signing in always registers
      // the session cookie, so an empty set means the sampling broke, not that there was nothing to find.
      expect(runSecrets.size, "session values registered during the signed-in runs").toBeGreaterThan(2);
      // 0.6.0: a sessionStorage session's token is registered too (docs/v2-spec.md "Sign-in: two-step and
      // sessionStorage"), so the grep below looks for it. Cookie sessions are UUIDs: only a token has this shape. The
      // shape grep (sessionTokensIn, sessionTokenShapesIn) needs no registry: it finds a token or a cookie-mode session
      // id under Fernway's keys in any run, cookie runs (two-step's included, which go beside others) as well.
      const tokenRuns = signedInRuns.filter((r) => r.session === "session-storage" && r.signedIn);
      if (selectedModes.some((m) => m.modes.session === "session-storage") || csrfSessionStorage) {
        expect(tokenRuns.map((r) => r.label), "plans and runs signed in with a sessionStorage session").not.toEqual([]);
      }
      // The sessionStorage plans and runs go one at a time with nothing else going (their describe isn't concurrent), so
      // each one's sample holds its own values only: a token here is that run's own. A run that signed B in too holds
      // two sessions, A's and B's, and each token must have been registered, or the grep below never looks for B's.
      for (const run of tokenRuns) {
        expect.soft(
          [...run.log.secrets].filter((v) => SESSION_TOKEN_SHAPE.test(v)).length,
          `${run.label}: the sessionStorage token of each identity it signed in (${run.identities === 2 ? "A and B" : "A"}) is among the values registered while it went`,
        ).toBeGreaterThanOrEqual(run.identities);
      }
      const passwords: Record<string, string> = { "Alex's password": FERNWAY_ACCOUNTS.alex.password, "Sam's password": FERNWAY_ACCOUNTS.sam.password };
      const needles: Record<string, string> = { ...passwords };
      let n = 0;
      for (const secret of runSecrets) if (!Object.values(passwords).includes(secret)) needles[`a session value (#${++n}, never printed)`] = secret;
      for (const run of signedInRuns) {
        if (run.dir) {
          expect.soft(await filesContaining(run.dir, needles), `${run.label}: files in ${run.dir}`).toEqual([]);
          expect.soft(await csrfTokensIn(run.dir), `${run.label}: CSRF tokens in the clear in ${run.dir}`).toEqual([]);
          expect.soft(await sessionTokensIn(run.dir), `${run.label}: bearer or sessionStorage tokens or cookie session ids in the clear in ${run.dir}`).toEqual([]);
        }
        expect.soft(
          run.log.lines.filter((line) => Object.values(needles).some((p) => line.includes(p))).length,
          `${run.label}: log lines or progress events holding a password or a session value`,
        ).toBe(0);
        // The shape grep of the run folders, on what has none: the Plan/Report (a plan never run included), the log and
        // the progress events.
        expect.soft(
          sessionTokenShapesIn(`${run.json}\n${run.log.lines.join("\n")}`),
          `${run.label}: bearer or sessionStorage tokens or cookie session ids in the clear in its Plan/Report, log or progress events`,
        ).toEqual([]);
        expect.soft(
          Object.entries(needles).filter(([, p]) => run.json.includes(p)).map(([label]) => label),
          `${run.label}: the Plan and Report objects`,
        ).toEqual([]);
      }
    },
  );
});
