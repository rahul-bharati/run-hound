import { site } from "@/lib/site";

/**
 * "Release 0.5.0 · 26 September 2026": the release a page describes and the day it came out, machine-readable in
 * <time>. Shown in the hero of /docs/ and /checks/, whose structured data carries the same date (dateModified: the
 * TechArticle on /docs/, the CollectionPage on /checks/).
 * Typed in normal case and set in capitals by CSS, so search snippets and screen readers get normal text.
 */
export function ReleaseLine({ className = "" }: { className?: string }) {
  return (
    <p className={`font-mono text-xs uppercase tracking-widest text-dim ${className}`}>
      Release {site.version} · <time dateTime={site.releasedIso}>{site.released}</time>
    </p>
  );
}
