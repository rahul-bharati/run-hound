import Link from "next/link";
import { ArrowIcon, ButtonLink } from "@/components/button-link";
import {
  aiBuiltJsonLd,
  aiBuiltPage,
  coverage,
  handles,
  hostNetworkCommand,
  limits,
  nextConfig,
  problems,
  viteConfig,
} from "@/components/ai-built/data";
import { CommandCopy } from "@/components/command-copy";
import { CodeBlock } from "@/components/docs/code-block";
import { JsonLd } from "@/components/json-ld";
import { Card, PageHeader, Section } from "@/components/layout";
import { aiBuiltScreens, type Screen } from "@/components/screens";
import { Screenshot } from "@/components/screenshot";
import { pageMetadata } from "@/lib/metadata";
import { site } from "@/lib/site";

export const metadata = pageMetadata(aiBuiltPage);

const link = "text-accent underline underline-offset-4 hover:text-accent-strong";
const code = "font-mono text-[0.9em] text-fg [overflow-wrap:anywhere]";

// Two columns from lg in the 7xl container (1136 px wide at most, 40 px apart), the full width below.
const figureSizes =
  "(min-width: 1280px) 548px, (min-width: 1024px) calc(50vw - 92px), (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)";

const figures: { screen: Screen; caption: string }[] = [
  {
    screen: aiBuiltScreens.plan,
    caption:
      "Fernway's landing page planned: the waitlist form, the newsletter form and the Book a demo form, which appears only in its dialog; 40 scenarios in all, each form's own tagged with its name.",
  },
  {
    screen: aiBuiltScreens.dialog,
    caption:
      "Mid-run: Run Hound opened the Book a demo dialog and filled it, the Radix Company size select and the consent checkbox included.",
  },
];

export default function AiBuiltAppsPage() {
  return (
    <>
      <JsonLd data={aiBuiltJsonLd()} />
      <PageHeader
        eyebrow="AI-BUILT APPS"
        title={
          <>
            Test apps built with <span className="text-accent">Lovable, Bolt and v0.</span>
          </>
        }
        lede="Apps from AI builders mix plain fields with custom widgets: their selects are buttons, their forms open in dialogs and their errors arrive as toasts. Run Hound finds and fills them the way a person would, tests them in a real browser on your machine, and proves every finding with evidence."
      >
        <p className="font-mono text-xs uppercase tracking-widest text-dim">
          Release {site.version} ·{" "}
          <time dateTime={site.releasedIso} className="whitespace-nowrap text-muted">
            {site.released}
          </time>
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <ButtonLink href="#set-up">
            Set it up
            <ArrowIcon />
          </ButtonLink>
          <ButtonLink href="/demo/#fernway" variant="secondary">
            See a real run on Fernway
          </ButtonLink>
        </div>
      </PageHeader>

      <Section
        id="handles"
        title="What it finds and fills"
        intro={`Since 0.4.0, discovery handles what AI app builders generate: React with Radix and shadcn/ui components, react-hook-form with zod, sonner toasts and client-side routing. ${coverage}`}
      >
        <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {handles.map((item) => (
            <li key={item.title}>
              <Card className="flex h-full flex-col gap-3">
                <h3 className="font-display text-xl font-bold leading-snug">{item.title}</h3>
                <p className="leading-relaxed text-muted">{item.text}</p>
              </Card>
            </li>
          ))}
        </ul>
        <div className="grid gap-10 lg:grid-cols-2">
          {figures.map((figure) => (
            <figure key={figure.caption} className="flex min-w-0 flex-col gap-3">
              <Screenshot screen={figure.screen} sizes={figureSizes} />
              <figcaption className="text-sm leading-relaxed text-muted">{figure.caption}</figcaption>
            </figure>
          ))}
        </div>
      </Section>

      <Section
        id="set-up"
        title="Set it up: your app on your machine, Run Hound in a container"
        intro="Inside the container, localhost is the container itself, not your machine. So Run Hound reaches your app as host.docker.internal, and your dev server has to accept that name. Four steps:"
        className="bg-band"
      >
        <ol className="flex max-w-3xl flex-col gap-10">
          <li className="flex flex-col gap-3">
            <h3 className="font-display text-xl font-bold">1. Start your app, with a throwaway database</h3>
            <p className="leading-relaxed text-muted">
              Start it the way you normally develop it. A full run saves the form several times (about 7 or 8 save
              requests), with obviously fake values, and Run Hound never deletes the records it creates.
            </p>
          </li>
          <li className="flex flex-col gap-3">
            <h3 className="font-display text-xl font-bold">2. Let the dev server answer the container</h3>
            <p className="leading-relaxed text-muted">
              It must listen on all interfaces, not only localhost, and accept the host name{" "}
              <code className={code}>host.docker.internal</code>. Vite needs both:
            </p>
            <CodeBlock label="Vite">{viteConfig}</CodeBlock>
            <p className="leading-relaxed text-muted">
              Or start Vite with <code className={code}>vite --host</code> and keep only{" "}
              <code className={code}>allowedHosts</code> in the config. <code className={code}>next dev</code> already
              listens on all interfaces; Next.js only needs to accept the origin:
            </p>
            <CodeBlock label="Next.js">{nextConfig}</CodeBlock>
          </li>
          <li className="flex flex-col gap-3">
            <h3 className="font-display text-xl font-bold">3. Start Run Hound</h3>
            <p className="leading-relaxed text-muted">
              Pull the image and run it from any folder, with Docker or Podman. Reports land in{" "}
              <code className={code}>./runs</code>.
            </p>
            <CodeBlock label="Docker or Podman, from any folder">{site.runCommands}</CodeBlock>
          </li>
          <li className="flex flex-col gap-3">
            <h3 className="font-display text-xl font-bold">4. Enter your page</h3>
            <p className="leading-relaxed text-muted">
              Open <code className={code}>http://localhost:4000</code> and enter your page as{" "}
              <code className={code}>http://host.docker.internal:&lt;port&gt;/&lt;page&gt;</code>, for example{" "}
              <code className={code}>http://host.docker.internal:5173/signup</code>. Check the &ldquo;found&rdquo;
              strip above the plan, approve the scenarios you want and start the run.
            </p>
          </li>
        </ol>

        <div className="grid max-w-5xl gap-5 lg:grid-cols-2">
          <Card className="flex min-w-0 flex-col gap-3">
            <h3 className="font-display text-xl font-bold">On Linux: share the host&apos;s network</h3>
            <p className="leading-relaxed text-muted">
              With <code className={code}>--network host</code>, localhost is your machine, so nothing in your app
              needs to change:
            </p>
            <CodeBlock label="Docker, host network">{hostNetworkCommand}</CodeBlock>
          </Card>
          <Card className="flex min-w-0 flex-col gap-3">
            <h3 className="font-display text-xl font-bold">From source: no network set-up</h3>
            <p className="leading-relaxed text-muted">
              Installed from source (Node.js 22.12 or newer, on Linux or macOS), Run Hound tests your app exactly as
              your browser sees it: enter <code className={code}>http://localhost:&lt;port&gt;/&lt;page&gt;</code>. It
              is also the way to watch the browser in a window.{" "}
              <Link href="/docs/#install" className={link}>
                Install from source
              </Link>
              .
            </p>
          </Card>
        </div>

        <p className="max-w-3xl leading-relaxed text-muted">
          Limits of the container set-up: <code className={code}>client-only-validation</code> is skipped for a target
          that isn&apos;t localhost, the CSRF check is inconclusive there, and a container can&apos;t show the browser in
          a window (the live preview in the web UI works).
        </p>

        <div className="flex max-w-3xl flex-col gap-4">
          <h3 className="font-display text-2xl font-bold">If it doesn&apos;t work</h3>
          <dl className="flex flex-col divide-y divide-line-soft rounded-2xl border border-line bg-surface">
            {problems.map((problem) => (
              <div key={problem.see} className="flex flex-col gap-1.5 px-5 py-4">
                <dt className="font-mono text-[13px] text-fg [overflow-wrap:anywhere]">{problem.see}</dt>
                <dd className="text-[15px] leading-relaxed text-muted">{problem.means}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Section>

      <Section
        id="signed-in"
        title="Pages behind your sign-in"
        intro="Apps from AI builders often keep the dashboard behind a sign-in. Save two test accounts you own, A and B, and Run Hound signs in through your app's own username and password form before it tests."
      >
        <div className="flex max-w-3xl flex-col gap-5 leading-relaxed text-muted">
          <p>
            Give the sign-in page the same host name as the page you test, for example{" "}
            <code className={code}>http://host.docker.internal:5173/login</code>. Sessions kept in cookies,
            localStorage or IndexedDB carry over, which is where Supabase and Firebase keep theirs, and since 0.6.0 so do
            sessions kept in sessionStorage, and a sign-in that asks for the email first and the password next. A
            session the app throws away when a page loads doesn&apos;t.
          </p>
          <p>
            Signed in as A, the access checks ask whether account B, or a visitor who isn&apos;t signed in, can read
            A&apos;s data (<code className={code}>access-control</code>), and whether the server stores fields such as{" "}
            <code className={code}>role</code> or <code className={code}>plan</code> that the form never sends (
            <code className={code}>mass-assignment</code>). The write-side checks, unticked by default, change A&apos;s
            data on purpose and put it back: can a page on another site change it (<code className={code}>csrf</code>),
            can account B or a signed-out visitor change or delete A&apos;s records (
            <code className={code}>write-access</code>), and can A get a paid plan without paying (
            <code className={code}>paywall-trust</code>). The CSRF check needs the app on localhost or 127.0.0.1, so
            run it with the host network (Linux) or from source.
          </p>
          <p>
            The signed-in checks (<code className={code}>access-control</code>,{" "}
            <code className={code}>mass-assignment</code>, <code className={code}>csrf</code>,{" "}
            <code className={code}>write-access</code> and <code className={code}>paywall-trust</code>) send requests only to
            your app&apos;s own address or an API on a local address. A hosted backend, such as a Supabase project on
            supabase.co, is neither, so an app that calls it straight from the browser gets those checks skipped.
            Checking Supabase row-level security directly is in the{" "}
            <Link href="/checks/#data-readable-without-signing-in" className={link}>
              catalog
            </Link>{" "}
            as planned.
          </p>
          <p>
            <Link href="/docs/#accounts" className={link}>
              Test accounts and signed-in runs, step by step
            </Link>
          </p>
        </div>
      </Section>

      <Section
        id="limits"
        title="Where it stops"
        intro="What Run Hound doesn't cover on these apps yet. A field it couldn't set is named in the notes of the scenarios it skipped, so nothing is dropped silently."
        className="bg-band"
      >
        <Card className="max-w-3xl">
          <ul className="flex list-disc flex-col gap-3 pl-5 leading-relaxed text-muted marker:text-dim">
            {limits.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Card>
      </Section>

      <Section
        id="fernway"
        title="Try it first on Fernway"
        intro="Fernway is a project-planning app built the way AI builders build them (Vite, React, Tailwind, Radix, sonner), with a dashboard behind a sign-in. It ships in the test lab twice: clean, where any confirmed finding is a false positive, and with planted bugs to find."
      >
        <div className="flex flex-col gap-3">
          <p className="font-mono text-xs tracking-widest text-dim">
            THE TEST LAB (RUN HOUND, KENNEL, FERNWAY AND FIVE SAMPLE APPS), FROM AN EMPTY FOLDER
          </p>
          <CommandCopy command={site.labCommand} className="w-full max-w-2xl" />
          <p className="max-w-3xl text-sm leading-relaxed text-dim">
            No clone needed. Podman:{" "}
            <code className="font-mono text-muted">podman compose -f run-hound.compose.yml up</code>. Then open{" "}
            <code className="font-mono text-muted">http://localhost:4000</code> and enter{" "}
            <code className="font-mono text-muted [overflow-wrap:anywhere]">http://fernway-bugs:4110/</code>.
          </p>
        </div>
        <div className="flex flex-col gap-x-8 sm:flex-row sm:flex-wrap">
          <Link href="/demo/#fernway" className={`inline-flex min-h-11 items-center gap-2 ${link}`}>
            What a run on Fernway finds
          </Link>
          <Link href="/faq/" className={`inline-flex min-h-11 items-center gap-2 ${link}`}>
            Questions about Run Hound, answered
          </Link>
          <Link href="/compare/" className={`inline-flex min-h-11 items-center gap-2 ${link}`}>
            How it compares with AI-builder scanners
          </Link>
        </div>
      </Section>
    </>
  );
}
