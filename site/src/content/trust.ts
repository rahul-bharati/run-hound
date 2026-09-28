import { builtInChecks } from "@/content/checks/data";
import type { LinkTarget } from "@/content/routes";
import { site } from "@/lib/site";

/**
 * The facts a visitor checks before trusting Run Hound, each with the link to its proof: the homepage's proof strip
 * and the Start band's facts line (the design's §3.1, blocks 0 and 6; the FactStrip primitive shows them). Counts come
 * from the checks data and the release from lib/site.ts, so nothing here is typed that the data knows (trust.test.ts).
 *
 * A link names its page by its registry id; `fallback` is where it goes until that page or anchor is registered
 * (content/routes.ts LinkTarget), and a page resolves it with resolveTarget() from lib/nav.ts. Server-only, like every
 * content module.
 */
export type TrustItem = {
  /** The fact, in at most 6 words. */
  readonly label: string;
  /** Its proof on this site: every FactStrip item is a link (§2.5). */
  readonly link: LinkTarget;
};

/**
 * The install requirements, which name the engines and the platforms (Docker 24+, Docker Desktop or Podman; Linux,
 * macOS and Windows on amd64 and arm64): the Install page's #requirements (§3.4), until then the one-page docs'.
 */
const requirements: LinkTarget = { to: "docs-install", hash: "requirements", fallback: { to: "docs", hash: "requirements" } };

/** The hero's proof strip: what it is, where it runs, the AI and the evidence (§3.1, block 0). */
export const proofStrip: readonly TrustItem[] = [
  { label: `${builtInChecks.length} checks, all open source`, link: { to: "checks" } },
  { label: "Runs on your machine", link: { to: "docs-safety", fallback: { to: "docs", hash: "safety" } } },
  { label: "AI off by default", link: { to: "docs-ai", fallback: { to: "docs", hash: "ai" } } },
  {
    label: "A Playwright test per finding",
    // A real exported spec, on the double-submit check's page; until that page exists, the check's card on the hub.
    link: { to: "check-double-submit", hash: "reproduce", fallback: { to: "checks", hash: "double-submit" } },
  },
];

/** The Start band's facts line: the license, the engines, the platforms and the release (§3.1, block 6). */
export const factsLine: readonly TrustItem[] = [
  // The open-source page has had #license all along; the registry promises it when that page is rewritten (F1), and
  // the fallback goes. Until then the fallback is its own target, which resolveTarget() doesn't check, so trust.test.ts
  // checks the page's markup for it.
  { label: `${site.license} license`, link: { to: "open-source", hash: "license", fallback: { to: "open-source", hash: "license" } } },
  { label: "Docker or Podman", link: requirements },
  // The images are published for linux/amd64 and arm64 (lib/site.ts).
  { label: "amd64 and arm64", link: requirements },
  {
    label: `Release ${site.version}, ${site.released}`,
    // What a 0.x release may change (#stability, new with the open-source page's rewrite); until then its roadmap.
    link: { to: "open-source", hash: "stability", fallback: { to: "open-source", hash: "roadmap" } },
  },
];
