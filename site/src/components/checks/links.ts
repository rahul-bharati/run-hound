import { hasRoute, type RouteId } from "@/content/routes";
import { href } from "@/lib/nav";

/**
 * Where a link to a built-in check goes: its page once it has one (content/checks/pages/index.ts registers it), its
 * card on the hub before (/checks/#<id>, which the registry promises), so every state in between builds.
 */
export function checkHref(id: string): string {
  const page = `check-${id}`;
  return hasRoute(page) ? href(page as RouteId) : href("checks", id);
}

/** A built-in check's page, or undefined while it has none: a hub card links it only then (§3.7). */
export function checkPageHref(id: string): string | undefined {
  const page = `check-${id}`;
  return hasRoute(page) ? href(page as RouteId) : undefined;
}
