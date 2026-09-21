import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/button-link";
import { AdvisoryBadge, CheckCard, VersionBadge } from "@/components/checks/check-card";
import { categories, notVisible, v0Checklist, versionMeaning, type Version } from "@/components/checks/data";
import { Container, Eyebrow, PageHeader, Section } from "@/components/layout";
import { SeverityLabel } from "@/components/finding";

export const metadata: Metadata = {
  title: "Checks",
  description:
    "The Run Hound check catalog: broken features, validation, accessibility, access and auth, leaks and blind spots for non-technical builders, with typical severity and the roadmap version each check lands in.",
};

const versions = Object.keys(versionMeaning) as Version[];

export default function ChecksPage() {
  const total = categories.reduce((sum, c) => sum + c.checks.length, 0);

  return (
    <>
      <PageHeader
        eyebrow="CHECKS"
        title="Everything it hunts for"
        lede="The gaps AI-built apps tend to ship with, grouped the way you'd notice them. Each check lists its typical severity and the roadmap version it is planned for. Run Hound is in early development, so this is a plan, not a feature list."
      >
        <nav aria-label="Check categories">
          <ul className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <li key={c.id}>
                <Link
                  href={`#${c.id}`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-4 text-sm text-muted transition-colors hover:border-amber hover:text-amber"
                >
                  {c.title}
                  <span className="font-mono text-xs text-dim">{c.checks.length}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </PageHeader>

      <Container>
        <div className="mb-4 grid gap-6 rounded-2xl border border-line bg-surface p-6 sm:p-7 lg:grid-cols-[1fr_1.4fr]">
          <div className="flex flex-col gap-3">
            <p className="font-mono text-xs tracking-widest text-dim">HOW TO READ A CHECK</p>
            <p className="text-sm leading-relaxed text-muted">
              {total} checks across {categories.length} categories. Severity is the typical level when the check fails;
              a real report grades each finding on its evidence. The signal is what Run Hound looks at, never a recipe.
            </p>
            <ul aria-label="Severity levels, most to least severe" className="flex flex-wrap gap-x-5 gap-y-2">
              {(["critical", "high", "medium", "low"] as const).map((s) => (
                <li key={s}>
                  <SeverityLabel severity={s} />
                </li>
              ))}
            </ul>
          </div>
          <dl className="grid gap-3 sm:grid-cols-2">
            {versions.map((v) => (
              <div key={v} className="flex items-center gap-3">
                <dt>
                  <VersionBadge version={v} />
                </dt>
                <dd className="text-sm text-muted">{versionMeaning[v]}</dd>
              </div>
            ))}
            <div className="flex items-center gap-3">
              <dt>
                <AdvisoryBadge />
              </dt>
              <dd className="text-sm text-muted">Relies on model judgement</dd>
            </div>
          </dl>
        </div>
      </Container>

      <Section
        id="v0"
        className="bg-band"
        title="V0 ships first"
        intro="V0 tests a single form on localhost. These picks are cheap, deterministic and high-signal. The model plans scenarios and writes explanations, but it never decides pass or fail."
      >
        <div className="rounded-2xl border border-amber/40 bg-surface p-6 sm:p-7">
          <Eyebrow className="mb-5">V0 CHECKLIST, IN ORDER</Eyebrow>
          <ol className="grid gap-x-10 gap-y-4 md:grid-cols-2">
            {v0Checklist.map((item, i) => (
              <li key={item.name} className="flex gap-4">
                <span aria-hidden="true" className="w-6 shrink-0 pt-0.5 font-mono text-sm text-amber">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="flex flex-col gap-1">
                  <p className="font-semibold text-fg">
                    {item.name}
                    {item.stretch ? (
                      <span className="ml-2 font-mono text-[11px] tracking-widest text-dim">STRETCH</span>
                    ) : null}
                  </p>
                  <p className="text-sm leading-relaxed text-muted">{item.line}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-6 border-t border-line-soft pt-5 text-sm leading-relaxed text-muted">
            Every finding carries evidence (a screenshot or the request and response) and a replayable exported test.
            Destructive actions are off by default.
          </p>
        </div>
      </Section>

      {categories.map((category, i) => (
        <section
          key={category.id}
          id={category.id}
          aria-labelledby={`${category.id}-title`}
          className={`scroll-mt-24 py-14 sm:py-20 ${i % 2 === 1 ? "bg-band" : ""}`}
        >
          <Container className="flex flex-col gap-10">
            <div className="flex max-w-3xl flex-col gap-4">
              <Eyebrow>{category.eyebrow}</Eyebrow>
              <h2 id={`${category.id}-title`} className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
                {category.title}
              </h2>
              <p className="text-lg leading-relaxed text-muted">{category.intro}</p>
            </div>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {category.checks.map((check) => (
                <CheckCard key={check.name} check={check} />
              ))}
            </ul>
          </Container>
        </section>
      ))}

      <Section
        id="advisory"
        title="Advisory checks are labelled"
        intro="A few checks depend on a model's judgement rather than a deterministic rule: alt-text quality, generic link and button labels, and placeholder or demo data. They arrive from V1 onward, and reports mark them advisory so they are never mistaken for confirmed defects."
      >
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
          <AdvisoryBadge />
          <span>Worth a look, not proof of a bug.</span>
        </div>
      </Section>

      <Section
        id="not-visible"
        className="bg-band"
        title="Not visible from outside"
        intro="Some holes can't be seen from a browser. Every report lists them as a checklist, so a clean report is never mistaken for a clean app."
      >
        <ul className="grid gap-4 sm:grid-cols-2">
          {notVisible.map((item) => (
            <li key={item.name} className="flex gap-4 rounded-2xl border border-line bg-surface p-5 sm:p-6">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="mt-0.5 size-5 shrink-0 text-dim"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="4" y="4" width="16" height="16" rx="3" />
              </svg>
              <div className="flex flex-col gap-1">
                <h3 className="font-semibold text-fg">{item.name}</h3>
                <p className="text-sm leading-relaxed text-muted">{item.line}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="max-w-3xl text-sm leading-relaxed text-muted">
          Reports also mark areas the browser can&apos;t inspect, such as canvas content, closed shadow DOM and
          cross-origin iframes, as unscanned.
        </p>
      </Section>

      <Section title="See how a check becomes a finding">
        <div className="flex flex-col gap-3 sm:flex-row">
          <ButtonLink href="/how-it-works">How it works</ButtonLink>
          <ButtonLink href="/demo" variant="secondary" comingSoon>
            See a sample report
          </ButtonLink>
        </div>
      </Section>
    </>
  );
}
