import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/button-link";
import { CommandCopy } from "@/components/command-copy";
import { Card, Container, Eyebrow, Section } from "@/components/layout";
import { ProductWindow } from "@/components/product-window";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: `${site.name}: ${site.tagline}` },
  description: site.description,
};

const categories = [
  {
    label: "BROKEN FEATURES",
    text: "Dead buttons, silent failures, double submits and data that vanishes on reload.",
  },
  {
    label: "ACCESSIBILITY",
    text: "Forms you cannot finish by keyboard, errors nobody announces, layouts that break at 320 px.",
  },
  {
    label: "ACCESS AND AUTH",
    text: "Frontend-only auth, other users' data within reach, paid features open without payment.",
  },
  {
    label: "LEAKS",
    text: "Secret keys in the JS bundle, personal data sent to third parties, stack traces shown to users.",
  },
];

const steps = [
  { name: "Explore", text: "Drives your app in a real headless browser." },
  { name: "Plan", text: "Writes golden-path and danger-path scenarios." },
  { name: "Approve", text: "You review, edit or remove them before anything runs." },
  { name: "Execute", text: "Runs the approved plan, capturing evidence at every step." },
  { name: "Report", text: "Plain-language findings with proof and a Playwright test." },
];

const principles = [
  {
    title: "Runs on your machine",
    text: "One Docker container and your own model: Ollama locally, or AWS Bedrock or any OpenAI-compatible API.",
  },
  {
    title: "Asks before it tests",
    text: "You approve the plan before anything runs. Destructive actions are off by default.",
  },
  {
    title: "Proves every finding",
    text: "Every finding carries evidence and a rerunnable Playwright test. The LLM plans and explains; deterministic checks decide.",
  },
];

const stats = [
  {
    value: "45%",
    text: "of AI-generated code samples failed security tests, and newer or larger models did no better.",
    source: "Veracode, 2025",
  },
  {
    value: "95.9%",
    text: "of the top million home pages fail automated WCAG checks. WebAIM names vibe coding as a likely contributor.",
    source: "WebAIM Million, 2026",
  },
  {
    value: "2,000+",
    text: "vulnerabilities, 400+ exposed secrets and 175 personal data exposures across about 5,600 live vibe-coded apps.",
    source: "Escape.tech, 2025",
  },
];

function ArrowLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center gap-2 self-start font-semibold text-fg hover:text-amber"
    >
      {children}
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 8h10M9 4l4 4-4 4" />
      </svg>
    </Link>
  );
}

export default function Home() {
  return (
    <>
      {/* 1. Hero */}
      <Container className="flex flex-col items-center gap-7 pb-12 pt-16 text-center sm:pt-24">
        <Link
          href="/open-source"
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line-strong bg-surface px-4 font-mono text-xs tracking-widest text-muted hover:border-amber hover:text-amber"
        >
          <span className="size-1.5 rounded-full bg-amber" aria-hidden="true" />
          OPEN SOURCE · EARLY DEVELOPMENT
        </Link>
        <h1 className="max-w-4xl font-display text-5xl font-extrabold leading-[0.98] tracking-[-0.03em] sm:text-7xl lg:text-8xl">
          Your AI said it&apos;s done.
          <span className="block text-amber">Let&apos;s check.</span>
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-muted sm:text-xl">
          An open-source testing agent that explores your app in a real browser, asks before it
          tests, and reports broken flows, accessibility failures and leaks with proof.
        </p>
        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <ButtonLink href="/docs" comingSoon>
            Get started
          </ButtonLink>
          <ButtonLink href="/demo" variant="secondary" comingSoon>
            See the demo
          </ButtonLink>
        </div>
      </Container>

      {/* 2. Product window */}
      <div className="mx-auto w-full max-w-[1320px] px-4 pb-6 sm:px-6">
        <ProductWindow />
        <p className="mt-4 text-center font-mono text-xs tracking-widest text-dim">
          SAMPLE RUN ON OUR DEMO APP
        </p>
      </div>

      {/* 3. What it hunts for */}
      <Section
        title="What it hunts for"
        intro="The holes AI-built apps ship with most often, checked from the outside like a real user would find them."
      >
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {categories.map((c) => (
            <li key={c.label}>
              <Card className="flex h-full flex-col gap-3">
                <Eyebrow>{c.label}</Eyebrow>
                <p className="leading-relaxed text-muted">{c.text}</p>
              </Card>
            </li>
          ))}
        </ul>
        <ArrowLink href="/checks">See every check</ArrowLink>
      </Section>

      {/* 4. How it works */}
      <Section
        title="How it works"
        intro="Five steps, with you in the loop before anything touches your app."
        className="border-y border-line-soft bg-band"
      >
        <ol className="grid gap-8 sm:grid-cols-2 lg:grid-cols-5 lg:gap-6">
          {steps.map((s, i) => (
            <li key={s.name} className="flex flex-col gap-2 border-t border-line pt-5">
              <span className="font-mono text-xs tracking-widest text-amber" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="font-display text-xl font-bold tracking-tight">{s.name}</h3>
              <p className="leading-relaxed text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
        <ArrowLink href="/how-it-works">How it works in detail</ArrowLink>
      </Section>

      {/* 5. Principles */}
      <Section title="Built to be trusted">
        <ul className="grid gap-5 md:grid-cols-3">
          {principles.map((p) => (
            <li key={p.title}>
              <Card className="flex h-full flex-col gap-3">
                <h3 className="font-display text-2xl font-bold tracking-tight">{p.title}</h3>
                <p className="leading-relaxed text-muted">{p.text}</p>
              </Card>
            </li>
          ))}
        </ul>
      </Section>

      {/* 6. Why now */}
      <Section
        title="Why now"
        intro="AI can build an app from a one-line prompt. The research says the result often ships with holes."
      >
        <ul className="grid gap-8 md:grid-cols-3">
          {stats.map((s) => (
            <li key={s.source} className="flex flex-col gap-3 border-t border-line pt-6">
              <p className="font-display text-5xl font-extrabold tracking-[-0.03em]">{s.value}</p>
              <p className="leading-relaxed text-muted">{s.text}</p>
              <p className="font-mono text-xs tracking-widest text-dim">SOURCE: {s.source.toUpperCase()}</p>
            </li>
          ))}
        </ul>
      </Section>

      {/* 7. Closing CTA */}
      <section aria-labelledby="closing-heading" className="border-t border-line-soft bg-band py-16 sm:py-24">
        <Container className="flex flex-col items-center gap-6 text-center">
          <h2
            id="closing-heading"
            className="max-w-3xl font-display text-3xl font-bold tracking-tight sm:text-5xl"
          >
            Free and open source. Coming soon to your machine.
          </h2>
          <CommandCopy command={site.dockerCommand} comingSoon className="w-full max-w-xl text-left" />
          <p className="max-w-xl text-sm leading-relaxed text-muted">
            Run Hound is in early development. The Docker image is not published yet, so this
            command will work once the first release is out.
          </p>
          <ButtonLink href={site.github} variant="secondary">
            Follow on GitHub
          </ButtonLink>
        </Container>
      </section>
    </>
  );
}
