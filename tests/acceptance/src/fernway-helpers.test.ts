/**
 * Guards the Fernway helpers the acceptance runs lean on (no browser, no Fernway): the greps that hold the signed-in
 * runs to never writing a session value, so a grep that can't find anything can't pass for a clean run folder.
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  csrfTokensIn,
  filesContaining,
  leftChanged,
  probeValuesLeft,
  SESSION_TOKEN_SHAPE,
  sessionTokenShapesIn,
  sessionTokensIn,
  type AccountState,
} from "./fernway.js";

/** A made-up token of Fernway's session-storage shape (43 characters of base64url). Never a real session. */
const TOKEN = "Zm9vYmFyYmF6cXV4LXRva2VuLXNoYXBlLW9ubHktMTIz".slice(0, 43);
/** A made-up session id of Fernway's cookie mode (a UUID). Never a real session. */
const COOKIE_ID = "6f1c2b1e-0c3a-4f0e-9a52-6a0b8e7d9c11";
/** How the cookie check shows a session cookie in its evidence: masked, its length only. */
const MASKED_COOKIE = "> fernway_session=… (36 chars)  no HttpOnly; no Secure; SameSite=Lax; Path=/";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rh-fernway-helpers-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function put(name: string, text: string): Promise<void> {
  const path = join(dir, name);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, text);
}

describe("sessionTokensIn (0.6.0: sessionStorage token values in the clear)", () => {
  it("the made-up token has Fernway's token shape", () => {
    expect(TOKEN).toHaveLength(43);
    expect(TOKEN).toMatch(SESSION_TOKEN_SHAPE);
  });

  it.for([
    ["a bearer header in a HAR", "net.har", `{"name":"authorization","value":"Bearer ${TOKEN}"}`],
    ["a bearer header in a log", "run.log", `GET /api/tasks authorization: bearer ${TOKEN}`],
    ["a sessionStorage item as JSON", "report.json", `{"fernway_session":"${TOKEN}"}`],
    ["a storage-state entry", "state.json", `{"name":"fernway_session","value":"${TOKEN}"}`],
    ["an escaped JSON string", "report.md", `"{\\"fernway_session\\":\\"${TOKEN}\\"}"`],
    ["a URL-encoded pair", "spec.ts", `const q = "fernway_session%3D${TOKEN}";`],
    ["a cookie-style pair", "evidence/step-1.txt", `fernway_session=${TOKEN}; Path=/`],
    // Fernway's sign-in and sign-up answer the token itself in session-storage mode: a captured login answer.
    ["a login answer's token field", "report.json", `{"token":"${TOKEN}"}`],
    ["a login answer's token field, escaped", "report.md", `"{\\"token\\":\\"${TOKEN}\\"}"`],
    // report.html embeds the evidence JSON with its quotes as HTML entities.
    ["an HTML-escaped login answer", "report.html", `{&quot;token&quot;:&quot;${TOKEN}&quot;}`],
    ["an HTML-escaped sessionStorage item", "report.html", `{&#34;fernway_session&#34;:&#34;${TOKEN}&#34;}`],
    // What an exported spec or init script that seeds a sessionStorage session would hold.
    ["a sessionStorage.setItem call in a spec", "spec.ts", `sessionStorage.setItem("fernway_session", "${TOKEN}")`],
    ["a URL-encoded bearer header", "run.log", `authorization=Bearer%20${TOKEN}`],
    ["a form-encoded bearer header", "run.log", `authorization=Bearer+${TOKEN}`],
    // Cookie mode's session is a UUID: covered by shape too, so a cookie the engine never registered is still found.
    ["a cookie-mode session id", "evidence.txt", `fernway_session=${COOKIE_ID}; Path=/`],
    ["a cookie-mode session id in a storage state", "state.json", `{"name":"fernway_session","value":"${COOKIE_ID}"}`],
    ["an HTML-escaped cookie-mode session id", "report.html", `{&quot;fernway_session&quot;:&quot;${COOKIE_ID}&quot;}`],
  ] as const)("finds %s", async ([, name, text]) => {
    await put(name, text);
    const hits = await sessionTokensIn(dir);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatch(new RegExp(`^${name.replace(/[.]/g, "\\.")}: a `));
    // A hit names the file and the kind of value, never any of it.
    expect(hits[0]).not.toContain(TOKEN.slice(0, 8));
    expect(hits[0]).not.toContain(COOKIE_ID.slice(0, 8));
  });

  it.for([
    ["a redacted bearer header", "run.log", "authorization: Bearer [REDACTED:account-secret]"],
    ["a redacted sessionStorage item", "report.json", `{"fernway_session":"[REDACTED:account-secret]"}`],
    ["the cookie check's masked value", "evidence.txt", MASKED_COOKIE],
    ["prose about the header", "report.md", "The app sends Authorization: Bearer <token> from sessionStorage."],
    ["the cookie's name in a finding", "report.json", `{"title":"Session cookie fernway_session is readable by JavaScript"}`],
    ["a spec that reads the token from the environment", "spec.ts", "headers: { authorization: `Bearer ${process.env.TOKEN}` }"],
    ["a run token", "report.json", `{"runToken":"1a2b3c4d"}`],
    ["a token-shaped value under a key that only ends in token", "report.json", `{"runToken":"${TOKEN}"}`],
    ["a redacted token field", "report.json", `{"token":"[REDACTED:account-secret]"}`],
    ["an HTML-escaped redacted token field", "report.html", `{&quot;token&quot;:&quot;[REDACTED:account-secret]&quot;}`],
    ["an HTML-escaped masked cookie", "report.html", `fernway_session=… (value hidden); Path=/; HttpOnly; SameSite=Lax&quot;,`],
    ["the cookie's name in a list", "report.json", `["fernway_session","> No CSRF token and no Origin check stopped it."]`],
    ["a setItem call that reads the token from the environment", "spec.ts", `sessionStorage.setItem("fernway_session", process.env.TOKEN)`],
  ] as const)("does not flag %s", async ([, name, text]) => {
    await put(name, text);
    expect(await sessionTokensIn(dir)).toEqual([]);
  });

  it("skips binary files (images are covered by the byte grep, filesContaining)", async () => {
    await put("frame.png", `fernway_session=${TOKEN}`);
    expect(await sessionTokensIn(dir)).toEqual([]);
    expect(await filesContaining(dir, { "the token": TOKEN })).toEqual(["frame.png: the token"]);
  });
});

// The same shapes in a Plan/Report as JSON and in log lines, which have no run folder to grep.
describe("sessionTokenShapesIn (0.6.0: the same grep on Plan/Report JSON and log lines)", () => {
  it.for([
    ["a bearer header in a log line", `GET /api/tasks authorization: bearer ${TOKEN}`, "a bearer token"],
    ["a sessionStorage item in a Report as JSON", JSON.stringify({ report: { notes: `{"fernway_session":"${TOKEN}"}` } }), "a fernway_session token"],
    ["a storage-state entry in a Plan as JSON", JSON.stringify({ plan: { state: { name: "fernway_session", value: TOKEN } } }), "a fernway_session token (storage state)"],
    ["a URL-encoded pair in a log line", `opened /app?fernway_session%3D${TOKEN}`, "a fernway_session token"],
    ["a login answer in a Report as JSON", JSON.stringify({ report: { notes: `{"token":"${TOKEN}"}` } }), "a token field"],
    ["a login answer in a log line", `POST /api/login answered {"token":"${TOKEN}"}`, "a token field"],
    ["a URL-encoded bearer header in a log line", `GET /api/tasks?authorization=Bearer%20${TOKEN}`, "a bearer token"],
    ["a sessionStorage.setItem call in a Plan as JSON", JSON.stringify({ spec: `sessionStorage.setItem("fernway_session", "${TOKEN}")` }), "a fernway_session token"],
    ["a cookie-mode session id in a log line", `signed in: fernway_session=${COOKIE_ID}`, "a fernway_session cookie id"],
    ["a cookie-mode session id in a Plan as JSON", JSON.stringify({ plan: { state: { name: "fernway_session", value: COOKIE_ID } } }), "a fernway_session cookie id (storage state)"],
  ] as const)("finds %s", ([, text, kind]) => {
    const hits = sessionTokenShapesIn(text);
    expect(hits).toEqual([kind]);
    // A hit names the kind of value, never any of it.
    expect(hits.join(" ")).not.toContain(TOKEN.slice(0, 8));
    expect(hits.join(" ")).not.toContain(COOKIE_ID.slice(0, 8));
  });

  it("counts repeats in one text", () => {
    expect(sessionTokenShapesIn(`Bearer ${TOKEN}\nBearer ${TOKEN}`)).toEqual(["a bearer token (2 times)"]);
  });

  it.for([
    ["a redacted bearer header", "authorization: Bearer [REDACTED:account-secret]"],
    ["a redacted sessionStorage item as JSON", JSON.stringify({ fernway_session: "[REDACTED:account-secret]" })],
    ["the cookie check's masked value", MASKED_COOKIE],
    ["prose about the header", "The app sends Authorization: Bearer <token> from sessionStorage."],
    ["a spec that reads the token from the environment", JSON.stringify({ source: "headers: { authorization: `Bearer ${process.env.TOKEN}` }" })],
    ["a run token", JSON.stringify({ runToken: "1a2b3c4d" })],
    ["a CSRF token field (csrfTokensIn's, not a session token)", JSON.stringify({ csrf_token: TOKEN })],
    ["a redacted token field", JSON.stringify({ token: "[REDACTED:account-secret]" })],
    ["nothing", ""],
  ] as const)("does not flag %s", ([, text]) => {
    expect(sessionTokenShapesIn(text)).toEqual([]);
  });

  it("finds what sessionTokensIn finds in a file with the same text", async () => {
    const text = `{"a":"Bearer ${TOKEN}","b":{"name":"fernway_session","value":"${TOKEN}"}}`;
    await put("report.json", text);
    expect((await sessionTokensIn(dir)).map((h) => h.replace(/^report\.json: /, ""))).toEqual(sessionTokenShapesIn(text));
  });
});

describe("csrfTokensIn", () => {
  /** A made-up CSRF token. A hit names the file, never any of the value: this must never appear in one. */
  const CSRF = "abcdefghijklmnop1234";

  it("finds a token in the clear and not a redacted one", async () => {
    await put("a.json", `{"csrf_token":"${CSRF}"}`);
    await put("b.json", `{"csrf_token":"[REDACTED:secret]"}`);
    expect(await csrfTokensIn(dir)).toEqual([expect.stringMatching(/^a\.json: /)]);
  });

  it.for([
    ["a JSON field", "a.json", `{"csrf_token":"${CSRF}"}`],
    ["a header", "run.log", `X-CSRF-Token: ${CSRF}`],
    // Express csurf's default field and cookie name.
    ["csurf's _csrf field", "evidence/step-1.txt", `_csrf=${CSRF}`],
    ["escaped JSON in a Markdown report", "report.md", `"{\\"csrf_token\\":\\"${CSRF}\\"}"`],
    ["HTML-escaped JSON in an HTML report", "report.html", `{&quot;csrf_token&quot;:&quot;${CSRF}&quot;}`],
  ] as const)("finds %s, naming the file and never any of the value", async ([, name, text]) => {
    await put(name, text);
    const hits = await csrfTokensIn(dir);
    expect(hits).toEqual([`${name}: a CSRF token`]);
    expect(hits.join(" ")).not.toContain(CSRF.slice(0, 8));
  });

  it.for([
    ["a redacted token", "a.json", `{"csrf_token":"[REDACTED:secret]"}`],
    ["an HTML-escaped redacted token", "report.html", `{&quot;csrf_token&quot;:&quot;[REDACTED:secret]&quot;}`],
    ["a csrf scenario id", "report.json", `{"id":"csrf:cross-site@form-2","checkId":"csrf"}`],
    ["prose about CSRF tokens", "report.md", "No CSRF token and no Origin check stopped it."],
  ] as const)("does not flag %s", async ([, name, text]) => {
    await put(name, text);
    expect(await csrfTokensIn(dir)).toEqual([]);
  });
});

describe("leftChanged (a write-side check says something of Account A may still be changed)", () => {
  const FORGED_CREATE =
    "The forged request created a new test record under Account A (it carries the run's test values, and Run Hound doesn't delete records): check Account A.";

  it.for([
    ["write-access", "Account A's test record was unchanged after Account B sent PATCH /api/tasks/t1 (404)."],
    ["paywall-trust", "Account A's plan read as it was before."],
    ["csrf", `The forged form-encoded request from http://127.0.0.1:1 was stored. ${FORGED_CREATE}`],
    ["csrf", ""],
  ] as const)("no: %s %s", ([checkId, notes]) => {
    expect(leftChanged(notes, checkId)).toBe(false);
  });

  it.for([
    ["write-access", "Could not be undone: title of Account A's test record: check Account A."],
    ["write-access", "Could not be undone: Account A's test record was deleted and couldn't be created again: check Account A."],
    ["paywall-trust", "Putting Account A's plan back failed (timeout). Account A's plan may still be \"pro\": check Account A."],
    ["csrf", "Inconclusive: the re-read as Account A failed after the forged request was sent, so Run Hound can't tell whether it was stored: check Account A."],
    // The new-record sentence is left out, and only it: a failed restore beside it still counts.
    ["csrf", `${FORGED_CREATE} Could not be undone: title of Account A's test record: check Account A.`],
  ] as const)("yes: %s %s", ([checkId, notes]) => {
    expect(leftChanged(notes, checkId)).toBe(true);
  });

  // Only csrf's forged create is exempt (on V08 it is the bug working): the same sentence from another check, or from
  // a check that isn't named, still says something was left behind.
  it.for(["write-access", "paywall-trust", undefined])("the new-record sentence from %s counts", (checkId) => {
    expect(leftChanged(FORGED_CREATE, checkId)).toBe(true);
  });

  it("no notes at all", () => {
    expect(leftChanged(undefined, "csrf")).toBe(false);
    expect(leftChanged(undefined)).toBe(false);
  });
});

describe("probeValuesLeft (the run's own test records hold no probe value afterwards)", () => {
  const TOK = "1a2b3c4d";
  const account = (tasks: Record<string, unknown>[] = [], projects: Record<string, unknown>[] = []): AccountState => ({
    tasks: tasks.map((t, i) => ({ id: `t${i + 1}`, ...t })),
    projects: projects.map((p, i) => ({ id: `p${i + 1}`, ...p })),
    profile: { name: "Alex Rivera", plan: "free" },
  });
  const seeded = { title: "Send the client the moodboard", done: false };

  it("records holding only the values they were created with: nothing left", () => {
    const state = {
      alex: account([seeded, { title: `Task ${TOK}wab` }, { title: `Task ${TOK}was` }, { title: `Task ${TOK}xsite` }], [{ name: `Project ${TOK}wab` }]),
      sam: account([{ title: "Draft the Q3 plan" }]),
    };
    expect(probeValuesLeft(state)).toEqual([]);
    expect(probeValuesLeft(state, true)).toEqual([]);
  });

  it.for([
    ["write-access other-account's marker", { title: `Task ${TOK}wxbwab` }],
    ["write-access signed-out's marker", { title: `Task ${TOK}wxswas` }],
    ["csrf's marker", { title: `Task ${TOK}csrfxsite` }],
    ["a marker in a field other than the title", { title: `Task ${TOK}wab`, notes: `Feed twice a day, note ${TOK}wxbwab` }],
    ["an upper-case marker", { title: `Task ${TOK.toUpperCase()}WXBWAB` }],
  ] as const)("finds %s, naming the account and the record, never the value", ([, task]) => {
    const hits = probeValuesLeft({ alex: account([seeded, task]), sam: account() });
    expect(hits).toEqual(["alex: t2"]);
    expect(hits.join(" ")).not.toContain(TOK);
  });

  it("looks at Sam's records and at projects too", () => {
    expect(probeValuesLeft({ alex: account([], [{ name: `Project ${TOK}wxs` }]), sam: account([{ title: `Task ${TOK}wxb` }]) })).toEqual(["alex: p1", "sam: t1"]);
  });

  it("on V08, csrf's forged create may keep its marker (test records are never deleted), a write-access marker still counts", () => {
    const state = { alex: account([{ title: `Task ${TOK}xsite` }, { title: `Task ${TOK}csrfxsite` }, { title: `Task ${TOK}wxbwab` }]), sam: account() };
    expect(probeValuesLeft(state, true)).toEqual(["alex: t3"]);
    expect(probeValuesLeft(state)).toEqual(["alex: t2", "alex: t3"]);
  });
});
