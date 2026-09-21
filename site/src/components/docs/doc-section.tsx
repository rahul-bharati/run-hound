import type { ReactNode } from "react";

/** One anchored section of a docs page. */
export function DocSection({
  id,
  step,
  title,
  children,
}: {
  id: string;
  step?: string;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="flex scroll-mt-28 flex-col gap-6">
      <div className="flex flex-col gap-2">
        {step ? <p className="font-mono text-xs tracking-widest text-amber">{step}</p> : null}
        <h2 id={`${id}-heading`} className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}
