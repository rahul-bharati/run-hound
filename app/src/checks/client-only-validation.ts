/**
 * client-only-validation: capture the form's save request (answered by the check, so the valid record is
 * never stored), then replay it to the real server with the end date moved before the start date (or, when
 * the form has no date range, a required field emptied). Pass when the server rejects it with 4xx; fail on 2xx.
 * Localhost targets only; creates at most one test record (the invalid one, if the server accepts it).
 */
import type { Request } from "playwright";
import type { Check, DiscoveredForm, Scenario } from "../core/types.js";
import { evidence, findingFactory, guarded, result, specSource, errorResult } from "./lib/functional-finding.js";
import { canaryValues, fieldName, fillForm, isCreatePlaywrightRequest, shiftDay, submitForm, waitFor, type FieldValue } from "./lib/functional-form.js";

const ID = "client-only-validation" as const;

/** Headers the browser or HTTP client sets on its own; everything else is replayed as captured. */
const DROP_HEADERS = /^(:|content-length$|host$|connection$|cookie$|accept-encoding$)/i;

export function isLocalTarget(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return host === "localhost" || host.endsWith(".localhost") || /^127\./.test(host) || host === "::1";
  } catch {
    return false;
  }
}

interface Mutation {
  /** Human description, e.g. "End date (2026-10-03) before Start date (2026-10-06)". */
  describe: string;
  /** Field name for the finding. */
  field: string;
  body: string;
}

/** Makes the captured body invalid in one way. JSON and urlencoded bodies are supported. */
function invalidate(body: string, values: FieldValue[]): Mutation | null {
  let fields: Record<string, unknown>;
  let encode: (f: Record<string, unknown>) => string;
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    fields = { ...(parsed as Record<string, unknown>) };
    encode = (f) => JSON.stringify(f);
  } catch {
    const params = new URLSearchParams(body);
    if ([...params.keys()].length === 0) return null;
    fields = Object.fromEntries(params.entries());
    encode = (f) => new URLSearchParams(f as Record<string, string>).toString();
  }
  const keyFor = (value: string) => Object.keys(fields).find((k) => fields[k] === value);

  const dates = values.filter((v) => v.field.type === "date");
  const start = dates[0];
  const end = dates.find((d) => d.value !== start?.value);
  if (start && end) {
    const startKey = keyFor(start.value);
    const endKey = keyFor(end.value);
    if (startKey && endKey) {
      const before = shiftDay(start.value, -3);
      return {
        describe: `${fieldName(end.field)} (${before}) set before ${fieldName(start.field)} (${start.value})`,
        field: fieldName(end.field),
        body: encode({ ...fields, [endKey]: before }),
      };
    }
  }
  // No date range: empty the first required free-text field the body carries.
  for (const v of values) {
    const key = v.field.required && v.value ? keyFor(v.value) : undefined;
    if (key) return { describe: `required ${fieldName(v.field)} left empty`, field: fieldName(v.field), body: encode({ ...fields, [key]: "" }) };
  }
  return null;
}

export const check: Check = {
  id: ID,
  title: "The server validates input too",
  category: "validation",

  plan(form: DiscoveredForm): Scenario[] {
    if (!isLocalTarget(form.url)) return [];
    const hasRange = form.fields.filter((f) => f.type === "date").length >= 2;
    return [
      {
        id: "replay-invalid",
        checkId: ID,
        title: hasRange ? "Send an end date before the start date straight to the server" : "Send an invalid request straight to the server",
        description: `Capture the save request from ${form.name ?? "the form"} (it is answered by Run Hound, so nothing is saved), then send it to the server with one field made invalid${hasRange ? " (end date before start date)" : ""}. The server must reject it. Localhost only; creates at most one test record.`,
        kind: "danger",
        priority: "high",
        destructive: false,
        defaultSelected: true,
      },
    ];
  },

  run(ctx, scenario) {
    return guarded(ID, scenario, ctx, async (started) => {
      if (!isLocalTarget(ctx.targetUrl)) return errorResult(ID, scenario, started, "Only runs against localhost targets.", "skipped");
      const { context, page } = await ctx.openPage();
      const values = canaryValues(ctx.form, ctx.runToken, "replay");

      // The page may write to more than one of its own endpoints on submit (telemetry, a log). The request
      // that carries the typed values is the save request; anything else is let through untouched.
      const typed = values.filter((v) => v.value).map((v) => v.value);
      let captured: Request | null = null;
      let firstWrite: Request | null = null;
      await page.route("**/*", async (route, request) => {
        if (captured || !isCreatePlaywrightRequest(request, ctx.targetUrl) || request.resourceType() === "document") return route.fallback();
        const body = request.postData() ?? "";
        if (!typed.some((value) => body.includes(value))) {
          firstWrite ??= request;
          return route.fallback();
        }
        captured = request;
        // Answer it ourselves so the valid record is never created.
        await route.fulfill({ status: 201, contentType: "application/json", body: body || "{}" });
      });
      await fillForm(page, values);
      await submitForm(page, ctx.form);
      await waitFor(() => captured !== null, 5000);
      await page.unrouteAll({ behavior: "ignoreErrors" });

      const request = (captured ?? firstWrite) as Request | null;
      if (!request) return errorResult(ID, scenario, started, "Submitting the form sent no save request to capture.");
      const mutation = invalidate(request.postData() ?? "", values);
      if (!mutation) return errorResult(ID, scenario, started, "The save request body could not be changed (not JSON or form data, or no field to make invalid).", "skipped");

      const headers = Object.fromEntries(Object.entries(await request.allHeaders()).filter(([k]) => !DROP_HEADERS.test(k)));
      // maxRedirects 0: the replay must reach the target's own endpoint, never wherever it redirects to.
      const response = await context.request.fetch(request.url(), {
        method: request.method(),
        headers,
        data: mutation.body,
        failOnStatusCode: false,
        maxRedirects: 0,
      });
      const status = response.status();
      const responseText = (await response.text().catch(() => "")).slice(0, 2000);
      const replayEvidence = evidence("network", `Replayed ${request.method()} ${request.url()} with ${mutation.describe} → ${status}`, {
        method: request.method(),
        url: request.url(),
        change: mutation.describe,
        requestBody: mutation.body,
        status,
        responseBody: responseText,
      });

      if (status < 200 || status >= 300) {
        return result(ID, scenario, started, [], `Server answered ${status} to a request with ${mutation.describe}.`);
      }

      const make = findingFactory(ID, "validation", scenario);
      const safeHeaders = Object.fromEntries(Object.entries(headers).filter(([k]) => /^content-type$|csrf|xsrf/i.test(k)));
      const finding = make({
        title: `The server accepts ${mutation.describe}`,
        severity: "high",
        location: `"${mutation.field}" field`,
        meaning: `The form stops you from entering ${mutation.describe} in the browser, but the server itself does not check it. Anyone who sends the request directly (a script, a modified page, an old app version) can save invalid data.`,
        impact: "Invalid records end up in your database, which can break reports, billing or schedules, and the browser check gives a false sense of safety.",
        fix: `Ask your AI or developer: "Repeat the ${mutation.field} validation on the server for ${new URL(request.url()).pathname} and answer 400 with a clear message when it fails. Never rely on browser-only checks."`,
        evidence: [replayEvidence],
        spec: {
          name: "server-rejects-invalid",
          source: specSource(ctx.targetUrl, `the server rejects ${mutation.describe}`, [
            `const response = await page.request.fetch(${JSON.stringify(request.url())}, {`,
            `  method: ${JSON.stringify(request.method())},`,
            `  headers: ${JSON.stringify(safeHeaders)},`,
            `  data: ${JSON.stringify(mutation.body)},`,
            `});`,
            `expect(response.status()).toBeGreaterThanOrEqual(400);`,
            `expect(response.status()).toBeLessThan(500);`,
          ]),
        },
      });
      return result(ID, scenario, started, [finding]);
    });
  },
};
