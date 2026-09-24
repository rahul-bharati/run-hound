import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ArrowIcon, ButtonLink } from "@/components/button-link";
import { FindingDetail } from "@/components/finding";
import { ApproveMock, ExecuteMock, ExploreMock, PlanMock } from "@/components/how/step-mocks";
import { Card, Container, Eyebrow, PageHeader, Section } from "@/components/layout";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "Run Hound finds the form on your local page, plans checks in three groups, waits for your approval, runs them in a real browser with evidence and timing at every step, and reports each defect in plain language.",
};

const steps: { number: string; name: string; title: string; body: ReactNode; mock: ReactNode }[] = [
  {
    number: "01",
    name: "EXPLORE",
    title: "It looks around like a user would",
    body: (
      <>
        Run Hound opens your page in a headless Chromium with Playwright and finds the main form: its fields, labels,
        buttons and the request it sends. It reads the accessibility tree and the DOM, the same structure screen
        readers rely on.
      </>
    ),
    mock: <ExploreMock />,
  },
  {
    number: "02",
    name: "PLAN",
    title: "It drafts golden paths and danger paths",
    body: (
      <>
        From what it found, it plans 13 to 15 scenarios under three groups: Accessibility, Features and Security. Golden
        paths are what a real user does; danger paths are what breaks things, like double clicks, server errors and
        keyboard-only use. In V0 the planning is rule-based; model-assisted planning is planned.
      </>
    ),
    mock: <PlanMock />,
  },
  {
    number: "03",
    name: "APPROVE",
    title: "Nothing runs until you say so",
    body: (
      <>
        The plan opens in a local web UI, or prints on the command line. Each scenario says what it does and whether it
        creates test records. Pick the ones you want, a whole group at a time if you like. Scenarios that could change
        or delete data stay off unless you opt in.
      </>
    ),
    mock: <ApproveMock />,
  },
  {
    number: "04",
    name: "RUN",
    title: "It runs your plan and keeps receipts",
    body: (
      <>
        The approved scenarios run group by group in a real browser. A live view shows the page under test, the
        current scenario, the elapsed time and every page loaded. Screenshots, console and network traffic are kept,
        so every result traces back to what actually happened.
      </>
    ),
    mock: <ExecuteMock />,
  },
  {
    number: "05",
    name: "REPORT",
    title: "Every defect, explained with proof",
    body: (
      <>
        Each finding comes with its group, severity, a plain-language explanation, evidence (annotated screenshots,
        GIFs, request and response cards) and an exported Playwright test. It also tells you what to ask your AI to
        fix.
      </>
    ),
    mock: (
      <div className="flex flex-col gap-3">
        <p className="font-mono text-xs tracking-widest text-dim">SAMPLE FINDING</p>
        <FindingDetail
          category="Broken feature"
          severity="high"
          headingLevel={4}
          title="One click, two bookings"
          meaning="The Book button stays active while the booking is being sent, so a quick double click books the sitter twice."
          impact="Customers get charged or scheduled twice and have to contact you to undo it."
          fix="Disable the Book button while the request is pending, and make the booking endpoint ignore duplicate submissions."
          evidence="evidence: GIF of the double click · 2 POST /api/bookings cards · double-submit spec"
        />
      </div>
    ),
  },
];

const principles = [
  {
    title: "Deterministic checks decide.",
    body: "Pass or fail comes from Playwright assertions, axe-core rules and captured traffic. V0 uses no AI model at all; when model-assisted planning arrives, it will still never decide a result. Findings that rely on judgement are marked advisory.",
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
    body: "V0 tests localhost and private addresses only; public sites are refused. The browser is pinned to the approved address, destructive scenarios are opt-in, and reports redact secret-looking text.",
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
    body: "A re-runnable spec for each finding. It runs with plain Playwright, without Run Hound, so you can reproduce the failure and add it to CI.",
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
  "Legal compliance: Run Hound reports WCAG failures, it doesn't certify compliance",
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
        lede="Run Hound finds the form on your page, drafts a test plan and waits for your approval. Then it runs the plan in a real browser and reports what broke, with proof."
      >
        <p className="font-mono text-xs tracking-widest text-dim">V0 TESTER PREVIEW {site.version} · PANELS BELOW ARE SAMPLES</p>
      </PageHeader>

      <section aria-labelledby="steps-heading" className="py-14 sm:py-20">
        <Container className="flex flex-col gap-16 sm:gap-24">
          <h2 id="steps-heading" className="sr-only">
            The five steps
          </h2>
          <ol className="flex flex-col gap-16 sm:gap-24">
            {steps.map((step, index) => (
              <li key={step.name} className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16">
                <div className={`flex flex-col gap-4 ${index % 2 === 1 ? "lg:order-2" : ""}`}>
                  <Eyebrow>
                    {step.number} · {step.name}
                  </Eyebrow>
                  <h3 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{step.title}</h3>
                  <p className="text-lg leading-relaxed text-muted">{step.body}</p>
                </div>
                <div className={`min-w-0 ${index % 2 === 1 ? "lg:order-1" : ""}`}>{step.mock}</div>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <Section
        className="bg-band"
        title="Design principles"
        intro="The rules Run Hound is built around. They exist to keep findings trustworthy and scans safe."
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
        <div className="flex flex-col items-start gap-6 rounded-2xl border border-line bg-surface p-8 sm:p-12">
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Try it on your own form</h2>
          <p className="max-w-2xl text-lg leading-relaxed text-muted">
            V0 runs on your machine with Node or Docker. Start with Kennel, our deliberately broken demo app, then point
            it at your own form.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <ButtonLink href={site.testingGuide}>
              Try V0 Locally
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
