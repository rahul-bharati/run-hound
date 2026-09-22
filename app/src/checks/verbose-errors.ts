/**
 * verbose-errors: submit oversized values through the form, then replay the save request with a malformed
 * body, and scan the server's responses and the page for stack traces, internal file paths or framework
 * error dumps. A plain error message (even a 500) passes; other checks own those.
 */
import type { Check, Scenario } from "../core/types.js";
import { controlLocator, evidence, fillLines, findingFactory, guarded, result, specSource, tryScreenshot } from "./lib/functional-finding.js";
import { canaryValues, createRequests, fillForm, isCreatePlaywrightRequest, settle, submitControl, submitForm, waitForCreates, type FieldValue } from "./lib/functional-form.js";

const ID = "verbose-errors" as const;

/** Patterns that only appear in internals, never in friendly messages ("Sitters arrive at 9 am" must not match). */
const LEAK_PATTERNS: { name: string; regex: RegExp }[] = [
  // "at fn (/srv/app/x.js:42:17)", "at file:///app/x.mjs:3:9", "at node:internal/..."
  { name: "stack trace", regex: /\bat\s+(?:[\w$.<>\[\] ]{1,120}?\s+\()?(?:file:\/\/|node:|webpack:|\/|[A-Za-z]:\\)[^\s)]*:\d+(?::\d+)?\)?/ },
  { name: "Node internals", regex: /node:internal\/[\w/]+/ },
  { name: "Python traceback", regex: /Traceback \(most recent call last\)/ },
  { name: "Java/.NET stack trace", regex: /\bat\s+[\w$.]+\([\w$]+\.(?:java|cs|kt|scala):\d+\)/ },
  { name: "PHP error dump", regex: /(?:Fatal error|Warning|Notice): .+ in \/[^\s]+\.php on line \d+/ },
  { name: "SQL error", regex: /\b(?:SQLSTATE\[\w+\]|syntax error at or near|ORA-\d{5}|SQLITE_ERROR|ER_PARSE_ERROR)/ },
  { name: "internal file path", regex: /(?:^|[\s"'(])\/(?:srv|home|usr|var|app|opt|Users|root|workspace)\/[\w.@/-]+\.(?:js|mjs|cjs|ts|tsx|py|rb|php|java|go|cs):\d+/ },
];

/** The first leak in `text`, with a short excerpt around it. Escaped newlines in JSON are unescaped first. */
export function findLeak(text: string): { name: string; excerpt: string } | null {
  const plain = text.replace(/\\n/g, "\n").replace(/\\"/g, '"');
  for (const { name, regex } of LEAK_PATTERNS) {
    const m = regex.exec(plain);
    if (!m) continue;
    const from = Math.max(0, plain.lastIndexOf("\n", Math.max(0, m.index - 200)) + 1);
    return { name, excerpt: plain.slice(from, m.index + m[0].length + 300).trim().slice(0, 800) };
  }
  return null;
}

/** Valid values everywhere except free-text fields, which get far more text than any form should accept. */
function oversized(values: FieldValue[]): FieldValue[] {
  return values.map((v) => {
    if (!v.canary || v.field.type === "email" || v.field.type === "url") return v;
    const size = v.field.type === "textarea" ? 20_000 : v.field.type === "tel" ? 200 : 2_000;
    return { ...v, value: `${v.value} ${"x".repeat(size)}` };
  });
}

export const check: Check = {
  id: ID,
  title: "Errors don't reveal internals",
  category: "security",

  plan(form): Scenario[] {
    return [
      {
        id: "oversized-and-malformed",
        checkId: ID,
        title: "Send oversized and malformed input",
        description: `Submit ${form.name ?? "the form"} with far too much text, then resend the save request with a broken body, and look for stack traces, file paths or error dumps in the responses and on the page.`,
        kind: "danger",
        priority: "medium",
        destructive: false,
        defaultSelected: true,
      },
    ];
  },

  run(ctx, scenario) {
    return guarded(ID, scenario, ctx, async (started) => {
      const { page, capture } = await ctx.openPage();
      const values = oversized(canaryValues(ctx.form, ctx.runToken, "verbose"));
      const firstNew = capture.requests.length;
      let saveHeaders: Record<string, string> | null = null;
      page.on("request", (request) => {
        if (!saveHeaders && isCreatePlaywrightRequest(request, ctx.targetUrl)) saveHeaders = request.headers();
      });

      await fillForm(page, values);
      await submitForm(page, ctx.form);
      await waitForCreates(page, capture, ctx.targetUrl);

      // Replay the save request with a body that is not valid JSON (or form data).
      const save = createRequests(capture, ctx.targetUrl)[0];
      if (save) {
        const headers = Object.fromEntries(Object.entries(saveHeaders ?? {}).filter(([k]) => !/^(content-length|cookie|host)$/i.test(k)));
        const script = `fetch(${JSON.stringify(save.url)}, { method: ${JSON.stringify(save.method)}, headers: ${JSON.stringify(headers)}, body: '{"broken": [1, 2,' }).then((r) => r.text()).catch(() => "")`;
        await page.evaluate(script).catch(() => undefined);
        await waitForCreates(page, capture, ctx.targetUrl);
      }
      await settle(page);

      const responses = capture.requests
        .slice(firstNew)
        .filter((r) => ["fetch", "xhr", "document"].includes(r.resourceType) && r.responseBody);
      const findings = [];
      const make = findingFactory(ID, "security", scenario);
      const submit = submitControl(ctx.form);
      const baseSpec = [...fillLines(values), submit ? `await ${controlLocator(submit)}.click();` : `await page.keyboard.press("Enter");`, `await page.waitForLoadState("networkidle");`];

      const pageText = String(await page.evaluate("document.body.innerText").catch(() => ""));
      const pageLeak = findLeak(pageText);
      if (pageLeak) {
        const shots = await tryScreenshot(ctx, page, "internal error shown on the page");
        findings.push(
          make({
            title: `The page shows a ${pageLeak.name} after bad input`,
            severity: "medium",
            location: ctx.form.name ? `${ctx.form.name} error message` : "Form error message",
            meaning: "When the form gets unexpected input, the page shows the server's internal error details (code locations and file paths) instead of a friendly message.",
            impact: "Anyone can learn how your server is built, which makes attacks easier, and real users see confusing technical output.",
            fix: `Ask your AI or developer: "Never send stack traces or file paths to the browser. Log them on the server and return a short, friendly error (and 400 for bad input)."`,
            evidence: [evidence("dom", `${pageLeak.name} visible in the page`, { excerpt: pageLeak.excerpt }), ...shots],
            spec: {
              name: "page-hides-internals",
              source: specSource(ctx.targetUrl, "bad input never shows internal error details", [
                ...baseSpec,
                `await expect(page.locator("body")).not.toContainText(/\\bat\\s.*\\/\\S+:\\d+(:\\d+)?|node:internal\\//);`,
              ]),
            },
          }),
        );
      }

      for (const r of responses) {
        const leak = findLeak(r.responseBody ?? "");
        if (!leak) continue;
        findings.push(
          make({
            title: `The server returns a ${leak.name} in its error response`,
            severity: "medium",
            location: `${r.method} ${new URL(r.url).pathname}`,
            meaning: "The server answers bad input with its internal error details (code locations and file paths). Even if the page hides it, anyone can read the response.",
            impact: "Attackers learn your file layout, libraries and code paths, which helps them find weaknesses.",
            fix: `Ask your AI or developer: "In the ${new URL(r.url).pathname} handler, validate input and return 400 with friendly messages; catch unexpected errors and return a generic 500 without the stack."`,
            evidence: [evidence("network", `${r.method} ${r.url} → ${r.status}`, { method: r.method, url: r.url, status: r.status, excerpt: leak.excerpt })],
            spec: {
              name: "response-hides-internals",
              source: specSource(ctx.targetUrl, "error responses never include internal details", [
                `const bodies: string[] = [];`,
                `page.on("response", async (r) => { if (r.request().method() !== "GET") bodies.push(await r.text().catch(() => "")); });`,
                ...baseSpec,
                `for (const body of bodies) expect(body).not.toMatch(/\\bat\\s.*\\/\\S+:\\d+(:\\d+)?|node:internal\\//);`,
              ]),
            },
          }),
        );
        break; // one response finding is enough; the evidence names the endpoint
      }

      return result(ID, scenario, started, findings, `Checked ${responses.length} responses and the page text.`);
    });
  },
};
