/**
 * bundle-secrets: scan every script the page loads (external and inline) plus the HTML for
 * secret-looking values. Publishable keys are allowed; values are only ever reported redacted.
 */
import type { Check, CheckContext, DiscoveredForm, EvidenceCard, Scenario } from "../core/types.js";
import { findSecrets, redactSecrets, secretSpans } from "../engine/redact.js";
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

/** Re-fetches a same-origin script in full from the page; null on a redirect, an error status or a network error. */
const REFETCH = `async (url) => {
  try {
    const res = await fetch(url, { redirect: "manual", credentials: "same-origin", cache: "no-store" });
    return res.type === "opaqueredirect" || !res.ok ? null : await res.text();
  } catch {
    return null;
  }
}`;

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
      // Fetched from inside the page, so it goes through the pinned browser and the navigation guard (a separate
      // HTTP client would do its own DNS lookup). redirect "manual": Run Hound never follows a redirect.
      text = await evalIn<string | null>(page, REFETCH, url).catch(() => null);
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

/** Lines of context shown above and below the key, and the widest slice of a line shown (minified bundles). */
const CONTEXT_LINES = 4;
const MAX_EXCERPT_CHARS = 150;

/**
 * Shortens long token-like values (publishable keys, other JWTs, hashes) to their first 6 characters. The excerpt is
 * there to show where the key sits; neighbouring tokens add nothing and may be sensitive in ways no pattern knows.
 */
function shortenTokens(line: string): string {
  return line.replace(/[A-Za-z0-9_\-+=.]{24,}/g, (token) => `${token.slice(0, 6)}…(${token.length} chars)`);
}

interface Excerpt {
  line: number;
  column: number;
  /** File line number of lines[0]. */
  firstLine: number;
  lines: EvidenceCard["lines"];
}

/**
 * The lines around the secret at `index` in `text`, redacted. The whole text is redacted before it is cut, so no slice
 * of a key survives a cut. Long lines are narrowed to a window around the key. Line and column are 1-based.
 */
export function excerptAround(text: string, index: number, kind: string): Excerpt {
  // Where the key starts once every secret before it has been replaced by "[REDACTED:<kind>]".
  let at = index;
  for (const span of secretSpans(text)) {
    if (span.start >= index) break;
    at += `[REDACTED:${span.kind}]`.length - (span.end - span.start);
  }
  const redacted = redactSecrets(text);
  const lines = redacted.split("\n");
  const line = redacted.slice(0, at).split("\n").length;
  const column = at - (redacted.lastIndexOf("\n", at - 1) + 1) + 1;
  const from = Math.max(1, line - CONTEXT_LINES);
  // A private key's body follows its header on the next lines and isn't matched itself: never show what follows.
  const to = kind === "private-key" ? line : Math.min(lines.length, line + CONTEXT_LINES);
  const window = (l: string, centre: number) => {
    if (l.length <= MAX_EXCERPT_CHARS) return l;
    const start = Math.max(0, Math.min(centre - MAX_EXCERPT_CHARS / 2, l.length - MAX_EXCERPT_CHARS));
    return `${start > 0 ? "…" : ""}${l.slice(start, start + MAX_EXCERPT_CHARS)}${start + MAX_EXCERPT_CHARS < l.length ? "…" : ""}`;
  };
  const out: Excerpt["lines"] = [];
  for (let n = from; n <= to; n++) {
    const text = shortenTokens(window(lines[n - 1] ?? "", n === line ? column : 0));
    out.push({ text, ...(n === line ? { mark: true } : {}) });
  }
  return { line, column, firstLine: from, lines: out };
}

/**
 * The non-secret claims of a JWT found at `index` (role, issuer, expiry), so the card shows why it is an admin key
 * without showing the token. Empty when the value there is not a decodable JWT.
 */
export function jwtClaims(text: string, index: number): { label: string; value: string }[] {
  const match = /^eyJ[A-Za-z0-9_-]+\.(eyJ[A-Za-z0-9_-]+)\.[A-Za-z0-9_-]*/.exec(text.slice(index));
  if (!match) return [];
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(match[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return [];
  }
  const out: { label: string; value: string }[] = [];
  if (typeof claims.role === "string") out.push({ label: "Decoded role claim", value: claims.role.slice(0, 40) });
  if (typeof claims.iss === "string") out.push({ label: "Issuer claim", value: claims.iss.slice(0, 60) });
  if (typeof claims.exp === "number") out.push({ label: "Expires", value: new Date(claims.exp * 1000).toISOString().slice(0, 10) });
  return out;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The path of a script URL ("/assets/app.js"), or the place as given when it isn't a URL. */
function scriptName(place: string): string {
  try {
    return new URL(place).pathname;
  } catch {
    return place;
  }
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
  // One page, one set of scripts and one layout, however many forms it has.
  scope: "page",

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
      ctx.step("Downloading every script the page loads");
      const sources = await collectSources(ctx);
      ctx.step(`Searching ${sources.length} scripts and the HTML for secret keys`);
      // One finding per distinct secret (kind + redacted preview); list every place it appears.
      const seen = new Map<string, { kind: string; preview: string; places: string[]; url: string | null; excerpt: Excerpt; claims: { label: string; value: string }[] }>();
      for (const source of sources) {
        for (const match of findSecrets(source.text)) {
          const key = `${match.kind}|${match.preview}`;
          const where = redactSecrets(source.where);
          const entry = seen.get(key) ?? {
            kind: match.kind,
            preview: match.preview,
            places: [],
            url: source.url,
            excerpt: excerptAround(source.text, match.index, match.kind),
            claims: match.kind === "supabase-service-role" ? jwtClaims(source.text, match.index) : [],
          };
          if (!entry.places.includes(where)) entry.places.push(where);
          seen.set(key, entry);
        }
      }
      for (const entry of seen.values()) {
        const what = KIND_NAMES[entry.kind] ?? `a secret (${entry.kind})`;
        const place = entry.places[0]!;
        const no = findings.items.length + 1;
        const { line, column, lines, firstLine } = entry.excerpt;
        ctx.step(`Found ${entry.kind} in ${place}`);
        const card = await ctx.captureCard(`${entry.kind} in the page's JavaScript`, {
          title: `${capitalise((KIND_NAMES[entry.kind] ?? entry.kind).replace(/^an? /, ""))} in ${scriptName(place)}`,
          subtitle: `${place} (line ${line}, column ${column})`,
          lines,
          firstLineNumber: firstLine,
          facts: [
            { label: "Script", value: place },
            { label: "Line", value: String(line) },
            { label: "Column", value: String(column) },
            { label: "Key type", value: entry.kind },
            { label: "Key (redacted)", value: entry.preview },
            ...entry.claims,
            ...(entry.places.length > 1 ? [{ label: "Also found in", value: entry.places.slice(1, 4).join(", ") }] : []),
          ],
        });
        const inScripts = entry.places.length > 1 ? ` (in ${entry.places.length} scripts)` : "";
        findings.add({
          title: `${entry.kind === "supabase-service-role" ? "Supabase service_role key is shipped to every visitor" : `Secret key shipped to every visitor: ${what}`}${inScripts}`,
          severity: "critical",
          meaning: `The page's JavaScript contains ${what}. Anything in the page's scripts can be read by anyone who opens the site, so this key is effectively public. It was found in ${entry.places.length > 1 ? `${entry.places.length} places: ${entry.places.join(", ")}` : place}.`,
          impact: "Anyone can copy the key and use it as you: run up bills on your account, read or change your data, or bypass your security rules.",
          fix: "Remove the key from the frontend code and move the call that needs it to your server (or an edge function). Then revoke the key and create a new one, because the old one has already been exposed.",
          location: place,
          ...(entry.places.length > 1 ? { locations: entry.places } : {}),
          evidence: [
            {
              kind: "network",
              label: "Script containing the key (value redacted)",
              data: { script: redactSecrets(place), foundIn: entry.places, kind: entry.kind, preview: entry.preview, line, column },
            },
            card,
          ],
          spec: playwrightSpec("bundle-secrets", no, `no ${entry.kind} in ${place}`, ctx.targetUrl, specBody(entry.kind, entry.url)),
        });
      }
      return checkResult("bundle-secrets", scenario, startedAt, findings.items, `Scanned ${sources.length} script/page sources`);
    });
  },
};
