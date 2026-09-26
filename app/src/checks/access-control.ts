/**
 * access-control (0.4.0, docs/v2-spec.md "access-control"): can account B, or a signed-out visitor, read account A's
 * data? Both scenarios first establish account A's data on the page (a test record from the main saving form, else the
 * responses that name the account), then replay A's data requests as the other account and as a signed-out visitor.
 * Read-only: only A's own GETs are replayed, never a path that acts (a sign-out, an unsubscribe). Account markers
 * (A's username or email) and the test record's values are matched but never printed: evidence describes them as
 * "Account A's email" / "Account A's test record".
 */
import type { Page } from "playwright";
import { isLocalOrigin, isSameOrigin, tokenKey } from "../core/saves.js";
import type { Capture, Check, CheckContext, DiscoveredForm, Evidence, Fact, Finding, Identity, PlanEnv, Scenario, Severity } from "../core/types.js";
import { openForm } from "../engine/open-form.js";
import { formLabel } from "../engine/plan.js";
import { isDestructiveControl } from "./dead-control.js";
import { actsWhenLoaded } from "./lib/acting-links.js";
import { endpointOf, errorResult, guarded, markText, result, tryCapture, tryCard } from "./lib/functional-finding.js";
import { canaryValues, fieldName, fillForm, isSearchForm, settle, submitControl, submitForm, waitForCreates, type FieldValue } from "./lib/functional-form.js";

const ID = "access-control" as const;

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** One string that identifies A's data, and how to describe it without printing it. */
interface Marker {
  value: string;
  label: string;
  /** "record": a value of the test record (it carries the run token); "username": Account A's username or email. */
  kind: "record" | "username";
}

/** One of A's data requests: a GET whose 2xx answer named the account. */
interface DataRequest {
  method: string;
  url: string;
  endpoint: string;
  body: string;
}

/** An endpoint that returned A's data to another identity, with the answer that proves it. */
interface Leak {
  endpoint: string;
  method: string;
  url: string;
  status: number;
  body: string;
  label: string;
}

/**
 * Every string that would give A's data away: the values Run Hound saved as A (its test record) and A's own username
 * or email (accountMarkers). Longer values first, so a value that contains another is masked whole.
 */
function markersOf(ctx: CheckContext, saved: string[]): Marker[] {
  const token = tokenKey(ctx.runToken);
  const markers: Marker[] = [];
  for (const value of saved) if (value.length >= 4) markers.push({ value, label: "Account A's test record", kind: "record" });
  if (token.length >= 4) markers.push({ value: token, label: "Account A's test record", kind: "record" });
  for (const value of ctx.accountMarkers()) if (value.trim().length >= 4) markers.push({ value: value.trim(), label: "Account A's email", kind: "username" });
  return markers.sort((a, b) => b.value.length - a.value.length);
}

function parseJson(body: string): unknown {
  if (!/^\s*[[{"]/.test(body)) return undefined;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True when a string of `json` (a value or a key) is `name` (any case), or holds the email `name` as a whole address. */
function jsonNames(json: unknown, name: string): boolean {
  const wanted = name.toLowerCase();
  const email = wanted.includes("@") ? new RegExp(`(?<![a-z0-9._%+-])${escapeRegExp(wanted)}(?![a-z0-9_%+-]|\\.[a-z0-9])`, "i") : null;
  const matches = (text: string) => text.trim().toLowerCase() === wanted || (email !== null && email.test(text));
  const walk = (node: unknown, depth: number): boolean => {
    if (depth > 12) return false;
    if (typeof node === "string") return matches(node);
    if (Array.isArray(node)) return node.some((n) => walk(n, depth + 1));
    if (node && typeof node === "object") return Object.entries(node).some(([k, v]) => matches(k) || walk(v, depth + 1));
    return false;
  };
  return walk(json, 0);
}

/**
 * The first marker `body` holds, or null. A test-record value (it carries the run token, so it is nobody else's)
 * counts anywhere in the answer, in any case. A username counts only in a JSON answer, as a whole value (or, for an
 * email, a whole address inside one): never as part of another name ("tester12" is not "tester1"), and never in HTML
 * or script text, where a public page can mention a demo account or a route of the same name.
 */
function markerIn(body: string, markers: Marker[]): Marker | null {
  const lc = body.toLowerCase();
  for (const m of markers) if (m.kind === "record" && lc.includes(m.value.toLowerCase())) return m;
  const names = markers.filter((m) => m.kind === "username");
  if (names.length === 0) return null;
  const json = parseJson(body);
  if (json === undefined) return null;
  return names.find((m) => jsonNames(json, m.value)) ?? null;
}

/** Replaces every marker value in `text` with its label, so no username, email or saved value is ever shown. */
function maskMarkers(text: string, markers: Marker[]): string {
  let out = text;
  for (const m of markers) {
    const re = new RegExp(m.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    out = out.replace(re, `[${m.label}]`);
  }
  return out;
}

/** A short body excerpt for a card, marker-masked, marking the line that names the account. */
function bodyExcerpt(body: string, markers: Marker[], maxLines = 20): { text: string; mark?: boolean }[] {
  let text = body;
  try {
    text = JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    // Not JSON: shown as sent.
  }
  const masked = maskMarkers(text, markers);
  const lines = masked.split("\n");
  const shown = lines.length > maxLines ? [...lines.slice(0, maxLines), `… ${lines.length - maxLines} more lines`] : lines;
  return shown.map((l) => ({ text: l.length > 160 ? `${l.slice(0, 160)}…` : l, mark: /Account A's (email|test record)/.test(l) }));
}

function count(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? "" : "s"}`;
}

/** "Checked 3 of Account A's requests as Account B; none returned Account A's data." (one request reads as such). */
function checkedNote(n: number, how: string): string {
  return n === 1
    ? `Checked Account A's only data request ${how}; it didn't return Account A's data.`
    : `Checked ${n} of Account A's requests ${how}; none returned Account A's data.`;
}

/** Builds a confirmed access-control finding: the shared shape for both scenarios. */
function accessFinding(
  ctx: CheckContext,
  scenario: Scenario,
  input: { title: string; severity: Severity; meaning: string; impact: string; fix: string; leaks: Leak[]; evidence: Evidence[]; identity: Identity },
): Finding {
  const locations = input.leaks.map((l) => `${l.method} ${pathOf(l.url)} (${l.status})`);
  return {
    checkId: ID,
    id: `${ID}#${scenario.id}-1`,
    title: input.title,
    severity: input.severity,
    category: "security",
    confidence: "confirmed",
    meaning: input.meaning,
    impact: input.impact,
    fix: input.fix,
    location: locations[0]!,
    locations,
    evidence: input.evidence,
    spec: { filename: `${ID}-${input.identity}.spec.ts`, source: replaySpec(ctx.targetUrl, input.leaks, input.identity) },
  };
}

/**
 * A standalone @playwright/test spec that reproduces the leak: two request contexts (A and the other identity), whose
 * credentials come from environment variables (never inlined), replaying each endpoint and asserting the other
 * identity cannot read A's record. Marker values are never written into the spec.
 */
function replaySpec(target: string, leaks: Leak[], identity: Identity): string {
  const q = (v: unknown) => JSON.stringify(v);
  const endpoints = leaks.map((l) => pathOf(l.url));
  const otherWords = identity === "signed-out" ? "a signed-out visitor" : "Account B";
  const lines: string[] = [
    `import { test, expect, request } from "@playwright/test";`,
    ``,
    `// Exported by Run Hound. Set the account environment variables before running:`,
    `//   RUNHOUND_ACCOUNT_A_LOGIN_URL, RUNHOUND_ACCOUNT_A_USERNAME, RUNHOUND_ACCOUNT_A_PASSWORD (and _B_ for Account B).`,
    `const TARGET = ${q(target)};`,
    `const ENDPOINTS = ${q(endpoints)} as unknown as string[];`,
    ``,
    `// Sign in through the app's own login form and return the session as storage state (cookies + localStorage).`,
    `async function sessionFor(slot: "A" | "B") {`,
    `  const loginUrl = process.env["RUNHOUND_ACCOUNT_" + slot + "_LOGIN_URL"]!;`,
    `  const username = process.env["RUNHOUND_ACCOUNT_" + slot + "_USERNAME"]!;`,
    `  const password = process.env["RUNHOUND_ACCOUNT_" + slot + "_PASSWORD"]!;`,
    `  const ctx = await request.newContext();`,
    `  // Replace with your app's sign-in call; it must set the session cookie or return a token.`,
    `  await ctx.post(new URL("/api/login", loginUrl).href, { data: { username, password } });`,
    `  const state = await ctx.storageState();`,
    `  await ctx.dispose();`,
    `  return state;`,
    `}`,
    ``,
    `test(${q(`${otherWords} cannot read Account A's data`)}, async () => {`,
    `  const a = await request.newContext({ storageState: await sessionFor("A") });`,
  ];
  if (identity === "other") {
    lines.push(`  const other = await request.newContext({ storageState: await sessionFor("B") });`);
  } else {
    lines.push(`  const other = await request.newContext(); // signed out: no session`);
  }
  lines.push(
    ``,
    `  for (const path of ENDPOINTS) {`,
    `    const url = new URL(path, TARGET).href;`,
    `    const mine = await a.get(url);`,
    `    expect(mine.ok(), path + " should return Account A's own data to Account A").toBe(true);`,
    `    const theirs = await other.get(url);`,
    `    // ${otherWords} must not get Account A's record back (a 401/403/404 or an answer without it).`,
    `    expect(theirs.ok() && (await theirs.text()) === (await mine.text()), path + " leaked Account A's data").toBe(false);`,
    `  }`,
    `  await a.dispose();`,
    `  await other.dispose();`,
    `});`,
    ``,
  );
  return lines.join("\n");
}

/** Answers that can hold account data: the app's API reads and the page's own HTML. Never scripts or styles. */
const DATA_TYPES = new Set(["fetch", "xhr", "document"]);
/** At most this many reads from another local origin are read again (capture keeps no body for them). */
const MAX_REREADS = 10;

/** Forms whose save changes the account itself, not a record: never used for the test record. */
const ACCOUNT_FORM =
  /\b(passwords?|passcode|e-?mail|two[\s-]?factor|2fa|mfa|security|sign\s?-?(in|up|out)|log\s?-?(in|out)|register|delete|close\s+(my\s+)?account|deactivate|username)\b/i;

/**
 * True for a form that saves a record Run Hound may create as Account A: it has fields and a submit control, isn't a
 * search, sets no password or email (a change-password or change-email form would change the account Run Hound signs
 * in with), its submit control isn't destructive, and its name doesn't say it changes the account.
 */
function savesRecord(form: DiscoveredForm): boolean {
  const submit = submitControl(form);
  if (!submit || form.fields.length === 0 || isSearchForm(form)) return false;
  if (form.fields.some((f) => f.type === "password" || f.type === "email" || /e-?mail/i.test(fieldName(f)))) return false;
  if (isDestructiveControl(submit)) return false;
  return !ACCOUNT_FORM.test(`${form.name ?? ""} ${submit.accessibleName ?? ""} ${submit.text}`);
}

/** The form the test record is saved with: the scenario's form when it saves a record, else the page's first that does. */
function recordForm(ctx: CheckContext): DiscoveredForm | null {
  const forms = [ctx.form, ...(ctx.discoveredPage?.forms ?? []).filter((f) => f.selector !== ctx.form.selector)];
  return forms.find(savesRecord) ?? null;
}

/** True when the page shows a visible password field: the sign-in form, where a form of the signed-in page should be. */
async function showsPasswordField(page: Page): Promise<boolean> {
  return (await page.locator("input[type=password]:visible").count().catch(() => 0)) > 0;
}

/** The first line of an error, without Playwright's call log. */
function firstLine(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).split("\n")[0] ?? "";
}

/**
 * The answers of `capture` that may hold account data, in the order they came: GETs of this app (its origin, or its
 * API on another local origin) that answered 2xx, from the API or the page's HTML, and that don't act when loaded. A
 * read from another local origin has no body in the capture: it is read again as `as`, once per URL (at most
 * MAX_REREADS URLs). The same endpoint may come more than once (before and after the test record was saved).
 */
async function dataAnswers(ctx: CheckContext, capture: Capture, as: "self" | "other"): Promise<{ url: string; endpoint: string; status: number; body: string }[]> {
  const out: { url: string; endpoint: string; status: number; body: string }[] = [];
  const reread = new Map<string, { status: number; body: string } | null>();
  for (const r of [...capture.requests]) {
    if (r.method.toUpperCase() !== "GET" || !DATA_TYPES.has(r.resourceType)) continue;
    if (typeof r.status !== "number" || r.status < 200 || r.status >= 300) continue;
    const same = isSameOrigin(r.url, ctx.targetUrl);
    if (!same && !isLocalOrigin(r.url, ctx.targetUrl)) continue;
    if (actsWhenLoaded(r.url)) continue;
    const endpoint = endpointOf("GET", r.url);
    if (r.responseBody) {
      out.push({ url: r.url, endpoint, status: r.status, body: r.responseBody });
      continue;
    }
    if (same || r.resourceType === "document") continue;
    if (!reread.has(r.url)) {
      if (reread.size >= MAX_REREADS) continue;
      const again = await ctx.request(as, { method: "GET", url: r.url }).catch(() => null);
      reread.set(r.url, again && again.status >= 200 && again.status < 300 && again.body ? { status: again.status, body: again.body } : null);
    }
    const again = reread.get(r.url);
    if (again) out.push({ url: r.url, endpoint, ...again });
  }
  return out;
}

/**
 * Establishes A's data on the page (as the run account): if the page has a form that saves a record, fill it with
 * test values carrying the run token and submit, then reload. Returns A's data requests (GETs whose 2xx answer named
 * the account), deduped by endpoint, at most 10, the markers to match and mask by, and notes on what could not be
 * done. Throws a plain Error when the page shows the sign-in form instead of the form: the session has ended.
 */
async function establish(ctx: CheckContext): Promise<{ dataRequests: DataRequest[]; markers: Marker[]; notes: string[] }> {
  const { page, capture } = await ctx.openPage({ as: "self" });
  const saved: string[] = [];
  const notes: string[] = [];
  const form = recordForm(ctx);
  if (form) {
    const label = formLabel(form);
    await openForm(page, form).catch(() => undefined);
    const shown = await page.locator(form.selector).first().isVisible().catch(() => false);
    if (!shown && (await showsPasswordField(page))) {
      throw new Error(
        `Opened as Account A, the page showed a sign-in form instead of the ${label}: Account A's session has ended (something earlier in the run may have signed it out), so there is nothing to compare.`,
      );
    }
    if (!shown) {
      notes.push(`The ${label} wasn't on the page when Run Hound opened it as Account A, so no test record was saved.`);
    } else {
      ctx.step("Saving a test record as Account A", page);
      const values: FieldValue[] = canaryValues(form, ctx.runToken, "access");
      try {
        await fillForm(page, values);
        await submitForm(page, form);
        await waitForCreates(page, capture, ctx.targetUrl, undefined, ctx.runToken);
        for (const v of values) if (v.canary && v.value) saved.push(v.value);
      } catch (err) {
        ctx.log(`could not save a test record: ${firstLine(err)}`);
        notes.push(`Run Hound could not save a test record through the ${label}, so only answers that name Account A count.`);
      }
      ctx.step("Reloading to see Account A's data", page);
      await page.reload({ waitUntil: "load" }).catch(() => undefined);
      await settle(page);
    }
  }
  const markers = markersOf(ctx, saved);

  const dataRequests: DataRequest[] = [];
  const seen = new Set<string>();
  for (const answer of await dataAnswers(ctx, capture, "self")) {
    if (seen.has(answer.endpoint) || !markerIn(answer.body, markers)) continue;
    seen.add(answer.endpoint);
    dataRequests.push({ method: "GET", url: answer.url, endpoint: answer.endpoint, body: answer.body });
    if (dataRequests.length >= 10) break;
  }
  return { dataRequests, markers, notes };
}

async function runOtherAccount(ctx: CheckContext, scenario: Scenario, started: number, dataRequests: DataRequest[], markers: Marker[], notes: string[]) {
  const other = ctx.accounts?.other;
  if (!other) return errorResult(ID, scenario, started, "Skipped: no second account is configured for the other-account check.", "skipped");
  const replayable = dataRequests.filter((r) => !actsWhenLoaded(r.url));

  const leaks = new Map<string, Leak>();

  // 1. Account B opens the page normally: any 2xx answer that names A is a leak (and often visible on B's page).
  ctx.step("Opening the page as Account B");
  const { page: bPage, capture: bCap } = await ctx.openPage({ as: "other" });
  const visibleValues: string[] = [];
  for (const answer of await dataAnswers(ctx, bCap, "other")) {
    const hit = leaks.has(answer.endpoint) ? null : markerIn(answer.body, markers);
    if (!hit) continue;
    leaks.set(answer.endpoint, { endpoint: answer.endpoint, method: "GET", url: answer.url, status: answer.status, body: answer.body, label: hit.label });
    if (hit.kind === "record") visibleValues.push(hit.value);
  }

  // 2. Replay each of A's data requests as B.
  for (const req of replayable) {
    ctx.step(`Replaying ${req.endpoint} as Account B`);
    const answer = await ctx.request("other", { method: "GET", url: req.url }).catch(() => null);
    if (!answer || answer.status < 200 || answer.status >= 300) continue;
    const hit = markerIn(answer.body, markers);
    if (!hit) continue;
    leaks.set(req.endpoint, { endpoint: req.endpoint, method: "GET", url: req.url, status: answer.status, body: answer.body, label: hit.label });
  }

  if (leaks.size === 0) {
    return result(ID, scenario, started, [], [checkedNote(replayable.length, `as ${other.label}`), ...notes].join(" "));
  }

  const found = [...leaks.values()];
  const evidence: Evidence[] = [];
  // A frame of B's page, when B's page itself shows one of A's records.
  for (const value of visibleValues.slice(0, 1)) {
    const marked = await markText(bPage, value, "rh-a-data", 1).catch(() => []);
    const selector = marked[0];
    evidence.push(
      ...(await tryCapture(ctx, bPage, "Account A's record on Account B's page", {
        ...(selector ? { highlights: [{ selector, label: "Account A's test record" }] } : {}),
        caption: `Signed in as ${other.label}, the page shows a record that belongs to Account A.`,
        facts: [{ label: "Signed in as", value: other.label }],
      })),
    );
  }
  for (const leak of found) evidence.push(...(await endpointCard(ctx, leak, markers, other.label)));

  const finding = accessFinding(ctx, scenario, {
    title: `Account B can read Account A's data (${count(found.length, "endpoint")})`,
    severity: "critical",
    meaning: `Signed in as ${other.label}, Run Hound could read data that belongs to Account A from ${count(found.length, "endpoint")}. Two accounts that should not see each other's data are not kept apart by the server.`,
    impact: `Any signed-in user can read another user's private data (their records, their profile), so nothing a person keeps in this app is private from other accounts.`,
    fix: `Ask your AI or developer: "These endpoints return one account's data to another signed-in account: ${found.map((l) => `${l.method} ${pathOf(l.url)}`).join(", ")}. Check on the server that the signed-in user owns the record before returning it, and answer 403 or 404 otherwise."`,
    leaks: found,
    evidence,
    identity: "other",
  });
  return result(ID, scenario, started, [finding], notes.join(" ") || undefined);
}

async function runSignedOut(ctx: CheckContext, scenario: Scenario, started: number, dataRequests: DataRequest[], markers: Marker[], notes: string[]) {
  const replayable = dataRequests.filter((r) => !actsWhenLoaded(r.url));
  const leaks = new Map<string, Leak>();
  for (const req of replayable) {
    ctx.step(`Replaying ${req.endpoint} with no session`);
    const answer = await ctx.request("signed-out", { method: "GET", url: req.url }).catch(() => null);
    if (!answer || answer.status < 200 || answer.status >= 300) continue; // 401/403/404 or a redirect is a pass.
    const hit = markerIn(answer.body, markers);
    if (!hit) continue;
    leaks.set(req.endpoint, { endpoint: req.endpoint, method: "GET", url: req.url, status: answer.status, body: answer.body, label: hit.label });
  }

  if (leaks.size === 0) {
    return result(ID, scenario, started, [], [checkedNote(replayable.length, "with no session"), ...notes].join(" "));
  }

  const found = [...leaks.values()];
  const evidence: Evidence[] = [];
  for (const leak of found) evidence.push(...(await endpointCard(ctx, leak, markers, "a signed-out visitor")));

  const finding = accessFinding(ctx, scenario, {
    title: `Account A's data is readable without signing in (${count(found.length, "endpoint")})`,
    severity: "critical",
    meaning: `Run Hound read data that belongs to Account A from ${count(found.length, "endpoint")} with no session at all: no cookie and no token. The server hands this data to anyone who asks for the right address.`,
    impact: `Anyone on the internet who knows (or guesses) the address can read this data without an account. Private records are effectively public.`,
    fix: `Ask your AI or developer: "These endpoints return account data without a session: ${found.map((l) => `${l.method} ${pathOf(l.url)}`).join(", ")}. Require a signed-in session on the server and answer 401 otherwise; the client-side redirect to the login page is not enough."`,
    leaks: found,
    evidence,
    identity: "signed-out",
  });
  return result(ID, scenario, started, [finding], notes.join(" ") || undefined);
}

/** A card of one leaking request: the request line, the status, and the marker-masked answer. */
async function endpointCard(ctx: CheckContext, leak: Leak, markers: Marker[], asWho: string): Promise<Evidence[]> {
  const facts: Fact[] = [
    { label: "Requested as", value: asWho },
    { label: "Status", value: String(leak.status) },
    { label: "Returned", value: leak.label },
  ];
  return tryCard(ctx, `${leak.method} ${pathOf(leak.url)} returned ${leak.label}`, {
    title: `${leak.method} ${pathOf(leak.url)} → ${leak.status}, requested as ${asWho}`,
    subtitle: `The answer holds ${leak.label} (shown here masked; the real value is never printed).`,
    lines: bodyExcerpt(leak.body, markers),
    facts,
  });
}

export const check: Check = {
  id: ID,
  title: "Another account or a signed-out visitor can't read your data",
  category: "security",
  scope: "page",

  plan(_form, _page, env?: PlanEnv): Scenario[] {
    if (!env?.signedIn) return [];
    const scenarios: Scenario[] = [];
    if (env.otherAccount) {
      scenarios.push({
        id: `${ID}:other-account`,
        checkId: ID,
        title: "Another account can't read Account A's data",
        description:
          "Save a test record as Account A, then, signed in as Account B, load the page and replay the requests that returned Account A's data. Account B must not get Account A's records back. Read-only: only Account A's own GETs are replayed.",
        kind: "danger",
        priority: "high",
        destructive: false,
        defaultSelected: true,
      });
    }
    scenarios.push({
      id: `${ID}:signed-out`,
      checkId: ID,
      title: "Signed-out visitors can't read Account A's data",
      description:
        "Save a test record as Account A, then replay the requests that returned Account A's data with no session at all. Each must be refused (401, 403, 404 or a redirect). Read-only: only Account A's own GETs are replayed.",
      kind: "danger",
      priority: "high",
      destructive: false,
      defaultSelected: true,
    });
    return scenarios;
  },

  run(ctx, scenario) {
    return guarded(ID, scenario, ctx, async (started) => {
      const { dataRequests, markers, notes } = await establish(ctx);
      if (dataRequests.length === 0) {
        return errorResult(
          ID,
          scenario,
          started,
          ["Account A has no data on this page that Run Hound can recognise (no form saved a record, and no response names Account A).", ...notes].join(" "),
          "skipped",
        );
      }
      const which = scenario.id.includes("other-account") ? "other" : "signed-out";
      return which === "other"
        ? runOtherAccount(ctx, scenario, started, dataRequests, markers, notes)
        : runSignedOut(ctx, scenario, started, dataRequests, markers, notes);
    });
  },
};
