import type { ReactNode } from "react";
import { Breadcrumbs } from "@/components/primitives/breadcrumbs";
import { NavLink } from "@/components/primitives/nav-link";
import { PrevNext } from "@/components/primitives/prev-next";
import { ReportLine } from "@/components/primitives/report-line";
import { StepTrail, type TrailStep } from "@/components/primitives/step-trail";
import type { RouteId } from "@/content/routes";
import { docsSidebar, href, prevNext } from "@/lib/nav";
import { DocsShellClient } from "./docs-shell-client";
import "./docs-shell.css";

/** One entry of "On this page": an h2 of the page and its pinned id. */
export type TocItem = { id: string; text: string };

const onThisPage = "On this page";
const docsMenu = "Docs menu";
/** The sidebar's name: not "Docs", which names the footer's Docs column (landmarks need names of their own). */
const docsPages = "Docs pages";

/**
 * The docs sidebar (§3.5): the registry's docs groups and pages in order (lib/nav.ts docsSidebar), then the checks hub
 * at the end of Reference, the current page marked with aria-current="page". Group names are labels, not headings, so
 * the page's h1 stays its first heading. Links prefetch on intent. Rendered twice on a page (the sidebar from 1024 px
 * and the bar's "Docs menu" below it), and only one copy is ever displayed.
 */
function DocsNav({ current, className }: { current: string; className?: string }) {
  const groups = docsSidebar().map((group) =>
    group.id === "reference" ? { ...group, links: [...group.links, { href: href("checks"), label: "The checks" }] } : group,
  );
  return (
    <nav aria-label={docsPages} className={className}>
      {groups.map((group) => (
        <div key={group.id} className="docs-nav-section">
          <p className="docs-nav-group">{group.label}</p>
          <ul className="docs-nav-list">
            {group.links.map((link) => (
              <li key={link.href}>
                <NavLink href={link.href} prefetch="intent" className="docs-nav-link" aria-current={link.href === current ? "page" : undefined}>
                  {link.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

const tocSteps = (toc: readonly TocItem[]): TrailStep[] => toc.map((item) => ({ label: item.text, href: `#${item.id}` }));

/** "On this page" as a plain list of links: in the bar's panel and in the inline box (only the column is a trail). */
function TocList({ toc }: { toc: readonly TocItem[] }) {
  return (
    <ol className="docs-toc-list">
      {toc.map((item) => (
        <li key={item.id}>
          <a href={`#${item.id}`} className="docs-toc-link">
            {item.text}
          </a>
        </li>
      ))}
    </ol>
  );
}

/** "On this page" as an inline box under the opening (1024 to 1279 px); MDX places it through its wrapper. */
export function InlineToc({ toc }: { toc: readonly TocItem[] }) {
  if (toc.length === 0) return null;
  return (
    <nav aria-label={onThisPage} className="docs-toc-inline" data-pagefind-ignore="">
      <p className="docs-toc-title">{onThisPage}</p>
      <TocList toc={toc} />
    </nav>
  );
}

/**
 * A docs page's shell (§3.5): the docs bar (below 1024 px), the sidebar (from 1024 px), the article (breadcrumb, h1,
 * the meta line, the MDX, then Previous and Next and "Report it on GitHub"), and "On this page" as a StepTrail with a
 * marker that follows the section in view (from 1280 px). The navigation stays out of the search index.
 */
export function DocsShell({ id, path, h1, meta, toc, children }: { id: RouteId; path: string; h1: string; meta: string; toc: readonly TocItem[]; children: ReactNode }) {
  const { prev, next } = prevNext(id);
  return (
    <>
      <div className="docs-bar" data-docs-bar="" data-pagefind-ignore="">
        <div className="container-page docs-bar-inner">
          <details name="docs-bar" className="docs-bar-item">
            <summary>{docsMenu}</summary>
            <div className="docs-bar-panel">
              <DocsNav current={path} />
            </div>
          </details>
          {toc.length > 0 ? (
            <details name="docs-bar" className="docs-bar-item">
              <summary>{onThisPage}</summary>
              <div className="docs-bar-panel">
                <nav aria-label={onThisPage}>
                  <TocList toc={toc} />
                </nav>
              </div>
            </details>
          ) : null}
        </div>
      </div>
      <div className="container-page docs-layout">
        <DocsNav current={path} className="docs-sidebar" />
        <article className="docs-article">
          <div className="docs-head">
            <Breadcrumbs id={id} />
            <h1 className="docs-h1">{h1}</h1>
            <p className="docs-meta">{meta}</p>
          </div>
          <div className="prose-doc">{children}</div>
          <div className="docs-foot" data-pagefind-ignore="">
            <PrevNext prev={prev} next={next} />
            <ReportLine path={path} />
          </div>
        </article>
        {toc.length > 0 ? (
          <div className="docs-toc" data-pagefind-ignore="">
            <nav aria-label={onThisPage}>
              <p className="docs-toc-title">{onThisPage}</p>
              <StepTrail steps={tocSteps(toc)} marker marked={{ index: 0, tone: "accent", current: "location" }} />
            </nav>
          </div>
        ) : null}
      </div>
      <DocsShellClient />
    </>
  );
}
