import Image from "next/image";
import type { ReactNode } from "react";

type Shot = {
  src: string;
  width: number;
  height: number;
  alt: string;
  kind: string;
  title: ReactNode;
  text: string;
};

/** Real V0 output from a run on Kennel with its planted bugs switched on (24 September 2026). */
const gif: Shot = {
  src: "/home/double-submit.gif",
  width: 1200,
  height: 664,
  alt: "Recording from Run Hound: the Book a sitter form is filled with test values, Book is double-clicked, and two identical bookings appear in the list.",
  kind: "GIF · ONE FRAME PER STEP",
  title: "One double click, two bookings",
  text: "Run Hound fills the form, double-clicks Book and reloads. Each frame is annotated with the step, the page URL and the capture time.",
};

const stills: Shot[] = [
  {
    src: "/home/double-submit-requests.webp",
    width: 960,
    height: 789,
    alt: "Evidence card: POST /api/bookings sent 2 times by one double click, at +23.7 ms and +24.1 ms, each answered 201 with a different record id. Both request bodies are shown.",
    kind: "CARD · CAPTURED TRAFFIC",
    title: (
      <>
        Two <code className="font-mono text-[0.9em]">POST /api/bookings</code>, 0.4 ms apart
      </>
    ),
    text: "The proof behind the GIF: both requests, both 201 responses, two different record ids.",
  },
  {
    src: "/home/no-visible-focus.webp",
    width: 1384,
    height: 828,
    alt: "Evidence frame: the Pet name field has keyboard focus but looks the same as at rest. A facts panel lists 0 of 31552 pixels changed, and identical outline, shadow, border and background before and after focus.",
    kind: "FRAME · MEASURED FACTS",
    title: "Focus you can't see: 0 of 31,552 pixels change",
    text: "Measured, not guessed: outline, shadow, border and background compared at rest and on focus.",
  },
];

function Figure({ shot, wide = false }: { shot: Shot; wide?: boolean }) {
  return (
    <figure
      className={`flex flex-col overflow-hidden rounded-2xl border border-line bg-surface ${
        wide ? "lg:grid lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]" : ""
      }`}
    >
      <a
        href={shot.src}
        className={`group relative block overflow-hidden border-line bg-bg-deep focus-visible:rounded-none ${
          wide ? "border-b lg:border-b-0 lg:border-r" : "border-b"
        }`}
        aria-label={`Open full size: ${shot.alt}`}
      >
        <Image
          src={shot.src}
          alt={shot.alt}
          width={shot.width}
          height={shot.height}
          unoptimized
          className={`w-full transition-transform duration-500 motion-safe:group-hover:scale-[1.015] ${
            wide ? "h-auto" : "aspect-[16/10] object-cover object-left-top"
          }`}
        />
      </a>
      <figcaption className={`flex flex-col gap-1.5 p-5 ${wide ? "lg:justify-center lg:gap-3 lg:p-8" : ""}`}>
        <span className="font-mono text-[11px] tracking-widest text-dim">{shot.kind}</span>
        <span className={`font-display font-bold leading-snug ${wide ? "text-lg lg:text-2xl" : "text-lg"}`}>
          {shot.title}
        </span>
        <span className="text-[15px] leading-relaxed text-muted">{shot.text}</span>
      </figcaption>
    </figure>
  );
}

export function Evidence() {
  return (
    <div className="flex flex-col gap-6">
      <Figure shot={gif} wide />
      <div className="grid gap-6 md:grid-cols-2">
        {stills.map((s) => (
          <Figure key={s.src} shot={s} />
        ))}
      </div>
      <p className="font-mono text-xs tracking-widest text-dim">
        REAL V0 OUTPUT · FROM A RUN ON OUR DELIBERATELY BROKEN DEMO APP, KENNEL
      </p>
    </div>
  );
}
