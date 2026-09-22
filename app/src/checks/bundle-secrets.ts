/**
 * bundle-secrets: scan every script the page loads (external and inline) plus the HTML for
 * secret-looking values. Publishable keys are allowed; values are only ever reported redacted.
 */
import type { Check, CheckContext, DiscoveredForm, Scenario } from "../core/types.js";
import { findSecrets, redactSecrets } from "../engine/redact.js";
import { checkResult, evalIn, FindingList, guarded, playwrightSpec, scenarioFor } from "./lib/a11y-common.js";
import { sameOrigin } from "./lib/a11y-form.js";

/** Plain-language names for redact.ts pattern kinds. */
const KIND_NAMES: Record<string, string> = {
  "openai-key": "an AI provider secret key (sk-…)",
  "anthropic-key": "an AI provider secret key (sk-ant-…)",
  "stripe-secret": "a Stripe secret key",
  "aws-access-key": "an AWS access key",
  "github-token": "a GitHub token",
  "slack-token": "a Slack token",
  "private-key": "a private key",
  "supabase-service-role": "a Supabase service_role key (a JWT with admin rights that bypass row-level security)",
};

/** Regex sources used in exported specs, so the spec never contains the secret itself. */
const SPEC_PATTERNS: Record<string, string> = {
  "openai-key": String.raw`sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}`,
  "anthropic-key": String.raw`sk-ant-[A-Za-z0-9_-]{20,}`,
  "stripe-secret": String.raw`(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}`,
  "aws-access-key": String.raw`(?:AKIA|ASIA)[A-Z0-9]{16}`,
  "github-token": String.raw`(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}`,
  "slack-token": String.raw`xox[abprs]-[A-Za-z0-9-]{10,}`,
  "private-key": String.raw`-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----`,
};

interface Source {
  /** Where the text came from: a script URL, "inline script #n on <page>", or the page URL. */
  where: string;
  url: string | null;
  text: string;
}

const INLINE_SCRIPTS = `() => Array.from(document.scripts).filter((s) => !s.src).map((s) => s.textContent || "")`;

async function collectSources(ctx: CheckContext): Promise<Source[]> {
  const { page, capture } = await ctx.openPage();
  const sources: Source[] = [];
  const pageUrl = page.url();

  // External scripts: re-fetch same-origin ones in full (capture bodies are truncated); use the
  // captured body for anything else the browser loaded.
  const scriptUrls = new Set<string>();
  for (const r of capture.requests) if (r.resourceType === "script") scriptUrls.add(r.url);
  const listed = await evalIn<string[]>(page, `() => Array.from(document.scripts).map((s) => s.src).filter(Boolean)`);
  for (const url of listed) scriptUrls.add(url);
  for (const url of scriptUrls) {
    let text: string | null = null;
    if (sameOrigin(url, ctx.targetUrl)) {
      // maxRedirects 0: a redirect could point off the target, and Run Hound never follows one.
      const res = await page.context().request.get(url, { maxRedirects: 0 }).catch(() => null);
      if (res?.ok()) text = await res.text();
    }
    text ??= capture.requests.find((r) => r.url === url)?.responseBody ?? null;
    if (text) sources.push({ where: url, url, text });
  }

  const inline = await evalIn<string[]>(page, INLINE_SCRIPTS);
  inline.forEach((text, i) => {
    if (text.trim()) sources.push({ where: `inline script #${i + 1} on ${pageUrl}`, url: null, text });
  });
  const html = await page.content();
  sources.push({ where: pageUrl, url: pageUrl, text: html });
  return sources;
}

function specBody(kind: string, scriptUrl: string | null): string {
  const pattern = SPEC_PATTERNS[kind];
  const fetchText = scriptUrl
    ? `const res = await page.request.get(${JSON.stringify(scriptUrl)});\nconst text = await res.text();`
    : `const text = await page.content();`;
  if (pattern) return `${fetchText}\nexpect(text).not.toMatch(new RegExp(${JSON.stringify(pattern)}));`;
  // service_role JWTs: decode every JWT-shaped value and check its role claim.
  return `${fetchText}
const roles = [...text.matchAll(/eyJ[A-Za-z0-9_-]+\\.(eyJ[A-Za-z0-9_-]+)\\.[A-Za-z0-9_-]*/g)].map((m) => {
  try { return JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")).role; } catch { return undefined; }
});
expect(roles).not.toContain("service_role");`;
}

export const check: Check = {
  id: "bundle-secrets",
  title: "No secret keys in the page's JavaScript",
  category: "security",

  plan(_form: DiscoveredForm): Scenario[] {
    return [
      scenarioFor("bundle-secrets", "scan-scripts", {
        title: "Scan every loaded script for secret keys",
        description: "Loads the page and searches every script it downloads (and inline scripts) for secret-looking keys. Publishable keys are fine.",
        priority: "high",
      }),
    ];
  },

  async run(ctx: CheckContext, scenario: Scenario) {
    return guarded("bundle-secrets", scenario, async (startedAt) => {
      const findings = new FindingList("bundle-secrets", "security");
      const sources = await collectSources(ctx);
      // One finding per distinct secret (kind + redacted preview); list every place it appears.
      const seen = new Map<string, { kind: string; preview: string; places: string[]; url: string | null }>();
      for (const source of sources) {
        for (const match of findSecrets(source.text)) {
          const key = `${match.kind}|${match.preview}`;
          const where = redactSecrets(source.where);
          const entry = seen.get(key) ?? { kind: match.kind, preview: match.preview, places: [], url: source.url };
          if (!entry.places.includes(where)) entry.places.push(where);
          seen.set(key, entry);
        }
      }
      for (const entry of seen.values()) {
        const what = KIND_NAMES[entry.kind] ?? `a secret (${entry.kind})`;
        const place = entry.places[0]!;
        const no = findings.items.length + 1;
        findings.add({
          title: entry.kind === "supabase-service-role" ? "Supabase service_role key is shipped to every visitor" : `Secret key shipped to every visitor: ${what}`,
          severity: "critical",
          meaning: `The page's JavaScript contains ${what}. Anything in the page's scripts can be read by anyone who opens the site, so this key is effectively public. It was found in ${place}.`,
          impact: "Anyone can copy the key and use it as you: run up bills on your account, read or change your data, or bypass your security rules.",
          fix: "Remove the key from the frontend code and move the call that needs it to your server (or an edge function). Then revoke the key and create a new one, because the old one has already been exposed.",
          location: place,
          evidence: [
            {
              kind: "network",
              label: "Script containing the key (value redacted)",
              data: { script: redactSecrets(place), foundIn: entry.places, kind: entry.kind, preview: entry.preview },
            },
          ],
          spec: playwrightSpec("bundle-secrets", no, `no ${entry.kind} in ${place}`, ctx.targetUrl, specBody(entry.kind, entry.url)),
        });
      }
      return checkResult("bundle-secrets", scenario, startedAt, findings.items, `Scanned ${sources.length} script/page sources`);
    });
  },
};
