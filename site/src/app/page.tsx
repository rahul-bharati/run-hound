import Link from "next/link";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/button-link";
import { Container, Section } from "@/components/layout";
import { links, previewChecks, totalChecks } from "@/components/home/data";
import { AiSection } from "@/components/home/ai";
import { Evidence } from "@/components/home/evidence";
import { Groups } from "@/components/home/groups";
import { Hero } from "@/components/home/hero";
import { SeeItRun } from "@/components/home/see-it-run";
import { AiBuiltTour, SignedInTour } from "@/components/home/v2-tours";
import { ArrowIcon, GitHubIcon } from "@/components/button-link";
import { CommandCopy } from "@/components/command-copy";
import { GetStarted } from "@/components/get-started";
import { Icon } from "@/components/icon";
import { pageMetadata } from "@/lib/metadata";
import { site } from "@/lib/site";
import {
  AppWindow,
  Container as Box,
  DatabaseZap,
  FileCode,
  KeyRound,
  LayoutDashboard,
  Link2Off,
  Lock,
  SlidersHorizontal,
  Terminal,
  TextCursorInput,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

export const metadata = pageMetadata({
  path: "/",
  title: `${site.name}: Find the bugs your AI forgot to test`,
  absoluteTitle: true,
  description:
    "Open-source, AI-assisted UI testing for AI-built apps: real checks in a real browser, with evidence and a Playwright test. Runs on your machine.",
});

/** The V2 preview's checks (0.4.0, docs/v2-spec.md), as the questions they answer. */
const accessChecks: { icon: LucideIcon; id: string; title: string; text: string }[] = [
  {
    icon: UsersRound,
    id: "access-control",
    title: "Can someone else read your data?",
    text: "Signed in as Account A, Run Hound saves a test record, then asks for the same data as Account B and as a visitor who isn't signed in. Either one getting it back is a critical finding, with the requests that prove it.",
  },
  {
    icon: DatabaseZap,
    id: "mass-assignment",
    title: "Does the server trust extra fields?",
    text: "It replays Account A's save with fields the form never sends, such as role: admin or plan: pro, and reads the record back. Unticked until you tick it: it changes Account A, then puts back what it changed.",
  },
  {
    icon: Link2Off,
    id: "deep-links",
    title: "Do your pages survive a reload?",
    text: "It opens the page's own links directly, as a reload or a shared link would, and reports the ones that answer with an error or a not-found page. Signed in or not.",
  },
];

/** What keeps the test accounts' secrets out of everything a signed-in run writes (docs/v2-spec.md "Test accounts"). */
const accountSecrets = [
  "Passwords are write-only: the web UI never shows a saved one, the CLI reads it from what you type or pipe (never a flag), and a saved password is only sent to the sign-in page it was saved for.",
  "Passwords, session cookies and tokens are hidden in reports, evidence, Playwright tests, logs, progress and AI prompts, and so are usernames: reports name the accounts by label.",
  "Screenshots are taken with the account's name and session values dotted out.",
  "The accounts are saved on your machine only, in a settings file only you can read.",
];

/** How discovery handles apps from AI builders (0.4.0); the limits are in the docs ("Apps from AI builders"). */
const aiBuilt: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: SlidersHorizontal,
    title: "Custom widgets",
    text: "Selects, comboboxes, checkboxes, switches, radio groups and sliders from Radix and shadcn/ui, Headless UI, cmdk and MUI are found as fields and set the way a person sets them, in the checks and in the Playwright tests you export.",
  },
  {
    icon: AppWindow,
    title: "Forms in dialogs and sheets",
    text: "Run Hound tries up to 3 controls that look like they open a dialog, such as “Add member”, with every write blocked while it looks, and tests the form that appears. Its scenarios open the dialog first.",
  },
  {
    icon: TextCursorInput,
    title: "Today's form stacks",
    text: "react-hook-form with zod, fields marked required only in their label (“Email *”), sonner toasts, and ids that change on every load (React useId, radix-…) are handled, so they don't turn into false findings.",
  },
  {
    icon: Box,
    title: "Fernway, built the same way",
    text: "A test app like the ones AI builders generate: Vite, React 19, Tailwind, Radix, sonner and react-hook-form, with sign-up, an onboarding wizard and a dashboard behind a login. Clean, any confirmed finding is a false positive; with its bugs on, each is caught by one check.",
  },
];

/** The ways you drive a run, and the guard rails around it (README "Running it locally", "Safety"). */
const tools = [
  {
    icon: LayoutDashboard,
    title: "A local web UI",
    text: "Plan, approve, run, report in your browser. The live view shows the page under test, each step and a timestamped log. Stop run stops for real and still writes a report; Re-run repeats the same scenarios; the Runs page lists every run on this machine, even after a restart.",
  },
  {
    icon: Terminal,
    title: "A CLI for CI",
    text: "run-hound run <url> --approve all runs the same checks from a terminal or a pipeline. It exits 0 with no confirmed findings, 1 with at least one and 2 on an error, and --json puts the report on stdout. Advisory findings never fail a run.",
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
    text: "It tests one page of an app running locally or on a private address, and reports stay on your machine. AI is off by default; turn it on and only redacted page structure and finding text go to the model you choose.",
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
        id="signed-in"
        eyebrow={`NEW IN 0.4.0 · ${site.preview.toUpperCase()}`}
        title={
          <>
            Signed-in runs <span className="text-accent">and access checks.</span>
          </>
        }
        intro="Add two test accounts you own on your app, A and B. Run Hound signs in before it tests, so pages behind a login get every check, and three new checks look for what AI-built backends often get wrong. It is the first part of V2, released as a preview."
        className="border-t border-line-soft"
      >
        <ul className="grid gap-5 md:grid-cols-3">
          {accessChecks.map((item) => (
            <li key={item.id} className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6 sm:p-7">
              <span className="grid size-11 place-items-center rounded-xl border border-line-strong text-accent">
                <Icon icon={item.icon} size={20} />
              </span>
              <h3 className="font-display text-xl font-bold leading-snug tracking-tight">{item.title}</h3>
              <p className="text-[15px] leading-relaxed text-muted">{item.text}</p>
              <p className="mt-auto font-mono text-xs text-dim">{item.id}</p>
            </li>
          ))}
        </ul>
        <SignedInTour />
        <div className="grid gap-8 rounded-2xl border border-line bg-bg-deep p-6 sm:p-8 lg:grid-cols-[1.4fr_1fr] lg:gap-12">
          <div className="flex flex-col gap-4">
            <p className="flex items-center gap-2 font-mono text-xs tracking-widest text-dim">
              <Icon icon={KeyRound} size={16} className="text-accent" />
              YOUR TEST ACCOUNTS STAY SECRET
            </p>
            <ul className="flex list-disc flex-col gap-2.5 pl-5 leading-relaxed text-muted marker:text-dim">
              {accountSecrets.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-4 text-[15px] leading-relaxed text-muted">
            <p>
              Set them up in <strong className="text-fg">Settings → Test accounts</strong>, with{" "}
              <code className="font-mono text-fg">run-hound accounts set</code>, or with{" "}
              <code className="font-mono text-fg">RUNHOUND_ACCOUNT_A_*</code> variables, then pick{" "}
              <strong className="text-fg">Sign in as</strong> in a new run, or pass{" "}
              <code className="font-mono text-fg">--as a</code>. Use accounts you own, made for testing, never a real
              customer&apos;s.
            </p>
            <p>
              Still planned for V2: testing a feature across pages, checking whether one account can change another&apos;s
              data, rate limits, CSRF, file uploads, prompt injection and paywall trust.
            </p>
            <ArrowLink href="/docs#accounts">Signed-in runs in the docs</ArrowLink>
          </div>
        </div>
      </Section>

      <Section
        id="ai-built-apps"
        eyebrow="AI-BUILT APPS · NEW IN 0.4.0"
        title={
          <>
            Works on apps built with <span className="text-accent">Lovable, Bolt and v0.</span>
          </>
        }
        intro="Apps from AI builders rarely use plain HTML form fields: their selects are buttons, their forms open in dialogs and their errors arrive as toasts. Run Hound finds and fills them the way a person would, and a test app built the same way keeps it honest."
        className="border-t border-line-soft bg-band"
      >
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {aiBuilt.map((item) => (
            <li key={item.title} className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6">
              <span className="grid size-11 place-items-center rounded-xl border border-line-strong text-accent">
                <Icon icon={item.icon} size={20} />
              </span>
              <h3 className="font-display text-xl font-bold leading-snug tracking-tight">{item.title}</h3>
              <p className="text-[15px] leading-relaxed text-muted">{item.text}</p>
            </li>
          ))}
        </ul>
        <AiBuiltTour />
        <p className="max-w-3xl text-[15px] leading-relaxed text-muted">
          Limits: a multi-step form is tested on its first step only, and a form that opens some other way (from a menu,
          for example) isn&apos;t found.{" "}
          <Link href="/docs#ai-built" className="text-accent underline underline-offset-4 hover:text-accent-strong">
            What discovery covers, and what it doesn&apos;t
          </Link>
          .
        </p>
        <div className="flex flex-col gap-3">
          <p className="font-mono text-xs tracking-widest text-dim">
            TRY IT WITH THE TEST APPS (KENNEL, FERNWAY AND FIVE SAMPLE APPS), FROM AN EMPTY FOLDER
          </p>
          <CommandCopy command={site.dockerCommand} className="w-full max-w-2xl" />
          <p className="text-sm text-dim">
            No clone needed. Podman: <code className="font-mono text-muted">podman compose -f run-hound.compose.yml up</code>. Then open{" "}
            <code className="font-mono text-muted">http://localhost:4000</code> and enter{" "}
            <code className="font-mono text-muted">http://fernway-bugs:4110/</code>.{" "}
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
        intro={`What the plan holds for a page, in run order: the form checks for each form and the page-wide checks. The ${previewChecks} checks of the V2 preview are tagged; two of them run only signed in. Checks that have nothing to test on your page are skipped and listed as such in the report. With AI on, suggested flows you tick run as one more, optional check.`}
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
        eyebrow="AI · OPTIONAL · SINCE 0.3.0"
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
            {site.name} is open source under the MIT license: one page at a time, on your machine, signed in if you like,
            with the test apps a single command away. The getting-started guide walks you through a first run; no clone
            needed.
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
