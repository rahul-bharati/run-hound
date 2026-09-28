import { houndBox, houndStrokes } from "@/components/hound/line-hound";

/**
 * Where the 404's hound rests (DESIGN.md §4.3): its head turned -6° round the neck, the storyboard's last beat
 * (src/motion/trail-404-storyboard.ts), so the server's frame is the timeline's end and a reader without motion sees
 * the finished drawing. The neck is 35% / 85% of the hound's box, as the storyboard turns it.
 */
export const headRest = { angle: -6, origin: [0.35, 0.85] as const };

const round = (n: number) => Math.round(n * 1000) / 1000;
const neck = `${round(headRest.origin[0] * houndBox.width)} ${round(headRest.origin[1] * houndBox.height)}`;
const size = { width: 120, height: Math.round((120 * houndBox.height) / houndBox.width) };

/** A path's data without the separators it doesn't need ("M15 140 C 90 130, 170 110" is "M15 140C90 130 170 110"). */
export const compactPath = (d: string) =>
  d
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ ?([A-Za-z]) ?/g, "$1")
    .trim();

/** The hound's fg strokes as one path of subpaths (each starts with its own M): drawn the same, in fewer bytes. */
export const houndLines = houndStrokes.lines.map(compactPath).join("");

/**
 * The 404's drawing (DESIGN.md §3.13, §4.3; the DOM contract's "trail-404" in src/motion/dom-contract.ts): a dim
 * dotted trail across the block and the line hound resting where it ends, nose lifted. Decorative: aria-hidden, no
 * words. The motion island (src/motion/trail-404-timeline.tsx) draws the trail left to right while the hound walks it,
 * dipping its nose twice, then lifting it; until then the three parts are held (data-beat="late"), and without motion
 * this is the finished frame.
 *
 * It is part of the 404's client body (not-found-body.tsx), whose chunk every page loads: utilities only (a stylesheet
 * imported here would be preloaded on every page), and the hound drawn once, inline, with compacted path data.
 *
 * - `trail` is a solid dim <line> that DrawSVG draws; a static mask of 3 px round dots, 9 px apart, makes it dotted
 *   (DrawSVG writes its own stroke-dasharray, so the dots can't be the line's own dash). The mask masks by alpha, so the
 *   dots stay whatever colour forced colours paint the figure's strokes (globals.css). The line is measured when the
 *   timeline is built (the hound walks from its left end), so it is rendered, never inside the mask: an element in a
 *   <mask> has no box. Its svg has no viewBox (1 unit is 1 px), so the dots keep their size at every width; it sits
 *   46 px down (under the nose, dipped) and ends 8 px in from the right, under the resting nose.
 * - `hound` is the line hound (houndStrokes, the mark's geometry, as LineHound draws it; the page has no other hound,
 *   so it needs no sprite symbol; its fg strokes are one path of subpaths), 120 px wide, resting at the trail's end. Its strokes are 9 units wide, 1.7 px at
 *   this size, instead of LineHound's non-scaling 1.6 px, which would take an attribute on every path. `head` is its
 *   head group, turned by a transform attribute round the neck, with transform-origin 0 0 (origin-top-left), so the
 *   attribute's own centre is the only one: GSAP bakes its origin into the same kind of matrix and takes over from
 *   exactly this frame (a CSS rotate with globals.css's 35% / 85% origin makes GSAP start and end the head off by a few
 *   pixels, measured in Chromium).
 */
export function TrailFigure() {
  return (
    <div className="relative h-18 w-full max-w-close" data-motion="trail-404" aria-hidden="true">
      <div className="absolute left-0 right-2 top-11.5 h-2">
        <svg className="block size-full overflow-visible" focusable="false">
          <mask id="trail-404-dots" mask-type="alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
            <line x1="2" y1="4" x2="100%" y2="4" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeDasharray="0 9" />
          </mask>
          <line className="stroke-dim stroke-4" x1="2" y1="4" x2="100%" y2="4" mask="url(#trail-404-dots)" data-part="trail" data-beat="late" />
        </svg>
      </div>
      <svg
        className="line-hound absolute right-0 top-0 stroke-9"
        width={size.width}
        height={size.height}
        viewBox={`0 0 ${houndBox.width} ${houndBox.height}`}
        focusable="false"
        data-part="hound"
        data-beat="late"
      >
        <g className="origin-top-left" transform={`rotate(${headRest.angle} ${neck})`} data-part="head" data-beat="late">
          <path d={houndLines} />
          <path className="line-hound-brow" d={compactPath(houndStrokes.brow)} />
        </g>
      </svg>
    </div>
  );
}
