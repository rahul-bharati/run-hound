import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/button-link";
import { FindingDetail } from "@/components/finding";
import { ApproveMock, ExecuteMock, ExploreMock, PlanMock } from "@/components/how/step-mocks";
import { Card, Container, Eyebrow, PageHeader, Section } from "@/components/layout";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "Run Hound explores your app in a real browser, drafts a test plan, waits for your approval, runs it with evidence at every step and reports each defect in plain language.",
};

const steps: { number: string; name: string; title: string; body: ReactNode; mock: ReactNode }[] = [
  {
    number: "01",
    name: "EXPLORE",
    title: "It looks around like a user would",
    body: (
      <>
        The agent drives a headless browser with Playwright. It reads the accessibility tree and the DOM first, the
        same structure screen readers rely on, and only uses vision on screenshots for layout and visual checks.
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
        From what it found, it writes test scenarios: the happy path a real user takes, and the danger paths that
        break things, like double clicks, server errors and keyboard-only use. Scenarios are grouped by feature and
        prioritized, so the most valuable ones come first.
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
        The plan opens in a local web UI. Review it, edit scenarios, remove the ones you don&apos;t want and add your
        own. Destructive actions, like real payments or deleting data, stay off unless you explicitly opt in.
      </>
    ),
    mock: <ApproveMock />,
  },
  {
    number: "04",
    name: "EXECUTE",
    title: "It runs your plan and keeps receipts",
    body: (
      <>
        The approved scenarios run in the browser. At every step it captures a screenshot, the console log and the
        network log, so every result can be traced back to what actually happened.
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
        Each finding comes with its feature, priority, a plain-language explanation, steps to reproduce, evidence and
        an exported Playwright test. It also tells you what to ask your AI to fix.
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
          evidence="evidence: 2 screenshots · 2 POST requests · double-submit.spec.ts"
        />
      </div>
    ),
  },
];

const principles = [
  {
    title: "The LLM plans and explains; deterministic checks decide.",
    body: "Pass or fail comes from Playwright assertions, axe-core rules and captured traffic, never from model judgement. Findings that depend on judgement, like alt-text quality, are marked advisory.",
  },
  {
    title: "No evidence, no finding.",
    body: "Every reported defect has a screenshot and/or the request and response, plus a replayable spec. Made-up defects are the biggest risk for a tool like this, so they are treated as the main thing to prevent.",
  },
  {
    title: "Build on Playwright and axe-core.",
    body: "Proven tools do the heavy lifting. Run Hound adds exploration, approval, triage and plain-language reporting on top instead of reinventing them.",
  },
  {
    title: "Only owned targets, safe by default.",
    body: "localhost and private addresses work out of the box. Any other domain will need ownership verification before a scan. Reports redact any secrets they find, and keys are never used or tested.",
  },
];

const outputs = [
  {
    label: "REPORT",
    title: "HTML or Markdown report",
    body: "Defects triaged by feature and priority. Each finding says what it means, why it matters and what to ask your AI to fix, with screenshots, console and network logs and reproduction steps.",
  },
  {
    label: ".SPEC.TS",
    title: "Playwright tests you keep",
    body: "A re-runnable spec for each scenario, using role- and label-based locators. No agent is needed to run them, so you can reproduce the failure and add it to CI.",
  },
  {
    label: "JSON",
    title: "Run recording",
    body: "A JSON record of the plan, steps, screenshots and findings. It powers replays, including the demo on this site.",
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
        title="It asks before it tests."
        lede="Run Hound explores your app, drafts a test plan and waits for your approval. Then it runs the plan in a real browser and reports what broke, with proof."
      >
        <p className="font-mono text-xs tracking-widest text-dim">EARLY DEVELOPMENT · V0 IN PROGRESS · PANELS BELOW ARE SAMPLES</p>
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
                <p className="font-mono text-xs tracking-widest text-amber">{output.label}</p>
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
        intro="A browser only sees what your app shows it. Some holes live entirely on the server side, so every report lists them in a “Not visible from outside” checklist. A clean report is never a clean bill of health."
      >
        <Card className="max-w-3xl">
          <p className="mb-4 font-mono text-xs tracking-widest text-dim">NOT VISIBLE FROM OUTSIDE · EXAMPLES</p>
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
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Read the docs</h2>
          <p className="max-w-2xl text-lg leading-relaxed text-muted">
            See what the first version covers, how the local setup is planned to work and how to bring your own model.
          </p>
          <ButtonLink href="/docs" comingSoon>
            Get started
          </ButtonLink>
        </div>
      </Section>
    </>
  );
}
