import type { ReactNode } from "react";

/** Visible notice shown at the top of every legal page until counsel has reviewed it. */
export function DraftNotice() {
  return (
    <aside
      aria-label="Draft notice"
      className="flex flex-col gap-2 rounded-2xl border border-accent/40 bg-surface p-5 sm:flex-row sm:items-start sm:gap-4"
    >
      <p className="shrink-0 font-mono text-xs tracking-widest text-accent">DRAFT</p>
      <p className="text-sm leading-relaxed text-muted">
        <strong className="font-semibold text-fg">Draft: not yet reviewed by a lawyer.</strong> Placeholders in
        [BRACKETS] will be filled before launch.
      </p>
    </aside>
  );
}

/** Page title and short summary for a legal page. Renders the page's only h1. */
export function LegalTitle({ title, lede }: { title: ReactNode; lede?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-4xl font-extrabold leading-[1.02] tracking-[-0.03em] text-fg sm:text-6xl">
        {title}
      </h1>
      {lede ? <p className="text-lg leading-relaxed text-muted">{lede}</p> : null}
    </div>
  );
}

/** Email address as a mailto link, or as plain text while it is still a [PLACEHOLDER]. */
export function MailLink({ address }: { address: string }) {
  if (address.startsWith("[")) {
    return <strong>{address}</strong>;
  }
  return <a href={`mailto:${address}`}>{address}</a>;
}

/** Callout inside prose for text that needs a lawyer's review before launch. */
export function ReviewNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-5 py-4 text-sm leading-relaxed">
      <p className="font-mono text-xs tracking-widest text-accent">FOR LEGAL REVIEW</p>
      <div className="mt-2 text-muted">{children}</div>
    </div>
  );
}
