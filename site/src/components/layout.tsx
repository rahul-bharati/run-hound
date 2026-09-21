import type { ReactNode } from "react";

/** Page-width container matching the header and footer gutters. */
export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-[72px] ${className}`}>{children}</div>;
}

/** Small mono label used above headings ("01 · PLAN", "ACCESSIBILITY"). */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`font-mono text-xs tracking-widest text-amber ${className}`}>{children}</p>;
}

/** Hero block for inner pages. */
export function PageHeader({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow?: string;
  title: ReactNode;
  lede?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Container className="flex flex-col gap-6 pb-12 pt-16 sm:pt-24">
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h1 className="max-w-4xl font-display text-5xl font-extrabold leading-[0.98] tracking-[-0.03em] sm:text-7xl">
        {title}
      </h1>
      {lede ? <p className="max-w-2xl text-lg leading-relaxed text-muted sm:text-xl">{lede}</p> : null}
      {children}
    </Container>
  );
}

/** Content section with an optional heading. */
export function Section({
  id,
  title,
  intro,
  children,
  className = "",
}: {
  id?: string;
  title?: ReactNode;
  intro?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`py-14 sm:py-20 ${className}`}>
      <Container className="flex flex-col gap-10">
        {title || intro ? (
          <div className="flex max-w-3xl flex-col gap-4">
            {title ? (
              <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
            ) : null}
            {intro ? <p className="text-lg leading-relaxed text-muted">{intro}</p> : null}
          </div>
        ) : null}
        {children}
      </Container>
    </section>
  );
}

/** Surface card. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-surface p-6 sm:p-7 ${className}`}>{children}</div>;
}
