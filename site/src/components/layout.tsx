import type { ReactNode } from "react";
import { LogoMark } from "@/components/logo";

/** Page-width container matching the header and footer gutters. */
export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-[72px] ${className}`}>{children}</div>;
}

/** Small mono label used above headings ("01 · PLAN", "ACCESSIBILITY"), led by a mint dot as in the brand reference. */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`flex items-center gap-2.5 font-mono text-xs tracking-[0.18em] text-accent ${className}`}>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-accent" />
      <span>{children}</span>
    </p>
  );
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
    <div className="hero-glow relative overflow-hidden">
      {/* Faint hound centred behind the title, as on the homepage hero. Decorative; hidden on small screens. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 hidden -translate-x-1/2 opacity-[0.05] md:block lg:-top-10 lg:opacity-[0.07]"
      >
        <LogoMark size={420} />
      </div>
      <Container className="relative flex flex-col gap-6 pb-12 pt-14 sm:pb-16 sm:pt-24">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h1 className="max-w-4xl text-balance font-display text-[2.75rem] font-extrabold leading-[0.98] tracking-[-0.03em] sm:text-6xl lg:text-7xl">
          {title}
        </h1>
        {lede ? <p className="max-w-2xl text-pretty text-lg leading-relaxed text-muted sm:text-xl">{lede}</p> : null}
        {children}
      </Container>
    </div>
  );
}

/**
 * Content section with an optional eyebrow, heading and intro. Every section on the site uses the same vertical
 * rhythm (64 px on phones, 96 px from sm) and the same heading scale, so pages read as one system.
 */
export function Section({
  id,
  eyebrow,
  title,
  intro,
  children,
  className = "",
}: {
  id?: string;
  eyebrow?: string;
  title?: ReactNode;
  intro?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = id && title ? `${id}-heading` : undefined;
  return (
    <section id={id} aria-labelledby={headingId} className={`scroll-mt-20 py-16 sm:py-24 ${className}`}>
      <Container className="flex flex-col gap-10 sm:gap-12">
        {eyebrow || title || intro ? (
          <div className="flex max-w-3xl flex-col gap-4">
            {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
            {title ? (
              <h2
                id={headingId}
                className="text-balance font-display text-3xl font-bold leading-[1.1] tracking-tight sm:text-[2.5rem]"
              >
                {title}
              </h2>
            ) : null}
            {intro ? <p className="text-pretty text-lg leading-relaxed text-muted">{intro}</p> : null}
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

/** Small mono tag for things that shipped recently ("New", "V2 preview"). */
export function NewTag({ children = "New", className = "" }: { children?: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border border-accent/50 bg-accent/10 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-widest text-accent ${className}`}
    >
      {children}
    </span>
  );
}
