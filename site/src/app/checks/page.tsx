import { CheckCard, isShipped } from "@/components/checks/check-card";
import styles from "@/components/checks/checks.module.css";
import { Dash } from "@/components/checks/dash";
import { checkPageHref } from "@/components/checks/links";
import { featuredFinding } from "@/components/checks/run-evidence";
import { JsonLd } from "@/components/json-ld";
import { Breadcrumbs } from "@/components/primitives/breadcrumbs";
import { Band, Container } from "@/components/primitives/layout";
import { TextLink } from "@/components/primitives/links";
import { Sprite } from "@/components/sprite";
import { aiFlowCheck, builtInChecks, categories, checksHub as hub, previewGroups, releaseAdded } from "@/content/checks/data";
import { checkPage } from "@/content/checks/pages";
import { cantSeeChecklist } from "@/content/claims";
import { fill, plural, ui } from "@/content/ui";
import { routeMetadata } from "@/lib/metadata";
import { href } from "@/lib/nav";
import { site } from "@/lib/site";
import { checksItemListNode, routeGraph, webPageId } from "@/lib/structured-data";

export const metadata = routeMetadata("checks");

const total = builtInChecks.length;
const gaps = categories.reduce((sum, c) => sum + c.checks.length, 0);
const covered = categories.reduce((sum, c) => sum + c.checks.filter(isShipped).length, 0);

// The page, where it sits, and the built-in checks as its main entity: each check's page once it has one, its card here
// before (lib/structured-data.ts checksItemListNode, from the registry).
const itemList = checksItemListNode();
const jsonLd = routeGraph("checks", itemList, { "@id": webPageId(href("checks")), mainEntity: { "@id": itemList["@id"] } });

/**
 * The typical severity a card shows ("Typical severity: high"): the check page's, or the run's finding until the check
 * has a page; none when neither says.
 */
function severityOf(id: string): string | undefined {
  const severity = checkPage(id)?.severity ?? featuredFinding(id)?.finding.severity;
  return severity ? fill(hub.severity, { severity }) : undefined;
}

/** The tags a card carries: "Signed in" for the checks of a signed-in run, "Added in <release>" for this release's. */
function tagsOf(check: (typeof builtInChecks)[number]): string[] {
  const release = releaseAdded(check);
  return [
    ...(check.signedIn ? [ui.tags.signedIn] : []),
    ...(release === site.version ? [fill(ui.tags.addedIn, { release })] : []),
  ];
}

const onThisPage = [
  ...previewGroups.map((g) => ({ label: g.group, hash: g.anchor })),
  { label: hub.onThisPage.aiFlow, hash: aiFlowCheck.id },
  { label: hub.onThisPage.notVisible, hash: "not-visible" },
  { label: hub.onThisPage.catalog, hash: "catalog" },
];

/**
 * The checks hub (DESIGN.md §3.7): the 26 built-in checks as compact cards in their three groups, each linking its
 * page (content/checks/pages); the optional AI flow; what a browser can't see; and the planned catalog as one table.
 * Every id outside links point at is kept (the registry's anchors: each check, each catalog entry, #ai-flow,
 * #not-visible, #catalog), plus #preview and the group anchors the homepage links.
 */
export default function ChecksPage() {
  return (
    <>
      <Sprite />
      <Container>
        <div className={styles.hubHead}>
          <Breadcrumbs id="checks" />
          <h1 className={styles.title}>
            {hub.title.lead}{" "}
            <span className={styles.titleKey} data-accent-exempt="">
              {hub.title.key}
            </span>
          </h1>
          <p className={styles.lede}>{fill(hub.intro, { total, version: site.version })}</p>
          <p className={styles.meta}>{fill(ui.checkPage.checked, { version: site.version, date: site.released })}</p>
          <nav aria-label={ui.docs.onThisPage}>
            <ul className={styles.onThisPage}>
              {onThisPage.map((item) => (
                <li key={item.hash}>
                  <TextLink href={href("checks", item.hash)}>{item.label}</TextLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </Container>

      <section id="preview" className="band" aria-label={fill(hub.builtInLabel, { version: site.version })}>
        <Container>
          {previewGroups.map((g) => (
            <section key={g.group} id={g.anchor} className={styles.group} aria-labelledby={`${g.anchor}-title`}>
              <div className={styles.groupHead}>
                <h2 id={`${g.anchor}-title`} className={styles.groupTitle}>
                  {g.group}
                  <span className={styles.groupCount}>{plural(hub.count, g.checks.length)}</span>
                </h2>
                <p className={styles.body}>{hub.groupIntro[g.group]}</p>
              </div>
              <ul className={styles.cards}>
                {builtInChecks
                  .filter((c) => c.group === g.group)
                  .map((c) => {
                    const page = checkPageHref(c.id);
                    return (
                      <CheckCard
                        key={c.id}
                        id={c.id}
                        name={c.name}
                        plain={c.plain}
                        severity={severityOf(c.id)}
                        tags={tagsOf(c)}
                        link={page ? { href: page, label: ui.checksHub.howTested } : undefined}
                      />
                    );
                  })}
              </ul>
            </section>
          ))}
          <section className={styles.group} aria-labelledby="ai-flow-title">
            <div className={styles.groupHead}>
              <h2 id="ai-flow-title" className={styles.groupTitle}>
                {hub.aiFlow.title}
              </h2>
              <p className={styles.body}>{fill(hub.aiFlow.intro, { total })}</p>
            </div>
            <ul className={styles.cards}>
              <CheckCard
                id={aiFlowCheck.id}
                name={aiFlowCheck.name}
                plain={aiFlowCheck.plain}
                severity={hub.aiFlow.advisory}
                tags={[fill(hub.aiFlow.added, { release: aiFlowCheck.added })]}
              />
            </ul>
          </section>
        </Container>
      </section>

      <Band id="not-visible" labelledBy="not-visible-title">
        <div className={styles.groupHead}>
          <h2 id="not-visible-title" className={styles.groupTitle}>
            {hub.notVisible.title}
          </h2>
          <p className={styles.body}>{hub.notVisible.intro}</p>
        </div>
        <ul className={styles.notVisible}>
          {cantSeeChecklist.map((item) => (
            <li key={item.name} className={styles.listItem}>
              <Dash />
              <span>
                <strong>{item.name}</strong>: {item.line}
              </span>
            </li>
          ))}
        </ul>
        <p className={`${styles.small} ${styles.after}`}>{hub.notVisible.after}</p>
      </Band>

      <Band id="catalog" labelledBy="catalog-title">
        <div className={styles.groupHead}>
          <h2 id="catalog-title" className={styles.groupTitle}>
            {hub.catalog.title}
          </h2>
          <p className={styles.body}>
            {fill(hub.catalog.intro, { gaps, covered, version: site.version })}{" "}
            <TextLink href={href("open-source", "roadmap")}>{hub.catalog.roadmap}</TextLink>.
          </p>
        </div>
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label={hub.catalog.table}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{hub.catalog.columns.gap}</th>
                <th scope="col">{hub.catalog.columns.line}</th>
                <th scope="col">{hub.catalog.columns.stage}</th>
              </tr>
            </thead>
            {categories.map((category) => (
              <tbody key={category.id} id={category.id}>
                <tr className={styles.groupRow}>
                  <th scope="colgroup" colSpan={3}>
                    {category.eyebrow}
                  </th>
                </tr>
                {category.checks.map((entry) => {
                  const shipped = isShipped(entry);
                  return (
                    <tr key={entry.id} id={entry.id}>
                      <th scope="row">
                        {entry.name}
                        {entry.advisory ? ` (${hub.catalog.advisory})` : ""}
                      </th>
                      <td>{entry.line}</td>
                      <td className={`${styles.stage} ${shipped ? styles.stageCovered : ""}`}>
                        {fill(shipped ? hub.catalog.covered : hub.catalog.planned, { stage: entry.stage })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      </Band>
      {/* Last, so the h1 and the page's text arrive before the structured data; search engines read it anywhere. */}
      <JsonLd data={jsonLd} />
    </>
  );
}
