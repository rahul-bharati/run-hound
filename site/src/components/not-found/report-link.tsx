"use client";

/**
 * The link of "Followed a broken link here? Tell us on GitHub" (DESIGN.md §3.13). A 404 is one prerendered page served
 * for every missing path, so the path is known only in the browser: the server renders the bare bug form
 * (useSyncExternalStore's server snapshot, also what hydration uses), and the browser then adds location.pathname as
 * the issue title (report-href.ts). `formUrl` comes from the server (lib/nav.ts bugFormUrl); the words are children.
 * The markup is TextLink's for a link off the site (primitives/links.tsx), written out: TextLink's code would otherwise
 * ride in the 404's chunk, which every page loads (not-found-body.tsx).
 */
import { type ReactNode, useSyncExternalStore } from "react";
import { primitiveLabels } from "@/components/primitives/labels";
import { reportHref } from "./report-href";

const noChange = () => () => {};
const pathname = () => location.pathname;
const noPath = () => null;

export function ReportBrokenLink({ formUrl, children }: { formUrl: string; children: ReactNode }) {
  const path = useSyncExternalStore(noChange, pathname, noPath);
  return (
    <a className="text-link has-ext" href={reportHref(formUrl, path)}>
      {children}
      <span className="sr-only">{primitiveLabels.opens("GitHub")}</span>
    </a>
  );
}
