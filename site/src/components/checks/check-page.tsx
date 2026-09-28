import Image from "next/image";
import type { ReactNode } from "react";
import { Breadcrumbs } from "@/components/primitives/breadcrumbs";
import { FactsList } from "@/components/primitives/facts-list";
import { Figure } from "@/components/primitives/figure";
import { Container } from "@/components/primitives/layout";
import { ArrowLink, TextLink } from "@/components/primitives/links";
import { ReportLine } from "@/components/primitives/report-line";
import { StepTrail } from "@/components/primitives/step-trail";
import { Tick } from "@/components/primitives/tick";
import { Sprite } from "@/components/sprite";
import { builtInChecks, checkPageWords as words, releaseAdded } from "@/content/checks/data";
import type { CheckPage } from "@/content/checks/pages/types";
import { route, type RouteId } from "@/content/routes";
import { fill, ui } from "@/content/ui";
import { site } from "@/lib/site";
import styles from "./checks.module.css";
import { CopyBlock, Repeat } from "./copy-block";
import { Dash } from "./dash";
import { evidenceAssets } from "./evidence-assets";
import { checkHref } from "./links";
import { askPrompt, isPicture, listingOf, pageEvidence, pageFinding, type Evidence } from "./run-evidence";

const labels = ui.checkPage;

/**
 * A section's heading: its number (the band index's accent mono, hidden from screen readers) and its title, a space
 * between them so the search index reads "01 How Run Hound tests it", not "01How".
 */
function SectionTitle({ n, id, children }: { n: number; id: string; children: string }) {
  return (
    <h2 id={id} className={styles.sectionTitle}>
      <span className={styles.sectionNumber} aria-hidden="true">
        {String(n).padStart(2, "0")}
      </span>{" "}
      {children}
    </h2>
  );
}

/** Where a link opens, for screen readers: the part of its label before the colon ("MDN: …" → "MDN"). */
const opensAt = (label: string) => label.split(":")[0];

/** A frame or a GIF from the run. GIFs play once and rest on their proof frame (R1), served as they are (next/image
 * never re-encodes an animation); frames are optimised. */
function Picture({ item }: { item: Evidence & { alt?: string } }) {
  const src = item.asset ? evidenceAssets[item.asset] : undefined;
  if (!src) throw new Error(`check pages: no static import for ${item.asset} (components/checks/evidence-assets.ts)`);
  const alt = item.alt ?? "";
  // The file and its size only: the static import's blur placeholder (a base64 PNG) is never drawn here, and passing it
  // would put it in the page's RSC payload for nothing.
  const image = { src: src.src, width: src.width, height: src.height };
  // The main column: 48rem from 1280 px (the 1136 px page less the 20rem facts column and its 3rem gap), the full width
  // below 1024 px; between, it is narrower than the viewport, so 100vw only over-asks.
  const sizes = "(width >= 64rem) 48rem, 100vw";
  // An animation is served as it is (unoptimized); either way its intrinsic size is reserved, so nothing shifts.
  if (item.kind === "gif") return <Image src={image} alt={alt} unoptimized className={styles.picture} />;
  return <Image src={image} alt={alt} sizes={sizes} quality={90} className={styles.picture} />;
}

/** How long a run of one character must be before withRuns sends its count instead of its characters. */
const RUN = 64;

/**
 * A spec's text as the page renders it. Every text node a page renders is in its HTML and again in the RSC payload
 * that hydrates it, so a run of one character (the filler a test types to overflow a field: 20,000 x's in the
 * verbose-errors spec) would be in the page twice. A run of RUN or more goes to the browser as its character and count
 * instead, and <Repeat> writes it out: the HTML still holds every character once, as shown, and Copy (which reads the
 * shown text) copies the spec exactly.
 */
function withRuns(text: string): ReactNode {
  const parts: ReactNode[] = [];
  let from = 0;
  for (const run of text.matchAll(new RegExp(`([^\\n])\\1{${RUN - 1},}`, "g"))) {
    parts.push(text.slice(from, run.index), <Repeat key={run.index} char={run[1]} count={run[0].length} />);
    from = run.index + run[0].length;
  }
  return parts.length ? [...parts, text.slice(from)] : text;
}

/** A request card, headers, cookies or console lines: the report's lines, as text. */
function Listing({ item, id }: { item: Evidence; id: string }) {
  const listing = listingOf(item);
  return (
    <div className={styles.listing}>
      {listing.title || listing.subtitle ? (
        <div className={styles.listingHead}>
          {listing.title ? <p className={styles.listingTitle}>{listing.title}</p> : null}
          {listing.subtitle ? <p className={styles.listingSubtitle}>{listing.subtitle}</p> : null}
        </div>
      ) : null}
      <pre className={styles.listingLines} tabIndex={0} role="region" aria-labelledby={id}>
        <code>{listing.lines.join("\n")}</code>
      </pre>
    </div>
  );
}

/**
 * One check's page (DESIGN.md §3.6), from its module (content/checks/pages/<id>.ts), the check's data line
 * (content/checks/data.ts) and its featured finding in the run extracts, shown as the report prints it. The facts panel
 * comes after the lede on phones and sits in a sticky column from 1024 px.
 *
 * Motion is deferred, a recorded deviation from §4.3's below-the-fold figure reveal. With
 * <MotionGate islands={["scroll"]} /> and <Figure reveal={isPicture(item)}>, this page requested 34,086 B of motion
 * code (limit 32,000: the scroll engine brings DrawSVG, which a reveal doesn't use) and was 20 B under its 15,000 B
 * gzip HTML budget. Those two lines come back once the engine loads DrawSVG only for the effects that draw (M1) and
 * the check pages' HTML budget is settled.
 *
 * Adjacent inline elements with words get a space between them ({" "}): the search index joins text nodes as they
 * are, so "Features" and "double-submit" would index as one word.
 */
export function CheckPageView({ page }: { page: CheckPage }) {
  const check = builtInChecks.find((c) => c.id === page.id);
  if (!check) throw new Error(`check pages: ${page.id} is not a built-in check`);
  const routeId = `check-${page.id}` as RouteId;
  const { path } = route(routeId);
  const finding = pageFinding(page);
  const featured = finding.featured;
  const evidence = featured ? pageEvidence(page) : [];
  const spec = featured?.finding.spec;
  const fix = askPrompt(finding.fix);
  const failed = words.copyFailed;
  const release = releaseAdded(check);
  const facts = [
    { term: labels.facts.id, detail: <code>{check.id}</code> },
    { term: labels.facts.group, detail: check.group },
    { term: labels.facts.severity, detail: words.severity[page.severity] },
    { term: labels.facts.records, detail: check.records },
    { term: labels.facts.signIn, detail: check.signedIn ? words.facts.signInYes : words.facts.no },
    { term: labels.facts.ticked, detail: check.offByDefault ? words.facts.no : words.facts.yes },
    { term: labels.facts.added, detail: release },
  ];
  const related = page.related.map((id) => builtInChecks.find((c) => c.id === id)).filter((c) => c !== undefined);
  const [runBefore, runAfter] = labels.runIt.split("{command}");

  return (
    <Container>
      <Sprite />
      <div className={styles.page}>
        <div className={styles.head}>
          <Breadcrumbs id={routeId} />
          <p className={styles.eyebrow}>
            <span>{check.group}</span> <span className={styles.idChip}>{check.id}</span>
          </p>
          <h1 className={styles.title}>{check.name}</h1>
          <p className={styles.lede} data-check-lede="">
            {page.lede}
          </p>
          <p className={styles.meta}>{fill(labels.checked, { version: site.version, date: site.released })}</p>
        </div>

        <section className={styles.aside} aria-label={words.facts.label}>
          <FactsList items={facts} />
        </section>

        <div className={styles.sections}>
          <section className={styles.section} aria-labelledby="how-tested">
            <SectionTitle n={1} id="how-tested">
              {labels.howTested}
            </SectionTitle>
            <StepTrail
              steps={page.steps.map((s) => ({ label: s.label, note: s.line }))}
              marked={{ index: page.steps.length - 1, tone: "fail" }}
            />
            <p className={`${styles.body} ${styles.notCounted}`}>
              <strong>{labels.notCounted}</strong> {page.notCounted}
            </p>
          </section>

          <section className={styles.section} aria-labelledby="finding">
            <SectionTitle n={2} id="finding">
              {labels.finding}
            </SectionTitle>
            <article className={styles.finding} aria-labelledby="finding-title">
              <p className={styles.findingChips}>
                <span className={styles.severity}>{finding.severity.toUpperCase()}</span>
                <span className="tag">{finding.confidence === "advisory" ? words.confidence.advisory : words.confidence.confirmed}</span>
              </p>
              <h3 id="finding-title" className={styles.subTitle}>
                {finding.title}
              </h3>
              <dl className={styles.findingFields}>
                <dt>{words.meaning}</dt>
                <dd>{finding.meaning}</dd>
                <dt>{words.impact}</dt>
                <dd>{finding.impact}</dd>
                {finding.location ? (
                  <>
                    <dt>{words.where}</dt>
                    <dd>{[finding.location, finding.scope].filter(Boolean).join(" · ")}</dd>
                  </>
                ) : null}
              </dl>
            </article>
            {/* Before the evidence, so the test app is named (brand.md) before a picture's alt text names it. */}
            <p className={styles.small}>
              {featured ? fill(words.foundOn[featured.app], { version: featured.run.runHoundVersion }) : labels.noEvidence}
              {featured && featured.run.approved < featured.run.planned
                ? ` ${fill(words.partialRun, { page: new URL(featured.run.target).pathname })}`
                : null}
            </p>
            {evidence.map((item, i) => {
              const captionId = `evidence-${i + 1}`;
              return (
                <Figure key={item.label} caption={<span id={captionId}>{item.caption}</span>}>
                  {isPicture(item) ? <Picture item={item} /> : <Listing item={item} id={captionId} />}
                </Figure>
              );
            })}
          </section>

          {/* Always here: the registry promises #reproduce on every check page (content/routes/checks.ts). */}
          <section id="reproduce" className={styles.section} aria-labelledby="reproduce-title">
            <SectionTitle n={3} id="reproduce-title">
              {labels.reproduce}
            </SectionTitle>
            {spec ? (
              <>
                <p className={`${styles.body} ${styles.stack}`}>{page.reproduce}</p>
                <CopyBlock label={spec.filename} failed={failed}>
                  {withRuns(spec.source)}
                </CopyBlock>
                <p className={styles.small}>
                  {runBefore}
                  <code>{`npx playwright test ${spec.filename}`}</code>
                  {runAfter}.
                </p>
              </>
            ) : (
              <p className={styles.body}>{labels.noEvidence}.</p>
            )}
          </section>

          <section className={styles.section} aria-labelledby="fix">
            <SectionTitle n={4} id="fix">
              {labels.fix}
            </SectionTitle>
            <h3 className={styles.subTitle}>{labels.askYourAi}</h3>
            <CopyBlock label={words.fixLabel} before={fix.before} after={fix.after} wrap searchable failed={failed}>
              {fix.prompt}
            </CopyBlock>
            <ul className={styles.list}>
              {page.background.map((link) => (
                <li key={link.href} className={styles.listItem}>
                  <Tick tone="bullet" />
                  <span>
                    <TextLink href={link.href} opens={opensAt(link.label)}>
                      {link.label}
                    </TextLink>
                    : {link.why}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.section} aria-labelledby="limits">
            <SectionTitle n={5} id="limits">
              {labels.limits}
            </SectionTitle>
            <ul className={styles.list}>
              {page.limits.map((limit) => (
                <li key={limit} className={styles.listItem}>
                  <Dash />
                  <span>{limit}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.section} aria-labelledby="related">
            <h2 id="related" className={styles.subTitle}>
              {labels.related}
            </h2>
            <ul className={styles.related}>
              {related.map((c) => (
                <li key={c.id}>
                  <ArrowLink href={checkHref(c.id)} prefetch="intent">
                    {c.question}
                  </ArrowLink>
                </li>
              ))}
            </ul>
            <p>
              <ArrowLink href={route("checks").path} prefetch="intent">
                {fill(labels.allChecks, { count: builtInChecks.length })}
              </ArrowLink>
            </p>
            <ReportLine path={path} />
          </section>
        </div>
      </div>
    </Container>
  );
}
