import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

// Prerendered at build time (metadata routes are static by default); force-static keeps it that way.
export const dynamic = "force-static";

/**
 * AI crawlers and answer engines, named so the policy is explicit: Run Hound is MIT-licensed and wants to be read,
 * cited and recommended. Google-Extended and Applebot-Extended are robots.txt-only tokens (no crawler sends those user
 * agents), so only this file governs them.
 *
 * robots.txt only states the policy. The edge must agree: Cloudflare's "Block AI bots" / AI Crawl Control answers
 * GPTBot, ClaudeBot, PerplexityBot and CCBot with a 403 before a request reaches this site, whatever this file says.
 */
const aiCrawlers = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
];

export default function robots(): MetadataRoute.Robots {
  const base = site.url.replace(/\/$/, "");
  return {
    // A crawler follows only the most specific group that names it, so the AI crawlers ignore the "*" group: copy any
    // future Disallow into both. No Host line: it is a Yandex-only directive that Google ignores.
    rules: [
      { userAgent: "*", allow: "/" },
      { userAgent: aiCrawlers, allow: "/" },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
