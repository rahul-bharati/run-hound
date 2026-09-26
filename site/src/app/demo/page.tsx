import Link from "next/link";
import { ArrowIcon, ButtonLink } from "@/components/button-link";
import { EvidenceFigure } from "@/components/demo/evidence-figure";
import { CodeBlock } from "@/components/docs/code-block";
import { evidence } from "@/components/evidence";
import { Card, Eyebrow, PageHeader, Section } from "@/components/layout";
import { aiBuiltScreens, v2Screens } from "@/components/screens";
import { Screenshot } from "@/components/screenshot";
import { pageMetadata } from "@/lib/metadata";
import { site } from "@/lib/site";

export const metadata = pageMetadata({
  path: "/demo/",
  title: "Demo",
  description:
    "Real evidence from a Run Hound run on Kennel, a deliberately broken booking app: a double submit, a silent failure, missing focus, leaked keys and more.",
});

// Planted bugs per test app and stage: fixtures/kennel/bugs.json and fixtures/fernway/bugs.json.
const planted = [
  {
    label: "KENNEL · V0",
    count: 19,
    title: "Booking form bugs",
    body: "Defects in a single form on localhost, the ones V0 was scored against. In clean mode the target is zero confirmed findings.",
    groups: [
      { name: "Broken features", count: 5 },
      { name: "Validation", count: 1 },
      { name: "Accessibility", count: 9 },
      { name: "Leaks and secrets", count: 4 },
    ],
  },
  {
    label: "KENNEL · V1",
    count: 5,
    title: "Whole-page bugs",
    body: "Defects outside the form and in how the server answers, the ones V1 is scored against. Clean Kennel sends proper headers and cookies, so the target is still zero confirmed findings.",
    groups: [
      { name: "Button outside the form", count: 1 },
      { name: "Security headers", count: 1 },
      { name: "Cookie flags", count: 1 },
      { name: "CORS", count: 1 },
      { name: "Public source maps", count: 1 },
    ],
  },
  {
    label: "FERNWAY · W01–W10",
    count: 10,
    title: "Bugs AI builders ship",
    body: "The usual defects, planted in an app built like the ones Lovable, Bolt and v0 generate: custom selects, toasts, dialogs and a dashboard behind a sign-in. Each is caught by one of the V0 and V1 checks.",
    groups: [
      { name: "Accessibility", count: 4 },
      { name: "Broken features", count: 3 },
      { name: "Leaks and security", count: 3 },
    ],
  },
  {
    label: `FERNWAY · V01–V05 · ${site.preview.toUpperCase()}`,
    count: 5,
    title: "Access bugs",
    body: "Caught by the checks of the V2 preview, with Run Hound signed in as one Fernway account (A) and a second one (B): who can read whose data, extra fields the server stores, and pages that break when opened directly.",
    groups: [
      { name: "Another account's data", count: 2 },
      { name: "Data without signing in", count: 1 },
      { name: "Mass assignment", count: 1 },
      { name: "Deep links", count: 1 },
    ],
  },
];

// Two screenshots side by side from lg: half the 1136 px container, full width below.
const halfShotSizes =
  "(min-width: 1280px) 552px, (min-width: 1024px) calc(50vw - 88px), (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)";

const kennelCommands = `# once: git clone, pnpm install, playwright install chromium, pnpm --filter kennel build (see the docs)

# terminal 1: Kennel with every bug on
KENNEL_BUGS=all PORT=5310 ANALYTICS_PORT=5311 pnpm kennel

# terminal 2: the web UI, then open http://localhost:4310
pnpm serve --port 4310`;

const dockerCommands = `curl -fsSLO ${site.composeFileUrl}
mkdir -p runs
docker compose -f run-hound.compose.yml up   # or: podman compose -f run-hound.compose.yml up

# then open http://localhost:4000 and enter http://kennel:3000/book
# or Fernway, with its planted bugs: http://fernway-bugs:4110/`;

export default function DemoPage() {
  return (
    <>
      <PageHeader
        eyebrow="DEMO · REAL OUTPUT"
        title={
          <>
            Proof, <span className="text-accent">not adjectives.</span>
          </>
        }
        lede={
          <>
            Everything on this page was captured from a real run of Run Hound against Kennel, our deliberately broken
            pet-sitting booking app, with all 24 of its V0 and V1 bugs switched on, and AI off. The keys and email
            addresses are fake test values.
          </>
        }
      />

      <Section
        id="features"
        title="One click, two bookings"
        intro="The double-submit check double-clicks “Book” and counts the save requests that reach the server. Kennel accepted both, so the report shows the recording and the two requests, 0.2 ms apart, with two different record ids."
        className="border-t border-line-soft"
      >
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <EvidenceFigure
            shot={evidence.doubleSubmitRecording}
            label="DOUBLE-SUBMIT · RECORDING"
            caption="The recording from the report: form filled, “Book” double-clicked, two identical rows saved."
          />
          <EvidenceFigure
            shot={evidence.doubleSubmitCard}
            label="DOUBLE-SUBMIT · REQUEST CARD"
            caption="The data behind it: both POST /api/bookings requests and the server's 201 answers."
          />
        </div>
      </Section>

      <Section
        id="silent-failure"
        className="bg-band"
        title="A save that fails in silence"
        intro="The silent-failure check answers the save with a simulated 500 (the request never reaches your server) and waits for an error the user can see and a screen reader can hear."
      >
        <div className="grid items-center gap-8 lg:grid-cols-[1.4fr_1fr]">
          <EvidenceFigure
            shot={evidence.silentFailureRecording}
            sizes="(min-width: 1280px) 660px, (min-width: 1024px) 58vw, (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)"
            label="SILENT-FAILURE · RECORDING"
            caption="5.1 s after the failed save, the page still shows no error. The facts panel records the injected status and that all 9 values were kept."
          />
          <div className="flex flex-col gap-4">
            <Eyebrow>WHY IT MATTERS</Eyebrow>
            <p className="text-lg leading-relaxed text-muted">
              People think they booked when they didn&apos;t, and you never hear about it. The finding says what it
              means, why it matters and what to ask your AI to fix, next to this evidence.
            </p>
          </div>
        </div>
      </Section>

      <Section
        id="accessibility"
        title="Focus you can't see, measured"
        intro="The focus-visible check tabs through the page and compares each control focused and at rest. On Kennel, “Pet name” changes 0 of 37,296 pixels around it: no outline, shadow, border or background change."
      >
        <EvidenceFigure
          shot={evidence.noVisibleFocus}
          sizes="(min-width: 1280px) 1136px, (min-width: 1024px) calc(100vw - 144px), (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)"
          label="FOCUS-VISIBLE · ANNOTATED FRAME"
          caption="An annotated frame: the element boxed, and the measured facts beside it. Keyboard users can't tell where they are."
        />
      </Section>

      <Section
        id="security"
        className="bg-band"
        title="Leaks, with the line that proves them"
        intro="Security checks read every script the page loads and watch every request the form triggers."
      >
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <EvidenceFigure
            shot={evidence.secretKey}
            label="BUNDLE-SECRETS · SCRIPT CARD"
            caption="A secret key in the page's JavaScript, with file, line and column. The key is redacted in the report."
          />
          <EvidenceFigure
            shot={evidence.emailLeak}
            label="PII-LEAK · REQUEST CARD"
            caption="The customer's email in a third-party analytics URL, in plain text, marked."
          />
        </div>
      </Section>

      <Section
        id="whole-page"
        title="The page as a whole"
        intro="Since V1, Run Hound also looks past the form, at how the server answers and who may read it. These checks run once for the whole page."
      >
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <EvidenceFigure
            shot={evidence.corsNullOrigin}
            label="CORS · REQUEST CARD"
            caption="The page's own reads, repeated from a sandboxed frame as any website could: Kennel's API lets two of them be read with the visitor's cookies. The page itself stays unreadable."
          />
          <EvidenceFigure
            shot={evidence.missingHeaders}
            label="SECURITY-HEADERS · HEADER CARD"
            caption="The page's response headers, with the session cookie's value hidden, and the three protections it never asks the browser for."
          />
        </div>
      </Section>

      <Section
        id="try"
        className="bg-band"
        title="Run the same demo yourself"
        intro="Kennel ships with Run Hound. The quickest way needs no clone: download one compose file and start it with Docker or Podman, which also starts Fernway and the sample apps; from source it takes two terminals. Then try the clean Kennel: it should give zero confirmed findings."
      >
        <div className="grid items-start gap-8 lg:grid-cols-[1.3fr_1fr] lg:gap-12">
          <div className="flex min-w-0 flex-col gap-5">
            <CodeBlock label="Docker or Podman">{dockerCommands}</CodeBlock>
            <CodeBlock label="From source, in a clone">{kennelCommands}</CodeBlock>
          </div>
          <div className="flex flex-col gap-4">
            <p className="leading-relaxed text-muted">
              With Docker, the clean Kennel is <code className="font-mono text-fg">http://kennel-clean:3000/book</code>
              ; from source, enter <code className="font-mono text-fg">http://localhost:5310/book</code>, and restart
              Kennel with <code className="font-mono text-fg">KENNEL_BUGS=none</code> for the clean run. Approve the
              plan and watch the live view. The{" "}
              <Link href="/docs#quick-start" className="text-accent underline underline-offset-4 hover:text-accent-strong">
                docs
              </Link>{" "}
              have both paths step by step.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">
              <ButtonLink href={site.testingGuide}>
                {site.cta}
                <ArrowIcon />
              </ButtonLink>
              <ButtonLink href="/docs#kennel" variant="secondary">
                Read the Kennel guide
              </ButtonLink>
            </div>
            <p className="text-sm text-dim">
              Open source: clone it from{" "}
              <a href={site.github} className="text-muted underline underline-offset-4 hover:text-accent">
                GitHub
              </a>
              . Want to see what AI adds? Turn it on in Settings → AI (
              <Link href="/docs#ai" className="text-muted underline underline-offset-4 hover:text-accent">
                AI setup
              </Link>
              ).
            </p>
          </div>
        </div>
      </Section>

      <Section
        id="fernway"
        className="border-t border-line-soft"
        title="Fernway: an app built the way AI builders build them"
        intro="Kennel is one booking form. Fernway asks a different question: does Run Hound work on the kind of app people generate today? It is a small project-planning app for studios, built with Vite, React 19, Tailwind, Radix and shadcn/ui-style components, sonner toasts and react-hook-form with zod, in light and dark mode."
      >
        <div className="grid items-start gap-8 lg:grid-cols-2 lg:gap-12">
          <ul className="flex list-disc flex-col gap-3 pl-5 leading-relaxed text-muted marker:text-dim">
            <li>
              <strong className="text-fg">Its pages:</strong> a landing page with a waitlist form and a “Book a demo”
              dialog, sign-up and sign-in, a three-step onboarding wizard, and a dashboard and settings behind a real
              sign-in, with two accounts that each have a workspace of their own.
            </li>
            <li>
              <strong className="text-fg">Two modes:</strong> <code className="font-mono text-fg">fernway</code> is
              built well on purpose, so any confirmed finding on it is a false positive;{" "}
              <code className="font-mono text-fg">fernway-bugs</code> has 15 planted bugs, each caught by one check.
            </li>
            <li>
              <strong className="text-fg">The access bugs</strong> need a signed-in run: set up Fernway&apos;s two
              accounts as test accounts A and B (their details are in{" "}
              <a href={site.fernwayGuide} className="text-accent underline underline-offset-4 hover:text-accent-strong">
                Fernway&apos;s README
              </a>
              ) and plan <code className="font-mono text-fg">/app</code> signed in as account A.
            </li>
          </ul>
          <div className="flex flex-col gap-4 leading-relaxed text-muted">
            <p>
              Both start with the quick start above. In the Run Hound UI, enter{" "}
              <code className="font-mono text-fg">http://fernway-bugs:4110/</code> for the planted bugs, or{" "}
              <code className="font-mono text-fg">http://fernway:4110/</code> for the clean app. The other pages are{" "}
              <code className="font-mono text-fg">/signup</code>, <code className="font-mono text-fg">/login</code>,{" "}
              <code className="font-mono text-fg">/onboarding</code>, <code className="font-mono text-fg">/app</code>,{" "}
              <code className="font-mono text-fg">/app/settings</code> and{" "}
              <code className="font-mono text-fg">/app/help</code>. The help page is where one bug (V05) shows: with
              the bugs on, it answers 404 when opened directly, though its link in the sidebar works.
            </p>
            <p>
              <Link href="/docs#accounts" className="text-accent underline underline-offset-4 hover:text-accent-strong">
                Signed-in runs, step by step
              </Link>
            </p>
          </div>
        </div>
        <div className="grid items-start gap-8 lg:grid-cols-2">
          <figure className="flex min-w-0 flex-col gap-3">
            <Screenshot screen={aiBuiltScreens.fernway} sizes={halfShotSizes} />
            <figcaption className="text-sm leading-relaxed text-muted">
              Fernway&apos;s landing page, clean: a waitlist form with a Radix select and a “Book a demo” form in a
              dialog. Run Hound plans 40 scenarios on it, and on the clean app none of them finds an issue.
            </figcaption>
          </figure>
          <figure className="flex min-w-0 flex-col gap-3">
            <Screenshot screen={v2Screens.accessControl} sizes={halfShotSizes} />
            <figcaption className="text-sm leading-relaxed text-muted">
              V01, caught on <code className="font-mono text-fg">/app/settings</code> with every bug on: signed in as
              account A, Run Hound replayed A&apos;s profile request as account B and got A&apos;s test record back.
            </figcaption>
          </figure>
        </div>
      </Section>

      <Section
        title="What the test apps plant"
        className="bg-band"
        intro="Every bug sits behind its own toggle. Because we know exactly what's broken, we can measure what Run Hound finds, what it misses and what it makes up."
      >
        <div className="grid gap-5 md:grid-cols-2">
          {planted.map((set) => (
            <Card key={set.label} className="flex flex-col gap-5">
              <div className="flex items-baseline justify-between gap-4">
                <Eyebrow>{set.label}</Eyebrow>
                <p className="font-display text-4xl font-extrabold tracking-tight">
                  {set.count}
                  <span className="sr-only"> planted bugs</span>
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <h3 className="font-display text-xl font-bold">{set.title}</h3>
                <p className="leading-relaxed text-muted">{set.body}</p>
              </div>
              <ul className="flex flex-col divide-y divide-line-soft border-t border-line-soft">
                {set.groups.map((group) => (
                  <li key={group.name} className="flex items-center justify-between gap-4 py-2.5">
                    <span>{group.name}</span>
                    <span className="font-mono text-sm text-muted">{group.count}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
        <p className="max-w-3xl leading-relaxed text-muted">
          In clean mode every bug is fixed properly, not removed, so the same flows run and any finding counts as a
          false positive. Seven more bugs (row-level security, server-side auth, file storage and payments) are planned for a
          Supabase-backed Kennel. An in-browser replay of a
          recorded run is planned too, so you can see all this without installing anything.
        </p>
      </Section>
    </>
  );
}
