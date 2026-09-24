import type { ReactNode } from "react";
import type { EvidenceShot } from "@/components/evidence";
import { EvidenceImage } from "@/components/evidence-image";

/**
 * A real evidence image from a Run Hound report, framed like a window. Recordings (GIFs) show their last frame to
 * people who prefer reduced motion. `sizes` defaults to half the page on large screens.
 */
export function EvidenceFigure({
  shot,
  label,
  caption,
  sizes = "(min-width: 1280px) 560px, (min-width: 1024px) 50vw, (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)",
  className = "",
}: {
  shot: EvidenceShot;
  label: string;
  caption: ReactNode;
  sizes?: string;
  className?: string;
}) {
  return (
    <figure className={`flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface ${className}`}>
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span aria-hidden="true" className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="size-2.5 rounded-full bg-line-strong" />
        </span>
        <span className="min-w-0 truncate font-mono text-[11px] tracking-widest text-dim">{label}</span>
      </div>
      <div className="bg-bg-deep">
        <EvidenceImage
          src={shot.src}
          still={shot.still}
          alt={shot.alt}
          sizes={sizes}
          className="block h-auto w-full"
        />
      </div>
      <figcaption className="border-t border-line px-4 py-3.5 text-sm leading-relaxed text-muted">{caption}</figcaption>
    </figure>
  );
}
