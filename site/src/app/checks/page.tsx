import { EyeOff, Info, KeyRound, Sparkles } from "lucide-react";
import Link from "next/link";
import { ArrowIcon, ButtonLink } from "@/components/button-link";
import { Icon, groupIcons } from "@/components/icon";
import { AdvisoryBadge, CheckCard, StageBadge, isShipped } from "@/components/checks/check-card";
import {
  aiFlowCheck,
  builtInChecks,
  categories,
  notVisible,
  previewGroups,
  stageMeaning,
  type Stage,
} from "@/components/checks/data";
import { ReleaseLine } from "@/components/docs/release";
import { JsonLd } from "@/components/json-ld";
import { Container, Eyebrow, NewTag, PageHeader, Section } from "@/components/layout";
import { pageMetadata, pageTitle } from "@/lib/metadata";
import { site } from "@/lib/site";
import { breadcrumbNode, graph, itemListNode, webPageId, webPageNode } from "@/lib/structured-data";
import { SeverityLabel } from "@/components/finding";

const previewTotal = builtInChecks.length;
const v2Total = builtInChecks.filter((c) => c.since === "V2").length;
const signedInTotal = builtInChecks.filter((c) => c.signedIn).length;

// The catalog's entries are gaps (what can go wrong), not checks: "checks" always means the built-in ones, as on the
// home page and in the docs. Every gap covered in this release is covered by a built-in check.
const gapTotal = categories.reduce((sum, c) => sum + c.checks.length, 0);
const gapsCovered = categories.reduce((sum, c) => sum + c.checks.filter(isShipped).length, 0);

const page = {
  path: "/checks/",
  title: "UI, accessibility and security checks",
  description: `${previewTotal} built-in accessibility, feature and security checks for AI-built apps, run in a real browser, plus the full catalog of gaps Run Hound hunts for.`,
};

export const metadata = pageMetadata(page);

// The page, where it sits, and the built-in checks as a list, from the same data the page renders. Each item links
// to the check's own anchor below, where its text is; the items carry no description, since the block ships twice
// (the script and the RSC payload).
const builtInList = itemListNode({
  path: page.path,
  name: `Built-in checks in ${site.name} ${site.version}`,
  items: builtInChecks.map((c) => ({ name: `${c.name} (${c.id})`, url: `${page.path}#${c.id}` })),
});

const jsonLd = graph(
  // Dated like the release the hero shows (ReleaseLine).
  webPageNode({
    path: page.path,
    name: pageTitle(page),
    description: page.description,
    type: "CollectionPage",
    dateModified: site.releasedIso,
  }),
  { "@id": webPageId(page.path), mainEntity: { "@id": builtInList["@id"] } },
  breadcrumbNode([
    { name: "Home", path: "/" },
    { name: "Checks", path: page.path },
  ]),
  builtInList,
);

const stages = Object.keys(stageMeaning) as Stage[];

const linkClass = "text-accent underline underline-offset-4 hover:text-accent-strong";

export default function ChecksPage() {
  return (
    <>
      <PageHeader
        eyebrow="CHECKS"
        title={
          <>
            Everything <span className="text-accent">it hunts for.</span>
          </>
        }
        lede={
          <>
            What Run Hound checks today, then the full catalog: the gaps{" "}
            <Link href="/ai-built-apps/" className={linkClass}>
              AI-built apps
            </Link>{" "}
            tend to ship with, grouped the way you&apos;d notice them, with typical severity and the roadmap stage
            for each.
          </>
        }
      >
        <ReleaseLine />
        <nav aria-label="Check categories">
          <ul className="flex flex-wrap gap-2">
            <li>
              <Link
                href="#preview"
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-accent/50 px-4 text-sm text-fg transition-colors hover:border-accent hover:text-accent"
              >
                In {site.version} today
                <span className="font-mono text-xs text-accent">
                  {previewTotal}
                  <span className="sr-only"> checks</span>
                </span>
              </Link>
            </li>
            {categories.map((c) => (
              <li key={c.id}>
                <Link
                  href={`#${c.id}`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-4 text-sm text-muted transition-colors hover:border-accent hover:text-accent"
                >
                  {c.title}
                  <span className="font-mono text-xs text-dim">
                    {c.checks.length}
                    <span className="sr-only"> gaps</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </PageHeader>

      <Section
        id="preview"
        eyebrow={`TODAY · RELEASE ${site.version}`}
        className="border-t border-line-soft bg-band"
        title={
          <>
            In {site.version} today:{" "}
            <span className="text-accent">
              {previewTotal} built-in checks, {previewGroups.length} groups.
            </span>
          </>
        }
        intro={`Run Hound tests one page of your local app. It finds the forms and controls on it, plans the form checks for each form plus the page-wide checks, and the plan, the run and the report all follow the same three groups. The ${v2Total} checks tagged V2 preview arrived in 0.4.0, 0.5.0 and 0.6.0; ${signedInTotal} of them need a signed-in run. With AI on, one optional check joins them: AI-suggested flows. Every pass and fail comes from a real check in a real browser, with evidence.`}
      >
        <div className="grid gap-5 lg:grid-cols-3">
          {previewGroups.map((g) => (
            <section
              key={g.group}
              // Named apart from the catalog's own "Accessibility" section further down (unique landmark names).
              aria-label={`${g.group} checks in ${site.version}`}
              className="flex flex-col gap-5 rounded-2xl border border-line bg-surface p-6 sm:p-7"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="flex items-center gap-3 font-display text-2xl font-bold tracking-tight">
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
                  <li key={c.id} id={c.id} className="flex flex-col gap-1.5 py-4 last:pb-0">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                      <p className="font-semibold text-fg">{c.name}</p>
                      {c.since === "V2" ? <NewTag>{site.preview}</NewTag> : null}
                    </div>
                    <p className="text-sm leading-relaxed text-muted">{c.line}</p>
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-dim">
                      <span>{c.id}</span>
                      {c.devServerAdvisory ? <span className="text-muted">advisory on a dev server</span> : null}
                      {c.signedIn ? <span className="text-muted">signed-in runs only</span> : null}
                      {c.offByDefault ? <span className="text-muted">unticked by default</span> : null}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <section
          id={aiFlowCheck.id}
          aria-labelledby="preview-ai-flow"
          className="flex flex-col gap-3 rounded-2xl border border-dashed border-line-strong bg-surface p-6 sm:p-7"
        >
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs tracking-widest text-dim">
            <span className="text-accent">ONLY WHEN AI IS ON</span>
            <span aria-hidden="true">·</span>
            <span>{aiFlowCheck.group.toUpperCase()} · SINCE 0.3.0</span>
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
          <Icon icon={KeyRound} size={20} className="mt-0.5 text-accent" />
          <div className="flex flex-col gap-2 text-[15px] leading-relaxed text-muted">
            <p className="font-semibold text-fg">The access checks need test accounts</p>
            <p>
              Access control, mass assignment and the CSRF check run only when Run Hound signs in first, with a test
              account you own on your app (account A). Checking that another account can&apos;t read your data also needs account B, a
              different user. Signed out, the plan says how to set them up instead.{" "}
              <Link href="/docs#accounts" className={linkClass}>
                Signed-in runs and test accounts
              </Link>
              .
            </p>
          </div>
        </div>

        <div className="flex max-w-3xl gap-4 rounded-2xl border border-line bg-surface p-5 sm:p-6">
          <Icon icon={Info} size={20} className="mt-0.5 text-accent" />
          <div className="flex flex-col gap-2 text-[15px] leading-relaxed text-muted">
            <p className="font-semibold text-fg">Why some findings are advisory on a dev server</p>
            <p>
              Dev servers such as <code className="font-mono text-fg">next dev</code> or{" "}
              <code className="font-mono text-fg">vite</code> don&apos;t send the headers, cookie settings or CORS rules
              your production build will. When the target looks like a dev server, header, cookie and CORS findings are
              marked advisory and never fail the run, and the source-map check is skipped. For confirmed results, run
              them against a production build served locally.
            </p>
          </div>
        </div>

        <p className="max-w-3xl text-[15px] leading-relaxed text-muted">
          Checks that don&apos;t apply to your page (no form, no password field, no JSON save request) are skipped
          with a plain reason. Every finding carries evidence and an exported Playwright test, and destructive
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
        intro={`The catalog lists ${gapTotal} gaps across ${categories.length} categories; ${gapsCovered} of them are covered in ${site.version} by the ${previewTotal} built-in checks above, and the other ${gapTotal - gapsCovered} are planned for the roadmap stage on their badge. Severity is the typical level when a gap is found; a real report grades each finding on its evidence. The signal is what Run Hound looks at, never a recipe.`}
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
                  <StageBadge stage="V1" shipped />
                </dt>
                <dd className="text-sm text-muted">Lit: covered in {site.version} today</dd>
              </div>
              <div className="flex items-center gap-3">
                <dt>
                  <StageBadge stage="V2" />
                </dt>
                <dd className="text-sm text-muted">Plain: planned for that stage</dd>
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
            <p className="font-mono text-xs tracking-widest text-dim">ROADMAP STAGES</p>
            <dl className="flex flex-col divide-y divide-line-soft border-y border-line-soft">
              {stages.map((stage) => (
                <div key={stage} className="flex items-baseline gap-4 py-2.5">
                  <dt className="w-8 shrink-0 font-mono text-sm text-fg">{stage}</dt>
                  <dd className="text-sm leading-relaxed text-muted">{stageMeaning[stage]}</dd>
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
                {category.checks.filter(isShipped).length} OF {category.checks.length} COVERED IN {site.version}
              </p>
            </div>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {category.checks.map((check) => (
                <CheckCard key={check.id} check={check} />
              ))}
            </ul>
          </Container>
        </section>
      ))}

      <Section
        id="advisory"
        className="border-t border-line-soft"
        title="Advisory findings are labelled"
        intro="Some findings rely on judgement rather than a pass-or-fail check, such as a missing autocomplete attribute. Header, cookie and CORS findings are also advisory when the target looks like a dev server, and so is every finding from an AI-suggested flow, every AI explanation, and a mass-assignment result the server only echoed back without a record to read again. Planned checks like alt-text quality, generic link and button labels, and placeholder or demo data will be advisory too. Reports mark all of them, and advisory findings never fail a run."
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
          Checks also can&apos;t see inside canvas content, closed shadow DOM or cross-origin iframes. Marking those
          areas as unscanned in reports is planned.
        </p>
      </Section>

      <Section
        title="See how a check becomes a finding"
        intro={
          <>
            Every finding comes with its evidence and a Playwright test, and the demo shows real ones from a run on
            Kennel. For what these checks cover beside other testing and scanning tools, see{" "}
            <Link href="/compare/" className={linkClass}>
              how Run Hound compares
            </Link>
            ; for the rest,{" "}
            <Link href="/faq/" className={linkClass}>
              answers to common questions
            </Link>
            .
          </>
        }
      >
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
      {/* Last, so the h1 and the page's text arrive before the structured data; search engines read it anywhere. */}
      <JsonLd data={jsonLd} />
    </>
  );
}
