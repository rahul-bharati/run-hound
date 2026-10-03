/** Finding shape and exported Playwright spec for the csrf check. */

import { tryCard } from "../lib/functional-finding.js";
import type { CheckContext, Evidence } from "../../core/types.js";
import type { ForgeEncoding, ForgeOutcome, TargetCookie } from "../lib/cross-site.js";
import type { ForgedBodies } from "../../interfaces/csrf.js";

/** A card of the forged request and the cookies it carried (names and SameSite only). */
export async function forgedCard(
  ctx: CheckContext,
  saveEndpoint: string,
  via: string,
  outcome: ForgeOutcome,
  cookies: TargetCookie[],
  bodies: Pick<ForgedBodies, "dropped" | "unplaced">,
): Promise<Evidence[]> {
  const named = bodies.dropped.filter((k) => !bodies.unplaced.includes(k));
  const sameSite = (name: string) => cookies.find((c) => c.name === name)?.sameSite ?? "unknown";
  const carried = outcome.cookies;
  const attached = !outcome.cookiesSeen
    ? "Run Hound didn't see the app's answer, so which cookies the browser attached isn't known."
    : carried.length > 0
      ? `Cookies the browser attached: ${carried.join(", ")}`
      : "The browser attached no cookie.";
  return tryCard(ctx, "The forged cross-site request", {
    title: `${saveEndpoint} forged from another site`,
    subtitle: "Sent from a page on a different site in Account A's browser, with a new value.",
    lines: [
      { text: `Sent as: ${via}`, mark: true },
      { text: attached, mark: true },
      { text: "No CSRF token and no Origin check stopped it.", mark: true },
    ],
    facts: [
      { label: "How it was sent", value: via },
      {
        label: "Cookies attached (SameSite)",
        value: !outcome.cookiesSeen ? "not seen" : carried.length > 0 ? carried.map((n) => `${n} (${sameSite(n)})`).join(", ") : "none",
      },
      ...(named.length > 0 ? [{ label: "Token fields left out", value: named.join(", ") }] : []),
      ...(bodies.unplaced.length > 0 ? [{ label: "Random values left out (a token, or a reference)", value: bodies.unplaced.join(", ") }] : []),
    ],
  });
}

/** A standalone spec: signs in as Account A from env vars, serves a blank attacker page, posts the save from it with the forged field, re-reads the record endpoint as Account A: the forged value must not be there. */
export function replaySpec(o: {
  target: string;
  save: string;
  record: string;
  fields: string[];
  marked: string;
  encoding: ForgeEncoding;
  attackerOrigin: string;
  tokenSession?: boolean;
  headerRead?: boolean;
  saveLeftOut?: string[];
  recordLeftOut?: string[];
}): string {
  const q = (v: unknown) => JSON.stringify(v);
  const path = (u: string) => {
    const p = new URL(u);
    return `${p.pathname}${p.search}`;
  };
  return [
    `import { test, expect, chromium, request } from "@playwright/test";`,
    `import { createServer } from "node:http";`,
    `import type { AddressInfo } from "node:net";`,
    ``,
    `// Exported by Run Hound. Set Account A's environment variables before running:`,
    `//   RUNHOUND_ACCOUNT_A_LOGIN_URL, RUNHOUND_ACCOUNT_A_USERNAME, RUNHOUND_ACCOUNT_A_PASSWORD.`,
    `// The save was stored when sent ${o.encoding === "form" ? "form-encoded" : o.encoding === "multipart" ? "as a multipart form (multipart/form-data)" : o.encoding === "text" ? "as JSON with a text/plain content-type" : "as JSON (CORS allowed the other site)"} from another site.`,
    `const TARGET = ${q(o.target)};`,
    `const SAVE = ${q(path(o.save))}; // the form's own save`,
    ...(o.saveLeftOut && o.saveLeftOut.length > 0
      ? [`// Run Hound left ${o.saveLeftOut.join(", ")} out of SAVE: the app's own page adds Account A's token or credential there, which a page on another site can't know.`]
      : []),
    `const RECORD = ${q(path(o.record))}; // reads the saved record back as Account A`,
    ...(o.recordLeftOut && o.recordLeftOut.length > 0
      ? [`// Run Hound left ${o.recordLeftOut.join(", ")} out of RECORD: add Account A's own value${o.recordLeftOut.length === 1 ? "" : "s"} to the re-read.`]
      : []),
    `const FIELDS = ${q(o.fields)} as string[];`,
    `const FORGED_FIELD = ${q(o.marked)};`,
    `const ENCODING = ${q(o.encoding)} as "form" | "multipart" | "text" | "json";`,
    `// A different SITE from the target: localhost and 127.0.0.1 are different sites of each other.`,
    `const ATTACKER_HOST = ${q(new URL(o.attackerOrigin).hostname)};`,
    ``,
    `// Sign in through the app's own login and return the session as storage state (cookies + localStorage).`,
    `async function sessionFor(slot: "A") {`,
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
    `test("a page on another site can't change Account A's data", async () => {`,
    `  const forged = "runhound-forged-" + Date.now();`,
    `  const server = createServer((_req, res) => {`,
    `    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });`,
    `    res.end("<!doctype html><title>Another site</title>");`,
    `  });`,
    `  await new Promise<void>((resolve) => server.listen(0, ATTACKER_HOST, resolve));`,
    `  const attacker = "http://" + ATTACKER_HOST + ":" + (server.address() as AddressInfo).port;`,
    `  const browser = await chromium.launch();`,
    `  try {`,
    `    const context = await browser.newContext({ storageState: await sessionFor("A") });`,
    `    const page = await context.newPage();`,
    `    await page.goto(attacker + "/");`,
    `    const values = Object.fromEntries(FIELDS.map((f) => [f, f === FORGED_FIELD ? forged : ""]));`,
    `    await page.evaluate(async ({ url, values, encoding }) => {`,
    `      if (encoding === "form" || encoding === "multipart") {`,
    `        const iframe = document.createElement("iframe"); iframe.name = "forged"; document.body.append(iframe);`,
    `        const form = document.createElement("form"); form.method = "POST"; form.action = url; form.target = "forged";`,
    `        if (encoding === "multipart") form.enctype = "multipart/form-data";`,
    `        for (const [k, v] of Object.entries(values)) { const i = document.createElement("input"); i.type = "hidden"; i.name = k; i.value = String(v); form.append(i); }`,
    `        document.body.append(form);`,
    `        await new Promise((resolve) => { iframe.addEventListener("load", resolve); form.submit(); setTimeout(resolve, 5000); });`,
    `      } else {`,
    `        const type = encoding === "text" ? "text/plain" : "application/json";`,
    `        await fetch(url, { method: "POST", credentials: "include", headers: { "content-type": type }, body: JSON.stringify(values) }).catch(() => undefined);`,
    `      }`,
    `    }, { url: new URL(SAVE, TARGET).href, values, encoding: ENCODING });`,
    `    // Re-read as Account A, from a page of the app itself: the forged value must NOT be stored.`,
    ...(o.tokenSession
      ? [`    // Account A's session is a token the app's own scripts send in a header, not a cookie: add it to this re-read.`]
      : o.headerRead
        ? [`    // Run Hound read the record back with the headers the app's own scripts add to its requests (such as a CSRF or API-key header): add them to this re-read.`]
        : []),
    `    const own = await context.newPage();`,
    `    await own.goto(TARGET);`,
    `    const reread = await own.evaluate(async (u) => {`,
    `      const res = await fetch(u, { credentials: "include" });`,
    `      return { ok: res.ok, text: await res.text() };`,
    `    }, new URL(RECORD, TARGET).href);`,
    `    expect(reread.ok, ${q(o.tokenSession || o.headerRead ? "the re-read as Account A failed: add what the comment above says to it, signed in as Account A" : "the re-read as Account A failed: sign in as Account A so the record can be read")}).toBe(true);`,
    `    expect(reread.text, "the value sent from another site was stored").not.toContain(forged);`,
    `  } finally {`,
    `    await browser.close();`,
    `    server.close();`,
    `  }`,
    `});`,
    ``,
  ].join("\n");
}