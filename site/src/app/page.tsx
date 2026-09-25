import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/button-link";
import { Container, NewTag, Section } from "@/components/layout";
import { links, newChecks, totalChecks } from "@/components/home/data";
import { AiSection } from "@/components/home/ai";
import { Evidence } from "@/components/home/evidence";
import { Groups } from "@/components/home/groups";
import { Hero } from "@/components/home/hero";
import { SeeItRun } from "@/components/home/see-it-run";
import { ArrowIcon, GitHubIcon } from "@/components/button-link";
import { CommandCopy } from "@/components/command-copy";
import { GetStarted } from "@/components/get-started";
import { Icon } from "@/components/icon";
import { site } from "@/lib/site";
import {
  Container as Box,
  FileCode,
  FileSearch,
  LayoutDashboard,
  Lock,
  MousePointerClick,
  ShieldCheck,
  Terminal,
} from "lucide-react";

export const metadata: Metadata = {
  title: { absolute: `${site.name}: Find the bugs your AI forgot to test` },
  description: `AI-assisted UI testing for AI-built apps, open source (MIT) on GitHub. Point Run Hound at a page on your local app: it finds every form and control, plans ${totalChecks} built-in checks across accessibility, features and security (optionally reviewed by your own AI model), runs them in a real browser after you approve, and reports each finding with annotated evidence and a Playwright test. Web UI, CLI for CI, Docker or Podman.`,
};

const whatsNew = [
  {
    icon: FileSearch,
    title: "The whole page, not one form",
    text: "Run Hound finds every form and interactive control on the page, and plans the form checks for each form.",
  },
  {
    icon: ShieldCheck,
    title: "Page-wide security checks",
    text: "Security headers, session cookie flags, CORS and public source maps. On a dev server, which doesn't send production headers, these findings are marked advisory.",
  },
  {
    icon: MousePointerClick,
    title: "Dead controls anywhere",
    text: "Buttons and controls outside your forms are clicked too, and the ones that do nothing are reported with evidence.",
  },
  {
    icon: Box,
    title: "Test apps in one command",
    text: "Docker or Podman starts Run Hound with Kennel, our deliberately broken demo app, and five sample apps, so you can try it straight away.",
  },
];

/** The ways you drive a run, and the guard rails around it (README "Running V1 locally", "Safety"). */
const tools = [
  {
    icon: LayoutDashboard,
    title: "A local web UI",
    text: "Plan, approve, run, report in your browser. The live view shows the page under test, each step and a timestamped log. Stop run stops for real and still writes a report; Re-run repeats the same scenarios; the Runs page lists every run on this machine, even after a restart.",
  },
  {
    icon: Terminal,
    title: "A CLI for CI",
    text: "run <url> --approve all runs the same checks from a terminal or a pipeline. It exits 0 with no confirmed findings, 1 with at least one and 2 on an error, and --json puts the report on stdout. Advisory findings never fail a run.",
  },
  {
    icon: FileCode,
    title: "Playwright tests you keep",
    text: "Every finding comes with a generated Playwright spec that reproduces it with plain Playwright, without Run Hound, so you can add it to your own suite and keep the bug fixed. Reports come as HTML, Markdown and JSON.",
  },
  {
    icon: Lock,
    title: "A safety gate",
    text: "Only localhost and private addresses (or hosts you list yourself) are tested; public sites are refused. The browser is pinned to the approved address, destructive scenarios such as Delete or Sign out are off by default, and the UI answers only on loopback.",
  },
];

const principles = [
  {
    title: "Runs on your machine",
    text: "It tests one page of an app running locally or on a private address, and reports stay on your machine. AI is off by default; turn it on and only redacted page structure goes to the model you choose.",
  },
  {
    title: "Asks before it tests",
    text: "You see every planned scenario, and the test records it may create, before anything runs. Destructive scenarios are off by default.",
  },
  {
    title: "No evidence, no finding",
    text: "AI plans and explains; real checks decide. Pass or fail comes from Playwright assertions, axe-core and captured traffic in a real browser, never from a model's guess.",
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
        id="whats-new"
        eyebrow={`NEW IN ${site.release} · ${site.version}`}
        title={
          <>
            From one form to <span className="text-accent">the whole page.</span>
          </>
        }
        intro={`V0 tested the main form on a page. ${site.release} tests the page: every form, every control, and ${newChecks} new checks that look at the page as a whole. Since 0.3.0, your own AI model can review the plan too. Still local only.`}
        className="border-t border-line-soft"
      >
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {whatsNew.map((item) => (
            <li key={item.title} className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6">
              <span className="grid size-11 place-items-center rounded-xl border border-line-strong text-accent">
                <Icon icon={item.icon} size={20} />
              </span>
              <h3 className="font-display text-xl font-bold leading-snug tracking-tight">{item.title}</h3>
              <p className="text-[15px] leading-relaxed text-muted">{item.text}</p>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-3">
          <p className="flex flex-wrap items-center gap-2 font-mono text-xs tracking-widest text-dim">
            TRY IT WITH THE TEST APPS, FROM AN EMPTY FOLDER <NewTag />
          </p>
          <CommandCopy command={site.dockerCommand} className="w-full max-w-2xl" />
          <p className="text-sm text-dim">
            No clone needed. Podman: <code className="font-mono text-muted">podman compose -f run-hound.compose.yml up</code>. Then open{" "}
            <code className="font-mono text-muted">http://localhost:4000</code>.{" "}
            <a href="#start" className="text-muted underline underline-offset-4 hover:text-accent">
              Both ways to start, step by step
            </a>
          </p>
        </div>
      </Section>

      <SeeItRun />

      <Section
        title="What a finding looks like"
        intro="Every finding carries proof you can check without rerunning anything: annotated frames, step-by-step GIFs and cards with the exact requests."
        className="border-t border-line-soft"
      >
        <Evidence />
      </Section>

      <Section
        title={`${totalChecks} checks in three groups`}
        eyebrow="WHAT IT CHECKS"
        intro={`What ${site.release} plans for a typical page, in this order: the form checks for each form, plus ${newChecks} page-wide checks marked new. Checks that have nothing to test on your page are skipped and listed as such in the report. With AI on, suggested flows you tick run as one more, optional check.`}
        className="border-y border-line-soft bg-band"
      >
        <Groups />
        <ArrowLink href="/checks">See every check</ArrowLink>
      </Section>

      <Section
        id="tools"
        eyebrow="WEB UI · CLI · SAFETY"
        title="Click through it, or put it in CI."
        intro="The same plan, checks and report whichever way you run it, with guard rails that keep it pointed at your own machine."
      >
        <ul className="grid gap-5 sm:grid-cols-2">
          {tools.map((item) => (
            <li key={item.title} className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6 sm:p-7">
              <span className="grid size-11 place-items-center rounded-xl border border-line-strong text-accent">
                <Icon icon={item.icon} size={20} />
              </span>
              <h3 className="font-display text-xl font-bold leading-snug tracking-tight">{item.title}</h3>
              <p className="text-[15px] leading-relaxed text-muted">{item.text}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Built to be trusted" eyebrow="PRINCIPLES" className="border-t border-line-soft">
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
        id="ai"
        eyebrow={`AI · OPTIONAL · SINCE ${site.version}`}
        title={
          <>
            AI that plans and explains. <span className="text-accent">Real checks still decide.</span>
          </>
        }
        intro="Bring your own model, local or cloud, and it takes on three jobs: reviewing the plan, suggesting extra flows and explaining findings. Off by default, and never the judge of pass or fail."
        className="border-t border-line-soft bg-band"
      >
        <AiSection />
      </Section>

      <Section
        eyebrow="WHY NOW"
        title="AI builds fast. It ships holes too."
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

      <Section
        id="start"
        eyebrow="START NOW · FREE AND OPEN SOURCE"
        title="Download one file and run it. Nothing to sign up for."
        intro="The repository is public and MIT licensed. Start with Docker or Podman (no clone), or build it from source; the getting-started guide walks through a first run on Kennel, then your own app."
        className="border-t border-line-soft bg-band"
      >
        <GetStarted />
      </Section>

      <section
        aria-labelledby="closing-heading"
        className="relative isolate overflow-hidden border-t border-line-soft py-20 sm:py-28"
      >
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
          <p className="max-w-xl text-pretty text-lg leading-relaxed text-muted">
            {site.release} is open source under the MIT license: one page, on your machine, with the test apps a single
            command away. Clone the repository and the guide walks you through it.
          </p>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <ButtonLink href={links.tryLocally}>
              {site.cta}
              <ArrowIcon size={18} />
            </ButtonLink>
            <ButtonLink href={links.github} variant="secondary">
              <GitHubIcon size={18} />
              View on GitHub
            </ButtonLink>
          </div>
          <p className="text-sm text-dim">
            Open source on GitHub:{" "}
            <a
              href={links.issues}
              className="text-muted underline decoration-line-strong underline-offset-4 hover:text-accent hover:decoration-accent"
            >
              file an issue
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
