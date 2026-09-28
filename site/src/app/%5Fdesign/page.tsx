import { Laptop, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { DesignMotion } from "@/components/design/design-motion";
import { ForcedColourNotes } from "@/components/design/forced-colours";
import { HeaderSpecimens } from "@/components/design/header-specimens";
import { MotionMoments } from "@/components/design/motion-moments";
import { OpszComparison } from "@/components/design/opsz-comparison";
import { BookingsCrop } from "@/components/home/bookings-crop";
import { LineHound } from "@/components/hound/line-hound";
import { LogoMark } from "@/components/logo";
import { Breadcrumbs } from "@/components/primitives/breadcrumbs";
import { ButtonLink } from "@/components/primitives/button-link";
import { Callout } from "@/components/primitives/callout";
import { Card, IconTile } from "@/components/primitives/card";
import { CodeBlock } from "@/components/primitives/code-block";
import { Command } from "@/components/primitives/command";
import { FactStrip } from "@/components/primitives/fact-strip";
import { FactsList } from "@/components/primitives/facts-list";
import { Figure } from "@/components/primitives/figure";
import { Band, Container, SectionHeading } from "@/components/primitives/layout";
import { ArrowLink, TextLink } from "@/components/primitives/links";
import { Pill } from "@/components/primitives/pill";
import { PrevNext } from "@/components/primitives/prev-next";
import { ReportLine } from "@/components/primitives/report-line";
import { StepTrail } from "@/components/primitives/step-trail";
import { Tag } from "@/components/primitives/tag";
import { Tick } from "@/components/primitives/tick";
import { Sprite } from "@/components/sprite";
import { commands } from "@/content/commands";
import { route } from "@/content/routes";
import { fill, ui } from "@/content/ui";
import { routeMetadata } from "@/lib/metadata";
import { href } from "@/lib/nav";
import { site } from "@/lib/site";
import { contrast, declarationsIn, px, resolveColour, tokensCss } from "./tokens";
// The homepage's figures (the motion moments) are styled by the homepage's sheet; the page's own by design.css.
import "@/components/home/home.css";
import "@/components/design/design.css";

// Internal (DESIGN.md §3.14): noindex and nofollow, in no nav, sitemap, llms.txt or search index. It shows the tokens,
// the type scale with the D18 opsz comparison, spacing and radii, every primitive in every state, the header
// transparent, opaque and with the menu open, each motion moment with its own Replay, and the forced-colours notes.
// G2 wrote the first version (tokens, type, primitives); X1 the rest. The lab checks it
// (scripts/lab/specs/design.spec.mjs) and saves reduced-motion snapshots at 1280 and 390 px as artefacts.
//
// A specimen page shows every type step, the D18 sizes and two line hounds (the 64 px one in its band, the 404's 120 px
// one in the Motion band), so two per-page rules can't hold here and the lab doesn't apply them to it: the type cap
// (≤ 9 font sizes in <main>) and the one-line-hound rule (§2.6). Everything else applies: axe, CSP, noindex, reflow at 320 px, and the accent budget (§2.3: at most one
// strong accent object per viewport-sized window).
export const metadata = routeMetadata("design");

const css = tokensCss();
const root = declarationsIn(css, [":root"]);
const fromSm = declarationsIn(css, ["@media (width >= 40rem)", ":root"]);
const fromXl = declarationsIn(css, ["@media (width >= 80rem)", ":root"]);

/** Colour roles with the Tailwind class that paints each swatch (written out, so Tailwind generates them). */
const roles = [
  { role: "bg", swatch: "bg-bg", use: "Page" },
  { role: "band", swatch: "bg-band", use: "The two tinted bands" },
  { role: "bg-deep", swatch: "bg-bg-deep", use: "Code, windows, the footer" },
  { role: "surface", swatch: "bg-surface", use: "Cards" },
  { role: "surface-2", swatch: "bg-surface-2", use: "Icon tiles, inputs" },
  { role: "surface-3", swatch: "bg-surface-3", use: "Selected rows" },
  { role: "line-soft", swatch: "bg-line-soft", use: "Dividers, band hairlines" },
  { role: "line", swatch: "bg-line", use: "Borders" },
  { role: "line-strong", swatch: "bg-line-strong", use: "Emphasised borders, tracks" },
  { role: "fg", swatch: "bg-fg", use: "Headings" },
  { role: "muted", swatch: "bg-muted", use: "Body text" },
  { role: "dim", swatch: "bg-dim", use: "Captions and labels" },
  { role: "accent", swatch: "bg-accent", use: "The one thing to do or that changed" },
  { role: "accent-strong", swatch: "bg-accent-strong", use: "Hover on accent" },
  { role: "fail", swatch: "bg-fail", use: "Failures, high severity" },
  { role: "warn", swatch: "bg-warn", use: "Medium severity, a failed copy" },
  { role: "paper", swatch: "bg-paper", use: "The app under test" },
  { role: "paper-action", swatch: "bg-paper-action", use: "Kennel's own orange on Book" },
] as const;

const textRoles = ["fg", "muted", "dim", "accent-text", "fail", "warn"] as const;
const grounds = ["bg", "band", "bg-deep", "surface", "surface-2"] as const;
const colour = (role: string) => resolveColour(`--rh-${role}`, root) ?? "#000000";

/** The type scale: the class, what it is for, and its sizes on phones, from 640 and from 1280 px. */
const typeSteps = [
  { step: "Display XL", className: "font-display text-display-xl", token: "display-xl", use: "Home and 404 h1" },
  { step: "Display L", className: "font-display text-display-l", token: "display-l", use: "Inner page h1, the closing h2" },
  { step: "Display M", className: "font-display text-display-m", token: "display-m", use: "h2" },
  { step: "Title", className: "text-title", token: "title", use: "h3, card titles" },
  { step: "Lead", className: "text-lead text-muted", token: "lead", use: "Subheads, intros, docs prose" },
  { step: "Body", className: "text-body text-muted", token: "body", use: "Cards, steps, lists" },
  { step: "Small", className: "text-small text-muted", token: "small", use: "Captions, the proof strip, the footer" },
  { step: "Mono", className: "font-mono text-mono text-muted", token: "mono", use: "Labels (12 px), code is 13 px" },
] as const;

const theme = declarationsIn(css, ["@theme"]);
const typeSizes = (token: string) => {
  const steps = [root.get(`--rh-text-${token}`) ?? theme.get(`--text-${token}`), fromSm.get(`--rh-text-${token}`), fromXl.get(`--rh-text-${token}`)];
  return steps
    .filter(Boolean)
    .map((rem) => px(rem))
    .join(" → ");
};

const spaceSteps = [
  { token: "--space-1", bar: "w-1" },
  { token: "--space-2", bar: "w-2" },
  { token: "--space-3", bar: "w-3" },
  { token: "--space-4", bar: "w-4" },
  { token: "--space-6", bar: "w-6" },
  { token: "--space-8", bar: "w-8" },
  { token: "--space-10", bar: "w-10" },
  { token: "--space-12", bar: "w-12" },
  { token: "--space-16", bar: "w-16" },
  { token: "--space-20", bar: "w-20" },
] as const;

const radii = [
  { name: "rounded-chip", use: "Chips, inputs, tags" },
  { name: "rounded-control", use: "Buttons, code" },
  { name: "rounded-card", use: "Cards, windows" },
  { name: "rounded-pill", use: "Pills" },
] as const;

const sections = [
  { id: "palette", title: "Palette and roles" },
  { id: "type", title: "Type" },
  { id: "spacing", title: "Spacing and radii" },
  { id: "components", title: "Components" },
  { id: "header", title: "The header" },
  { id: "motion", title: "Motion" },
  { id: "forced-colours", title: "Forced colours" },
  { id: "hound", title: "The line hound" },
] as const;

const runBlock = commands.blocks.run;

/** One component's specimens; `specimen` names it for the lab (data-dz-specimen). */
function Sub({ title, specimen, children }: { title: string; specimen: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4" data-dz-specimen={specimen}>
      <h3 className="text-title text-fg">{title}</h3>
      {children}
    </div>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-4">{children}</div>;
}

export default function DesignPage() {
  return (
    <>
      <Sprite github hound icons={{ local: Laptop, guard: ShieldCheck }} />
      <Container className="flex flex-col gap-6 pb-12 pt-16">
        <Breadcrumbs id="design" />
        <h1 className="font-display text-display-l text-fg">{route("design").title}</h1>
        <p className="max-w-measure text-lead text-muted">{route("design").description}</p>
        <nav aria-label="On this page">
          <StepTrail orientation="row" steps={sections.map((s) => ({ label: s.title, href: `#${s.id}` }))} />
        </nav>
      </Container>

      <Band id="palette" index={{ n: 1, total: sections.length }} labelledBy="palette-title">
        <SectionHeading
          id="palette-title"
          title="Palette and roles"
          intro="Each role points at a brand colour in tokens.css. Contrast ratios are computed from those values."
        />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {roles.map(({ role, swatch, use }) => (
            <li key={role} className="flex items-center gap-4">
              <span aria-hidden="true" className={`size-12 shrink-0 rounded-control border border-line ${swatch}`} />
              <span className="flex flex-col">
                <code className="font-mono text-code text-fg">--rh-{role}</code>
                <span className="text-small text-muted">
                  {colour(role)} · {use}
                </span>
              </span>
            </li>
          ))}
        </ul>
        {/* The label sits outside the sideways scroller, so a phone reads it whole; it names the region and the table. */}
        <p id="contrast-caption" className="mt-8 pb-3 text-small text-muted">
          Text colours against each ground (WCAG ratio; 4.5 is AA for body text)
        </p>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-labelledby="contrast-caption">
          <table className="w-full text-left text-small" aria-labelledby="contrast-caption">
            <thead>
              <tr>
                <th scope="col" className="py-2 pr-4 font-mono text-mono text-muted">
                  Text
                </th>
                {grounds.map((ground) => (
                  <th key={ground} scope="col" className="py-2 pr-4 font-mono text-mono text-muted">
                    {ground}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {textRoles.map((text) => (
                <tr key={text} className="border-t border-line-soft">
                  <th scope="row" className="py-2 pr-4 font-mono text-mono text-fg">
                    {text}
                  </th>
                  {grounds.map((ground) => {
                    const ratio = contrast(colour(text), colour(ground));
                    return (
                      <td key={ground} className="py-2 pr-4 text-fg">
                        {ratio.toFixed(2)}
                        {ratio < 4.5 ? " (below AA)" : ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Band>

      <Band id="type" index={{ n: 2, total: sections.length }} tone="band" labelledBy="type-title">
        <SectionHeading id="type-title" title="Type" intro="Eight steps: Bricolage Grotesque for display, Geist for text, Geist Mono for code and labels." />
        <ul className="flex flex-col gap-8">
          {typeSteps.map(({ step, className, token, use }) => (
            <li key={step} className="flex flex-col gap-2">
              <span className="font-mono text-mono text-muted">
                {step} · text-{token} · {typeSizes(token)} px · {use}
              </span>
              <span className={className}>Find the bugs your AI forgot to test.</span>
            </li>
          ))}
        </ul>
        <h3 className="mt-12 text-title text-fg">D18: Bricolage with and without its opsz axis</h3>
        <p className="mt-2 max-w-measure text-body text-muted">
          The axis costs 35.6 KB on every first visit. Compare the display steps at 40, 60 and 80 px; if the pairs look
          the same, drop it (brief D18). The face loads with font-display: optional, so a first visit that misses it
          shows the fallback here: reload.
        </p>
        <OpszComparison />
      </Band>

      <Band id="spacing" index={{ n: 3, total: sections.length }} labelledBy="spacing-title">
        <SectionHeading id="spacing-title" title="Spacing and radii" intro="An 8 px base: ten steps from 4 to 80 px, and four radii." />
        <div className="grid gap-12 lg:grid-cols-2">
          <ul className="flex flex-col gap-3">
            {spaceSteps.map(({ token, bar }) => (
              <li key={token} className="flex items-center gap-4">
                <code className="w-24 font-mono text-code text-muted">{token}</code>
                <span aria-hidden="true" className={`h-3 rounded-chip bg-line-strong ${bar}`} />
                <span className="text-small text-muted">{px(root.get(token))} px</span>
              </li>
            ))}
          </ul>
          <ul className="grid grid-cols-2 gap-4">
            {radii.map(({ name, use }) => (
              <li key={name} className="flex flex-col gap-2">
                <span aria-hidden="true" className={`h-16 border border-line-strong bg-surface ${name}`} />
                <span className="text-small text-muted">
                  <code className="font-mono text-code text-fg">{name}</code> · {use}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Band>

      <Band id="components" index={{ n: 4, total: sections.length }} tone="band" labelledBy="components-title">
        <SectionHeading id="components-title" title="Components" intro="The primitives in src/components/primitives, in each of their states." />
        <div className="flex flex-col gap-12">
          <Sub title="Buttons: default, hover, focus, active" specimen="buttons">
            <Row>
              <ButtonLink href={href("docs")}>Try it locally</ButtonLink>
              <ButtonLink href={href("docs")} demoState="hover">
                Hover
              </ButtonLink>
              <ButtonLink href={href("docs")} demoState="focus">
                Focus
              </ButtonLink>
              <ButtonLink href={href("docs")} demoState="active">
                Active
              </ButtonLink>
              <ButtonLink href={href("docs")} size="header">
                Header size
              </ButtonLink>
            </Row>
            <Row>
              <ButtonLink href={site.github} variant="secondary" icon="github" shortLabel={ui.header.github}>
                {ui.header.viewOnGitHub}
              </ButtonLink>
              <ButtonLink href={site.github} variant="secondary" demoState="hover">
                Hover
              </ButtonLink>
              <ButtonLink href={site.github} variant="secondary" demoState="focus">
                Focus
              </ButtonLink>
              <ButtonLink href={site.github} variant="secondary" demoState="active">
                Active
              </ButtonLink>
            </Row>
          </Sub>

          <Sub title="Links, pill and tags" specimen="links">
            <p className="max-w-measure text-body text-muted">
              A link inside a sentence, such as <TextLink href={href("faq")}>the FAQ</TextLink>, stays underlined. A link off
              the site, such as <TextLink href={site.changelog}>the changelog</TextLink>, ends in an arrow.
            </p>
            <Row>
              <ArrowLink href={href("checks")}>See all the checks</ArrowLink>
              <ArrowLink href={site.github} opens="GitHub">
                Source on GitHub
              </ArrowLink>
            </Row>
            <Row>
              <Pill href={href("checks")}>{`New in ${site.version}: the pill, on one line`}</Pill>
              <Pill href={href("checks")} demoState="hover">
                Hovered
              </Pill>
              <Tag>{ui.tags.preview}</Tag>
              <Tag>{ui.tags.signedIn}</Tag>
              <Tag>{fill(ui.tags.addedIn, { release: site.version })}</Tag>
            </Row>
          </Sub>

          <Sub title="Cards, icon tiles and ticks" specimen="cards">
            <p className="max-w-measure text-body text-muted">
              A card that a link lands on rings once, then rests. Try it:{" "}
              <a className="text-link" href="#linked-card">
                go to the linked card
              </a>
              .
            </p>
            <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card as="li">
                <p className="text-title text-fg">A card</p>
                <p className="mt-2 text-body text-muted">Surface, a 1 px line, radius 16.</p>
              </Card>
              <Card as="li" interactive demoState="hover">
                <p className="text-title text-fg">Hovered</p>
                <p className="mt-2 text-body text-muted">The border turns accent at 45%, colour only.</p>
              </Card>
              <Card as="li" id="linked-card">
                <p className="text-title text-fg">Linked</p>
                <p className="mt-2 text-body text-muted">Reached by a link: a 2 px accent ring that fades out in 600 ms.</p>
              </Card>
              <Card as="li">
                <div className="flex items-center gap-4">
                  <IconTile icon="local" />
                  <IconTile icon="guard" />
                </div>
                <p className="tick-row mt-4 text-body text-muted">
                  <Tick /> A pass
                </p>
                <p className="tick-row mt-2 text-body text-muted">
                  <Tick tone="bullet" /> A bullet
                </p>
              </Card>
            </ul>
          </Sub>

          <Sub title="Fact strip and facts list" specimen="facts">
            <FactStrip
              items={[
                { label: "Every check, open source", href: href("checks") },
                { label: "Runs on your machine", href: href("docs") },
                { label: "Questions answered", href: href("faq") },
                { label: "How the project works", href: href("open-source") },
              ]}
            />
            <FactsList
              className="max-w-md"
              items={[
                { term: "Release", detail: site.version },
                { term: "Licence", detail: site.license },
                { term: "Image", detail: <code className="font-mono text-code">{site.imageName}</code> },
              ]}
            />
          </Sub>

          <Sub title="Command: idle, copied, failed" specimen="command">
            <Command command={commands.pullAndRun} next={ui.afterCopy} hint="Then open localhost:4000. Docker or Podman." />
            <Command command={commands.pullAndRun} next={ui.afterCopy} label="Run command, copied" initialState="copied" />
            <Command command={commands.pullAndRun} label="Run command, copy failed" initialState="failed" />
          </Sub>

          <Sub title="Code block: idle, copied, failed" specimen="code">
            <CodeBlock label="Start Run Hound" comment="reports land in ./runs" commands={runBlock.commands} output={runBlock.output} />
            <CodeBlock label="Start Run Hound, copied" commands={runBlock.commands} initialState="copied" />
            <CodeBlock label="Start Run Hound, copy failed" commands={runBlock.commands} initialState="failed" />
          </Sub>

          <Sub title="Figure and window" specimen="figure">
            <Figure caption="A window frame: a 28 px title bar, three dots and an address.">
              <div className="win max-w-xl" aria-hidden="true">
                <div className="win-bar">
                  <span className="win-dot" />
                  <span className="win-dot" />
                  <span className="win-dot" />
                  <span className="win-address">localhost:4000</span>
                </div>
                <div className="win-row p-4 text-small text-muted">
                  <Tick /> 20 / 20 scenarios
                </div>
              </div>
            </Figure>
          </Sub>

          <Sub title="Callouts" specimen="callouts">
            <Callout title="A note">A line-strong rule and muted text.</Callout>
            <Callout tone="warn" title="A warning">
              A warn rule, for what can go wrong.
            </Callout>
          </Sub>

          <Sub title="Step trail: a check's steps, and a docs page's On this page" specimen="step-trail">
            <div className="grid gap-12 md:grid-cols-2">
              <StepTrail
                steps={[
                  { label: "Fill the form", note: "With valid data for every field." },
                  { label: "Double-click the submit button", note: "Two clicks in a row, as an impatient reader would." },
                  { label: "Decide", note: "Two saved records: a finding." },
                ]}
                marked={{ index: 2, tone: "fail" }}
              />
              <nav aria-label="On this page, an example">
                <StepTrail
                  className="text-small"
                  steps={sections.map((s) => ({ label: s.title, href: `#${s.id}` }))}
                  marked={{ index: 3, tone: "accent", current: "location" }}
                  marker
                />
              </nav>
            </div>
          </Sub>

          <Sub title="Breadcrumbs on a phone: one line, the middle item shortens" specimen="breadcrumbs">
            <p className="max-w-measure text-body text-muted">
              A check page&apos;s trail on a 320 px screen. The trail at the top of this page is the live one.
            </p>
            {/* A picture of the phone state: inert, so its links and its landmark leave the tab order and the
                accessibility tree, and the page keeps one Breadcrumb landmark. */}
            <div className="dz-stage dz-stage-phone dz-stage-crumbs" inert>
              <Breadcrumbs id="check-axe-states" />
            </div>
          </Sub>

          <Sub title="Previous and next, and the report line" specimen="pager">
            <PrevNext prev={{ href: href("docs"), label: route("docs").label }} next={{ href: href("checks"), label: route("checks").label }} />
            <ReportLine path={route("design").path} />
          </Sub>
        </div>
      </Band>

      <Band id="header" index={{ n: 5, total: sections.length }} labelledBy="header-title">
        <SectionHeading
          id="header-title"
          title="The header"
          intro="Its three looks, in its own styles: transparent, opaque once the page scrolls, and the phone menu open."
        />
        <HeaderSpecimens
          brand={
            <>
              <LogoMark size={23} />
              <span className="max-xs:sr-only">{site.name}</span>
            </>
          }
        />
      </Band>

      <Band id="motion" index={{ n: 6, total: sections.length }} tone="band" labelledBy="motion-title">
        <SectionHeading
          id="motion-title"
          title="Motion"
          intro="Each moment as its page plays it, with its own Replay. Only figures move; their words never do."
        />
        <MotionMoments crop={<BookingsCrop />} />
      </Band>

      <Band id="forced-colours" index={{ n: 7, total: sections.length }} labelledBy="forced-colours-title">
        <SectionHeading
          id="forced-colours-title"
          title="Forced colours"
          intro="When a contrast theme replaces the palette, these rules keep strokes, progress and the current item visible."
        />
        <ForcedColourNotes />
      </Band>

      <Band id="hound" index={{ n: 8, total: sections.length }} tone="band" labelledBy="hound-title">
        <SectionHeading
          id="hound-title"
          title="The line hound"
          intro="At most once per page on the site: 64 px at the homepage's close; the 404's 120 px hound walks in the Motion band above."
        />
        <div className="flex flex-wrap items-end gap-12" data-dz-specimen="hound">
          <LineHound size={64} />
        </div>
      </Band>
      <DesignMotion />
    </>
  );
}
