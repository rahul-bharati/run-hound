import type { Metadata } from "next";
import { ButtonLink } from "@/components/button-link";
import { FindingDetail } from "@/components/finding";
import { Card, Container, Eyebrow, PageHeader, Section } from "@/components/layout";
import { ProductWindow } from "@/components/product-window";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Demo",
  description:
    "An interactive replay of a real Run Hound run against Kennel, a deliberately broken booking app, is coming. Preview the run window and sample findings.",
};

const replaySteps = [
  { title: "Approve the plan", body: "Review the scenarios the agent drafted, exactly as you would in the local UI." },
  { title: "Watch the steps", body: "Follow each browser action with its screenshot, console and network log." },
  { title: "Browse the findings", body: "Open each defect with its plain-language explanation and evidence." },
  { title: "Copy the spec", body: "Grab the exported Playwright test and see how it reproduces the failure." },
  {
    title: "Flip Broken / Clean",
    body: "Switch Kennel to its clean mode and replay the same run: zero findings, because nothing was planted.",
  },
];

const samples = [
  {
    category: "Leak",
    severity: "critical" as const,
    title: "Admin key in the browser",
    meaning:
      "The key that gives full access to your database, bypassing every access rule, is included in the JavaScript that every visitor downloads.",
    impact: "Anyone who opens your site can read, change or delete any user's data.",
    fix: "Remove the admin key from all frontend code, rotate it now, and only use it on the server.",
    evidence: "evidence: bundle file and line (key redacted) · bundle-secret.spec.ts",
  },
  {
    category: "Broken feature",
    severity: "high" as const,
    title: "One click, two bookings",
    meaning: "The Book button stays active while the booking is being sent, so a quick double click creates two bookings.",
    impact: "Customers get scheduled or charged twice and have to contact you to undo it.",
    fix: "Disable the Book button while the request is pending, and make the booking endpoint ignore duplicate submissions.",
    evidence: "evidence: 2 screenshots · 2 booking requests · double-submit.spec.ts",
  },
  {
    category: "Accessibility",
    severity: "high" as const,
    title: "Pet-type picker can't be reached by keyboard",
    meaning:
      "The Dog, Cat and Other options are plain clickable boxes, not buttons or radio inputs, so pressing Tab skips right past them.",
    impact: "People who use a keyboard or screen reader can't finish a booking at all.",
    fix: "Replace the clickable boxes with a labelled radio group so they can be focused and announced.",
    evidence: "evidence: keyboard walkthrough screenshots · axe rule result · keyboard-only.spec.ts",
  },
];

const planted = [
  {
    version: "V0",
    count: 19,
    title: "Booking form bugs",
    body: "Defects in a single form on localhost. V0 is done when Run Hound finds these and reports nothing in clean mode.",
    groups: [
      { name: "Broken features", count: 5 },
      { name: "Validation", count: 1 },
      { name: "Accessibility", count: 9 },
      { name: "Leaks and secrets", count: 4 },
    ],
  },
  {
    version: "V2",
    count: 7,
    title: "Two-account bugs",
    body: "Access problems that only show up when two owned test accounts try to see each other's data.",
    groups: [
      { name: "Data access", count: 4 },
      { name: "Auth", count: 2 },
      { name: "Payments", count: 1 },
    ],
  },
];

export default function DemoPage() {
  return (
    <>
      <PageHeader
        eyebrow="DEMO"
        title="The interactive replay is coming."
        lede={
          <>
            Run Hound is in early development, so there is no live demo yet. Once V0 works, this page will host a
            replay of a real recorded run against Kennel, a pet-sitting booking app we broke on purpose.
          </>
        }
      />

      <Section
        title="What the replay will let you do"
        intro="It replays a recorded run, not a live scan, so it costs nothing per visit and never touches anyone's site."
        className="pt-4 sm:pt-6"
      >
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {replaySteps.map((step, index) => (
            <li key={step.title}>
              <div className="flex h-full flex-col gap-2 rounded-2xl border border-line bg-surface p-5">
                <span className="font-mono text-xs tracking-widest text-amber">{String(index + 1).padStart(2, "0")}</span>
                <h3 className="font-display text-lg font-bold leading-snug">{step.title}</h3>
                <p className="text-[15px] leading-relaxed text-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <section aria-labelledby="preview-heading" className="py-6 sm:py-10">
        <Container className="flex flex-col gap-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="preview-heading" className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
              A look at the run window
            </h2>
            <p className="font-mono text-xs tracking-widest text-dim">PREVIEW · SAMPLE DATA</p>
          </div>
          <ProductWindow />
        </Container>
      </section>

      <Section
        title="Sample findings"
        intro="How findings will read in the replay. These are written from bugs planted in Kennel; they are samples, not results from a finished run."
      >
        <ul className="flex flex-col gap-5">
          {samples.map((sample) => (
            <li key={sample.title} className="flex flex-col gap-2">
              <p className="font-mono text-xs tracking-widest text-dim">SAMPLE</p>
              <FindingDetail {...sample} />
            </li>
          ))}
        </ul>
      </Section>

      <Section
        className="bg-band"
        title="What Kennel plants"
        intro="Kennel runs on a local database with every bug behind its own toggle. We know exactly what's broken, so we can measure what Run Hound finds, what it misses and what it makes up."
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
          false positive. The target there is zero.
        </p>
      </Section>

      <Section>
        <div className="flex flex-col items-start gap-6 rounded-2xl border border-line bg-surface p-8 sm:p-12">
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Follow along</h2>
          <p className="max-w-2xl text-lg leading-relaxed text-muted">
            The replay ships once V0 finds Kennel&apos;s form bugs and reports nothing in clean mode. Watch the
            repository to see it happen.
          </p>
          <ButtonLink href={site.github}>
            Follow progress on GitHub
          </ButtonLink>
        </div>
      </Section>
    </>
  );
}
