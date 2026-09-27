import { pageTitle } from "@/lib/metadata";
import { site } from "@/lib/site";
import { breadcrumbNode, graph, webPageNode } from "@/lib/structured-data";

/**
 * The page for apps built with Lovable, Bolt, v0 and similar tools (/ai-built-apps/). Its facts come from
 * docs/ai-built-apps.md (what discovery handles and its limits), docs/install.md and TESTING.md ("Test your own app":
 * the host.docker.internal set-up and its problems), docs/signed-in-runs.md and docs/brand.md (what discovery covers).
 * Plain data, so llms-full.txt can reuse it.
 */

/** The page's canonical path, title and meta description: pageMetadata() and the structured data share them. */
export const aiBuiltPage = {
  path: "/ai-built-apps/",
  title: "Test apps built with Lovable, Bolt and v0",
  description:
    "How to test a Lovable, Bolt or v0 app in a real browser: the widgets and dialog forms Run Hound handles, the host.docker.internal set-up, and its limits.",
  /** Its name in the breadcrumb and the footer. */
  crumb: "AI-built apps",
} as const;

/** What discovery covers on one page (docs/brand.md: say what it covers, never "every form"). */
export const coverage =
  "On one page, Run Hound finds up to 5 forms (the one with the most fields first), forms behind up to 3 buttons that open a dialog or a sheet, and up to 40 controls outside the forms, of which it clicks 20.";

/** How it handles what AI app builders generate, since 0.4.0 (docs/ai-built-apps.md). */
export const handles: readonly { title: string; text: string }[] = [
  {
    title: "Widgets that aren't form fields",
    text: "Radix and shadcn/ui, Headless UI, cmdk and MUI selects, comboboxes, checkboxes, switches, radio groups and sliders are found as fields and set the way a person sets them (open, pick an option), in the checks and in the exported Playwright tests.",
  },
  {
    title: "Forms in dialogs and sheets",
    text: "Discovery tries up to 3 buttons that look like they open one (“New project”, “Add member”, aria-haspopup=\"dialog\"), with every write blocked while it looks, and plans the form that appears. Its scenarios open the dialog first after every page load.",
  },
  {
    title: "Forms validated by a schema",
    text: "With react-hook-form and zod, optional fields are filled too, and fields the form refuses when it is sent empty count as required even when nothing marks them. A label such as “Email *” marks a field required. Run Hound answers the empty submit itself, so nothing is saved.",
  },
  {
    title: "Toasts and client-side routing",
    text: "Toasts such as sonner's count as shown and announced, and are never taken for a saved record. A move to another page after saving is followed, and ids that React or Radix number on each load are never used to find a field.",
  },
  {
    title: "Multi-step forms, on their first step",
    text: "When submitting shows the next step without saving, the checks that need a saved record skip with a “multi-step form” note instead of reporting lost data.",
  },
];

/** Vite: listen on all interfaces and accept the container's name for your machine (TESTING.md, docs/install.md). */
export const viteConfig = `// vite.config.ts: inside your existing defineConfig({ ... })
server: {
  host: true,                              // listen on all interfaces, like vite --host
  allowedHosts: ["host.docker.internal"],  // or Vite answers "Blocked request"
},`;

/** Next.js: `next dev` already listens on all interfaces; it only needs to accept the origin. */
export const nextConfig = `// next.config.ts: inside your existing config
allowedDevOrigins: ["host.docker.internal"],`;

/** Linux: share the host's network instead, so localhost is your machine and nothing in the app changes. */
export const hostNetworkCommand = `mkdir -p runs
docker run --rm --init --network host -v "$PWD/runs:/repo/app/runs" ${site.imageName} \\
  run http://localhost:5173/signup --approve all`;

/** What you see when the container set-up isn't right, and what it means (TESTING.md "Common problems"). */
export const problems: readonly { see: string; means: string }[] = [
  {
    see: "Nothing is answering at http://localhost:5173",
    means:
      "In a container, localhost is the container itself. Your app is running, just not where the container looks: enter http://host.docker.internal:5173 instead.",
  },
  {
    see: "Blocked request. This host is not allowed (or “No form found”)",
    means: "Vite refused the host name. Add host.docker.internal to server.allowedHosts in vite.config.",
  },
  {
    see: "The page never becomes interactive, and you get false findings",
    means: "The Next.js dev server blocked the origin. Add host.docker.internal to allowedDevOrigins in next.config.",
  },
  {
    see: "Failed requests to http://localhost:<apiPort>",
    means:
      "A frontend that calls its API on localhost calls the container instead, and fails. Use the host network on Linux, or install Run Hound from source.",
  },
  {
    see: "Signed in as Account A, but … still shows the sign-in page",
    means:
      "The session didn't carry over: the sign-in page and the page use different host names, the app keeps its session in sessionStorage only, or the account's details are wrong. Test sign-in in Settings checks the account on its own.",
  },
];

/**
 * Where it stops on these apps (docs/ai-built-apps.md "Limits", the docs page, TESTING.md "Known limitations"; the
 * signed-in checks' own-address rule from docs/v2-spec.md and docs/signed-in-runs.md).
 */
export const limits: readonly string[] = [
  "Only the first step of a multi-step form is tested.",
  "Forms that appear only after other actions (a menu item, a tab, a hover, or a 4th opener button) aren't found.",
  "File inputs are left empty.",
  "Widgets from other libraries, custom date pickers and rich-text editors may not be recognised as fields.",
  "Anything inside a canvas, a closed shadow root or a frame from another site (an embedded payment form, for example) can't be seen.",
  "One page per run: deep-links opens the page's own links to see that they load, but the pages behind them aren't tested.",
  "The signed-in checks don't reach a hosted backend (a Supabase project on supabase.co): they use only your app's own address or a local API.",
  "Only apps on your machine, a private address or a host name you list in RUNHOUND_ALLOWED_HOSTS; other hosts are refused. That setting skips the address check with no ownership check, so list only hosts you own.",
];

/**
 * The page's structured data: a WebPage dated like the release it describes (the page shows that date) and its
 * breadcrumb. The site and the app are referred to by id (lib/structured-data.ts).
 */
export function aiBuiltJsonLd() {
  return graph(
    webPageNode({
      path: aiBuiltPage.path,
      name: pageTitle(aiBuiltPage),
      description: aiBuiltPage.description,
      dateModified: site.releasedIso,
    }),
    breadcrumbNode([
      { name: "Home", path: "/" },
      { name: aiBuiltPage.crumb, path: aiBuiltPage.path },
    ]),
  );
}
