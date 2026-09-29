import { isShipped } from "@/components/checks/check-card";
import { aiFlowCheck, categories, previewGroups, releaseAdded, stageMeaning, type Stage } from "@/content/checks/data";
import { cantSeeChecklist as notVisible, principles } from "@/content/claims";
import {
  aiBuiltPage,
  coverage,
  handles,
  hostNetworkCommand,
  limits as aiBuiltLimits,
  nextConfig,
  problems,
  viteConfig,
} from "@/content/ai-built";
import { capabilities, comparePage, notYet, researchUrl, tools, type Mark } from "@/content/compare";
import { answerText, faqGroups, faqPage } from "@/content/faq";
import { docHeadings, docMarkdown, docSource } from "@/lib/docs-text";
import { docsSidebar, href } from "@/lib/nav";
import { site } from "@/lib/site";
import { absoluteUrl } from "@/lib/structured-data";
import { builtInTotal, intro, linkSection, linkSections, textResponse } from "../llms.txt/llms";

// Prerendered at build time: a GET route handler is dynamic unless told otherwise. The file has an extension, so
// trailingSlash leaves /llms-full.txt as it is.
export const dynamic = "force-static";

/**
 * /llms-full.txt: the content of the site's key pages as one plain-text (Markdown) file, so a language model can read
 * Run Hound in one request. Where a page renders from data, this file uses the same data, so the two can't drift: the
 * checks, the catalog and "what a browser can't see" (content/checks/data.ts), the AI-built apps page
 * (content/ai-built.ts), the FAQ (content/faq.ts) and the comparison (content/compare.ts). The docs pages are their
 * own MDX (src/content/docs/<slug>.mdx, read by lib/docs-text.ts), in the docs sidebar's order. The rest follows the
 * pages' text and the repository's guides (README.md, docs/*.md).
 */

const fence = "```";
const bullets = (items: string[]) => items.map((item) => `- ${item}`).join("\n");
const section = (title: string, ...parts: string[]) => [`## ${title}`, "", parts.join("\n\n")].join("\n");

/**
 * The docs pages, in the sidebar's order: each one's h1 as a section, its address, then its MDX as Markdown (the
 * commands from content/commands.ts, headings one level down).
 */
function docsPages(): string[] {
  return docsSidebar()
    .flatMap((group) => group.links)
    .map((link) => {
      const slug = link.href.split("/")[2];
      const mdx = docSource(slug);
      if (docHeadings(mdx).length === 0) throw new Error(`llms-full.txt: ${link.href} has no sections`);
      return section(link.label, `From ${absoluteUrl(link.href)}.`, docMarkdown(mdx, { absolute: absoluteUrl, depthShift: 1 }));
    });
}

function howItWorks(): string {
  return section(
    "How it works",
    [
      "1. Explore. Run Hound opens your page in a headless Chromium with Playwright and finds the forms and controls on it: fields and their labels, buttons, and the controls outside any form, including the custom selects, switches and sliders of component libraries such as Radix and shadcn/ui, and forms that open in a dialog. It reads the accessibility tree and the DOM, and notes the page's response headers, cookies and scripts. With a test account, it signs in first and explores the page as that user.",
      "2. Plan. From what it found, it plans form checks for each form, plus page-wide checks such as security headers, cookie flags, CORS, public source maps, dead controls anywhere on the page and links that break when opened directly, under three groups: Accessibility, Features and Security. Signed in, it adds the access checks, and the write-side checks, which stay unticked until you tick them. Golden paths are what a real user does; danger paths are what breaks things, like double clicks, server errors and invalid input. With AI on, your own model reviews the plan, recommending and ranking each scenario with a reason, and suggests up to 5 extra flows built only from the fields and buttons it found; they stay unticked until you choose them.",
      "3. Approve. Nothing runs until you say so. The plan opens in a local web UI, or prints on the command line (--plan-only). Each scenario says what it does and whether it creates test records. Scenarios that could change or delete data, such as Delete or Sign out buttons, stay off unless you opt in.",
      "4. Run. The approved scenarios run group by group in a real browser. A live view shows the page under test, the current scenario and its steps, the elapsed time and a log. Screenshots, console and network traffic are kept, so every result traces back to what actually happened.",
      "5. Report. Each finding comes with its group, severity, a plain-language explanation, evidence (annotated screenshots, GIFs, request and response cards) and an exported Playwright test, and says what to ask your AI to fix. On the command line the exit code is 0 with no confirmed findings, 1 with at least one and 2 on an error. With AI on, each finding also gets an AI explanation beside the built-in one, labelled advisory.",
    ].join("\n"),
    coverage,
    "Design principles:",
    bullets(
      principles.map((p) =>
        [p.title, p.text, p.link ? `${p.link.label}: ${absoluteUrl(href(p.link.to))}` : ""].filter(Boolean).join(" "),
      ),
    ),
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
 * The release that added a check, named by its number (a stage is named only as a stage; releaseAdded in
 * content/checks/data.ts): the V0 checks came in 0.1.0, the V1 checks in 0.2.0 and the V2 preview's in 0.4.0,
 * except csrf in 0.5.0 and write-access and paywall-trust in 0.6.0.
 */
const addedIn = (c: PreviewCheck) => {
  const release = `since ${releaseAdded(c)}`;
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
    `Every check in the current release, in the three groups the plan, the run and the report follow, in run order. Each check names the release that added it: 0.1.0 (the V0 stage), 0.2.0 (the V1 stage), or 0.4.0, 0.5.0 and 0.6.0 (the ${site.preview}).`,
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

function roadmap(): string {
  return section(
    "Roadmap",
    "V0 to V4 are stages of what Run Hound can test, not version numbers, and no longer decide when 1.0.0 comes. The public launch is 0.6.5 (Docker and npx run-hound), to get feedback from people using Run Hound now; 1.0.0 is the release that refactors the app code so it is maintainable.",
    bullets([
      "V0: single form (shipped, 0.1.0).",
      "V1: single page (shipped: 0.2.0, optional AI in 0.3.0, apps from AI builders in 0.4.0).",
      "V2: single feature (preview since 0.4.0): signed-in runs, access-control, mass-assignment and deep-links in 0.4.0, csrf in 0.5.0. Built in 0.6.0: write-access (can account B, or a visitor who isn't signed in, change or delete A's records, with the update and delete requests the app itself sends) and paywall-trust (can A get a paid plan without paying: a success page that grants it on load; the only check that may change A's plan, which it puts back through the app's own cancel control); sign-in that asks for the email first and the password next, and sessions kept in sessionStorage. Planned: feature testing across pages (a feature named by the user, such as signup or checkout, tested end to end across its pages), the rest of the V2 stage; the two other paywall-trust probes (a checkout replayed with a changed price or plan, and the APIs only paid accounts use); and opt-in, throttled checks for rate limits, file upload and prompt injection in LLM features.",
      "V3: whole app (planned): dead-link crawl, cross-browser runs, Core Web Vitals, SEO and social previews.",
      "V4: live staging, behind ownership verification (planned, not tied to a release).",
      "0.6.1 to 0.6.5 get Run Hound to the public launch: an isolated test browser and Bedrock access keys (0.6.1), a clean per-launch UI and window (0.6.2), npx run-hound (0.6.3), launch prep (0.6.4), then the launch itself (0.6.5). 1.0.0, after the launch, refactors the app code so it is maintainable. Native desktop packages follow, with a desktop launch of their own.",
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
    ...docsPages(),
    howItWorks(),
    builtInChecks(),
    cantSee(),
    aiBuiltApps(),
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
