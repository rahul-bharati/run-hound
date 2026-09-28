import { commands, type ShellBlock } from "@/content/commands";
import type { Rich } from "@/content/how-it-works";
import type { LinkTarget } from "@/content/routes";
import { routeGraph } from "@/lib/structured-data";

/**
 * The page for apps built with Lovable, Bolt, v0 and similar tools (/ai-built-apps/). Its facts come from
 * docs/ai-built-apps.md (what discovery handles and its limits), docs/install.md and TESTING.md ("Test your own app":
 * the host.docker.internal set-up and its problems), docs/signed-in-runs.md and docs/brand.md (what discovery covers).
 * Plain data, so llms-full.txt can reuse it; app/ai-built-apps/page.tsx renders it (DESIGN.md §3.11), and
 * components/demo/rich-text.tsx its inline code and links.
 *
 * The page is the search landing page for Lovable, Bolt and v0 apps. "Vibe-coded" is a secondary term (brand.md, copy
 * rules): once in the first paragraph and in one h2, never in the title, the h1 or the description (ai-built.test.ts).
 * The discovery limits it states are the app's own constants (app/src/engine/discover.ts, checks/page-controls.ts),
 * which ai-built.test.ts reads.
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

/**
 * The page's top: the h1 and its first paragraph, which holds the page's one "vibe-coded" outside an h2. The h1 is the
 * route's title with a full stop (content/routes/product.ts keeps the title).
 */
export const aiBuiltIntro = {
  title: "Test apps built with Lovable, Bolt and v0.",
  lede: "Apps from AI builders mix plain fields with custom widgets: their selects are buttons, their forms open in dialogs and their errors arrive as toasts. Run Hound tests a vibe-coded app the way a person uses it, in a real browser on your machine, and proves every finding with evidence.",
  /** Before the release and its date (lib/site.ts), in the meta line under the lede. */
  metaLead: "For release",
  setUp: "Set it up",
  seeFernway: "See a real run on Fernway",
} as const;

/** The names of #set-up's code blocks (each also names its scrolling region, so each is unique on the page). */
export const setUpLabels = {
  vite: "Vite",
  next: "Next.js",
  run: "Docker or Podman, from any folder",
  hostNetwork: "Docker, host network",
} as const;

/**
 * The page's sections in order: the id (kept from before the redesign, #discovery new: the old /docs/#ai-built lands
 * here), the h2 (at most 8 words, a statement) and the intro (at most 25 words).
 */
export const aiBuiltSections = [
  {
    id: "handles",
    title: "The widgets vibe-coded apps are built from",
    intro: "Discovery handles what AI app builders generate: React with Radix and shadcn/ui components, react-hook-form with zod, sonner toasts and client-side routing.",
  },
  {
    id: "discovery",
    title: "What discovery covers on one page",
    intro: "Run Hound says what it covers, never “every form”. A field it couldn't set is named in the notes of the scenarios it skipped.",
  },
  {
    id: "set-up",
    title: "Set it up: export, run, then test",
    intro: "Run Hound tests your app on your machine, not in the builder. Export the code, start it locally, then let Run Hound's container reach it.",
  },
  {
    id: "signed-in",
    title: "Pages behind your sign-in",
    intro: "Save two test accounts you own, A and B, and Run Hound signs in through your app's own sign-in form before it tests.",
  },
  {
    id: "limits",
    title: "Where it stops",
    intro: "What Run Hound doesn't cover on these apps yet.",
  },
  {
    id: "fernway",
    title: "Try it first on Fernway",
    intro: "Fernway is a small SaaS app built the way AI builders build apps. The test lab ships it clean and with planted bugs.",
  },
] as const satisfies readonly { id: string; title: string; intro: string }[];

export type AiBuiltSectionId = (typeof aiBuiltSections)[number]["id"];

/** A section's heading and intro by its id. */
export const aiBuiltSection = (id: AiBuiltSectionId) => aiBuiltSections.find((section) => section.id === id)!;

/**
 * #discovery: the content of the old /docs/#ai-built, the numbers first. Each `limit` is one of the app's constants,
 * which ai-built.test.ts compares with its source.
 */
export const discovery = {
  facts: [
    { term: "Forms", value: "Up to 5 per page, the one with the most fields first", limit: 5 },
    { term: "Dialog buttons", value: "Up to 3 buttons that open a dialog or a sheet, such as “Add member”", limit: 3 },
    { term: "Controls outside forms", value: "Up to 40 found, of which it clicks 20", limit: 40 },
  ],
  finds: [
    ["Native inputs, selects, text areas, checkboxes and radio buttons, inside a ", { code: "<form>" }, " or not, and the buttons and controls outside the forms."],
    [
      "Forms behind a button. It never tries a link to another page or a control that looks destructive. While it looks, it blocks every write: every request except GET, HEAD and OPTIONS, and every WebSocket message.",
    ],
    ["Required fields marked only in their label (“Email *”, “(required)”), and fields the page itself refuses when left empty."],
  ] satisfies readonly Rich[],
  limitsLink: { text: "Where it stops", hash: "limits" },
} as const;

/**
 * How it handles what AI app builders generate, since 0.4.0 (docs/ai-built-apps.md). `card` is the page's card body
 * (brand.md: at most 22 words); `text` is the whole fact, which llms-full.txt reads.
 */
export const handles: readonly { title: string; card: string; text: string }[] = [
  {
    title: "Widgets that aren't form fields",
    card: "Selects, comboboxes, switches and sliders from Radix, shadcn/ui, Headless UI, cmdk and MUI count as fields, set as a person sets them.",
    text: "Radix and shadcn/ui, Headless UI, cmdk and MUI selects, comboboxes, checkboxes, switches, radio groups and sliders are found as fields and set the way a person sets them (open, pick an option), in the checks and in the exported Playwright tests.",
  },
  {
    title: "Forms in dialogs and sheets",
    card: "Discovery clicks up to 3 buttons that open one, such as “Add member”, with every write blocked, and plans the form inside.",
    text: "Discovery tries up to 3 buttons that look like they open one (“New project”, “Add member”, aria-haspopup=\"dialog\"), with every write blocked while it looks, and plans the form that appears. Its scenarios open the dialog first after every page load.",
  },
  {
    title: "Forms validated by a schema",
    card: "With react-hook-form and zod, fields the form refuses when sent empty count as required, and optional fields are filled too.",
    text: "With react-hook-form and zod, optional fields are filled too, and fields the form refuses when it is sent empty count as required even when nothing marks them. A label such as “Email *” marks a field required. Run Hound answers the empty submit itself, so nothing is saved.",
  },
  {
    title: "Toasts and client-side routing",
    card: "Sonner toasts count as shown and announced, never as a saved record. A move to another page after saving is followed.",
    text: "Toasts such as sonner's count as shown and announced, and are never taken for a saved record. A move to another page after saving is followed, and ids that React or Radix number on each load are never used to find a field.",
  },
  {
    title: "Multi-step forms, first step only",
    card: "When submitting shows the next step without saving, checks that need a saved record skip with a “multi-step form” note.",
    text: "When submitting shows the next step without saving, the checks that need a saved record skip with a “multi-step form” note instead of reporting lost data.",
  },
];

/**
 * #set-up, in order: export and run the app locally first (§3.11), then host.docker.internal. `extra` names the code a
 * step shows after its words: the two dev server configs, or the pull-and-run commands (content/commands.ts).
 */
export const setUpSteps: readonly { readonly title: string; readonly text: Rich; readonly extra?: "configs" | "run" }[] = [
  {
    title: "1. Export your app's code and run it locally",
    text: [
      "Export the code from your builder, install its dependencies and start it with its dev command, such as ",
      { code: "npm run dev" },
      ". Give it a throwaway database. A full run saves the form about 7 or 8 times, with obviously fake values. Run Hound never deletes the records it creates.",
    ],
  },
  {
    title: "2. Let the dev server answer the container",
    text: [
      "Inside the container, localhost is the container itself, not your machine, so Run Hound reaches your app as ",
      { code: "host.docker.internal" },
      ". The dev server must listen on all interfaces and accept that host name. Vite needs both:",
    ],
    extra: "configs",
  },
  {
    title: "3. Start Run Hound",
    text: ["Pull the image and run it from any folder, with Docker or Podman. Reports land in ", { code: "./runs" }, "."],
    extra: "run",
  },
  {
    title: "4. Enter your page",
    text: [
      "Open ",
      { code: "http://localhost:4000" },
      " and enter your page as ",
      { code: "http://host.docker.internal:<port>/<page>" },
      ", for example ",
      { code: "http://host.docker.internal:5173/signup" },
      ". Check the “found” strip above the plan, approve the scenarios you want and start the run.",
    ],
  },
];

/** Step 2's words between the Vite and the Next.js config. */
export const nextConfigNote: Rich = [
  "Or start Vite with ",
  { code: "vite --host" },
  " and keep only ",
  { code: "allowedHosts" },
  " in the config. ",
  { code: "next dev" },
  " already listens on all interfaces; Next.js only needs to accept the origin:",
];

/** Step 3's commands: the quick start's pull and run (content/commands.ts), without their output. */
export const runBlock: ShellBlock = { commands: commands.blocks.run.commands };

/** The two ways round the container's network, and the container set-up's limits. */
export const otherSetUps = {
  hostNetwork: {
    title: "Linux: share the host's network",
    text: [
      "With ",
      { code: "--network host" },
      ", localhost is your machine, so nothing in your app needs to change:",
    ] satisfies Rich,
    block: commands.blocks.hostNetworkRun,
  },
  source: {
    title: "From source: no network set-up",
    text: [
      "Installed from source (Node.js 22.12 or newer, on Linux or macOS), Run Hound tests your app exactly as your browser sees it. Enter ",
      { code: "http://localhost:<port>/<page>" },
      ". It is also the way to watch the browser in a window. ",
      { text: "Install from source", link: { to: "docs-install", hash: "from-source", fallback: { to: "docs", hash: "install" } } },
      ".",
    ] satisfies Rich,
  },
  limits: [
    "Limits of the container set-up: ",
    { code: "client-only-validation" },
    " is skipped for a target that isn't localhost, and the CSRF check is inconclusive there. A container can't show the browser in a window, though the live preview in the web UI works.",
  ] satisfies Rich,
  problemsTitle: "If it doesn't work",
} as const;

/** #signed-in: what carries over, the signed-in checks, and where they stop. */
export const signedIn: { readonly paragraphs: readonly Rich[]; readonly link: { readonly text: string; readonly to: LinkTarget } } = {
  paragraphs: [
    [
      "Give the sign-in page the same host name as the page you test, for example ",
      { code: "http://host.docker.internal:5173/login" },
      ". Sessions kept in cookies, localStorage, IndexedDB or sessionStorage carry over, which is where Supabase and Firebase keep theirs. A sign-in that asks for the email first and the password next works too. A session the app throws away when a page loads doesn't.",
    ],
    [
      "Signed in as A, the access checks ask whether account B, or a visitor who isn't signed in, can read A's data (",
      { code: "access-control" },
      "). They also ask whether the server stores fields such as ",
      { code: "role" },
      " or ",
      { code: "plan" },
      " that the form never sends (",
      { code: "mass-assignment" },
      "). The write-side checks, unticked by default, change A's data on purpose and put it back. They ask: can a page on another site change it (",
      { code: "csrf" },
      ")? Can account B or a signed-out visitor change or delete A's records (",
      { code: "write-access" },
      ")? Can A get a paid plan without paying (",
      { code: "paywall-trust" },
      ")? The CSRF check needs the app on localhost or 127.0.0.1, so run it with the host network (Linux) or from source.",
    ],
    [
      "These checks send requests only to your app's own address or an API on a local address. A hosted backend, such as a Supabase project on supabase.co, is neither, so an app that calls it straight from the browser gets them skipped. Checking Supabase row-level security directly is in the ",
      { text: "catalog", link: { to: "checks", hash: "data-readable-without-signing-in" } },
      " as planned.",
    ],
  ],
  link: { text: "Test accounts and signed-in runs, step by step", to: { to: "docs-signed-in-runs", fallback: { to: "docs", hash: "accounts" } } },
};

/** #fernway: the test lab on one line with Copy, what to enter, and where to go next. */
export const fernwayTry = {
  label: "The test lab: Run Hound, Kennel, Fernway and five sample apps",
  command: commands.lab,
  hint: [
    "No clone needed; Podman works the same. Then open ",
    { code: "http://localhost:4000" },
    " and enter ",
    { code: "http://fernway-bugs:4110/" },
    ".",
  ] satisfies Rich,
  links: [
    { text: "What a run on Fernway finds", to: { to: "demo", hash: "fernway" } },
    { text: "Questions about Run Hound, answered", to: { to: "faq" } },
    { text: "How it compares with AI-builder scanners", to: { to: "compare" } },
  ] satisfies readonly { text: string; to: LinkTarget }[],
} as const;

/** The screenshots #handles shows, by their key in components/screens.ts aiBuiltScreens, with their captions. */
export const handlesFigures = [
  { screen: "plan", caption: "Fernway, a test app built like AI builders' apps, planned: three forms, 40 scenarios." },
  { screen: "dialog", caption: "Mid-run: Run Hound opened the Book a demo dialog and filled it." },
] as const satisfies readonly { screen: string; caption: string }[];

/** Vite: listen on all interfaces and accept the container's name for your machine (TESTING.md, docs/install.md). */
export const viteConfig = `// vite.config.ts: inside your existing defineConfig({ ... })
server: {
  host: true,                              // listen on all interfaces, like vite --host
  allowedHosts: ["host.docker.internal"],  // or Vite answers "Blocked request"
},`;

/** Next.js: `next dev` already listens on all interfaces; it only needs to accept the origin. */
export const nextConfig = `// next.config.ts: inside your existing config
allowedDevOrigins: ["host.docker.internal"],`;

/**
 * Linux: share the host's network instead, so localhost is your machine and nothing in the app changes (the command is
 * content/commands.ts's, where every shell command is written).
 */
export const hostNetworkCommand = commands.text.hostNetwork;

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
      "The session didn't carry over. The sign-in page and the page may use different host names, or the account's details are wrong. Or the app throws its session away when a page loads (a sessionStorage session tied to the tab that signed in). Test sign-in in Settings checks the account on its own.",
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
 * The page's structured data: the registry's WebPage (dated like the release it describes, which the page shows) and
 * its breadcrumb, as /how-it-works/ and /demo/ get theirs (lib/structured-data.ts routeGraph), so it has one source.
 */
export const aiBuiltJsonLd = () => routeGraph("ai-built-apps");
