import type { Metadata } from "next";
import { EyeOff } from "lucide-react";
import Link from "next/link";
import { ArrowIcon, ButtonLink } from "@/components/button-link";
import { Icon } from "@/components/icon";
import { AdvisoryBadge, CheckCard, VersionBadge } from "@/components/checks/check-card";
import { categories, notVisible, v0Groups, versionMeaning, type Version } from "@/components/checks/data";
import { Container, Eyebrow, PageHeader, Section } from "@/components/layout";
import { site } from "@/lib/site";
import { SeverityLabel } from "@/components/finding";

export const metadata: Metadata = {
  title: "Checks",
  description:
    "The 15 checks in Run Hound V0, grouped as Accessibility, Features and Security, and the full catalog of gaps it is planned to hunt for, with typical severity and roadmap version.",
};

const versions = Object.keys(versionMeaning) as Version[];

export default function ChecksPage() {
  const total = categories.reduce((sum, c) => sum + c.checks.length, 0);

  return (
    <>
      <PageHeader
        eyebrow="CHECKS"
        title={
          <>
            Everything <span className="text-accent">it hunts for.</span>
          </>
        }
        lede="What V0 checks today, then the full catalog: the gaps AI-built apps tend to ship with, grouped the way you'd notice them, with typical severity and the roadmap version each check is in or planned for."
      >
        <nav aria-label="Check categories">
          <ul className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <li key={c.id}>
                <Link
                  href={`#${c.id}`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-4 text-sm text-muted transition-colors hover:border-accent hover:text-accent"
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
              <dd className="text-sm text-muted">Relies on judgement, never a confirmed defect</dd>
            </div>
          </dl>
        </div>
      </Container>

      <Section
        id="v0"
        className="bg-band"
        title={
          <>
            In V0 today: <span className="text-accent">15 checks, 3 groups.</span>
          </>
        }
        intro="V0 tests the main form on one page of your local app. On a typical form it plans these 15 checks, and the plan, the run and the report all follow the same three groups. Every pass and fail comes from a real check in a real browser, with evidence."
      >
        <div className="grid gap-5 lg:grid-cols-3">
          {v0Groups.map((g) => (
            <section
              key={g.group}
              aria-labelledby={`v0-${g.group}`}
              className="flex flex-col gap-5 rounded-2xl border border-line bg-surface p-6 sm:p-7"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h3 id={`v0-${g.group}`} className="font-display text-2xl font-bold tracking-tight">
                  {g.group}
                </h3>
                <span className="font-display text-3xl font-extrabold text-accent">
                  {g.checks.length}
                  <span className="sr-only"> checks</span>
                </span>
              </div>
              <ul className="flex flex-col gap-4 border-t border-line-soft pt-5">
                {g.checks.map((c) => (
                  <li key={c.id} className="flex flex-col gap-1">
                    <p className="font-semibold text-fg">{c.name}</p>
                    <p className="text-sm leading-relaxed text-muted">{c.line}</p>
                    <p className="font-mono text-xs text-dim">{c.id}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="max-w-3xl text-sm leading-relaxed text-muted">
          Checks that don&apos;t apply to your form (no password field, no JSON save request) are skipped with a plain
          reason. Every finding carries evidence and an exported Playwright test, and destructive scenarios are off by
          default.{" "}
          <Link href="/docs#checks" className="text-accent underline underline-offset-4 hover:text-accent-strong">
            How each check works, and the test records it creates
          </Link>
          .
        </p>
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
        intro="Some findings rely on judgement rather than a pass-or-fail check. In V0 that is a few small hints, such as a missing autocomplete attribute. Planned checks like alt-text quality, generic link and button labels, and placeholder or demo data arrive from V1 onward. Reports mark all of them advisory, and advisory findings never fail a run."
      >
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
          <AdvisoryBadge />
          <span>Worth a look, not proof of a bug.</span>
        </div>
      </Section>

      <Section
        id="not-visible"
        className="bg-band"
        title="What a browser can't see"
        intro="Some holes can't be seen from a browser. Every report lists them, so a clean report is never mistaken for a clean app."
      >
        <ul className="grid gap-4 sm:grid-cols-2">
          {notVisible.map((item) => (
            <li key={item.name} className="flex gap-4 rounded-2xl border border-line bg-surface p-5 sm:p-6">
              <Icon icon={EyeOff} size={20} className="mt-0.5 text-dim" />
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
          <ButtonLink href={site.testingGuide}>
            Try V0 Locally
            <ArrowIcon />
          </ButtonLink>
          <ButtonLink href="/demo" variant="secondary">
            See real evidence
          </ButtonLink>
          <ButtonLink href="/how-it-works" variant="ghost">
            How it works
          </ButtonLink>
        </div>
      </Section>
    </>
  );
}
