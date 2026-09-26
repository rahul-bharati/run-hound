/**
 * pii-leak: submit the form with a canary email and phone number, then look at every request to a
 * different origin (a third party). Fail when a canary, or a common hash/encoding of it, appears in
 * the request URL or body. The app's own backend is not a third party, wherever it is hosted (see appBackends).
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

/** Why an origin counts as the app's own backend rather than a third party. */
export type BackendReason = "own-api" | "hosted-backend" | "form-action" | "app-api";

/**
 * Hosted backends the app builders wire a form to: the app's own database, auth or storage (Supabase, Firebase,
 * Appwrite, Convex, Nhost, Hasura Cloud, Xata, AWS AppSync) and form services a form sends its data to (Formspree,
 * Getform, Basin, Web3Forms, FormSubmit, Formcarry, Formspark, EmailJS). The data goes there to be stored for the app,
 * not to be tracked. Matched on the whole host name or a subdomain of it.
 */
const HOSTED_BACKENDS = [
  "supabase.co",
  "supabase.in",
  "firestore.googleapis.com",
  "firebaseio.com",
  "firebasedatabase.app",
  "identitytoolkit.googleapis.com",
  "securetoken.googleapis.com",
  "firebasestorage.googleapis.com",
  "cloudfunctions.net",
  "appwrite.io",
  "convex.cloud",
  "nhost.run",
  "hasura.app",
  "xata.sh",
  "formspree.io",
  "getform.io",
  "usebasin.com",
  "api.web3forms.com",
  "formsubmit.co",
  "formcarry.com",
  "submit-form.com",
  "api.emailjs.com",
];
const APPSYNC = /\.appsync-api\.[a-z0-9-]+\.amazonaws\.com$/;

/**
 * Analytics, advertising, session-replay and error-monitoring hosts. Never taken for the app's own API, even when
 * one of them is the only place the whole form was sent (an analytics "identify" call).
 */
const TRACKERS = [
  "google-analytics.com",
  "analytics.google.com",
  "googletagmanager.com",
  "doubleclick.net",
  "googleadservices.com",
  "googlesyndication.com",
  "facebook.com",
  "facebook.net",
  "segment.io",
  "segment.com",
  "mixpanel.com",
  "amplitude.com",
  "posthog.com",
  "hotjar.com",
  "hotjar.io",
  "clarity.ms",
  "plausible.io",
  "usefathom.com",
  "fullstory.com",
  "heap.io",
  "heapanalytics.com",
  "logrocket.io",
  "logrocket.com",
  "mouseflow.com",
  "sentry.io",
  "rudderstack.com",
  "tiktok.com",
  "linkedin.com",
  "licdn.com",
  "twitter.com",
  "ads-twitter.com",
  "snapchat.com",
  "pinterest.com",
  "bing.com",
  "reddit.com",
  "redditstatic.com",
  "criteo.com",
  "taboola.com",
  "outbrain.com",
];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function onDomain(host: string, domains: string[]): boolean {
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

type RequestInfo = { method: string; resourceType: string; url: string; postData: string | null };

/** How many of the values typed into the form a request body carries. */
function typedCount(request: RequestInfo, values: Canaries): number {
  if (!request.postData) return 0;
  const body = `${request.postData}\n${decode(request.postData)}`.toLowerCase();
  return [values.email, values.phone, values.name, values.text].filter((v) => body.includes(v.toLowerCase())).length;
}

/**
 * The origins that are the app's own backend, not a third party, with the reason; everything else on another origin
 * is a third party. In order of precedence:
 * - "own-api": the form's save to an API on this machine or the local network (isOwnApiSave).
 * - "hosted-backend": any request to a hosted backend or form service the app builders wire forms to (HOSTED_BACKENDS):
 *   a Supabase project, Firebase, Formspree and the like.
 * - "form-action": a full-page form post (the form's own action, not a script) carrying a typed value: the form itself
 *   names where its data goes.
 * - "app-api": when none of the above received the form and nothing typed was written to the target's origin or the
 *   local network, the app's configured API on the internet (an API the app is set up to call, such as
 *   https://api.myapp.com): the one origin that received a write carrying two or more of the typed values, unless it
 *   is a known analytics or advertising host (TRACKERS). When two or more origins did, Run Hound cannot tell which is
 *   the app's, and none is exempt.
 * With a backend of the first three kinds, another origin receiving the whole form is a copy sent elsewhere: a third
 * party. Data in a URL, in a read, or a lone typed value in an analytics call is never the form being saved.
 */
export function appBackends(requests: RequestInfo[], targetUrl: string, values: Canaries): { origin: string; why: BackendReason }[] {
  const origin = new URL(targetUrl).origin;
  const found = new Map<string, BackendReason>();
  const add = (url: string, why: BackendReason) => {
    const o = new URL(url).origin;
    if (!found.has(o)) found.set(o, why);
  };
  const others = requests.filter((r) => {
    try {
      return /^https?:/.test(r.url) && new URL(r.url).origin !== origin;
    } catch {
      return false;
    }
  });
  for (const r of others) {
    const host = hostOf(r.url);
    if (isOwnApiSave(r, targetUrl, values)) add(r.url, "own-api");
    else if (onDomain(host, HOSTED_BACKENDS) || APPSYNC.test(host)) add(r.url, "hosted-backend");
    else if (isWrite(r) && r.resourceType === "document" && typedCount(r, values) >= 1) add(r.url, "form-action");
  }
  // Any typed value written to the target's origin or the local network means the app has a backend of its own:
  // then nothing on the internet is taken for its API.
  const savedLocally = requests.some((r) => isWrite(r) && isLocalOrigin(r.url, targetUrl) && typedCount(r, values) >= 1);
  if (found.size === 0 && !savedLocally) {
    const saves = others.filter((r) => isWrite(r) && typedCount(r, values) >= 2 && !onDomain(hostOf(r.url), TRACKERS));
    const origins = [...new Set(saves.map((r) => new URL(r.url).origin))];
    if (origins.length === 1) add(origins[0]!, "app-api");
  }
  return [...found].map(([o, why]) => ({ origin: o, why }));
}

/** The requests to a third party: another http(s) origin that is not one of the app's backends (appBackends). */
export function thirdPartyRequests<T extends RequestInfo>(requests: T[], targetUrl: string, values: Canaries): T[] {
  const origin = new URL(targetUrl).origin;
  const backends = new Set(appBackends(requests, targetUrl, values).map((b) => b.origin));
  return requests.filter((r) => {
    try {
      const o = new URL(r.url).origin;
      return /^https?:/.test(r.url) && o !== origin && !backends.has(o);
    } catch {
      return false;
    }
  });
}

/** How the note names each kind of backend. */
const BACKEND_WORDS: Record<BackendReason, string> = {
  "own-api": "its own API",
  "hosted-backend": "a hosted backend or form service the app uses",
  "form-action": "where the form itself posts",
  "app-api": "the only place the form was saved, taken to be the app's own API: make sure it is yours",
};

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
      ctx.step("Filling the form with a test email and phone number", page);
      await fillValid(page, ctx.form, values);
      const atSubmit = await captureAtSubmit(ctx, page, values);
      ctx.step("Submitting and watching requests to other sites", page);
      const response = await submitAndWait(page, ctx.form, { targetUrl: ctx.targetUrl, runToken: ctx.runToken });
      // Trackers often fire after the success response; give them a moment.
      await settle(page, 1_500);

      // The app's own backend (its API, a hosted backend, where the form posts) receives the form by design;
      // everything else on another origin is a third party.
      const backends = appBackends(capture.requests, ctx.targetUrl, values);
      const thirdParty = thirdPartyRequests(capture.requests, ctx.targetUrl, values);

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
            `// Any request to another origin than the app (not only ${host}) must not carry the value.${backends.length > 0 ? "\n// The app's own backend receives the form by design." : ""}
const backends: string[] = ${JSON.stringify(backends.map((b) => b.origin))};
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
  const origin = new URL(req.url()).origin;
  if (origin !== new URL(TARGET).origin && !backends.includes(origin) && text.includes(${JSON.stringify(needle.value)})) leaks.push(req.url());
});
${fillAndSubmitSpec(ctx.form, values)}
await page.waitForLoadState("networkidle");
await page.waitForTimeout(1500);
expect(leaks).toEqual([]);`, [], ctx.form,
          ),
        });
      }

      const status = response?.status() ?? null;
      const ownApi = backends.filter((b) => b.why === "own-api");
      const otherBackends = backends.filter((b) => b.why !== "own-api");
      const apiNote = [
        ownApi.length > 0 ? `; the form saves to its own API at ${ownApi.map((b) => new URL(b.origin).host).join(", ")}, which is not counted as a third party` : "",
        otherBackends.length > 0 ? `; not counted as third parties either: ${otherBackends.map((b) => `${new URL(b.origin).host} (${BACKEND_WORDS[b.why]})`).join(", ")}` : "",
      ].join("");
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
