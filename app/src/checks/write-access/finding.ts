/**
 * Finding and replay-spec for write-access: builds the Finding object (finding) and exports the Playwright spec
 * (replaySpec) that reproduces the write outside Run Hound. The SpecInput contract lives in
 * `interfaces/write-access.ts`; the identity-name table lives in `constants/write-access-constants.ts`. The
 * other focused modules (identity, record matching, record body, write build, CSRF tokens, credentials,
 * version stamps, restoration) live alongside this one.
 */
import { endpointOf, tryCard } from "../../checks/lib/functional-finding.js";
import { redactSecrets } from "../../engine/redact.js";
import { WHO } from "../../constants/write-access-constants.js";
import { aroundId } from "./record-match.js";
import type { CheckContext, Evidence, Finding, Scenario } from "../../core/types.js";
import type { Effect, RecordIdOf, SpecInput, Write } from "../../interfaces/write-access.js";
import type { Who } from "../../types/write-access.js";

/** The finding for a write `who` got through on Account A's test record (read at `readUrl`, its id `id`). */
export async function finding(
  ctx: CheckContext,
  scenario: Scenario,
  who: Who,
  w: Write,
  status: number | null,
  n: number,
  effect: Effect,
  readUrl: string,
  id: RecordIdOf,
): Promise<Finding> {
  const endpoint = endpointOf(w.method, w.url);
  const isDelete = w.method === "DELETE";
  const verb = isDelete || effect.gone ? "delete" : "change";
  const changed = effect.changed.join(", ");
  const title = `${WHO[who].subject} can ${verb} Account A's records`;
  const evidence: Evidence[] = await tryCard(ctx, `${endpoint} as ${WHO[who].words}`, {
    title: `${endpoint} sent as ${WHO[who].words}`,
    subtitle: effect.gone ? "Re-read as Account A: the record is gone." : `Re-read as Account A: ${changed} changed.`,
    lines: [
      { text: `Sent as: ${WHO[who].words}`, mark: true },
      { text: `Answer: ${status ?? "none"}` },
      { text: effect.gone ? "Account A's test record was deleted." : `Account A's test record changed after the request (${changed}).`, mark: true },
    ],
    facts: [
      { label: "Request", value: endpoint },
      { label: "Sent as", value: WHO[who].words },
      { label: "Status", value: status === null ? "none" : String(status) },
      ...(effect.gone ? [] : [{ label: effect.changed.length === 1 ? "Field changed" : "Fields changed", value: changed }]),
    ],
  });
  // An update's spec watches the field it sets; a DELETE that left the record there, changed (the app's soft delete),
  // the fields it changed. Every spec also checks that the record is still there.
  const watch = !isDelete ? [w.field!] : effect.gone ? [] : effect.changed;
  return {
    checkId: "write-access",
    id: `write-access#${scenario.id}-${n}`,
    title,
    severity: "critical",
    category: "security",
    confidence: "confirmed",
    meaning: `Run Hound saved a test record as Account A, then sent ${endpoint} as ${WHO[who].words}. Re-reading the record as Account A showed it ${
      effect.gone ? "was deleted" : `had changed (${changed})`
    }. The server doesn't check that the record belongs to whoever sends the ${verb === "delete" ? "delete" : "update"}.`,
    impact:
      who === "other"
        ? `Any signed-in user can ${verb} other users' records by sending their ids (insecure direct object reference).`
        : `Anyone, without signing in, can ${verb} users' records by sending their ids.`,
    fix: `Ask your AI or developer: "${endpoint} must only let the signed-in owner of the record ${verb} it: require a session, look the record up by id AND the session user's id, and answer 404 (or 403) otherwise. The same for every update and delete route."`,
    location: endpoint,
    evidence,
    spec: {
      filename: `write-access-${WHO[who].slug}-${n}.spec.ts`,
      source: redactSecrets(replaySpec({ target: ctx.targetUrl, write: w, who, verb, readUrl, id, watch })),
    },
  };
}

/**
 * A standalone spec: signs in as Account A (and B) from environment variables, reads a record Account A owns, sends the
 * same request as the other identity, and re-reads it as Account A: the record must still be there with the watched
 * fields unchanged. The status code is only reported, never the verdict. It creates nothing itself; no value Run Hound
 * typed and no credential is in it.
 */
export function replaySpec(o: SpecInput): string {
  const q = (v: unknown) => JSON.stringify(v);
  const w = o.write;
  const isDelete = w.method === "DELETE";
  const urlExpr = (url: string) => {
    const parsed = new URL(url, o.target);
    const around = aroundId(parsed, o.id);
    return around
      ? `${q(around.prefix)} + encodeURIComponent(RECORD_ID)${around.suffix ? ` + ${q(around.suffix)}` : ""}`
      : q(`${parsed.pathname}${parsed.search}`);
  };
  // The value goes where the app's own update holds the record: one level down ({"task": {...}}) when it nests it.
  // A form update that nests the record under the model's name (Rails' task[title]) sends the value under that key.
  const value = w.formKey ? `{ ${q(w.formKey)}: "runhound-" + Date.now() }` : `{ [FIELD]: "runhound-" + Date.now() }`;
  const payload = isDelete ? "" : `, ${w.kind === "form" ? "form" : "data"}: ${w.nest ? `{ ${q(w.nest)}: ${value} }` : value}`;
  const identity = o.who === "other" ? "Account B" : "a visitor with no session";
  return [
    `import { test, expect, request, type APIRequestContext } from "@playwright/test";`,
    ``,
    `// Exported by Run Hound. Set the accounts' environment variables before running:`,
    `//   RUNHOUND_ACCOUNT_A_LOGIN_URL, RUNHOUND_ACCOUNT_A_USERNAME, RUNHOUND_ACCOUNT_A_PASSWORD${o.who === "other" ? ", and the same with _B_" : ""}.`,
    `// Create a test record as Account A first and set RECORD_ID to its id: this test sends the request below for it as`,
    `// ${identity}, which ${isDelete ? "deletes" : "changes"} it when the app is vulnerable. The verdict comes from re-reading the record as`,
    `// Account A, not from the answer's status (a server can answer 403 and still apply the write, or 200 and ignore it).`,
    `const TARGET = ${q(o.target)};`,
    `// No default: an app that reuses ids could have given Run Hound's test record id to one of Account A's real records.`,
    `const RECORD_ID = process.env.RECORD_ID ?? "";`,
    `const ID_KEY = ${q(o.id.key)};`,
    `const RECORD_URL = process.env.RECORD_URL ?? ${urlExpr(w.url)}; // the request Run Hound sent`,
    `const RECORD_READ = process.env.RECORD_READ ?? ${urlExpr(o.readUrl)}; // reads the record as Account A`,
    `const METHOD = ${q(w.method)};`,
    ...(isDelete ? [] : [`const FIELD = ${q(w.field ?? "title")};`]),
    `const WATCH = ${q(o.watch)} as string[]; // fields that must read the same after the request`,
    ...(w.headerTokens && w.headerTokens.length > 0
      ? [
          `// Your app's own request carried an anti-CSRF header (${w.headerTokens.map((t) => t.name).join(", ")}): add it to the request below,`,
          `// with ${o.who === "other" ? "Account B's own token, read the way your app's scripts read it" : "a signed-out visitor's token if your app gives one"}, or the app may refuse it for that alone.`,
        ]
      : []),
    ``,
    `// Your app's sign-in request (a path on the login page's origin). Run Hound signed in through the login page, so it`,
    `// doesn't know this request: set it, and the body sessionFor sends, before running the test.`,
    `const SIGN_IN_ENDPOINT = "/YOUR-SIGN-IN-ENDPOINT";`,
    ``,
    `// Sign in through the app's own login and return the session as storage state (cookies + localStorage).`,
    `async function sessionFor(slot: "A" | "B") {`,
    `  if (SIGN_IN_ENDPOINT.startsWith("/YOUR-")) throw new Error("Replace SIGN_IN_ENDPOINT and sessionFor with your app's sign-in before running this test.");`,
    `  const loginUrl = process.env["RUNHOUND_ACCOUNT_" + slot + "_LOGIN_URL"]!;`,
    `  const username = process.env["RUNHOUND_ACCOUNT_" + slot + "_USERNAME"]!;`,
    `  const password = process.env["RUNHOUND_ACCOUNT_" + slot + "_PASSWORD"]!;`,
    `  const ctx = await request.newContext();`,
    `  // Your app's sign-in call: it must set the session cookie or return a token.`,
    `  await ctx.post(new URL(SIGN_IN_ENDPOINT, loginUrl).href, { data: { username, password } });`,
    `  const state = await ctx.storageState();`,
    `  await ctx.dispose();`,
    `  return state;`,
    `}`,
    ``,
    `// The object in \`node\` (the read's JSON) whose ID_KEY is RECORD_ID, or undefined when it isn't there.`,
    `function findRecord(node: unknown): Record<string, unknown> | undefined {`,
    `  if (Array.isArray(node)) {`,
    `    for (const item of node) {`,
    `      const found = findRecord(item);`,
    `      if (found) return found;`,
    `    }`,
    `    return undefined;`,
    `  }`,
    `  if (!node || typeof node !== "object") return undefined;`,
    `  const obj = node as Record<string, unknown>;`,
    `  if (obj[ID_KEY] !== undefined && String(obj[ID_KEY]) === RECORD_ID) return obj;`,
    `  for (const value of Object.values(obj)) {`,
    `    const found = findRecord(value);`,
    `    if (found) return found;`,
    `  }`,
    `  return undefined;`,
    `}`,
    ``,
    `// The record as Account A reads it, or undefined when it is gone.`,
    `async function readAsA(a: APIRequestContext) {`,
    `  const res = await a.get(new URL(RECORD_READ, TARGET).href);`,
    `  if (res.status() === 404 || res.status() === 410) return undefined;`,
    `  expect(res.ok(), "Account A can read its record").toBe(true);`,
    `  return findRecord(await res.json());`,
    `}`,
    ``,
    `test(${q(`${WHO[o.who].subject} can't ${o.verb} Account A's records`)}, async () => {`,
    `  if (!RECORD_ID) throw new Error(${q(`Set RECORD_ID to the id of a test record you created as Account A (Run Hound's was ${String(o.id.value)}).`)});`,
    `  const a = await request.newContext({ storageState: await sessionFor("A") });`,
    o.who === "other"
      ? `  const other = await request.newContext({ storageState: await sessionFor("B") });`
      : `  const other = await request.newContext(); // no session`,
    `  try {`,
    `    const before = await readAsA(a);`,
    `    expect(before, "Account A's record " + RECORD_ID + " is there before the test").toBeDefined();`,
    `    const res = await other.fetch(new URL(RECORD_URL, TARGET).href, { method: METHOD${payload} });`,
    `    test.info().annotations.push({ type: "answer", description: METHOD + " " + RECORD_URL + " answered " + res.status() });`,
    `    const after = await readAsA(a);`,
    `    expect(after, "the record is gone after a " + METHOD + " from someone who doesn't own it").toBeDefined();`,
    `    for (const key of WATCH) {`,
    `      expect(after?.[key], key + " changed after a " + METHOD + " from someone who doesn't own it").toEqual(before?.[key]);`,
    `    }`,
    `  } finally {`,
    `    await other.dispose();`,
    `    await a.dispose();`,
    `  }`,
    `});`,
    ``,
  ].join("\n");
}
