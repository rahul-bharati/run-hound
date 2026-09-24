import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/button-link";
import { Container, Section } from "@/components/layout";
import { links, totalChecks } from "@/components/home/data";
import { Direction } from "@/components/home/direction";
import { Evidence } from "@/components/home/evidence";
import { Groups } from "@/components/home/groups";
import { Hero } from "@/components/home/hero";
import { ArrowIcon, GitHubIcon } from "@/components/button-link";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: `${site.name}: Find the bugs your AI forgot to test` },
  description:
    "AI-assisted UI testing for AI-built apps, open source, now in V0 tester preview (AI planning coming soon). Point Run Hound at a form on your local app: it plans 15 checks across accessibility, features and security, runs them in a real browser after you approve, and reports each finding with annotated evidence and a Playwright test.",
};

const principles = [
  {
    title: "Runs on your machine",
    text: "V0 tests one form on an app running locally or on a private address. Nothing is sent anywhere to decide a result.",
  },
  {
    title: "Asks before it tests",
    text: "You see every planned scenario, and what it will create, before anything runs. Destructive scenarios are off by default.",
  },
  {
    title: "No evidence, no finding",
    text: "AI plans and explains; real checks decide. Pass or fail comes from Playwright assertions, axe-core and captured traffic in a real browser, never from a model's guess. AI planning is coming soon.",
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
      className="inline-flex min-h-11 items-center gap-2 self-start font-semibold text-fg hover:text-accent"
    >
      {children}
      <ArrowIcon size={16} />
    </Link>
  );
}

export default function Home() {
  return (
    <>
      <Hero />

      <Section
        title="What a finding looks like"
        intro="Every finding carries proof you can check without rerunning anything: annotated frames, step-by-step GIFs and cards with the exact requests."
        className="border-t border-line-soft"
      >
        <Evidence />
      </Section>

      <Section
        title={`${totalChecks} checks in three groups`}
        intro="What V0 runs on a typical form, in this order. Checks that have nothing to test on your form are skipped and listed as such in the report."
        className="border-y border-line-soft bg-band"
      >
        <Groups />
        <ArrowLink href="/checks">See every check</ArrowLink>
      </Section>

      <Section title="Built to be trusted">
        <ul className="grid gap-5 md:grid-cols-3">
          {principles.map((p, i) => (
            <li key={p.title} className="flex flex-col gap-3 border-t border-line pt-6">
              <span className="font-mono text-xs tracking-widest text-accent" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="font-display text-2xl font-bold tracking-tight">{p.title}</h3>
              <p className="leading-relaxed text-muted">{p.text}</p>
            </li>
          ))}
        </ul>
        <ArrowLink href="/how-it-works">How it works in detail</ArrowLink>
      </Section>

      <Section
        title="Why now"
        intro="AI can build an app from a one-line prompt. The research says the result often ships with holes."
        className="border-t border-line-soft"
      >
        <ul className="grid gap-8 md:grid-cols-3">
          {stats.map((s) => (
            <li key={s.source} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-6 sm:p-7">
              <p className="font-display text-5xl font-extrabold tracking-[-0.03em] text-fg">{s.value}</p>
              <p className="leading-relaxed text-muted">{s.text}</p>
              <p className="mt-auto pt-2 font-mono text-xs tracking-widest text-dim">
                SOURCE: {s.source.toUpperCase()}
              </p>
            </li>
          ))}
        </ul>
      </Section>

      <Direction />

      <section aria-labelledby="closing-heading" className="relative isolate overflow-hidden py-20 sm:py-28">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(50%_60%_at_50%_100%,rgba(94,230,163,0.10),transparent_70%)]"
        />
        <Container className="flex flex-col items-center gap-6 text-center">
          <h2
            id="closing-heading"
            className="max-w-3xl font-display text-4xl font-extrabold leading-[1.02] tracking-[-0.03em] sm:text-6xl"
          >
            Your AI said it&apos;s done. <span className="block text-accent">Let&apos;s check.</span>
          </h2>
          <p className="max-w-xl text-lg leading-relaxed text-muted">
            V0 is a tester preview: one form, on your machine, about ten minutes on the demo app. The tester guide
            walks you through it.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <ButtonLink href={links.tryLocally}>
              Try V0 Locally
              <ArrowIcon size={18} />
            </ButtonLink>
            <ButtonLink href={links.github} variant="secondary">
              <GitHubIcon size={18} />
              View on GitHub
            </ButtonLink>
          </div>
          <p className="text-sm text-dim">
            Invite-only preview:{" "}
            <a
              href={links.requestAccess}
              className="text-muted underline decoration-line-strong underline-offset-4 hover:text-accent hover:decoration-accent"
            >
              ask for access
            </a>
            {" · "}
            <a
              href={links.changelog}
              className="text-muted underline decoration-line-strong underline-offset-4 hover:text-accent hover:decoration-accent"
            >
              Changelog
            </a>
          </p>
        </Container>
      </section>
    </>
  );
}
