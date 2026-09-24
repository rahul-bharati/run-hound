/**
 * verbose-errors: submit oversized values through the form, then replay the save request with a malformed
 * body, and scan the server's responses and the page for stack traces, internal file paths or framework
 * error dumps. A plain error message (even a 500) passes; other checks own those.
 */
import type { Capture, Check, Evidence, Fact, Scenario } from "../core/types.js";
import { clip, controlLocator, endpointOf, evidence, fillLines, findingFactory, guarded, markText, result, specSource, tryCapture, tryCard } from "./lib/functional-finding.js";
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

/**
 * The first leak in `text`, with the matched text and a short excerpt around it. Escaped newlines in JSON are
 * unescaped first.
 */
export function findLeak(text: string): { name: string; match: string; excerpt: string } | null {
  const plain = text.replace(/\\n/g, "\n").replace(/\\"/g, '"');
  for (const { name, regex } of LEAK_PATTERNS) {
    const m = regex.exec(plain);
    if (!m) continue;
    const from = Math.max(0, plain.lastIndexOf("\n", Math.max(0, m.index - 200)) + 1);
    return { name, match: m[0].trim(), excerpt: plain.slice(from, m.index + m[0].length + 300).trim().slice(0, 800) };
  }
  return null;
}

/** The body Run Hound replays the save request with: JSON that stops half way. */
const MALFORMED_BODY = '{"broken": [1, 2,';

/** How the check produced a request, in words, for facts and card titles. */
function howSent(r: Capture["requests"][number]): string {
  if (r.postData === MALFORMED_BODY) return "replayed with a malformed body";
  if (r.method !== "GET") return "form submitted with oversized input";
  return "loaded after submitting";
}

/** Valid values everywhere except free-text fields, which get far more text than any form should accept. */
function oversized(values: FieldValue[]): FieldValue[] {
  return values.map((v) => {
    if (!v.canary || v.field.type === "email" || v.field.type === "url") return v;
    const size = v.field.type === "textarea" ? 20_000 : v.field.type === "tel" ? 200 : 2_000;
    return { ...v, value: `${v.value} ${"x".repeat(size)}` };
  });
}

/** A request body as card lines: pretty JSON (or the raw text), each line clipped, at most 14 lines, passwords masked. */
function requestBodyLines(body: string | null): { text: string }[] {
  if (!body) return [];
  let text = body;
  try {
    // Passwords and tokens are masked even though they are Run Hound's own test values.
    text = JSON.stringify(JSON.parse(body, (key, value) => (/pass|secret|token/i.test(key) && typeof value === "string" ? "••••" : value)), null, 2);
  } catch {
    // Not JSON: shown as sent, minus anything that looks like a password field.
    text = body.replace(/((?:^|&)[^=&]*(?:pass|secret|token)[^=&]*=)[^&]*/gi, "$1••••");
  }
  const lines = text.split("\n");
  return [
    ...lines.slice(0, 14).map((line) => ({ text: clip(line, 160) })),
    ...(lines.length > 14 ? [{ text: `  … ${lines.length - 14} more lines` }] : []),
  ];
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
        description: `Submit ${form.name ?? "the form"} with far too much text, then resend the save request with a broken body, and look for stack traces, file paths or error dumps in the responses and on the page. May create up to two test records if the server accepts them.`,
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
        if (!saveHeaders && isCreatePlaywrightRequest(request, ctx.targetUrl, ctx.runToken)) saveHeaders = request.headers();
      });

      ctx.step("Filling free-text fields with far too much text", page);
      await fillForm(page, values);
      ctx.step("Submitting the oversized input", page);
      await submitForm(page, ctx.form);
      await waitForCreates(page, capture, ctx.targetUrl, undefined, ctx.runToken);

      // Replay the save request with a body that is not valid JSON (or form data).
      const save = createRequests(capture, ctx.targetUrl, ctx.runToken)[0];
      let replayed: Capture["requests"][number] | null = null;
      if (save) {
        const headers = Object.fromEntries(Object.entries(saveHeaders ?? {}).filter(([k]) => !/^(content-length|cookie|host)$/i.test(k)));
        ctx.step(`Replaying ${endpointOf(save.method, save.url)} with a malformed body`, page);
        // The answer is read in the page: the browser only keeps a response body the page reads, and many apps never
        // read the body of an error (or of a save on another origin).
        const script = `fetch(${JSON.stringify(save.url)}, { method: ${JSON.stringify(save.method)}, headers: ${JSON.stringify(headers)}, body: ${JSON.stringify(MALFORMED_BODY)}, redirect: "manual" })
          .then(async (r) => ({ status: r.status, text: (await r.text()).slice(0, 65536) })).catch(() => null)`;
        const answer = (await page.evaluate(script).catch(() => null)) as { status: number; text: string } | null;
        if (answer && answer.status > 0) {
          replayed = { url: save.url, method: save.method, resourceType: "fetch", postData: MALFORMED_BODY, status: answer.status, failure: null, responseBody: answer.text };
        }
        await waitForCreates(page, capture, ctx.targetUrl, undefined, ctx.runToken);
      }
      await settle(page);

      const captured = capture.requests
        .slice(firstNew)
        .filter((r) => ["fetch", "xhr", "document"].includes(r.resourceType) && r.responseBody);
      // The replay's own capture entry holds the same answer when the capture could read it; count it once.
      const responses = replayed && !captured.some((r) => r.postData === MALFORMED_BODY && r.responseBody) ? [...captured, replayed] : captured;
      const findings = [];
      const make = findingFactory(ID, "security", scenario);
      const submit = submitControl(ctx.form);
      const baseSpec = [...fillLines(values), submit ? `await ${controlLocator(submit)}.click();` : `await page.keyboard.press("Enter");`, `await page.waitForLoadState("networkidle");`];

      ctx.step("Scanning the responses and the page for stack traces and file paths", page);
      const pageText = String(await page.evaluate("document.body.innerText").catch(() => ""));
      const pageLeak = findLeak(pageText);
      const leaking = responses.map((r) => ({ r, leak: findLeak(r.responseBody ?? "") })).find((x) => x.leak !== null);

      // Evidence shared by both findings: the response that leaks (as a card) and the page showing it (as a frame).
      const facts: Fact[] = leaking?.leak
        ? [
            { label: "Status", value: String(leaking.r.status ?? leaking.r.failure) },
            { label: "Request", value: `${endpointOf(leaking.r.method, leaking.r.url)} (${howSent(leaking.r)})` },
            { label: "Matched pattern", value: leaking.leak.name },
          ]
        : [];
      const card: Evidence[] = [];
      if (leaking?.leak) {
        const { r, leak } = leaking;
        const firstMatchLine = leak.match.split("\n")[0]!;
        card.push(
          ...(await tryCard(ctx, "error response with internals", {
            title: `${endpointOf(r.method, r.url)} → ${r.status}: ${leak.name} in the response`,
            subtitle: `${r.url} (${howSent(r)})`,
            // What was sent (so the input that triggered it is on record), then what came back.
            lines: [
              { text: `${r.method} ${r.url}` },
              ...requestBodyLines(r.postData),
              { text: "" },
              { text: `Response ${r.status}` },
              ...leak.excerpt.split("\n").map((line) => ({ text: clip(line, 200), mark: line.includes(firstMatchLine) })),
            ],
            facts: [...facts, { label: "Matched text", value: clip(leak.match, 120) }],
          })),
        );
      }
      const frame: Evidence[] = [];
      if (pageLeak) {
        const marked = (await markText(page, pageLeak.match.split("\n")[0]!, "rh-trace", 1))[0];
        frame.push(
          ...(await tryCapture(ctx, page, "internal error shown on the page", {
            step: "After submitting bad input",
            highlights: marked ? [{ selector: marked, label: `${pageLeak.name} shown to users` }] : [],
            caption: `The page prints the server's ${pageLeak.name} (code locations and file paths) instead of a friendly message.`,
            facts: [
              ...facts.filter((f) => f.label !== "Matched pattern"),
              { label: "Matched pattern", value: `${pageLeak.name} (on the page)` },
              { label: "Matched text", value: clip(pageLeak.match, 120) },
            ],
          })),
        );
      }

      if (pageLeak) {
        findings.push(
          make({
            title: `The page shows a ${pageLeak.name} after bad input`,
            severity: "medium",
            location: ctx.form.name ? `${ctx.form.name} error message` : "Form error message",
            meaning: "When the form gets unexpected input, the page shows the server's internal error details (code locations and file paths) instead of a friendly message.",
            impact: "Anyone can learn how your server is built, which makes attacks easier, and real users see confusing technical output.",
            fix: `Ask your AI or developer: "Never send stack traces or file paths to the browser. Log them on the server and return a short, friendly error (and 400 for bad input)."`,
            evidence: [...frame, ...card, evidence("dom", `${pageLeak.name} visible in the page`, { excerpt: pageLeak.excerpt })],
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

      if (leaking?.leak) {
        const { r, leak } = leaking;
        findings.push(
          make({
            title: `The server returns a ${leak.name} in its error response`,
            severity: "medium",
            location: `${r.method} ${new URL(r.url).pathname}`,
            meaning: "The server answers bad input with its internal error details (code locations and file paths). Even if the page hides it, anyone can read the response.",
            impact: "Attackers learn your file layout, libraries and code paths, which helps them find weaknesses.",
            fix: `Ask your AI or developer: "In the ${new URL(r.url).pathname} handler, validate input and return 400 with friendly messages; catch unexpected errors and return a generic 500 without the stack."`,
            evidence: [
              ...card,
              ...frame,
              evidence("network", `${r.method} ${r.url} → ${r.status}`, { method: r.method, url: r.url, status: r.status, excerpt: leak.excerpt }),
            ],
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
        ); // one response finding is enough; the evidence names the endpoint
      }

      return result(ID, scenario, started, findings, `Checked ${responses.length} responses and the page text.`);
    });
  },
};
