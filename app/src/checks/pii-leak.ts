/**
 * pii-leak: submit the form with a canary email and phone number, then look at every request to a
 * different origin (a third party). Fail when a canary, or a common hash/encoding of it, appears in
 * the request URL or body.
 */
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";
import type { Capture, Check, CheckContext, DiscoveredForm, Evidence, EvidenceCard, Highlight, Scenario } from "../core/types.js";
import { isLocalOrigin, isWrite } from "../core/saves.js";
import { redactSecrets } from "../engine/redact.js";
import { checkResult, clip, FindingList, guarded, playwrightSpec, scenarioFor, submitControl } from "./lib/a11y-common.js";
import { canaries, fillAndSubmitSpec, fillValid, settle, submitAndWait, type Canaries } from "./lib/a11y-form.js";

type DataKind = "email" | "phone";

interface Needle {
  kind: DataKind;
  /** How the value was encoded when found, e.g. "as plain text", "as a SHA-256 hash". */
  form: string;
  hashed: boolean;
  value: string;
}

function hash(algorithm: string, value: string, encoding: "hex" | "base64" = "hex"): string {
  return createHash(algorithm).update(value).digest(encoding);
}

function needles(email: string, phone: string): Needle[] {
  const normEmail = email.trim().toLowerCase();
  const list: Needle[] = [
    { kind: "email", form: "as plain text", hashed: false, value: email },
    { kind: "email", form: "as plain text", hashed: false, value: normEmail },
    { kind: "email", form: "base64-encoded", hashed: false, value: Buffer.from(email).toString("base64").replace(/=+$/, "") },
    { kind: "email", form: "as a SHA-256 hash", hashed: true, value: hash("sha256", normEmail) },
    { kind: "email", form: "as a SHA-256 hash", hashed: true, value: hash("sha256", normEmail, "base64").replace(/=+$/, "") },
    { kind: "email", form: "as a SHA-1 hash", hashed: true, value: hash("sha1", normEmail) },
    { kind: "email", form: "as an MD5 hash", hashed: true, value: hash("md5", normEmail) },
    { kind: "phone", form: "as plain text", hashed: false, value: phone },
    { kind: "phone", form: "as a SHA-256 hash", hashed: true, value: hash("sha256", phone) },
  ];
  return list;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

/** True when `text` holds the needle, raw or URL-decoded (plain values also case-insensitively). */
function contains(text: string | null, needle: Needle): boolean {
  return !!text && (text.includes(needle.value) || decode(text).includes(needle.value) || (!needle.hashed && decode(text).toLowerCase().includes(needle.value.toLowerCase())));
}

/** Where in the request a needle appears, or null. */
function locate(request: Capture["requests"][number], needle: Needle): "URL" | "request body" | null {
  if (contains(request.url, needle)) return "URL";
  if (contains(request.postData, needle)) return "request body";
  return null;
}

/** The part of the URL holding the needle, for the facts ("URL query string", "URL path"). */
function urlPart(url: string, needle: Needle): string {
  try {
    const u = new URL(url);
    if (contains(u.search, needle)) return "URL query string";
    if (contains(u.pathname, needle)) return "URL path";
    return "URL fragment";
  } catch {
    return "URL";
  }
}

/** The request as card lines: method and URL, one query parameter per line, then the body; lines with the canary are marked. */
function requestLines(request: Capture["requests"][number], needle: Needle): EvidenceCard["lines"] {
  const line = (text: string) => ({ text: redactSecrets(text), ...(contains(text, needle) ? { mark: true } : {}) });
  const lines: EvidenceCard["lines"] = [];
  let url: URL | null = null;
  try {
    url = new URL(request.url);
  } catch {
    // Not a parseable URL: show it whole.
  }
  if (!url) return [line(`${request.method} ${request.url}`)];
  lines.push(line(`${request.method} ${url.origin}${url.pathname}`));
  // One parameter per line, joined as in the real URL ("?first", then "&next"), values decoded.
  [...url.searchParams].forEach(([key, value], i) => lines.push(line(`    ${i === 0 ? "?" : "&"}${key}=${value}`)));
  if (request.postData) {
    lines.push({ text: "" }, { text: "Request body:" });
    let body = request.postData;
    try {
      body = JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      // Not JSON: form-encoded bodies read better one field per line.
      if (/^[^=\s&]+=[^&]*(&[^=\s&]+=[^&]*)*$/.test(body)) body = body.split("&").map(decode).join("\n");
    }
    for (const text of body.split("\n").slice(0, 25)) lines.push(line(`    ${text}`));
  }
  return lines;
}

const DATA_NAMES: Record<DataKind, string> = { email: "email address", phone: "phone number" };

/**
 * The form's own save request to an API on another origin (another port of this machine, or a host on the local
 * network, like the target): a write (POST, PUT, ...) sent by fetch, XHR or a form post, whose body carries at least
 * two of the values typed into the form. That is the app saving the form, not a third party receiving data. An
 * analytics call that only carries the email (or sends it in a URL) is still a third party.
 */
export function isOwnApiSave(request: { method: string; resourceType: string; url: string; postData: string | null }, targetUrl: string, values: Canaries): boolean {
  if (!isWrite(request) || !isLocalOrigin(request.url, targetUrl) || !request.postData) return false;
  const body = `${request.postData}\n${decode(request.postData)}`.toLowerCase();
  const typed = [values.email, values.phone, values.name, values.text].filter((v) => body.includes(v.toLowerCase()));
  return typed.length >= 2;
}

/** The filled form just before submit, with the fields holding the test values and the submit control marked. */
async function captureAtSubmit(ctx: CheckContext, page: Page, values: Canaries): Promise<Evidence> {
  const email = ctx.form.fields.find((f) => f.type === "email" || /mail/i.test(f.key));
  const phone = ctx.form.fields.find((f) => f.type === "tel" || /phone|tel/i.test(f.key));
  const submit = submitControl(ctx.form);
  const highlights: Highlight[] = [
    ...(email ? [{ selector: email.selector, label: "Test email address", tone: "info" as const }] : []),
    ...(phone ? [{ selector: phone.selector, label: "Test phone number", tone: "info" as const }] : []),
    ...(submit ? [{ selector: submit.selector, label: "Submitted next", tone: "info" as const }] : []),
  ];
  ctx.step("Capturing the form at submit", page);
  return ctx.capture(page, "Form at submit with the test values", {
    fullPage: true,
    step: "Submit the form with test values",
    highlights,
    facts: [
      { label: "Test email", value: values.email },
      { label: "Test phone", value: values.phone },
    ],
    caption: "The form as it was submitted. Run Hound then looked for these test values in every request to another site.",
  });
}

export const check: Check = {
  id: "pii-leak",
  title: "Personal data isn't sent to third parties",
  category: "security",

  plan(form: DiscoveredForm): Scenario[] {
    const carriers = form.fields.some((f) => f.type === "email" || f.type === "tel" || /mail|phone/i.test(f.key));
    if (!submitControl(form) || !carriers) return [];
    return [
      scenarioFor("pii-leak", "canary-submit", {
        title: "Submit a test email and phone number and watch third-party requests",
        description: "Submits the form with a unique test email and phone number, then checks no request to another site contains them (or their hashes). Creates one test record.",
        priority: "high",
      }),
    ];
  },

  async run(ctx: CheckContext, scenario: Scenario) {
    return guarded("pii-leak", scenario, async (startedAt) => {
      const findings = new FindingList("pii-leak", "security");
      const values = canaries(ctx.runToken);
      const { page, capture } = await ctx.openPage();
      const origin = new URL(ctx.targetUrl).origin;
      ctx.step("Filling the form with a test email and phone number", page);
      await fillValid(page, ctx.form, values);
      const atSubmit = await captureAtSubmit(ctx, page, values);
      ctx.step("Submitting and watching requests to other sites", page);
      const response = await submitAndWait(page, ctx.form, { targetUrl: ctx.targetUrl, runToken: ctx.runToken });
      // Trackers often fire after the success response; give them a moment.
      await settle(page, 1_500);

      const otherOrigins = capture.requests.filter((r) => {
        try {
          return new URL(r.url).origin !== origin && /^https?:/.test(r.url);
        } catch {
          return false;
        }
      });
      // The app's own API on another origin receives the form by design; everything else is a third party.
      const ownApi = otherOrigins.filter((r) => isOwnApiSave(r, ctx.targetUrl, values));
      const ownApiOrigins = [...new Set(ownApi.map((r) => new URL(r.url).origin))];
      const thirdParty = otherOrigins.filter((r) => !ownApiOrigins.includes(new URL(r.url).origin));

      // One finding per (third-party host, kind of data, hashed or not).
      const groups = new Map<string, { host: string; needle: Needle; hits: Evidence[]; request: Capture["requests"][number]; where: string }>();
      for (const request of thirdParty) {
        // One hit per kind of data per request (the first form it appears in), so an email found as text and as a
        // hash counts once, but a phone number in the same request as the email is still reported.
        const found = new Set<Needle["kind"]>();
        for (const needle of needles(values.email, values.phone)) {
          if (found.has(needle.kind)) continue;
          const where = locate(request, needle);
          if (!where) continue;
          found.add(needle.kind);
          const host = new URL(request.url).host;
          const key = `${host}|${needle.kind}|${needle.hashed}`;
          const group = groups.get(key) ?? { host, needle, hits: [], request, where: where === "URL" ? urlPart(request.url, needle) : where };
          if (group.hits.length < 5) {
            group.hits.push({
              kind: "network",
              label: `${request.method} to ${host}: ${DATA_NAMES[needle.kind]} ${needle.form} in the ${where}`,
              data: {
                method: request.method,
                url: redactSecrets(request.url).slice(0, 1000),
                where,
                encoding: needle.form,
                body: request.postData ? redactSecrets(request.postData).slice(0, 1000) : null,
              },
            });
          }
          groups.set(key, group);
        }
      }

      // The frame taken at submit is only kept when it backs a finding.
      if (groups.size === 0) await rm(join(ctx.artifactsDir, atSubmit.path!), { force: true });

      for (const { host, needle, hits, request, where } of groups.values()) {
        const data = DATA_NAMES[needle.kind];
        const thirdPartyOrigin = new URL(request.url).origin;
        ctx.step(`Found the test ${data} in a request to ${host}`, page);
        const card = await ctx.captureCard(`${request.method} to ${host} with the ${data}`, {
          title: `${request.method} ${host}${clip(new URL(request.url).pathname, 60)}: carries the customer's ${data}`,
          subtitle: `Third-party request sent after submitting the form. Marked: the ${data} ${needle.form}.`,
          lines: requestLines(request, needle),
          facts: [
            { label: "Third-party origin", value: thirdPartyOrigin },
            { label: "Found in", value: where },
            { label: "Hashed", value: needle.hashed ? `yes, ${needle.form.replace(/^as an? /, "")} (still identifies the person)` : `no, ${needle.form.replace(/^as /, "")}` },
            { label: `Test ${data}`, value: needle.kind === "email" ? values.email : values.phone },
          ],
        });
        const hashedNote = needle.hashed ? `${needle.form.replace(/^as /, "")} of the ` : "";
        findings.add({
          title: needle.hashed
            ? `Customer ${data} sent to a third party (${host}) as a hash`
            : `Customer ${data} sent to a third party (${host})`,
          severity: "high",
          meaning: `After the form is submitted, the page sends the ${hashedNote}customer's ${data} to ${host}, a different site from yours.${needle.hashed ? " Hashing does not hide it: the same email always gives the same hash, so the third party can match it to the person." : ""}`,
          impact: `Customers' personal data is shared with another company without them knowing. That can break privacy laws (GDPR, CCPA) and your own privacy policy, and ${host} may store or resell it.`,
          fix: `Stop sending the ${data} to ${host}: remove it from the tracking or analytics call (URL and body) and send only an event name or an anonymous id.`,
          location: `Request to ${host}`,
          evidence: [
            card,
            atSubmit,
            ...hits,
            { kind: "note", label: "Test values used", data: { email: values.email, phone: values.phone, thirdPartyHost: host } },
          ],
          spec: playwrightSpec(
            "pii-leak",
            findings.items.length + 1,
            `${data} is not sent to ${host}`,
            ctx.targetUrl,
            `// Any request to another origin than the app (not only ${host}) must not carry the value.
const leaks: string[] = [];
const decode = (text: string) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};
page.on("request", (req) => {
  const text = req.url() + " " + decode(req.url()) + " " + (req.postData() ?? "");
  if (new URL(req.url()).origin !== new URL(TARGET).origin && text.includes(${JSON.stringify(needle.value)})) leaks.push(req.url());
});
${fillAndSubmitSpec(ctx.form, values)}
await page.waitForLoadState("networkidle");
await page.waitForTimeout(1500);
expect(leaks).toEqual([]);`,
          ),
        });
      }

      const status = response?.status() ?? null;
      const apiNote = ownApiOrigins.length > 0 ? `; the form saves to its own API at ${ownApiOrigins.map((o) => new URL(o).host).join(", ")}, which is not counted as a third party` : "";
      return checkResult(
        "pii-leak",
        scenario,
        startedAt,
        findings.items,
        `Submitted canaries (save response ${status ?? "none"}); inspected ${thirdParty.length} third-party request(s)${apiNote}`,
      );
    });
  },
};
