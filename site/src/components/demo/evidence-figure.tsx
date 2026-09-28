import type { EvidenceShot } from "@/components/evidence";
import { EvidenceImage } from "@/components/evidence-image";
import { Figure } from "@/components/primitives/figure";

/** Half the page column from 1024 px (1136 px column, 32 px gap from 1280; 72 px gutters and a 24 px gap below). */
export const halfSizes =
  "(min-width: 1280px) 552px, (min-width: 1024px) calc(50vw - 84px), (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)";
/**
 * 7 of 12 columns from 1024 px (the 1136 px column with a 48 px gap, lg:gap-12), the full width below: a step's
 * screenshot on /how-it-works/, and the silent failure's recording beside its note on /demo/.
 */
export const wideSizes = "(min-width: 1280px) 650px, (min-width: 1024px) 56vw, (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)";
/** The whole page column. */
export const fullSizes = "(min-width: 1280px) 1136px, (min-width: 1024px) calc(100vw - 144px), (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)";

/**
 * A real evidence image from a Run Hound report in a window (DESIGN.md §2.4), as a Figure: the window's title bar
 * names the check and the kind of evidence (aria-hidden: the caption and the image's alt text carry the facts), and
 * the caption never moves. `reveal` marks the window for the below-the-fold reveal (§4.3): only the media moves.
 * Recordings (GIFs) play once and rest on their proof frame; people who prefer reduced motion get that frame as a still
 * (components/evidence-image.tsx).
 */
export function EvidenceFigure({
  shot,
  label,
  caption,
  sizes = halfSizes,
  reveal = true,
  className,
}: {
  shot: EvidenceShot;
  label: string;
  caption: string;
  sizes?: string;
  reveal?: boolean;
  className?: string;
}) {
  return (
    <Figure caption={caption} reveal={reveal} className={className}>
      <div className="win">
        <div aria-hidden="true" className="win-bar">
          <span className="win-dot" />
          <span className="win-dot" />
          <span className="win-dot" />
          <span className="win-address min-w-0 truncate">{label}</span>
        </div>
        <EvidenceImage src={shot.src} still={shot.still} alt={shot.alt} sizes={sizes} className="block h-auto w-full" />
      </div>
    </Figure>
  );
}
