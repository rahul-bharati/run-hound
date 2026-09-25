import type { ReactNode } from "react";
import { evidence, type EvidenceShot } from "@/components/evidence";
import { EvidenceImage } from "@/components/evidence-image";

type Shot = {
  shot: EvidenceShot;
  kind: string;
  title: ReactNode;
  text: string;
};

/** Real output (V0, 0.1.0) from a run on Kennel with its planted bugs switched on. */
const gif: Shot = {
  shot: evidence.doubleSubmitRecording,
  kind: "GIF · ONE FRAME PER STEP",
  title: "One double click, two bookings",
  text: "Run Hound fills the form, double-clicks Book and waits for the saves. Each frame is annotated with the step, the page URL and the capture time.",
};

const stills: Shot[] = [
  {
    shot: evidence.doubleSubmitCard,
    kind: "CARD · CAPTURED TRAFFIC",
    title: (
      <>
        Two <code className="font-mono text-[0.9em]">POST /api/bookings</code>, 0.2 ms apart
      </>
    ),
    text: "The proof behind the GIF: both requests, both 201 responses, two different record ids.",
  },
  {
    shot: evidence.noVisibleFocus,
    kind: "FRAME · MEASURED FACTS",
    title: "Focus you can't see: 0 of 31,552 pixels change",
    text: "Measured, not guessed: outline, shadow, border and background compared at rest and on focus.",
  },
];

const wideSizes =
  "(min-width: 1280px) 760px, (min-width: 1024px) 66vw, (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)";
const halfSizes = "(min-width: 1280px) 560px, (min-width: 768px) 50vw, calc(100vw - 32px)";

function Figure({ item, wide = false }: { item: Shot; wide?: boolean }) {
  const { shot } = item;
  return (
    <figure
      className={`flex flex-col overflow-hidden rounded-2xl border border-line bg-surface ${
        wide ? "lg:grid lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]" : ""
      }`}
    >
      <a
        href={shot.src.src}
        className={`group relative block overflow-hidden border-line bg-bg-deep focus-visible:rounded-none ${
          wide ? "border-b lg:border-b-0 lg:border-r" : "border-b"
        }`}
        aria-label={`Open full size: ${shot.alt}`}
      >
        <EvidenceImage
          src={shot.src}
          still={shot.still}
          alt={shot.alt}
          sizes={wide ? wideSizes : halfSizes}
          className={`block w-full transition-transform duration-500 motion-safe:group-hover:scale-[1.015] ${
            wide ? "h-auto" : "aspect-[16/10] object-cover object-left-top"
          }`}
        />
      </a>
      <figcaption className={`flex flex-col gap-1.5 p-5 ${wide ? "lg:justify-center lg:gap-3 lg:p-8" : ""}`}>
        <span className="font-mono text-[11px] tracking-widest text-dim">{item.kind}</span>
        <span className={`font-display font-bold leading-snug ${wide ? "text-lg lg:text-2xl" : "text-lg"}`}>
          {item.title}
        </span>
        <span className="text-[15px] leading-relaxed text-muted">{item.text}</span>
      </figcaption>
    </figure>
  );
}

export function Evidence() {
  return (
    <div className="flex flex-col gap-6">
      <Figure item={gif} wide />
      <div className="grid gap-6 md:grid-cols-2">
        {stills.map((s) => (
          <Figure key={s.shot.src.src} item={s} />
        ))}
      </div>
      <p className="font-mono text-xs tracking-widest text-dim">
        REAL V0 OUTPUT · FROM A RUN ON OUR DELIBERATELY BROKEN DEMO APP, KENNEL
      </p>
    </div>
  );
}
