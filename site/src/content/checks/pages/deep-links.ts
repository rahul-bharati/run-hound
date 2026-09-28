import type { CheckPage } from "./types";

/**
 * /checks/deep-links/. Sources: app/src/checks/deep-links.ts (at most 10 same-site links, which links are left out,
 * the 400-or-more and not-found-view rules, the single-page-app cause), docs/v2-spec.md "deep-links", the Fernway 0.6.0
 * run's featured finding (content/runs/fernway-0.6.0.json: the steps, the frame and card, the test) and TESTING.md
 * "Known limitations" (only the given page is tested; deep-links opens success pages too).
 */
export const page = {
  id: "deep-links",
  description:
    "How the deep links check opens an app's own links directly, as a reload or a shared link would, with a real Fernway finding, its test and the fix.",
  lede: "A page that loads through the app's own links can fail from a bookmark, a reload or a shared link. AI builders often make single-page apps, and a host with no fallback to index.html answers such links with an error.",
  severity: "high",
  steps: [
    {
      label: "Opening /app/settings directly",
      line: "Each of the page's own links is opened on its own, as a reload would; the settings page loaded normally.",
    },
    {
      label: "Opening /app/help directly",
      line: "The help page answered 404, so anyone reloading it or following a shared link lands on an error.",
    },
  ],
  notCounted:
    "Links to other sites, downloads, the page's own address, and links that act when opened: sign out, unsubscribe.",
  evidence: [
    {
      label: "/app/help opened directly (404)",
      caption: "Fernway's help page opened directly: the server's plain Not Found page.",
      alt: "A plain white Not Found page: the requested URL was not found on this server. Run Hound's facts: opened directly, status 404.",
    },
    {
      label: "/app/help opened directly",
      caption: "The direct load as the report records it: a 404 and an error page.",
    },
  ],
  reproduce:
    "The exported test opens /app/help directly, the way a reload or a shared link would. It fails on an answer of 400 or more, or a title or main heading saying 404 or not found.",
  background: [
    {
      label: "MDN: 404 Not Found",
      href: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/404",
      why: "The status the help page answered with: the server has no file at that path to send.",
    },
    {
      label: "MDN: The History API",
      href: "https://developer.mozilla.org/en-US/docs/Web/API/History_API",
      why: "Single-page apps change the address with pushState, so the server first sees those paths on a reload.",
    },
  ],
  limits: [
    "At most 10 of the page's own links are opened, and the pages behind them aren't tested any further.",
    "A not-found view that also shows when the link is followed inside the app isn't flagged: that page doesn't exist.",
    "Signed in, links open as the run's account, so a success page that grants a plan can change that account.",
  ],
  related: ["console-network-errors", "page-controls"],
} as const satisfies CheckPage;
