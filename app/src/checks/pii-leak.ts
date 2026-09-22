/**
 * pii-leak: submit the form with a canary email and phone number, then look at every request to a
 * different origin (a third party). Fail when a canary, or a common hash/encoding of it, appears in
 * the request URL or body.
 */
import { createHash } from "node:crypto";
import type { Capture, Check, CheckContext, DiscoveredForm, Evidence, Scenario } from "../core/types.js";
import { redactSecrets } from "../engine/redact.js";
import { checkResult, FindingList, guarded, playwrightSpec, scenarioFor, submitControl } from "./lib/a11y-common.js";
import { canaries, fillAndSubmitSpec, fillValid, settle, submitAndWait } from "./lib/a11y-form.js";

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

/** Where in the request a needle appears, or null. */
function locate(request: Capture["requests"][number], needle: Needle): "URL" | "request body" | null {
  const inText = (text: string | null) => !!text && (text.includes(needle.value) || decode(text).includes(needle.value) || (!needle.hashed && decode(text).toLowerCase().includes(needle.value.toLowerCase())));
  if (inText(request.url)) return "URL";
  if (inText(request.postData)) return "request body";
  return null;
}

const DATA_NAMES: Record<DataKind, string> = { email: "email address", phone: "phone number" };

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
        description: "Books with a unique test email and phone number, then checks no request to another site contains them (or their hashes). Creates one test booking.",
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
      await fillValid(page, ctx.form, values);
      const response = await submitAndWait(page, ctx.form);
      // Trackers often fire after the success response; give them a moment.
      await settle(page, 1_500);

      const thirdParty = capture.requests.filter((r) => {
        try {
          return new URL(r.url).origin !== origin && /^https?:/.test(r.url);
        } catch {
          return false;
        }
      });

      // One finding per (third-party host, kind of data, hashed or not).
      const groups = new Map<string, { host: string; needle: Needle; hits: Evidence[] }>();
      for (const request of thirdParty) {
        for (const needle of needles(values.email, values.phone)) {
          const where = locate(request, needle);
          if (!where) continue;
          const host = new URL(request.url).host;
          const key = `${host}|${needle.kind}|${needle.hashed}`;
          const group = groups.get(key) ?? { host, needle, hits: [] };
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
          break;
        }
      }

      for (const { host, needle, hits } of groups.values()) {
        const data = DATA_NAMES[needle.kind];
        const hashedNote = needle.hashed ? `${needle.form.replace(/^as /, "")} of the ` : "";
        findings.add({
          title: needle.hashed
            ? `Customer ${data} sent to a third party (${host}) as a hash`
            : `Customer ${data} sent to a third party (${host})`,
          severity: "high",
          meaning: `After a booking, the page sends the ${hashedNote}customer's ${data} to ${host}, a different site from yours.${needle.hashed ? " Hashing does not hide it: the same email always gives the same hash, so the third party can match it to the person." : ""}`,
          impact: `Customers' personal data is shared with another company without them knowing. That can break privacy laws (GDPR, CCPA) and your own privacy policy, and ${host} may store or resell it.`,
          fix: `Stop sending the ${data} to ${host}: remove it from the tracking or analytics call (URL and body) and send only an event name or an anonymous id.`,
          location: `Request to ${host}`,
          evidence: [
            ...hits,
            { kind: "note", label: "Test values used", data: { email: values.email, phone: values.phone, thirdPartyHost: host } },
          ],
          spec: playwrightSpec(
            "pii-leak",
            findings.items.length + 1,
            `${data} is not sent to ${host}`,
            ctx.targetUrl,
            `const leaks: string[] = [];
page.on("request", (req) => {
  const text = decodeURIComponent(req.url()) + " " + (req.postData() ?? "");
  if (new URL(req.url()).host === ${JSON.stringify(host)} && text.includes(${JSON.stringify(needle.value)})) leaks.push(req.url());
});
${fillAndSubmitSpec(ctx.form, values)}
await page.waitForLoadState("networkidle");
await page.waitForTimeout(1500);
expect(leaks).toEqual([]);`,
          ),
        });
      }

      const status = response?.status() ?? null;
      return checkResult(
        "pii-leak",
        scenario,
        startedAt,
        findings.items,
        `Submitted canaries (booking response ${status ?? "none"}); inspected ${thirdParty.length} third-party request(s)`,
      );
    });
  },
};
