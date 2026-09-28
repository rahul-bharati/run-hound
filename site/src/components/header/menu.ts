/**
 * The phone menu's logic (DESIGN.md §3.2), apart from React so `pnpm test` checks it: its items, and when focus leaving
 * closes it. Plain types only: the header's client component imports this.
 */
import type { NavLink } from "@/lib/nav";

export type MenuItem = { kind: "hub" | "external" | "cta"; href: string; label: string };

/** The menu's rows, in order: the five hubs, GitHub, "Changelog · v0.6.0", then the call to action. */
export function menuItems({
  links,
  github,
  changelog,
  version,
  cta,
}: {
  links: NavLink[];
  github: string;
  changelog: string;
  version: string;
  cta: { href: string; label: string };
}): MenuItem[] {
  return [
    ...links.map((link): MenuItem => ({ kind: "hub", href: link.href, label: link.label })),
    { kind: "external", href: github, label: "GitHub" },
    { kind: "external", href: changelog, label: `Changelog · v${version}` },
    { kind: "cta", href: cta.href, label: cta.label },
  ];
}

/**
 * Whether a focusout on <header> leaves it: focus went outside the header, or nowhere (a click on the page). Focus
 * moving between the Menu button, the panel's links and the search dialog stays inside, and keeps the menu open. This
 * is the one handler that closes the menu on focus (E1: a handler on the panel alone closed it while tabbing from the
 * Menu button into the panel, or never).
 */
export function leavesHeader(header: { contains(node: never): boolean }, related: unknown): boolean {
  return !related || !header.contains(related as never);
}
