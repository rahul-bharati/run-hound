import type { Metadata } from "next";
import { EyeOff, Info, Sparkles } from "lucide-react";
import Link from "next/link";
import { ArrowIcon, ButtonLink } from "@/components/button-link";
import { Icon, groupIcons } from "@/components/icon";
import { AdvisoryBadge, CheckCard, VersionBadge, isShipped } from "@/components/checks/check-card";
import { aiFlowCheck, categories, notVisible, previewGroups, versionMeaning, type Version } from "@/components/checks/data";
import { Container, Eyebrow, NewTag, PageHeader, Section } from "@/components/layout";
import { site } from "@/lib/site";
import { SeverityLabel } from "@/components/finding";

const previewTotal = previewGroups.reduce((sum, g) => sum + g.checks.length, 0);
const newTotal = previewGroups.reduce((sum, g) => sum + g.checks.filter((c) => c.since === "V1").length, 0);

export const metadata: Metadata = {
  title: "Checks",
  description: `The ${previewTotal} built-in checks in Run Hound V1 (${site.version}), grouped as Accessibility, Features and Security, including ${newTotal} page-wide checks new in V1, plus the optional AI-suggested flows check, and the full catalog of gaps it is planned to hunt for, with typical severity and roadmap version.`,
};

const versions = Object.keys(versionMeaning) as Version[];

const linkClass = "text-accent underline underline-offset-4 hover:text-accent-strong";

export default function ChecksPage() {
  const total = categories.reduce((sum, c) => sum + c.checks.length, 0);
  const available = categories.reduce((sum, c) => sum + c.checks.filter(isShipped).length, 0);

  return (
    <>
      <PageHeader
        eyebrow="CHECKS"
        title={
          <>
            Everything <span className="text-accent">it hunts for.</span>
          </>
        }
        lede={`What ${site.release} checks today, then the full catalog: the gaps AI-built apps tend to ship with, grouped the way you'd notice them, with typical severity and the roadmap version each check is in or planned for.`}
      >
        <nav aria-label="Check categories">
          <ul className="flex flex-wrap gap-2">
            <li>
              <Link
                href="#preview"
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-accent/50 px-4 text-sm text-fg transition-colors hover:border-accent hover:text-accent"
              >
                In {site.release} today
                <span className="font-mono text-xs text-accent">{previewTotal}</span>
              </Link>
            </li>
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

      <Section
        id="preview"
        eyebrow={`${site.release} TODAY · ${site.version}`}
        className="border-t border-line-soft bg-band"
        title={
          <>
            In {site.release} today:{" "}
            <span className="text-accent">
              {previewTotal} built-in checks, {previewGroups.length} groups.
            </span>
          </>
        }
        intro={`${site.release} tests one page of your local app. It finds every form and interactive control on the page, plans the form checks for each form plus ${newTotal} page-wide checks new in ${site.release}, and the plan, the run and the report all follow the same three groups. With AI on, one optional check joins them: AI-suggested flows. Every pass and fail comes from a real check in a real browser, with evidence.`}
      >
        <div className="grid gap-5 lg:grid-cols-3">
          {previewGroups.map((g) => (
            <section
              key={g.group}
              aria-labelledby={`preview-${g.group}`}
              className="flex flex-col gap-5 rounded-2xl border border-line bg-surface p-6 sm:p-7"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h3
                  id={`preview-${g.group}`}
                  className="flex items-center gap-3 font-display text-2xl font-bold tracking-tight"
                >
                  <Icon icon={groupIcons[g.group.toLowerCase()]} size={24} className="text-accent" />
                  {g.group}
                </h3>
                <span className="font-display text-3xl font-extrabold text-accent">
                  {g.checks.length}
                  <span className="sr-only"> checks</span>
                </span>
              </div>
              <ul className="flex flex-col divide-y divide-line-soft border-t border-line-soft">
                {g.checks.map((c) => (
                  <li key={c.id} className="flex flex-col gap-1.5 py-4 last:pb-0">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                      <p className="font-semibold text-fg">{c.name}</p>
                      {c.since === "V1" ? <NewTag /> : null}
                    </div>
                    <p className="text-sm leading-relaxed text-muted">{c.line}</p>
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-dim">
                      <span>{c.id}</span>
                      {c.devServerAdvisory ? <span className="text-muted">advisory on a dev server</span> : null}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <section
          aria-labelledby="preview-ai-flow"
          className="flex flex-col gap-3 rounded-2xl border border-dashed border-line-strong bg-surface p-6 sm:p-7"
        >
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs tracking-widest text-dim">
            <span className="text-accent">ONLY WHEN AI IS ON</span>
            <span aria-hidden="true">·</span>
            <span>{aiFlowCheck.group.toUpperCase()} · NEW IN {site.version}</span>
          </p>
          <h3 id="preview-ai-flow" className="flex items-center gap-3 font-display text-2xl font-bold tracking-tight">
            <Icon icon={Sparkles} size={24} className="text-accent" />
            {aiFlowCheck.name}
          </h3>
          <p className="max-w-3xl text-[15px] leading-relaxed text-muted">{aiFlowCheck.line}</p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-dim">
            <span>{aiFlowCheck.id}</span>
            <span className="text-muted">always advisory · not counted in the {previewTotal}</span>
          </p>
        </section>

        <div className="flex max-w-3xl gap-4 rounded-2xl border border-line bg-surface p-5 sm:p-6">
          <Icon icon={Info} size={20} className="mt-0.5 text-accent" />
          <div className="flex flex-col gap-2 text-[15px] leading-relaxed text-muted">
            <p className="font-semibold text-fg">Why some findings are advisory on a dev server</p>
            <p>
              Dev servers such as <code className="font-mono text-fg">next dev</code> or{" "}
              <code className="font-mono text-fg">vite</code> don&apos;t send the headers, cookie settings or CORS rules
              your production build will. When the target looks like a dev server, header, cookie and CORS findings are
              marked advisory and never fail the run. For confirmed results, run them against a production build
              served locally.
            </p>
          </div>
        </div>

        <p className="max-w-3xl text-[15px] leading-relaxed text-muted">
          Checks that don&apos;t apply to your page (no form, no password field, no JSON save request, no API) are
          skipped with a plain reason. Every finding carries evidence and an exported Playwright test, and destructive
          scenarios are off by default.{" "}
          <Link href="/docs#checks" className={linkClass}>
            How each check works, and the test records it creates
          </Link>
          .
        </p>
      </Section>

      <Section
        id="catalog"
        eyebrow="THE FULL CATALOG"
        title="How to read the catalog"
        intro={`${total} checks across ${categories.length} categories, ${available} of them in ${site.release} today. Severity is the typical level when the check fails; a real report grades each finding on its evidence. The signal is what Run Hound looks at, never a recipe.`}
      >
        <div className="grid gap-8 rounded-2xl border border-line bg-surface p-6 sm:p-7 lg:grid-cols-[1fr_1.5fr] lg:gap-10">
          <div className="flex flex-col gap-4">
            <p className="font-mono text-xs tracking-widest text-dim">TYPICAL SEVERITY</p>
            <ul aria-label="Severity levels, most to least severe" className="flex flex-wrap gap-x-5 gap-y-2">
              {(["critical", "high", "medium", "low"] as const).map((s) => (
                <li key={s}>
                  <SeverityLabel severity={s} />
                </li>
              ))}
            </ul>
            <p className="mt-2 font-mono text-xs tracking-widest text-dim">BADGES</p>
            <dl className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <dt>
                  <VersionBadge version="V1" shipped />
                </dt>
                <dd className="text-sm text-muted">Lit: runs in {site.release} today</dd>
              </div>
              <div className="flex items-center gap-3">
                <dt>
                  <VersionBadge version="V2" />
                </dt>
                <dd className="text-sm text-muted">Plain: planned for that version</dd>
              </div>
              <div className="flex items-center gap-3">
                <dt>
                  <AdvisoryBadge />
                </dt>
                <dd className="text-sm text-muted">Relies on judgement, never a confirmed defect</dd>
              </div>
            </dl>
          </div>
          <div className="flex flex-col gap-4">
            <p className="font-mono text-xs tracking-widest text-dim">ROADMAP VERSIONS</p>
            <dl className="flex flex-col divide-y divide-line-soft border-y border-line-soft">
              {versions.map((v) => (
                <div key={v} className="flex items-baseline gap-4 py-2.5">
                  <dt className="w-8 shrink-0 font-mono text-sm text-fg">{v}</dt>
                  <dd className="text-sm leading-relaxed text-muted">{versionMeaning[v]}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </Section>

      {categories.map((category, i) => (
        <section
          key={category.id}
          id={category.id}
          aria-labelledby={`${category.id}-title`}
          className={`scroll-mt-20 py-16 sm:py-24 ${i % 2 === 0 ? "border-y border-line-soft bg-band" : ""}`}
        >
          <Container className="flex flex-col gap-10 sm:gap-12">
            <div className="flex max-w-3xl flex-col gap-4">
              <Eyebrow>{category.eyebrow}</Eyebrow>
              <h2
                id={`${category.id}-title`}
                className="text-balance font-display text-3xl font-bold leading-[1.1] tracking-tight sm:text-[2.5rem]"
              >
                {category.title}
              </h2>
              <p className="text-pretty text-lg leading-relaxed text-muted">{category.intro}</p>
              <p className="font-mono text-xs tracking-widest text-dim">
                {category.checks.filter(isShipped).length} OF {category.checks.length} IN {site.release} TODAY
              </p>
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
        className="border-t border-line-soft"
        title="Advisory findings are labelled"
        intro={`Some findings rely on judgement rather than a pass-or-fail check, such as a missing autocomplete attribute. In ${site.release}, header, cookie and CORS findings are also advisory when the target looks like a dev server, and so is every finding from an AI-suggested flow and every AI explanation. Planned checks like alt-text quality, generic link and button labels, and placeholder or demo data will be advisory too. Reports mark all of them, and advisory findings never fail a run.`}
      >
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
          <AdvisoryBadge />
          <span>Worth a look, not proof of a bug.</span>
        </div>
      </Section>

      <Section
        id="not-visible"
        className="border-y border-line-soft bg-band"
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
        <p className="max-w-3xl text-[15px] leading-relaxed text-muted">
          Reports also mark areas the browser can&apos;t inspect, such as canvas content, closed shadow DOM and
          cross-origin iframes, as unscanned.
        </p>
      </Section>

      <Section title="See how a check becomes a finding">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <ButtonLink href={site.testingGuide}>
            {site.cta}
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
