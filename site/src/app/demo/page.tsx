import type { Metadata } from "next";
import Link from "next/link";
import { ArrowIcon, ButtonLink } from "@/components/button-link";
import { EvidenceFigure } from "@/components/demo/evidence-figure";
import { CodeBlock } from "@/components/docs/code-block";
import { Card, Eyebrow, PageHeader, Section } from "@/components/layout";
import { site } from "@/lib/site";
import doubleSubmitGif from "@/components/demo/media/double-submit-recording.gif";
import doubleSubmitStill from "@/components/demo/media/double-submit-recording-still.webp";
import doubleSubmitCard from "@/components/demo/media/double-submit-two-requests.webp";
import emailCard from "@/components/demo/media/email-to-third-party.webp";
import focusFrame from "@/components/demo/media/no-visible-focus.webp";
import secretCard from "@/components/demo/media/secret-key-in-bundle.webp";
import silentGif from "@/components/demo/media/silent-failure-recording.gif";
import silentStill from "@/components/demo/media/silent-failure-recording-still.webp";

export const metadata: Metadata = {
  title: "Demo",
  description:
    "Real evidence from Run Hound 0.1.0 run against Kennel, a deliberately broken booking form: a double submit, a silent failure, missing focus, a secret key in the bundle and an email sent to a third party.",
};

const planted = [
  {
    version: "V0",
    count: 19,
    title: "Booking form bugs",
    body: "Defects in a single form on localhost, the ones V0 is scored against. In clean mode the target is zero confirmed findings.",
    groups: [
      { name: "Broken features", count: 5 },
      { name: "Validation", count: 1 },
      { name: "Accessibility", count: 9 },
      { name: "Leaks and secrets", count: 4 },
    ],
  },
  {
    version: "V2 · PLANNED",
    count: 7,
    title: "Two-account bugs",
    body: "Access problems that only show up when two owned test accounts try to see each other's data. Not tested by V0.",
    groups: [
      { name: "Data access", count: 4 },
      { name: "Auth", count: 2 },
      { name: "Payments", count: 1 },
    ],
  },
];

const kennelCommands = `# terminal 1: Kennel with every bug on
KENNEL_BUGS=all PORT=5310 ANALYTICS_PORT=5311 pnpm kennel

# terminal 2: the web UI, then open http://localhost:4310
pnpm serve --port 4310`;

export default function DemoPage() {
  return (
    <>
      <PageHeader
        eyebrow="DEMO · REAL OUTPUT FROM V0 0.1.0"
        title={
          <>
            Proof, <span className="text-accent">not adjectives.</span>
          </>
        }
        lede={
          <>
            Everything on this page was captured from a real run of Run Hound {site.version} against Kennel, our
            deliberately broken pet-sitting booking form, with all 19 planted bugs switched on. The keys and email
            addresses are fake test values.
          </>
        }
      />

      <Section
        id="features"
        title="One click, two bookings"
        intro="The double-submit check double-clicks “Book” and counts the save requests that reach the server. Kennel accepted both, so the report shows the recording and the two requests, 0.4 ms apart, with two different record ids."
        className="pt-4 sm:pt-6"
      >
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <EvidenceFigure
            src={doubleSubmitGif}
            still={doubleSubmitStill}
            alt="Recording of the Kennel booking form: the form is filled, Book is double-clicked, and two identical bookings appear, marked Saved copy 1 and Saved copy 2."
            label="DOUBLE-SUBMIT · RECORDING"
            caption="The recording from the report: form filled, “Book” double-clicked, two identical rows saved."
          />
          <EvidenceFigure
            src={doubleSubmitCard}
            alt="Request card: POST /api/bookings sent 2 times by one double click, at +23.7 ms and +24.1 ms, each answered 201 with a different record id."
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
            src={silentGif}
            still={silentStill}
            alt="Recording of the Kennel booking form after a failed save: the Book button keeps spinning and, 5.1 seconds later, no error message has appeared."
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
        intro="The focus-visible check tabs through the page and compares each control focused and at rest. On Kennel, “Pet name” changes 0 of 31,552 pixels around it: no outline, shadow, border or background change."
      >
        <EvidenceFigure
          src={focusFrame}
          alt="Annotated screenshot of the Kennel form with Pet name focused and boxed in red, labelled No visible focus, beside a facts panel listing identical outline, shadow, border and background values at rest and focused."
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
            src={secretCard}
            alt="Script card: an AI provider secret key found in /config/ai-client.js at line 6, column 12, shown redacted."
            label="BUNDLE-SECRETS · SCRIPT CARD"
            caption="A secret key in the page's JavaScript, with file, line and column. The key is redacted in the report."
          />
          <EvidenceFigure
            src={emailCard}
            alt="Request card: a GET request to a third-party analytics origin carrying the test email address as plain text in the query string."
            label="PII-LEAK · REQUEST CARD"
            caption="The customer's email in a third-party analytics URL, in plain text, marked."
          />
        </div>
      </Section>

      <Section
        id="try"
        title="Run the same demo yourself"
        intro="Kennel ships in the repository. With the local install, two terminals are enough. Then restart Kennel with KENNEL_BUGS=none: a clean Kennel should give zero confirmed findings."
      >
        <div className="grid items-start gap-8 lg:grid-cols-[1.3fr_1fr]">
          <CodeBlock label="From the repository root">{kennelCommands}</CodeBlock>
          <div className="flex flex-col gap-4">
            <p className="leading-relaxed text-muted">
              Enter <code className="font-mono text-fg">http://localhost:5310/book</code>, approve the plan and watch
              the live view. A run takes about a minute. Docker works too; the{" "}
              <Link href="/docs#kennel" className="text-accent underline underline-offset-4 hover:text-accent-strong">
                docs
              </Link>{" "}
              have both paths.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">
              <ButtonLink href={site.testingGuide}>
                Try V0 Locally
                <ArrowIcon />
              </ButtonLink>
              <ButtonLink href="/docs#kennel" variant="secondary">
                Read the Kennel guide
              </ButtonLink>
            </div>
            <p className="text-sm text-dim">
              Invite-only preview:{" "}
              <a
                href={`mailto:${site.contactEmail}?subject=Run%20Hound%20V0%20access`}
                className="text-muted underline underline-offset-4 hover:text-accent"
              >
                ask for access
              </a>
              .
            </p>
          </div>
        </div>
      </Section>

      <Section
        className="bg-band"
        title="What Kennel plants"
        intro="Every bug sits behind its own toggle. Because we know exactly what's broken, we can measure what Run Hound finds, what it misses and what it makes up."
      >
        <div className="grid gap-5 md:grid-cols-2">
          {planted.map((set) => (
            <Card key={set.version} className="flex flex-col gap-5">
              <div className="flex items-baseline justify-between gap-4">
                <Eyebrow>{set.version}</Eyebrow>
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
          false positive. An in-browser replay of a recorded run is planned, so you can see all this without
          installing anything.
        </p>
      </Section>
    </>
  );
}
