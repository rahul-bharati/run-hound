import { isShipped } from "@/components/checks/check-card";
import { aiFlowCheck, categories, notVisible, previewGroups, stageMeaning, type Stage } from "@/components/checks/data";
import {
  aiBuiltPage,
  coverage,
  handles,
  hostNetworkCommand,
  limits as aiBuiltLimits,
  nextConfig,
  problems,
  viteConfig,
} from "@/components/ai-built/data";
import { capabilities, comparePage, notYet, researchUrl, tools, type Mark } from "@/components/compare/data";
import { answerText, faqGroups, faqPage } from "@/components/faq/data";
import { site } from "@/lib/site";
import { absoluteUrl } from "@/lib/structured-data";
import { builtInTotal, intro, linkSection, linkSections, textResponse } from "../llms.txt/llms";

// Prerendered at build time: a GET route handler is dynamic unless told otherwise. The file has an extension, so
// trailingSlash leaves /llms-full.txt as it is.
export const dynamic = "force-static";

/**
 * /llms-full.txt: the content of the site's key pages as one plain-text (Markdown) file, so a language model can read
 * Run Hound in one request. Where a page renders from data, this file uses the same data, so the two can't drift: the
 * checks, the catalog and "what a browser can't see" (components/checks/data.ts), the AI-built apps page
 * (components/ai-built/data.ts), the FAQ (components/faq/data.ts) and the comparison (components/compare/data.ts). The
 * rest follows the pages' text and the repository's guides (README.md, docs/*.md).
 */

const fence = "```";
const bullets = (items: string[]) => items.map((item) => `- ${item}`).join("\n");
const section = (title: string, ...parts: string[]) => [`## ${title}`, "", parts.join("\n\n")].join("\n");

function getStarted(): string {
  return section(
    "Get started",
    "The main way needs only Docker or Podman and no clone: pull the image and run it. The image has Run Hound's web UI, its command line and Chromium. In any folder:",
    `${fence}sh\n${site.runCommands}\n${fence}`,
    "Then open http://localhost:4000 and enter a page of an app on your machine as http://host.docker.internal:<port>/<page>. In a container, localhost is the container itself, so your dev server must listen on all interfaces (vite --host) and accept that host name (Vite server.allowedHosts, Next.js allowedDevOrigins). On Linux, --network host is another way: localhost is then your machine. Podman works the same (podman pull, podman run). Reports land in ./runs.",
    "To try it on the demo apps first, one compose file starts Run Hound with Kennel (a deliberately broken booking app, and its clean mode), Fernway (a project-planning app built the way AI builders build them, clean and with planted bugs) and five well-built sample apps. The first start downloads about 0.5 GB:",
    `${fence}sh\n${site.labCommand}\n${fence}`,
    "Then open http://localhost:4000 and enter http://kennel:3000/book.",
    "From source (to contribute, or to watch the browser in a window): Node.js 22.12 or newer (24 recommended), pnpm, git and Chromium, on Linux or macOS (on Windows, use WSL2). The image runs on Linux, macOS and Windows.",
  );
}

function howItWorks(): string {
  return section(
    "How it works",
    [
      "1. Explore. Run Hound opens your page in a headless Chromium with Playwright and finds the forms and controls on it: fields and their labels, buttons, and the controls outside any form, including the custom selects, switches and sliders of component libraries such as Radix and shadcn/ui, and forms that open in a dialog. It reads the accessibility tree and the DOM, and notes the page's response headers, cookies and scripts. With a test account, it signs in first and explores the page as that user.",
      "2. Plan. From what it found, it plans form checks for each form, plus page-wide checks such as security headers, cookie flags, CORS, public source maps, dead controls anywhere on the page and links that break when opened directly, under three groups: Accessibility, Features and Security. Signed in, it adds the access checks. Golden paths are what a real user does; danger paths are what breaks things, like double clicks, server errors and invalid input. With AI on, your own model reviews the plan, recommending and ranking each scenario with a reason, and suggests up to 5 extra flows built only from the fields and buttons it found; they stay unticked until you choose them.",
      "3. Approve. Nothing runs until you say so. The plan opens in a local web UI, or prints on the command line (--plan-only). Each scenario says what it does and whether it creates test records. Scenarios that could change or delete data, such as Delete or Sign out buttons, stay off unless you opt in.",
      "4. Run. The approved scenarios run group by group in a real browser. A live view shows the page under test, the current scenario and its steps, the elapsed time and a log. Screenshots, console and network traffic are kept, so every result traces back to what actually happened.",
      "5. Report. Each finding comes with its group, severity, a plain-language explanation, evidence (annotated screenshots, GIFs, request and response cards) and an exported Playwright test, and says what to ask your AI to fix. On the command line the exit code is 0 with no confirmed findings, 1 with at least one and 2 on an error. With AI on, each finding also gets an AI explanation beside the built-in one, labelled advisory.",
    ].join("\n"),
    coverage,
    "Design principles:",
    bullets([
      "AI plans and explains; real checks decide. Pass or fail comes from Playwright assertions, axe-core and captured traffic in a real browser, never from a model. Findings that rely on judgement, or on production values a dev server doesn't send, are marked advisory.",
      "No evidence, no finding. Every reported defect has an annotated screenshot, a GIF or the request and response, plus a replayable spec. Each false positive is treated as a bug in Run Hound.",
      "Built on Playwright and axe-core. Run Hound adds exploration, approval, triage and plain-language reporting on top.",
      "Only owned targets, safe by default. Run Hound tests localhost and private addresses only, plus host names you list yourself; public sites are refused. The browser is pinned to the approved address, destructive scenarios are opt-in, and reports redact secret-looking text.",
    ]),
    "What you get from every run:",
    bullets([
      "An HTML and Markdown report: run time, a table per group and findings by severity, each saying what it means, why it matters and what to ask your AI to fix, with its evidence inline.",
      "A Playwright test (.spec.ts) for each finding. It runs with Playwright (plus @axe-core/playwright for the axe-states specs), without Run Hound, so you can reproduce the failure and add it to CI.",
      "report.json: the plan, groups, scenario results and timings, findings and the Run Hound version, machine-readable.",
    ]),
  );
}

type PreviewCheck = (typeof previewGroups)[number]["checks"][number];

/**
 * The release that added a check, named by its number (a stage is named only as a stage): the V0 checks came in 0.1.0,
 * the V1 checks in 0.2.0 and the V2 preview's in 0.4.0, except csrf in 0.5.0 (CHANGELOG.md, docs/signed-in-runs.md).
 */
const stageRelease: Record<PreviewCheck["since"], string> = { V0: "0.1.0", V1: "0.2.0", V2: "0.4.0" };
const laterRelease: Partial<Record<string, string>> = { csrf: "0.5.0" };
const addedIn = (c: PreviewCheck) => {
  const release = `since ${laterRelease[c.id] ?? stageRelease[c.since]}`;
  return c.since === "V2" ? `${site.preview}, ${release}` : release;
};

function builtInChecks(): string {
  const flags = (c: PreviewCheck) =>
    [
      c.signedIn ? "signed-in runs only" : "",
      c.offByDefault ? "unticked by default" : "",
      c.devServerAdvisory ? "advisory on a dev server" : "",
    ].filter(Boolean);
  const groups = previewGroups.map((g) =>
    [
      `### ${g.group} (${g.checks.length})`,
      "",
      bullets(
        g.checks.map((c) => {
          const notes = [addedIn(c), ...flags(c)].join(", ");
          return `${c.name} (\`${c.id}\`; ${notes}): ${c.line} Test records it can create: ${c.records}. ${absoluteUrl(`/checks/#${c.id}`)}`;
        }),
      ),
    ].join("\n"),
  );
  return section(
    `The ${builtInTotal} built-in checks in release ${site.version}`,
    `Every check in the current release, in the three groups the plan, the run and the report follow, in run order. Each check names the release that added it: 0.1.0 (the V0 stage), 0.2.0 (the V1 stage), or 0.4.0 and 0.5.0 (the ${site.preview}).`,
    ...groups,
    [
      `### ${aiFlowCheck.name} (optional)`,
      "",
      `\`${aiFlowCheck.id}\`, in the ${aiFlowCheck.group} group, since 0.3.0: ${aiFlowCheck.line} It runs only when AI is on and you tick a suggested flow, so it is not counted with the built-in checks.`,
    ].join("\n"),
  );
}

function cantSee(): string {
  return section(
    "What a browser can't see",
    "A browser only sees what your app shows it. Every report ends with this checklist, so a clean report is never mistaken for a clean app:",
    bullets(notVisible.map((item) => `${item.name}: ${item.line}`)),
  );
}

function catalog(): string {
  const stages = Object.keys(stageMeaning) as Stage[];
  const gapTotal = categories.reduce((sum, c) => sum + c.checks.length, 0);
  const covered = categories.reduce((sum, c) => sum + c.checks.filter(isShipped).length, 0);
  return section(
    "The catalog: gaps in AI-built apps, by roadmap stage",
    `The catalog lists ${gapTotal} gaps that AI-built apps tend to ship with, across ${categories.length} categories, each with its typical severity and the roadmap stage it is in or planned for. ${covered} of them are covered in release ${site.version} by the ${builtInTotal} built-in checks above (one check can cover several gaps), and the other ${gapTotal - covered} are planned. Severity is the typical level when a gap is found; a real report grades each finding on its evidence. Entries marked advisory rely on judgement and are never reported as confirmed defects.`,
    `Stages (not releases):\n${bullets(stages.map((stage) => `${stage}: ${stageMeaning[stage]}`))}`,
    ...categories.map((category) =>
      [
        `### ${category.title} (${category.checks.length})`,
        "",
        category.intro,
        "",
        bullets(
          category.checks.map((c) => {
            const status = [
              `${c.stage}${c.note ? ` ${c.note}` : ""}`,
              isShipped(c) ? "available now" : "planned",
              `severity ${c.severity}`,
              c.advisory ? "advisory" : "",
            ].filter(Boolean);
            return `${c.name} (${status.join(", ")}): ${c.line}`;
          }),
        ),
      ].join("\n"),
    ),
  );
}

/** The /ai-built-apps/ page, from the data it renders. */
function aiBuiltApps(): string {
  return section(
    aiBuiltPage.title,
    `From ${absoluteUrl(aiBuiltPage.path)}. Apps from Lovable, Bolt, v0 and similar tools use React, Radix/shadcn components, react-hook-form with zod, sonner toasts and client-side routing. Since 0.4.0 Run Hound handles them, and Fernway, a test app built the same way, keeps it honest.`,
    coverage,
    bullets(handles.map((item) => `${item.title}: ${item.text}`)),
    "To test an app on your machine from the container, enter http://host.docker.internal:<port>/<page>. The dev server must listen on all interfaces and accept that host name. Vite:",
    `${fence}ts\n${viteConfig}\n${fence}`,
    "Next.js:",
    `${fence}ts\n${nextConfig}\n${fence}`,
    "On Linux, share the host's network instead, so localhost is your machine and nothing in the app changes:",
    `${fence}sh\n${hostNetworkCommand}\n${fence}`,
    `When the set-up isn't right:\n${bullets(problems.map((problem) => `"${problem.see}": ${problem.means}`))}`,
    `Limits:\n${bullets([...aiBuiltLimits])}`,
  );
}

function signedIn(): string {
  return section(
    `Signed-in runs and access checks (${site.preview})`,
    "Pages behind a sign-in can be tested signed in, as one of two test accounts you own on your app, A and B. Run Hound signs in with a fresh session at the start of each plan and run, and every check then runs signed in. Four V2 checks join the plan:",
    bullets([
      "access-control (0.4.0): signed in as A, Run Hound finds A's data on the page. Can account B read it? Can a visitor who isn't signed in? It replays only the read requests (GET) that returned A's data.",
      "mass-assignment (0.4.0, unticked by default): does the server store role, isAdmin, plan, credits, verified and similar fields that the form never sends? It changes account A, then restores it, and says what it couldn't restore.",
      "deep-links (0.4.0): do the app's own pages load when opened directly (a reload, a shared link)? At most 10 links, never one that signs out, deletes or accepts an invitation.",
      "csrf (0.5.0, unticked by default): can a page on another site make A's browser change A's data? It writes only the test record it created in the same scenario, and puts it back. It needs the app on localhost or 127.0.0.1; on any other host name it is inconclusive, never a pass.",
    ]),
    "Passwords, session cookies, tokens and usernames never appear in reports, evidence, specs, logs or AI prompts. Sign-in needs the app's own form with a username (or email) and a password on one page: verification codes, captchas, sign-in with Google or GitHub, and two-step sign-in pages aren't supported yet. The session must carry over to a new browser: cookies, localStorage and IndexedDB work (Supabase and Firebase keep their sessions there), a session kept only in sessionStorage doesn't.",
  );
}

function optionalAi(): string {
  return section(
    "Optional AI, with your own model",
    "AI is off until you turn it on. A model reviews the plan (recommends and ranks each scenario with a one-line reason), suggests up to 5 extra flows (built only from the fields and buttons Run Hound found, checked by deterministic assertions, unticked by default, findings advisory) and explains findings in plain words. It never decides pass or fail, and if it fails or times out you get the built-in plan with a warning.",
    "Bring your own model: Ollama, LM Studio, llama.cpp, vLLM, any OpenAI-compatible endpoint, or Amazon Bedrock. Small local models work (tested with a 9B model on Ollama). Only redacted page structure is sent (the page title and path, field labels and types, option labels, button names, the scenario list; a local model also gets the full address with its query, redacted; for explanations, the finding text and its evidence facts), never typed values, cookies, response bodies or screenshots. A remote endpoint is refused until you consent for that host. Run Hound itself operates no AI service.",
  );
}

function safety(): string {
  return section(
    "Safety",
    bullets([
      "The target must be localhost, a private address, or listed in RUNHOUND_ALLOWED_HOSTS (which skips the address check with no ownership check, so list only hosts you own). Ownership verification for other hosts is planned for the V4 stage (live staging).",
      "The browser is pinned to the address the safety gate approved and is stopped if a page navigates off it.",
      "No destructive actions (real payments, deleting data) unless you explicitly opt in (--allow-destructive).",
      "Reports redact any secrets they find; keys are never used or tested.",
      "The web UI and its API answer only to loopback names and addresses (localhost, 127.0.0.1, ::1) unless you add others, send a strict Content-Security-Policy and refuse to be framed.",
    ]),
  );
}

function limitations(): string {
  return section(
    "Known limitations",
    bullets([
      "One page at a time: up to 5 forms are tested and up to 20 controls outside them clicked; links are opened only to check they load. A page behind a login needs a test account.",
      "Sign-in works with the app's own form and a password on one page only: not with Google or another provider, magic links, one-time codes, captchas, a sign-in split over two pages, or a session kept only in sessionStorage. csrf needs the app on localhost or 127.0.0.1; elsewhere it is inconclusive.",
      "Dev servers don't send production headers: header, cookie and CORS findings on a dev server are advisory. For confirmed results, test a production build served on your machine.",
      "Unusual apps may still produce false findings: it has been tried on classic HTML forms, fetch-based single-page apps, login forms, forms whose API is on another origin and an app built the way AI builders build them (Fernway), but not on your stack.",
      "Docker has no visible browser window (--headed needs the install from source on a machine with a display); the web UI's live view works.",
      "Windows is only supported through WSL2 or Docker.",
      "AI output quality depends on the model; findings from AI-suggested flows are advisory: check them by hand.",
    ]),
  );
}

function roadmap(): string {
  return section(
    "Roadmap",
    "V0 to V4 are stages of what Run Hound can test, not version numbers. Releases stay 0.x while the stages are built; 1.0.0 is the release that completes V4, and 0.9.9, right before it, is the npx run-hound release, with no Docker.",
    bullets([
      "V0: single form (shipped, 0.1.0).",
      "V1: single page (shipped: 0.2.0, optional AI in 0.3.0, apps from AI builders in 0.4.0).",
      "V2: single feature (preview since 0.4.0): signed-in runs, access-control, mass-assignment and deep-links in 0.4.0, csrf in 0.5.0. Planned: write-access, paywall-trust and multi-page feature runs.",
      "V3: whole app (planned): dead-link crawl, cross-browser runs, Core Web Vitals, SEO and social previews.",
      "V4: live staging, behind ownership verification (planned: 1.0.0).",
    ]),
  );
}

/** The FAQ page's questions and answers, from the array the page and its FAQPage structured data render. */
function faq(): string {
  return section(
    "Frequently asked questions",
    `From the FAQ page: ${absoluteUrl(faqPage.path)}`,
    ...faqGroups.map((group) =>
      [
        `### ${group.title}`,
        "",
        group.items
          .map((item) =>
            [
              `#### ${item.q}`,
              "",
              answerText(item),
              "",
              `More: ${item.links.map((link) => `${link.label} (${absoluteUrl(link.href)})`).join("; ")}. This answer: ${absoluteUrl(`${faqPage.path}#${item.id}`)}`,
            ].join("\n"),
          )
          .join("\n\n"),
      ].join("\n"),
    ),
  );
}

const markWords: Record<Mark, string> = {
  yes: "yes",
  some: "partly",
  no: "no",
  unknown: "not stated in the research",
};

/** The /compare/ page, from the data it renders: capabilities only, dated by release, with the research's sources. */
function compare(): string {
  const columns = tools.map((tool) => [tool.id, tool.short] as const);
  return section(
    comparePage.title,
    `From ${absoluteUrl(comparePage.path)}. Capabilities only, as of release ${site.version} (${site.released}). What the other tools do comes from Run Hound's research, docs/research.md §2.2 and §2.3: ${researchUrl} (it lists no source for Lighthouse, WAVE or Burp).`,
    ...tools.map((tool) =>
      [
        `### ${tool.name}`,
        "",
        bullets([
          `What it is: ${tool.what}`,
          `What Run Hound adds: ${tool.adds}`,
          `Together: ${tool.together}`,
          `Sources: ${tool.sources.map((source) => `${source.label} (${source.href})`).join("; ")}`,
        ]),
      ].join("\n"),
    ),
    [
      "### Capabilities side by side",
      "",
      bullets(
        capabilities.map((row) => {
          const others = columns.map(([id, name]) => {
            const cell = row.cells[id];
            return `${name}: ${markWords[cell.mark]}${cell.text ? ` (${cell.text})` : ""}`;
          });
          return `${row.capability}. Run Hound: ${row.runHound}. ${others.join("; ")}.`;
        }),
      ),
    ].join("\n"),
    ["### What Run Hound doesn't do yet", "", bullets([...notYet])].join("\n"),
  );
}

function openSource(): string {
  return section(
    "License and who makes it",
    `Run Hound is open source under the ${site.license} license (${site.licenseUrl}). The open core includes every check, the approval UI, reports, Playwright export, bring-your-own-model support and the test fixtures; checks are never paywalled. It is made by ${site.maintainer.name} (${site.maintainer.url}). The repository is public: anyone can clone it, try it and file an issue (${site.feedback}). Changes in each release: ${site.changelog}`,
  );
}

function llmsFullTxt(): string {
  return [
    intro(),
    `This file is the content of the site's key pages in one place. The index with links: ${absoluteUrl("/llms.txt")}. Every page: ${absoluteUrl("/sitemap.xml")}`,
    getStarted(),
    howItWorks(),
    builtInChecks(),
    cantSee(),
    aiBuiltApps(),
    signedIn(),
    optionalAi(),
    safety(),
    limitations(),
    catalog(),
    faq(),
    compare(),
    roadmap(),
    openSource(),
    ...linkSections.map(linkSection),
  ].join("\n\n") + "\n";
}

export function GET() {
  return textResponse(llmsFullTxt());
}
