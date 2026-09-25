/**
 * cookie-flags (V1): load the page and read the cookies it sets. Fails when a cookie that looks like a session or
 * auth token is readable by JavaScript (no HttpOnly), is sent to every site (SameSite=None), or on https lacks Secure.
 * Cookies set by page scripts (document.cookie) can never be HttpOnly, and are named as such. CSRF tokens are meant to
 * be readable and are left out. On a dev server the finding is advisory.
 */
import type { Cookie } from "playwright";
import type { Check, Severity } from "../core/types.js";
import { checkResult, clip, FindingList, guarded, listOf, playwrightSpec, plural, scenarioFor } from "./lib/a11y-common.js";
import { DEV_SERVER_NOTE, looksLikeDevServer, worst } from "./lib/http-checks.js";

const ID = "cookie-flags" as const;

/** Cookie names that hold a session or credentials. */
const SESSION_NAME = /sess|(^|[_.-])sid($|[_.-])|auth|token|jwt|remember|login|identity|credential|^connect\.sid$/i;
/** Tokens that pages must be able to read (double-submit CSRF protection). */
const READABLE_BY_DESIGN = /csrf|xsrf/i;

export function isSessionCookie(name: string): boolean {
  return SESSION_NAME.test(name) && !READABLE_BY_DESIGN.test(name);
}

export interface CookieProblem {
  name: string;
  /** How the cookie was set: by the server (Set-Cookie) or by a page script (document.cookie). */
  setBy: "server" | "script";
  issues: { flag: string; severity: Severity; why: string }[];
}

/**
 * What is wrong with each session-like cookie. `server` maps the names seen in Set-Cookie headers to their header
 * line. SameSite=None is taken from that line only: browsers report a cookie set without SameSite differently.
 */
export function cookieProblems(cookies: Pick<Cookie, "name" | "httpOnly" | "secure">[], server: Map<string, string>, https: boolean): CookieProblem[] {
  const out: CookieProblem[] = [];
  for (const c of cookies) {
    if (!isSessionCookie(c.name)) continue;
    const setBy = server.has(c.name) ? "server" : "script";
    const issues: CookieProblem["issues"] = [];
    if (!c.httpOnly) {
      issues.push({
        flag: "HttpOnly",
        severity: "high",
        why: setBy === "script" ? "set by a page script, so it can never be HttpOnly: any script on the page can read it" : "any script on the page can read it",
      });
    }
    if (/;\s*samesite\s*=\s*none/i.test(server.get(c.name) ?? "")) issues.push({ flag: "SameSite", severity: "medium", why: "SameSite=None sends it with requests from every other website (cross-site request forgery)" });
    if (https && !c.secure) issues.push({ flag: "Secure", severity: "high", why: "it may be sent over plain http, where anyone on the network can read it" });
    if (issues.length > 0) out.push({ name: c.name, setBy, issues });
  }
  return out;
}

export const check: Check = {
  id: ID,
  title: "Session cookies are protected",
  category: "security",
  scope: "page",

  plan() {
    return [
      scenarioFor(ID, "session-cookies", {
        title: "Check the flags on session cookies",
        description:
          "Loads the page and reads every cookie it sets. Cookies that look like a session or sign-in token must be HttpOnly (out of reach of scripts), not SameSite=None and, on https, Secure. Cookie values are never shown. On a dev server, findings are advisory.",
        priority: "medium",
      }),
    ];
  },

  async run(ctx, scenario) {
    return guarded(ID, scenario, async (startedAt) => {
      const findings = new FindingList(ID, "security");
      const { context, page, capture } = await ctx.openPage();
      ctx.step("Reading the cookies the page set", page);
      const cookies = await context.cookies(ctx.targetUrl);
      const server = new Map<string, string>();
      for (const r of capture.requests) {
        for (const line of (r.responseHeaders?.["set-cookie"] ?? "").split("\n")) {
          const name = line.split("=")[0]!.trim();
          if (name) server.set(name, line);
        }
      }
      const https = new URL(ctx.targetUrl).protocol === "https:";
      const dev = looksLikeDevServer(capture);
      const problems = cookieProblems(cookies, server, https);
      const sessions = cookies.filter((c) => isSessionCookie(c.name));
      if (problems.length === 0) {
        const notes =
          cookies.length === 0
            ? "The page set no cookies on load. Cookies that are only set after signing in aren't checked yet."
            : `${plural(cookies.length, "cookie")} on load, ${plural(sessions.length, "session-like cookie")}${sessions.length ? ` (${listOf(sessions.map((c) => c.name))})` : ""}: flags OK.`;
        return checkResult(ID, scenario, startedAt, [], notes);
      }

      const flag = (c: Cookie) =>
        [c.httpOnly ? "HttpOnly" : "no HttpOnly", c.secure ? "Secure" : "no Secure", `SameSite=${c.sameSite}`, `Path=${c.path}`].join("; ");
      const bad = new Set(problems.map((p) => p.name));
      const card = await ctx.captureCard("session cookies without protection", {
        title: `Cookies after loading the page (${cookies.length})`,
        subtitle: "Values hidden; flags as the browser stored them",
        lines: cookies.map((c) => ({ text: `${c.name}=… (${c.value.length} chars)  ${flag(c)}${server.has(c.name) ? "" : "  [set by a script]"}`, ...(bad.has(c.name) ? { mark: true } : {}) })),
        facts: [
          ...problems.map((p) => ({ label: p.name, value: `missing ${p.issues.map((i) => i.flag).join(", ")}` })),
          { label: "Dev server", value: dev ? "yes (advisory)" : "no" },
        ],
      });
      const all = problems.flatMap((p) => p.issues);
      const first = problems[0]!;
      const f = findings.add({
        title:
          problems.length === 1
            ? `Session cookie "${clip(first.name, 40)}" ${first.issues.map((i) => (i.flag === "SameSite" ? "is SameSite=None" : `has no ${i.flag}`)).join(" and ")}`
            : `${problems.length} session cookies lack protection (${clip(problems.map((p) => p.name).join(", "), 60)})`,
        severity: worst(all.map((i) => i.severity)),
        confidence: dev ? "advisory" : "confirmed",
        location: `Cookie "${first.name}"`,
        locations: problems.map((p) => `Cookie "${p.name}"`),
        meaning: problems.map((p) => `"${p.name}": ${p.issues.map((i) => i.why).join("; ")}.`).join(" "),
        impact: `A session cookie is the key to someone's account. If a script can read it, one injected script (XSS) can steal every visitor's session and sign in as them.${dev ? ` ${DEV_SERVER_NOTE}` : ""}`,
        fix: `Ask your AI or developer: "Set the session cookie${problems.length > 1 ? "s" : ""} ${listOf(problems.map((p) => p.name))} from the server with HttpOnly; SameSite=Lax; Secure (Secure in production). Never write session tokens with document.cookie or keep them in localStorage."`,
        evidence: [card],
      });
      f.spec = playwrightSpec(ID, 1, "session cookies are HttpOnly", ctx.targetUrl, [
        `const cookies = await page.context().cookies();`,
        ...problems.map((p) => `expect(cookies.find((c) => c.name === ${JSON.stringify(p.name)})?.httpOnly, ${JSON.stringify(`${p.name} should be HttpOnly`)}).toBe(true);`),
        ...problems.filter((p) => p.issues.some((i) => i.flag === "SameSite")).map((p) => `expect(cookies.find((c) => c.name === ${JSON.stringify(p.name)})?.sameSite).not.toBe("None");`),
      ].join("\n"));
      return checkResult(ID, scenario, startedAt, findings.items, dev ? DEV_SERVER_NOTE : undefined);
    });
  },
};
