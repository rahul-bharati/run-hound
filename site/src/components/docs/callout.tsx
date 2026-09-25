import type { ReactNode } from "react";

/** Highlighted note box, e.g. the open-source notice on the docs. */
export function Callout({
  label,
  title,
  children,
  className = "",
}: {
  label: string;
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <aside
      aria-label={label}
      className={`flex flex-col gap-2 rounded-2xl border border-accent/60 bg-surface p-5 sm:p-6 ${className}`}
    >
      <p className="font-mono text-xs tracking-widest text-accent">{label.toUpperCase()}</p>
      <p className="font-display text-xl font-bold leading-snug text-fg">{title}</p>
      {children ? <div className="text-[15px] leading-relaxed text-muted">{children}</div> : null}
    </aside>
  );
}
