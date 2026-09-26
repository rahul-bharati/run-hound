/**
 * deep-links (0.4.0, docs/v2-spec.md "deep-links"): do the app's own pages load when opened directly (a reload, a
 * shared link)? Opens up to 10 same-origin links from the page directly (signed in as the run account when there is
 * one) and reports those whose document answers >= 400, or that render a not-found view although following the same
 * link inside the app does not. The typical cause is a single-page app hosted without a fallback to index.html.
 */
import type { Page } from "playwright";
import type { Check, CheckContext, DiscoveredPage, Evidence, Finding, Scenario } from "../core/types.js";
import { linkActs } from "./lib/acting-links.js";
import { guarded, result, tryCapture, tryCard } from "./lib/functional-finding.js";
import { settle } from "./lib/functional-form.js";

const ID = "deep-links" as const;

/** At most this many links are opened directly; each is a full page load. */
const MAX_LINKS = 10;

/** Common file extensions a link downloads rather than navigates to. */
const DOWNLOAD_EXT = /\.(pdf|zip|tar|gz|csv|xlsx?|docx?|pptx?|dmg|exe|apk|mp4|mp3|png|jpe?g|gif|svg)(\?|#|$)/i;

interface Link {
  url: string;
  path: string;
  text: string;
}

interface Broken {
  path: string;
  url: string;
  status: number;
  reason: "error" | "not-found-view";
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** Same-origin links with a real href, each with its visible text, in document order. Runs as a string. */
const SCAN_LINKS = `(() => {
  const origin = location.origin;
  const out = [];
  for (const a of document.querySelectorAll("a[href]")) {
    if (a.hasAttribute("download") || a.target) continue;
    const raw = (a.getAttribute("href") || "").trim();
    if (!raw || raw.charAt(0) === "#" || /^(javascript|mailto|tel|data):/i.test(raw)) continue;
    let url;
    try { url = new URL(a.href, location.href); } catch (e) { continue; }
    if (url.origin !== origin) continue;
    out.push({ url: url.href, path: url.pathname, text: (a.innerText || a.textContent || "").replace(/\\s+/g, " ").trim() });
  }
  return out;
})()`;

/** True when the loaded page shows a "this page doesn't exist" view (its title or main heading says so). */
const NOT_FOUND_VIEW = `(() => {
  const title = (document.title || "").toLowerCase();
  const h1 = (document.querySelector("h1") ? document.querySelector("h1").innerText || "" : "").toLowerCase();
  const text = title + " " + h1;
  return /\\b404\\b|not[\\s-]?found|does\\s?n['’]?t exist|no such page|page (does\\s?n['’]?t|cannot be) found/.test(text);
})()`;

async function isNotFoundView(page: Page): Promise<boolean> {
  return Boolean(await page.evaluate(NOT_FOUND_VIEW).catch(() => false));
}

/** The links worth opening directly: same-origin, another path than the page's own, not destructive, not a download. */
function chooseLinks(all: Link[], pageUrl: string): Link[] {
  const own = pathOf(pageUrl);
  const seen = new Set<string>();
  const chosen: Link[] = [];
  for (const link of all) {
    if (link.path === own) continue;
    if (DOWNLOAD_EXT.test(link.url)) continue;
    // A link that acts when loaded (sign out, disconnect, accept, "?action=delete") is never opened directly.
    if (linkActs(link.text, link.url)) continue;
    if (seen.has(link.path)) continue;
    seen.add(link.path);
    chosen.push(link);
    if (chosen.length >= MAX_LINKS) break;
  }
  return chosen;
}

/**
 * Follows `link` inside the app from a freshly loaded target page (clicks it, letting the app's own click handler run)
 * and returns whether the app then shows a not-found view. Used only to tell a real "no such page" from a hosting
 * problem: when the same link works inside the app but not when opened directly, the direct load is broken.
 */
async function inAppShowsNotFound(ctx: CheckContext, page: Page, link: Link): Promise<boolean> {
  await page.goto(ctx.targetUrl, { waitUntil: "load" }).catch(() => undefined);
  await settle(page);
  const clicked = await page
    .evaluate((path) => {
      const a = Array.from(document.querySelectorAll("a[href]")).find((el) => {
        try {
          return new URL((el as HTMLAnchorElement).href, location.href).pathname === path;
        } catch {
          return false;
        }
      }) as HTMLElement | undefined;
      if (!a) return false;
      a.click();
      return true;
    }, link.path)
    .catch(() => false);
  if (!clicked) return true; // Can't follow it in-app: don't flag on the soft-404 rule.
  await settle(page);
  return isNotFoundView(page);
}

function count(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? "" : "s"}`;
}

function deepLinkSpec(target: string, broken: Broken[]): string {
  const q = (v: unknown) => JSON.stringify(v);
  return [
    `import { test, expect } from "@playwright/test";`,
    ``,
    `// Exported by Run Hound. Open each linked page directly (as a shared link or a reload would).`,
    `const TARGET = ${q(target)};`,
    `const PATHS = ${q(broken.map((b) => b.path))} as unknown as string[];`,
    ``,
    `test("the app's pages load when opened directly", async ({ page }) => {`,
    `  for (const path of PATHS) {`,
    `    const url = new URL(path, TARGET).href;`,
    `    const response = await page.goto(url, { waitUntil: "load" });`,
    `    expect(response && response.status(), path + " should not answer with an error").toBeLessThan(400);`,
    `    const notFound = await page.evaluate(() => /404|not found/i.test((document.title + " " + (document.querySelector("h1")?.innerText || ""))));`,
    `    expect(notFound, path + " should not show a not-found view when opened directly").toBe(false);`,
    `  }`,
    `});`,
    ``,
  ].join("\n");
}

export const check: Check = {
  id: ID,
  title: "The app's pages load when opened directly",
  category: "broken-feature",
  scope: "page",

  plan(_form, page): Scenario[] {
    const targets = page?.linkTargets ?? [];
    const own = page ? pathOf(page.url) : "";
    if (!targets.some((t) => pathOf(t) !== own)) return [];
    return [
      {
        id: ID,
        checkId: ID,
        title: "The app's pages load when opened directly",
        description:
          "Open up to ten of the page's own links directly, as a reload or a shared link would (signed in as the run account). Each must load without an error and without a not-found view when the same link works inside the app.",
        kind: "golden",
        priority: "medium",
        destructive: false,
        defaultSelected: true,
      },
    ];
  },

  run(ctx, scenario) {
    return guarded(ID, scenario, ctx, async (started) => {
      const { page } = await ctx.openPage({ as: "self" });
      const all = ((await page.evaluate(SCAN_LINKS).catch(() => [])) as Link[]) ?? [];
      const chosen = chooseLinks(all, ctx.targetUrl);
      if (chosen.length === 0) {
        return { ...result(ID, scenario, started, []), status: "skipped" as const, notes: "This page has no links to its own other pages to open directly." };
      }

      const broken: Broken[] = [];
      const notes: string[] = [];
      const frames: Evidence[] = [];
      for (const link of chosen) {
        ctx.step(`Opening ${link.path} directly`, page);
        const response = await page.goto(link.url, { waitUntil: "load" }).catch(() => null);
        await settle(page);
        const status = response?.status() ?? 0;
        if (status >= 400) {
          broken.push({ path: link.path, url: link.url, status, reason: "error" });
          notes.push(`${link.path}: opened directly → ${status}`);
          if (frames.length < 6) frames.push(...(await captureBroken(ctx, page, link.path, status)));
          continue;
        }
        if (await isNotFoundView(page)) {
          const inApp = await inAppShowsNotFound(ctx, page, link);
          if (!inApp) {
            broken.push({ path: link.path, url: link.url, status, reason: "not-found-view" });
            notes.push(`${link.path}: opened directly → ${status}, but shows a "page not found" view (it works inside the app)`);
            // Re-load the broken page for the frame (the in-app check navigated away).
            await page.goto(link.url, { waitUntil: "load" }).catch(() => undefined);
            await settle(page);
            if (frames.length < 6) frames.push(...(await captureBroken(ctx, page, link.path, status)));
            continue;
          }
          notes.push(`${link.path}: not found both directly and inside the app (the app has no such page)`);
          continue;
        }
        notes.push(`${link.path}: opened directly → ${status}`);
      }

      if (broken.length === 0) {
        return result(ID, scenario, started, [], `Opened ${count(chosen.length, "linked page")} directly; each loaded. ${notes.join("; ")}`);
      }

      const locations = broken.map((b) => `${b.path} (${b.status}${b.reason === "not-found-view" ? ", not-found view" : ""})`);
      const cards: Evidence[] = [];
      for (const b of broken.slice(0, 6)) {
        cards.push(
          ...(await tryCard(ctx, `${b.path} opened directly`, {
            title: `GET ${b.path} → ${b.status}`,
            subtitle: b.reason === "error" ? "Opening this link directly answers with an error." : "Opening this link directly answers OK, but the page shows a not-found view.",
            lines: [
              { text: `Direct load: GET ${b.path}`, mark: true },
              { text: `Status: ${b.status}` },
              { text: b.reason === "not-found-view" ? "Renders: a not-found view (the same link works inside the app)" : "Renders: an error page" },
            ],
          })),
        );
      }

      const finding: Finding = {
        checkId: ID,
        id: `${ID}#${scenario.id}-1`,
        title: `${count(broken.length, "page")} ${broken.length === 1 ? "shows" : "show"} an error when opened directly (a reload or a shared link breaks)`,
        severity: "high",
        category: "broken-feature",
        confidence: "confirmed",
        meaning: `Opening ${broken.length === 1 ? "one of the app's own links" : "some of the app's own links"} directly, the way a reload or a shared link would, ${broken.length === 1 ? "shows" : "show"} an error or a "page not found" view, even though the same ${broken.length === 1 ? "link works" : "links work"} when clicked inside the app.`,
        impact: "Anyone who reloads the page, bookmarks it or opens a shared link lands on an error instead of the page they expected. Deep links and refreshes are broken.",
        fix: 'Ask your AI or developer: "Opening these pages directly returns an error or a not-found view, though they work when navigated to inside the app. This is usually a single-page app served without a fallback to index.html: configure the host to serve index.html for any unknown path so the client router can handle it."',
        location: locations[0]!,
        locations,
        evidence: [...frames, ...cards],
        spec: { filename: `${ID}.spec.ts`, source: deepLinkSpec(ctx.targetUrl, broken) },
      };
      return result(ID, scenario, started, [finding], notes.join("; "));
    });
  },
};

/** A frame of the error page opened directly. */
async function captureBroken(ctx: CheckContext, page: Page, path: string, status: number): Promise<Evidence[]> {
  return tryCapture(ctx, page, `${path} opened directly (${status})`, {
    caption: `Opened ${path} directly (as a reload or a shared link would): the page did not load as expected.`,
    facts: [
      { label: "Opened directly", value: path },
      { label: "Status", value: String(status) },
    ],
  });
}
