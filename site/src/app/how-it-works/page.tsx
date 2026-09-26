import type { ReactNode } from "react";
import { ArrowIcon, ButtonLink } from "@/components/button-link";
import { GetStarted } from "@/components/get-started";
import { stepScreens } from "@/components/screens";
import { Screenshot } from "@/components/screenshot";
import { Card, Container, Eyebrow, PageHeader, Section } from "@/components/layout";
import { pageMetadata } from "@/lib/metadata";
import { site } from "@/lib/site";

export const metadata = pageMetadata({
  path: "/how-it-works/",
  title: "How it works",
  description:
    "Run Hound explores your local page, plans checks you approve, runs them in a real browser and reports each defect with evidence and a Playwright test.",
});

// The step's screenshot column: 7/12 of the 1136 px container from xl, 7/12 of the viewport on lg, full width below.
const shotSizes =
  "(min-width: 1280px) 650px, (min-width: 1024px) 56vw, (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)";

const steps: { number: string; name: string; title: string; body: ReactNode; shot: ReactNode }[] = [
  {
    number: "01",
    name: "EXPLORE",
    title: "It looks around like a user would",
    body: (
      <>
        Run Hound opens your page in a headless Chromium with Playwright and finds the forms and controls on it:
        fields and their labels, buttons, and the controls outside any form. That includes the custom selects,
        switches and sliders of component libraries such as Radix and shadcn/ui, and forms that open in a dialog. It
        reads the accessibility tree and the DOM, the same structure screen readers rely on, and notes the
        page&apos;s response headers, cookies and scripts. With a test account, it signs in first and explores the
        page as that user.
      </>
    ),
    shot: <Screenshot screen={stepScreens.explore} sizes={shotSizes} />,
  },
  {
    number: "02",
    name: "PLAN",
    title: "It drafts golden paths and danger paths",
    body: (
      <>
        From what it found, it plans form checks for each form, plus page-wide checks such as security headers, cookie
        flags, CORS, public source maps, dead controls anywhere on the page and links that break when opened directly,
        under three groups: Accessibility, Features and Security. Signed in, it adds the access checks: can another
        account, or a visitor who isn&apos;t signed in, read your data? Golden paths are what a real user does; danger paths are what breaks things, like
        double clicks, server errors and invalid input. The plan comes from what it found on the page. If you turn
        on AI, your own model reviews it, recommending and ranking each scenario with a reason, and suggests up to 5
        extra flows built only from the fields and buttons it found; they stay unticked until you choose them.
      </>
    ),
    shot: <Screenshot screen={stepScreens.plan} sizes={shotSizes} />,
  },
  {
    number: "03",
    name: "APPROVE",
    title: "Nothing runs until you say so",
    body: (
      <>
        The plan opens in a local web UI, or prints on the command line (<code className="font-mono text-base text-fg">--plan-only</code>). Each scenario says
        what it does and whether it creates test records. Pick the ones you want, a whole group at a time if you like.
        Scenarios that could change or delete data, such as Delete or Sign out buttons, stay off unless you opt in.
      </>
    ),
    shot: <Screenshot screen={stepScreens.approve} sizes={shotSizes} />,
  },
  {
    number: "04",
    name: "RUN",
    title: "It runs your plan and keeps receipts",
    body: (
      <>
        The approved scenarios run group by group in a real browser. A live view shows the page under test, the
        current scenario and its steps as they happen, the elapsed time and a timestamped log. Stop run stops it for
        real and still writes a report; Back to test plan plans the same page again. Screenshots, console and network
        traffic are kept, so every result traces back to what actually happened.
      </>
    ),
    shot: <Screenshot screen={stepScreens.run} sizes={shotSizes} />,
  },
  {
    number: "05",
    name: "REPORT",
    title: "Every defect, explained with proof",
    body: (
      <>
        Each finding comes with its group, severity, a plain-language explanation, evidence (annotated screenshots,
        GIFs, request and response cards) and an exported Playwright test. It also tells you what to ask your AI to
        fix. Re-run repeats the same scenarios once you have fixed something, and the Runs page lists every run on this
        machine. On the command line the exit code says it all: 0 with no confirmed findings, 1 with at least one, 2
        on an error. With AI on, each finding also gets an AI explanation beside the built-in one, labelled advisory.
      </>
    ),
    shot: <Screenshot screen={stepScreens.report} sizes={shotSizes} />,
  },
];

const principles = [
  {
    title: "AI plans and explains. Real checks decide.",
    body: "Pass or fail comes from Playwright assertions, axe-core and captured traffic in a real browser, never from a model guessing. With AI on (it is off by default), your own model reviews the plan, suggests flows and explains findings, but a real check with evidence still decides every result, and findings from AI-suggested flows are advisory. Findings that rely on judgement, or on production values a dev server doesn't send, are marked advisory.",
  },
  {
    title: "No evidence, no finding.",
    body: "Every reported defect has an annotated screenshot, a GIF or the request and response, plus a replayable spec. A wrong finding costs you time, so each false positive is treated as a bug in Run Hound.",
  },
  {
    title: "Build on Playwright and axe-core.",
    body: "Proven tools do the heavy lifting. Run Hound adds exploration, approval, triage and plain-language reporting on top instead of reinventing them.",
  },
  {
    title: "Only owned targets, safe by default.",
    body: "Run Hound tests localhost and private addresses only (plus host names you list yourself); public sites are refused. The browser is pinned to the approved address, destructive scenarios are opt-in, and reports redact secret-looking text. Test accounts are yours, and their passwords, sessions and usernames are kept out of everything a run writes. With AI on, only redacted page structure is sent to your model, and a remote endpoint needs your consent first.",
  },
];

const outputs = [
  {
    label: "REPORT",
    title: "HTML and Markdown report",
    body: "A summary with run time, a table per group and findings by severity. Each finding says what it means, why it matters and what to ask your AI to fix, with its evidence inline.",
  },
  {
    label: ".SPEC.TS",
    title: "Playwright tests you keep",
    body: "A re-runnable spec for each finding. It runs with plain Playwright, without Run Hound, so you can reproduce the failure and add it to CI. Run Hound's own CLI fits CI too: exit code 1 means a confirmed finding.",
  },
  {
    label: "JSON",
    title: "report.json",
    body: "Everything machine-readable: the plan, groups, scenario results and timings, findings and the Run Hound version.",
  },
];

const notVisible = [
  "Database backups",
  "Webhook signature verification on the server",
  "Dependency hygiene, such as hallucinated or look-alike packages in your lockfile",
  "Backend error monitoring",
  "Legal compliance: Run Hound reports WCAG failures but doesn't certify compliance",
];

export default function HowItWorksPage() {
  return (
    <>
      <PageHeader
        eyebrow="HOW IT WORKS"
        title={
          <>
            It asks <span className="text-accent">before it tests.</span>
          </>
        }
        lede="Run Hound finds the forms and controls on your page, drafts a test plan and waits for your approval. Then it runs the plan in a real browser and reports what broke, with proof."
      >
        <p className="max-w-3xl font-mono text-xs leading-relaxed tracking-widest text-dim">
          SCREENSHOTS FROM A REAL RUN ON KENNEL, OUR DELIBERATELY BROKEN DEMO APP, WITH AI OFF
        </p>
      </PageHeader>

      <section aria-labelledby="steps-heading" className="py-14 sm:py-20">
        <Container className="flex flex-col gap-16 sm:gap-24">
          <h2 id="steps-heading" className="sr-only">
            The five steps
          </h2>
          <ol className="flex flex-col gap-16 sm:gap-24">
            {steps.map((step, index) => (
              <li
                key={step.name}
                className={`grid items-center gap-8 lg:gap-14 ${
                  index % 2 === 1 ? "lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]" : "lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
                }`}
              >
                <div className={`flex flex-col gap-4 ${index % 2 === 1 ? "lg:order-2" : ""}`}>
                  <Eyebrow>
                    {step.number} · {step.name}
                  </Eyebrow>
                  <h3 className="text-balance font-display text-3xl font-bold leading-[1.1] tracking-tight sm:text-4xl">
                    {step.title}
                  </h3>
                  <p className="text-lg leading-relaxed text-muted">{step.body}</p>
                </div>
                <div className={`min-w-0 ${index % 2 === 1 ? "lg:order-1" : ""}`}>{step.shot}</div>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <Section
        className="bg-band"
        title="Design principles"
        intro="The principles Run Hound is built around. They exist to keep findings trustworthy and runs safe."
      >
        <ul className="grid gap-5 md:grid-cols-2">
          {principles.map((principle) => (
            <li key={principle.title}>
              <Card className="flex h-full flex-col gap-3">
                <h3 className="font-display text-xl font-bold leading-snug">{principle.title}</h3>
                <p className="leading-relaxed text-muted">{principle.body}</p>
              </Card>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="What you get" intro="Three outputs from every run, all yours to keep.">
        <ul className="grid gap-5 md:grid-cols-3">
          {outputs.map((output) => (
            <li key={output.title}>
              <Card className="flex h-full flex-col gap-3">
                <p className="font-mono text-xs tracking-widest text-accent">{output.label}</p>
                <h3 className="font-display text-xl font-bold leading-snug">{output.title}</h3>
                <p className="leading-relaxed text-muted">{output.body}</p>
              </Card>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        className="bg-band"
        title="What it can't see"
        intro="A browser only sees what your app shows it. Some holes live entirely on the server side, so every report ends with a “What a browser can’t see” list. A clean report is never a clean bill of health."
      >
        <Card className="max-w-3xl">
          <p className="mb-4 font-mono text-xs tracking-widest text-dim">WHAT A BROWSER CAN’T SEE · EXAMPLES</p>
          <ul className="flex flex-col gap-3">
            {notVisible.map((item) => (
              <li key={item} className="flex items-start gap-3">
                <span className="mt-1 size-4 shrink-0 rounded border border-line-strong" aria-hidden="true" />
                <span className="leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      <Section>
        <div className="flex flex-col items-start gap-6 rounded-2xl border border-line bg-surface p-6 sm:p-12">
          <h2 className="text-balance font-display text-3xl font-bold tracking-tight sm:text-[2.5rem]">
            Try it on your own page
          </h2>
          <p className="max-w-2xl text-lg leading-relaxed text-muted">
            {site.name} runs on your machine with Node, Docker or Podman, and it&apos;s free and MIT licensed. One
            command starts it with Kennel, our deliberately broken demo app, Fernway, an app built the way AI builders
            build them, and a few sample apps; then point it at a page of your own.
          </p>
          <GetStarted />
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <ButtonLink href={site.testingGuide}>
              {site.cta}
              <ArrowIcon />
            </ButtonLink>
            <ButtonLink href="/docs" variant="secondary">
              Read the docs
            </ButtonLink>
          </div>
        </div>
      </Section>
    </>
  );
}
