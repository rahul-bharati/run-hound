import { Breadcrumbs } from "@/components/primitives/breadcrumbs";
import { Card } from "@/components/primitives/card";
import { NavLink } from "@/components/primitives/nav-link";
import { docsHub, type HubCard } from "@/content/docs/hub";
import { docsGroups, routes, type RouteEntry, type RouteId } from "@/content/routes";
import { resolveTarget } from "@/lib/nav";
import { site } from "@/lib/site";
import "./docs-shell.css";

type HubItem = { id?: string; title: string; text: string; href: string };

/**
 * The docs hub (DESIGN.md §3.4): breadcrumb, h1, the meta line and the intro (the old #overview), then the four groups
 * of cards from content/docs/hub.ts. Each card carries the old /docs/#id it keeps and rings once when a link lands on
 * it (.card:target, globals.css). A docs page registered with no card of its own (D2's CLI and glossary) gets one at
 * the end of its group, from its label and its sentence in docsHub.pageCards. Cards prefetch on intent.
 */
export function DocsHub() {
  const linked = new Set<string>(docsHub.groups.flatMap((g) => g.cards.map((c: HubCard) => c.to)));
  const extra = (group: string): HubItem[] =>
    routes
      .filter((r): r is RouteEntry & { docs: NonNullable<RouteEntry["docs"]> } => r.docs?.group === group && !linked.has(r.id))
      .sort((a, b) => a.docs.order - b.docs.order)
      .map((r) => ({
        title: r.label,
        text: docsHub.pageCards.find((c) => c.to === r.id)?.text ?? "",
        href: resolveTarget({ to: r.id as RouteId }),
      }));
  const groups = docsHub.groups.map((group) => ({
    id: group.id,
    label: docsGroups.find((g) => g.id === group.id)?.label ?? group.id,
    cards: [...group.cards.map((c: HubCard): HubItem => ({ id: c.id, title: c.title, text: c.text, href: resolveTarget(c) })), ...extra(group.id)],
  }));
  return (
    <div className="container-page docs-hub">
      <div className="docs-head" id="overview">
        <Breadcrumbs id="docs" />
        <h1 className="docs-h1">{docsHub.h1}</h1>
        <p className="docs-meta">
          For release {site.version} · Updated {site.released}
        </p>
        <p className="docs-lede">{docsHub.intro}</p>
      </div>
      <div className="docs-hub-groups">
        {groups.map((group) => (
          <section key={group.id} aria-labelledby={`docs-group-${group.id}`}>
            <h2 id={`docs-group-${group.id}`} className="docs-hub-title">
              {group.label}
            </h2>
            <ul className="docs-hub-grid">
              {group.cards.map((card) => (
                <Card as="li" key={card.href + card.title} id={card.id} interactive className="docs-hub-card">
                  <h3 className="docs-hub-card-title">
                    <NavLink href={card.href} prefetch="intent" className="docs-hub-link">
                      {card.title}
                    </NavLink>
                  </h3>
                  <p className="docs-hub-card-text">{card.text}</p>
                </Card>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
