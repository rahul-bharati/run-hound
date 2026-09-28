import { previewGroups } from "@/content/checks/data";
import { aiDataFlow } from "@/content/claims";
import type { LinkTarget } from "@/content/routes";
import { resolveTarget } from "@/lib/nav";
import { site } from "@/lib/site";
import { faqNode, routeGraph } from "@/lib/structured-data";

/**
 * The FAQ page (/faq/, DESIGN.md §3.9): "At a glance" first, then the questions people put to search engines and AI
 * assistants about Run Hound, each answered in its first sentence, then linked to the page that holds the detail. The
 * page and its FAQPage structured data are both built from `faqGroups`, so the answers in the JSON-LD are the visible
 * text word for word. Facts come from README.md, TESTING.md, docs/*.md and docs/research.md (the two statistics, with
 * their sources); keep them in step with those. Sentences stay at 25 words or fewer (brand.md, faq.test.ts).
 *
 * Answers are plain text. `code` in backticks is shown as code on the page and as plain text in the structured data
 * and in llms-full.txt (answerText).
 */

/** The page's canonical path, title and meta description, as the registry has them (content/routes/project.ts). */
export const faqPage = {
  path: "/faq/",
  title: "FAQ: UI testing for AI-built apps",
  description:
    "Short answers about Run Hound: testing Lovable, Bolt and v0 apps, security and accessibility checks, AI, privacy, CI, the price and what it can't test.",
  /** Its name in the breadcrumb and the footer. */
  crumb: "FAQ",
} as const;

export type FaqLink = { href: string; label: string };

export type FaqItem = {
  /** Anchor on the page (/faq/#is-it-free). Stable: other pages and llms.txt link to it (content/routes/project.ts). */
  id: string;
  q: string;
  /** Paragraphs. The first sentence of the first one answers the question. */
  a: readonly string[];
  /** Where to read more: internal paths end with "/" (or "/#section"), external URLs are sources. */
  links: readonly FaqLink[];
};

export type FaqGroup = { id: string; title: string; items: readonly FaqItem[] };

/**
 * A link on this site, by its registry id: the page once registered (a docs page D1 adds), its fallback until then
 * (today's section of /docs/), so a link never waits for a page and never dead-ends (lib/nav.ts resolveTarget).
 */
const to = (label: string, target: LinkTarget): FaqLink => ({ label, href: resolveTarget(target) });

/** The page's h1, lede and the closing block. */
export const faqIntro = {
  title: "Questions about testing AI-built apps",
  lede: "Each answer starts with the short version, then links to the details. They describe the release you can run today, and they say what Run Hound doesn't do as plainly as what it does.",
  glance: "At a glance",
} as const;

export const faqClosing = {
  title: "Didn't find your question?",
  text: "The docs cover every step, from the first run to reading the report. Or ask on GitHub: anyone can open an issue.",
  links: [
    { label: "Read the docs", href: resolveTarget({ to: "docs" }) },
    { label: "Ask on GitHub", href: site.feedback },
  ],
} as const;

/** The docs pages the answers point at, each with today's /docs/ section as its fallback. */
const docs = {
  quickStart: { to: "docs-quick-start", fallback: { to: "docs", hash: "quick-start" } },
  requirements: { to: "docs-install", hash: "requirements", fallback: { to: "docs", hash: "requirements" } },
  yourApp: { to: "docs-your-app", fallback: { to: "docs", hash: "your-app" } },
  signedIn: { to: "docs-signed-in-runs", fallback: { to: "docs", hash: "accounts" } },
  safety: { to: "docs-safety", fallback: { to: "docs", hash: "safety" } },
  report: { to: "docs-report", fallback: { to: "docs", hash: "report" } },
  cli: { to: "docs-cli", fallback: { to: "docs", hash: "your-app" } },
  ai: { to: "docs-ai", fallback: { to: "docs", hash: "ai" } },
} as const satisfies Record<string, LinkTarget>;

/** The built-in checks in this release (26 in 0.6.0), counted from the data the checks page renders. */
const checkTotal = previewGroups.reduce((sum, group) => sum + group.checks.length, 0);

/** Sources of the two statistics, as docs/research.md §2.1 and §7 cite them (Escape: the methodology post). */
export const statSources = {
  veracode: "https://www.veracode.com/blog/genai-code-security-report/",
  escape: "https://escape.tech/blog/methodology-how-we-discovered-vulnerabilities-apps-built-with-vibe-coding/",
} as const;

export type FaqFact = { readonly term: string; readonly text: string; readonly link: FaqLink };

/**
 * "At a glance" (moved from the homepage, §3.9): the facts a visitor checks first, each with the link to its proof.
 * The release and the license come from lib/site.ts.
 */
export const faqAtAGlance: readonly FaqFact[] = [
  {
    term: "What it is",
    text: "AI-assisted UI testing for apps built with Lovable, Bolt, v0 and similar tools, one page at a time.",
    link: to("How it works", { to: "how-it-works" }),
  },
  {
    term: "License",
    text: `${site.license}, every check included.`,
    link: { label: "The LICENSE file", href: site.licenseUrl },
  },
  {
    term: "Price",
    text: "Free. Hosted services may come later, only if there is demand; none exist today.",
    // The open-source page has #open-core; the registry doesn't promise it, so the fallback names it too.
    link: to("The open core", { to: "open-source", hash: "open-core", fallback: { to: "open-source", hash: "open-core" } }),
  },
  {
    term: "Runs on",
    text: "Your machine, in Docker or Podman: Linux, macOS or Windows, on amd64 or arm64.",
    link: to("Install and platforms", { to: "docs-install", fallback: { to: "docs", hash: "install" } }),
  },
  {
    term: "Needs",
    text: "Docker 24+, Docker Desktop or Podman, and your app running on your machine.",
    link: to("Requirements", docs.requirements),
  },
  {
    term: "AI",
    text: "Optional and off by default. Real checks decide pass or fail, never a model.",
    link: to("Optional AI", docs.ai),
  },
  {
    term: "Release",
    text: `${site.version}, ${site.released}.`,
    link: { label: "The changelog", href: site.changelog },
  },
];

export const faqGroups: readonly FaqGroup[] = [
  {
    id: "basics",
    title: "The basics",
    items: [
      {
        id: "what-is-run-hound",
        q: "What is Run Hound?",
        a: [
          `${site.name} is free, open-source (MIT) AI-assisted UI testing for apps built with Lovable, Bolt, v0 and similar tools. It opens one page of an app on your machine in a real browser and plans checks you approve. Then it runs them and reports what broke, with evidence and a Playwright test for every finding.`,
          `Release ${site.version} has ${checkTotal} built-in checks in three groups: Accessibility, Features and Security. It is made for solo developers, small teams and QA testers who want to check what their AI built before their users do.`,
        ],
        links: [to("How it works, step by step", { to: "how-it-works" }), to(`The ${checkTotal} built-in checks`, { to: "checks" })],
      },
      {
        id: "is-it-free",
        q: "Is Run Hound free?",
        a: [
          "Yes: Run Hound is open source under the MIT license, and every check is in the free core. No check will ever sit behind a paywall.",
          "Paid hosted services, such as hosted inference or a hosted runner, are possible later, only if there is demand. None of them exist today.",
        ],
        links: [to("Open source: the license and the open core", { to: "open-source" })],
      },
      {
        id: "requirements",
        q: "What do I need to run it?",
        a: [
          "Docker 24+, Docker Desktop or Podman, on Linux, macOS or Windows (amd64 or arm64). Run Hound's image is about 260 MB to download and 715 MB on disk.",
          "There is nothing to clone and no sign-up: pull the image and run it. From source it needs Node.js 22.12 or newer, pnpm and git, on Linux or macOS (on Windows, through WSL2). A release that starts with `npx run-hound`, with no Docker, is planned as 0.9.9.",
        ],
        links: [to("Quick start with Docker or Podman", docs.quickStart), to("Requirements", docs.requirements)],
      },
    ],
  },
  {
    id: "testing",
    title: "Testing your app",
    items: [
      {
        id: "lovable-bolt-v0",
        q: "How do I test an app built with Lovable, Bolt or v0?",
        a: [
          "Run the app on your machine and start Run Hound with Docker or Podman. Open `http://localhost:4000` and enter your page as `http://host.docker.internal:<port>/<page>`.",
          "Your dev server must listen on all interfaces (`vite --host`) and accept that host name (Vite `server.allowedHosts`, Next.js `allowedDevOrigins`). Run Hound finds and fills the widgets these apps use: Radix and shadcn/ui, Headless UI, cmdk and MUI. It finds forms in dialogs and sheets, behind up to 3 buttons that open one. It handles forms validated with react-hook-form and zod, and counts sonner toasts as messages. A multi-step form is tested on its first step only.",
        ],
        links: [to("Testing apps built with Lovable, Bolt and v0", { to: "ai-built-apps" }), to("Test your own app", docs.yourApp)],
      },
      {
        id: "behind-a-login",
        q: "Can Run Hound test pages behind a login?",
        a: [
          "Yes, since 0.4.0: Run Hound signs in as a test account you own, through your app's own username and password form. Save a second account to check that it can't read the first one's data. Since 0.6.0 that includes sign-ins that ask for the email first and the password next, and sessions kept in sessionStorage.",
          "Signed in, it also checks whether another account, or a visitor who isn't signed in, can read your data. It checks whether the server stores fields such as `role` or `plan` that the form never sends. Opt-in write-side checks change the test account's data and put it back. They ask whether another account or a signed-out visitor can change or delete your data (0.6.0). CSRF (since 0.5.0) asks whether another website can; your app must run on `localhost` or `127.0.0.1` and keep its session in a cookie. Paywall trust (0.6.0) asks whether an account can get a paid plan without paying. These checks use only your app's own address or an API on a local address. Requests sent straight to a hosted backend, such as a Supabase project on supabase.co, aren't checked yet. Verification codes, captchas, sign-in links sent by email and sign-in with Google or GitHub aren't supported yet.",
        ],
        links: [to("Test accounts and signed-in runs", docs.signedIn)],
      },
      {
        id: "live-site",
        q: "Can Run Hound test my live website?",
        a: [
          "Not yet: it tests only `localhost`, private network addresses and internal host names you list in `RUNHOUND_ALLOWED_HOSTS`. It refuses other hosts. List only hosts you own there, since that setting skips the address check.",
          "Testing live staging and dev sites behind ownership verification is planned for the V4 stage, and completing V4 is the 1.0.0 release.",
        ],
        links: [to("Safety and test records", docs.safety), to("The roadmap", { to: "open-source", hash: "roadmap" })],
      },
      {
        id: "ci",
        q: "Can I run Run Hound in CI?",
        a: [
          "Yes: the command line runs a page without the web UI. Its `run <url> --approve all` exits with 0 with no confirmed findings, 1 with at least one, and 2 on an error.",
          "`--json` prints the report as JSON. Each finding's Playwright spec also runs on its own, without Run Hound, so you can add it to your test suite. It needs `@playwright/test`, plus `@axe-core/playwright` for the `axe-states` specs.",
        ],
        links: [to("Reading the report, and exit codes", docs.report), to("Command-line options", docs.cli)],
      },
    ],
  },
  {
    id: "checks",
    title: "Security, accessibility and other tools",
    items: [
      {
        id: "is-my-app-secure",
        q: "Is my vibe-coded app secure?",
        a: [
          "Not necessarily: Veracode found that 45% of AI-generated code samples failed security tests. Escape.tech found 2,000+ vulnerabilities, 400+ exposed secrets and 175 exposures of personal data across about 5,600 live vibe-coded apps.",
          "Run Hound checks what a browser can see: security headers, session cookie flags, CORS, public source maps and secret keys in the JavaScript. It also checks for personal data sent to other sites and stack traces shown to users. Signed in as test accounts you own, it asks whether another account or a signed-out visitor can read your data. It asks whether the server trusts fields the form never sends. Opt-in checks ask whether another account, a signed-out visitor or another website can change your data, and whether a paid plan needs a payment. These checks reach only your app's own address or a local API. It can't see backups, webhook signatures or dependency hygiene, so a clean report is not a clean app.",
        ],
        links: [
          to("What a browser can't see", { to: "checks", hash: "not-visible" }),
          { href: statSources.veracode, label: "Source: Veracode, 2025" },
          { href: statSources.escape, label: "Source: Escape.tech, 2025" },
        ],
      },
      {
        id: "vs-playwright",
        q: "How is Run Hound different from Playwright?",
        a: [
          "Run Hound is built on Playwright and adds what a test framework leaves to you. It explores the page, plans scenarios you approve, and runs built-in feature, accessibility and security checks. It explains each finding in plain language, with evidence.",
          "Every finding comes with a Playwright spec that runs without Run Hound. Playwright's own test agents (a planner, a generator and a healer, since Playwright 1.56) are free and aimed at developers in an IDE.",
        ],
        links: [to("Run Hound vs Playwright, axe-core and security scanners", { to: "compare" }), to("How it works", { to: "how-it-works" })],
      },
      {
        id: "vs-axe-lighthouse",
        q: "How is Run Hound different from axe-core or Lighthouse?",
        a: [
          "Run Hound runs axe-core's WCAG 2.2 AA rules itself, in four states of each form. The states are empty, after an empty submit, after a server error and after a successful send. axe-core or Lighthouse on their own check one page state at a time.",
          "It also goes beyond axe-core's rules: it completes the form with only the keyboard. It checks that every focused control shows a visible focus indicator and that errors are announced to screen readers. It checks that the page doesn't scroll sideways at 320 px and that paste works in password fields. It reports WCAG failures; it doesn't certify compliance.",
        ],
        links: [
          // The checks hub's Accessibility group once the hub promises its anchor (C1), the hub before.
          to("The accessibility checks", { to: "checks", hash: "group-accessibility", fallback: { to: "checks" } }),
          to("How it compares with other tools", { to: "compare" }),
        ],
      },
    ],
  },
  {
    id: "ai-privacy",
    title: "AI and privacy",
    items: [
      {
        id: "ai-pass-fail",
        q: "Does AI decide whether a test passes?",
        a: [
          "No: every pass or fail comes from a real check in a real browser, never from a model. The checks are Playwright assertions, axe-core rules and captured traffic.",
          "AI is optional and off by default. You can turn it on with your own model: Ollama, LM Studio, llama.cpp, vLLM, any OpenAI-compatible endpoint or Amazon Bedrock. It then reviews and ranks the plan, suggests up to 5 extra flows with advisory findings, and explains findings beside the built-in text.",
        ],
        links: [to("AI (optional)", docs.ai)],
      },
      {
        id: "data",
        q: "Does Run Hound send my app's data anywhere?",
        a: [
          "No, not to us: Run Hound has no telemetry, and reports stay on your machine (in `./runs` with Docker). With AI off, the default, nothing is sent to any AI provider either.",
          `With AI on, ${aiDataFlow}. A remote endpoint gets it only after you consent, and Run Hound operates no AI service of its own.`,
        ],
        links: [to("Privacy policy", { to: "privacy" }), to("What the model is sent", docs.ai)],
      },
    ],
  },
];

/** Every question, in page order. */
export const faqItems: readonly FaqItem[] = faqGroups.flatMap((group) => group.items);

/** Text with its `code` marks removed: what the structured data and plain-text copies show. */
export const plainText = (text: string) => text.replace(/`([^`]*)`/g, "$1");

/** An answer as one plain-text string, exactly as the page shows it (paragraphs joined by a space). */
export const answerText = (item: FaqItem) => item.a.map(plainText).join(" ");

/**
 * The FAQ page's structured data: its registry nodes (an FAQPage dated like the release the answers describe, and its
 * breadcrumb; lib/structured-data.ts routeNodes) with the visible questions and answers, merged into the page node by
 * graph() (the same @id). FAQPage is on this page only (check-seo).
 */
export function faqJsonLd() {
  return routeGraph("faq", faqNode(faqItems.map((item) => ({ q: item.q, a: answerText(item) })), faqPage.path));
}
