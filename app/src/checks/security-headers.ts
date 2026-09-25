/**
 * security-headers (V1): load the page and read the response headers of its own document. Fails when the page has no
 * Content-Security-Policy, no clickjacking protection (CSP frame-ancestors or X-Frame-Options), no
 * X-Content-Type-Options: nosniff, a CSP that lets any script run, a referrer policy that leaks full URLs, or (on
 * https) no Strict-Transport-Security. One finding lists every problem. On a dev server the finding is advisory.
 */
import type { Check, Severity } from "../core/types.js";
import { clip, FindingList, guarded, checkResult, playwrightSpec, plural, scenarioFor } from "./lib/a11y-common.js";
import { DEV_SERVER_NOTE, documentResponse, headerLines, looksLikeDevServer, requestLine, worst } from "./lib/http-checks.js";

const ID = "security-headers" as const;

export interface HeaderProblem {
  /** The header as people write it, e.g. "Content-Security-Policy". */
  header: string;
  /** Lower-case header names the card marks. */
  names: string[];
  severity: Severity;
  /** "missing" or what is wrong with it. */
  problem: string;
  /** One sentence: what an attacker can do. */
  risk: string;
  /** A value to send. */
  suggested: string;
  /** Spec assertion (TypeScript) on `headers`. */
  assertion: string;
}

/** CSP directives by name (lower-case), from the first policy when several are sent. */
function parseCsp(value: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of value.split("\n")[0]!.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name && !out.has(name.toLowerCase())) out.set(name.toLowerCase(), sources);
  }
  return out;
}

/**
 * What is wrong with the document's headers. `https` adds the HSTS requirement (browsers ignore HSTS on http, and
 * localhost is usually http).
 */
export function headerProblems(headers: Record<string, string>, https: boolean): HeaderProblem[] {
  const problems: HeaderProblem[] = [];
  const csp = headers["content-security-policy"];
  const directives = csp ? parseCsp(csp) : new Map<string, string[]>();
  if (!csp) {
    problems.push({
      header: "Content-Security-Policy",
      names: ["content-security-policy"],
      severity: "medium",
      problem: "missing",
      risk: "nothing limits which scripts the page may run, so a single injected script (XSS) can do anything a signed-in user can",
      suggested: "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
      assertion: `expect(headers["content-security-policy"], "Content-Security-Policy should be set").toBeTruthy();`,
    });
  } else {
    const scripts = directives.get("script-src") ?? directives.get("default-src");
    const lax = (s: string) => s === "*" || s === "'unsafe-inline'" || s === "http:" || s === "https:" || s === "data:";
    const nonceOrHash = scripts?.some((s) => /^'(nonce-|sha256-|sha384-|sha512-|strict-dynamic')/.test(s));
    if (!scripts || (scripts.some(lax) && !nonceOrHash)) {
      problems.push({
        header: "Content-Security-Policy",
        names: ["content-security-policy"],
        severity: "low",
        problem: scripts ? `allows any script (script-src ${clip(scripts.join(" "), 60)})` : "has no script-src or default-src, so it doesn't limit scripts",
        risk: "the policy is there but lets an injected script run anyway",
        suggested: "script-src 'self' (use nonces or hashes for inline scripts instead of 'unsafe-inline')",
        assertion: `expect(headers["content-security-policy"], "CSP should limit scripts").toMatch(/(script-src|default-src)[^;]*'self'/);`,
      });
    }
  }
  const xfo = (headers["x-frame-options"] ?? "").trim().toUpperCase();
  if (!directives.has("frame-ancestors") && xfo !== "DENY" && xfo !== "SAMEORIGIN") {
    problems.push({
      header: "Clickjacking protection (frame-ancestors or X-Frame-Options)",
      names: ["x-frame-options", "content-security-policy"],
      severity: "medium",
      problem: xfo ? `X-Frame-Options is "${clip(xfo, 30)}", which browsers ignore` : "missing",
      risk: "any website can load this page in an invisible frame and trick people into clicking its buttons (clickjacking)",
      suggested: "Content-Security-Policy: frame-ancestors 'self' (or X-Frame-Options: DENY)",
      assertion: `expect(/frame-ancestors/.test(headers["content-security-policy"] ?? "") || /^(DENY|SAMEORIGIN)$/i.test(headers["x-frame-options"] ?? ""), "the page should refuse to be framed by other sites").toBe(true);`,
    });
  }
  if ((headers["x-content-type-options"] ?? "").trim().toLowerCase() !== "nosniff") {
    problems.push({
      header: "X-Content-Type-Options",
      names: ["x-content-type-options"],
      severity: "low",
      problem: headers["x-content-type-options"] ? `is "${clip(headers["x-content-type-options"], 30)}", not "nosniff"` : "missing",
      risk: "browsers may guess a file's type, so an uploaded or user-supplied file can be run as a script",
      suggested: "nosniff",
      assertion: `expect(headers["x-content-type-options"], "X-Content-Type-Options should be nosniff").toBe("nosniff");`,
    });
  }
  const referrer = (headers["referrer-policy"] ?? "").trim().toLowerCase().split(",").pop()?.trim() ?? "";
  if (referrer === "unsafe-url" || referrer === "no-referrer-when-downgrade") {
    problems.push({
      header: "Referrer-Policy",
      names: ["referrer-policy"],
      severity: "low",
      problem: `is "${referrer}"`,
      risk: "the full address of every page, including ids and tokens in it, is sent to every other site the page links to or loads from",
      suggested: "strict-origin-when-cross-origin",
      assertion: `expect(headers["referrer-policy"] ?? "", "Referrer-Policy should not leak full URLs").not.toMatch(/unsafe-url|no-referrer-when-downgrade/);`,
    });
  }
  if (https && !/max-age=\d+/i.test(headers["strict-transport-security"] ?? "")) {
    problems.push({
      header: "Strict-Transport-Security",
      names: ["strict-transport-security"],
      severity: "medium",
      problem: "missing",
      risk: "a first visit over plain http can be intercepted and downgraded on public Wi-Fi",
      suggested: "max-age=31536000; includeSubDomains",
      assertion: `expect(headers["strict-transport-security"], "HSTS should be set").toMatch(/max-age=\\d+/);`,
    });
  }
  return problems;
}

export const check: Check = {
  id: ID,
  title: "The page sends security headers",
  category: "security",
  scope: "page",

  plan() {
    return [
      scenarioFor(ID, "response-headers", {
        title: "Check the page's security headers",
        description:
          "Loads the page and reads the headers of its response: Content-Security-Policy, clickjacking protection (frame-ancestors or X-Frame-Options), X-Content-Type-Options, Referrer-Policy and, on https, Strict-Transport-Security. Sends nothing but the page load. On a dev server, findings are advisory.",
        priority: "medium",
      }),
    ];
  },

  async run(ctx, scenario) {
    return guarded(ID, scenario, async (startedAt) => {
      const findings = new FindingList(ID, "security");
      const { page, capture } = await ctx.openPage();
      ctx.step("Reading the headers of the page's response", page);
      const doc = documentResponse(capture, ctx.targetUrl);
      if (!doc?.responseHeaders) throw new Error("The page's own response could not be read, so its headers can't be checked.");
      const headers = doc.responseHeaders;
      const dev = looksLikeDevServer(capture);
      const https = new URL(doc.url).protocol === "https:";
      const problems = headerProblems(headers, https);
      if (problems.length === 0) {
        return checkResult(ID, scenario, startedAt, [], `Checked ${plural(Object.keys(headers).length, "response header")} of ${requestLine("GET", doc.url)}: all present.`);
      }

      const marked = new Set(problems.flatMap((p) => p.names));
      const card = await ctx.captureCard("security headers of the page", {
        title: `${requestLine("GET", doc.url)} → ${doc.status}`,
        subtitle: "Response headers of the page (missing ones listed at the end)",
        lines: [
          ...headerLines(headers, (name) => marked.has(name) && name in headers),
          { text: "" },
          ...problems.map((p) => ({ text: `✗ ${p.header}: ${p.problem}`, mark: true })),
        ],
        facts: [
          { label: "Problems", value: String(problems.length) },
          { label: "Page", value: doc.url },
          { label: "Dev server", value: dev ? "yes (advisory)" : "no" },
        ],
      });
      const onlyWeak = problems.every((p) => p.severity === "low");
      const n = problems.length;
      const f = findings.add({
        title: n === 1 ? `${problems[0]!.header} ${problems[0]!.problem}` : `${n} security header problems (${clip(problems.map((p) => p.header.split(" (")[0]).join(", "), 90)})`,
        severity: worst(problems.map((p) => p.severity)),
        confidence: dev || onlyWeak ? "advisory" : "confirmed",
        location: `Response headers of ${requestLine("GET", doc.url)}`,
        locations: problems.map((p) => p.header),
        meaning: `The page's response is missing protections that browsers only apply when the server asks for them: ${problems.map((p) => `${p.header} ${p.problem}`).join("; ")}.`,
        impact: `Without them, ${problems.map((p) => p.risk).join("; and ")}.${dev ? ` ${DEV_SERVER_NOTE}` : ""}`,
        fix: `Ask your AI or developer: "Send these response headers on every page (in the server, framework config or hosting config): ${problems.map((p) => `${p.header.split(" (")[0]}: ${p.suggested}`).join("; ")}. Check the app still loads its scripts, styles and API calls with the new Content-Security-Policy."`,
        evidence: [card],
      });
      f.spec = playwrightSpec(ID, 1, "the page sends security headers", ctx.targetUrl, [
        `const response = await page.reload();`,
        `const headers = response!.headers();`,
        ...problems.map((p) => p.assertion),
      ].join("\n"));
      return checkResult(ID, scenario, startedAt, findings.items, dev ? DEV_SERVER_NOTE : undefined);
    });
  },
};
