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
      {/* Faint hound behind the title, like the reference homepage. Decorative, wide screens only. */}
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-10 hidden opacity-[0.05] lg:block">
        <LogoMark size={420} />
      </div>
      <Container className="relative flex flex-col gap-6 pb-12 pt-16 sm:pt-24">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h1 className="max-w-4xl font-display text-5xl font-extrabold leading-[0.98] tracking-[-0.03em] sm:text-7xl">
          {title}
        </h1>
        {lede ? <p className="max-w-2xl text-lg leading-relaxed text-muted sm:text-xl">{lede}</p> : null}
        {children}
      </Container>
    </div>
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
