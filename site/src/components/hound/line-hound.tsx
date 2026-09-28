/**
 * The line hound (DESIGN.md §2.6, docs/brand.md "Logo"): an illustration in the mark's geometry, not the mark. The
 * mark (public/brand/hound-mark-light.png) is the logo and never moves; this is the mark traced as 8 uniform,
 * round-capped strokes in fg, with the one brow stroke in accent as the mark has it (traced in the hound prototype's
 * hound-glyph.tsx over the 640 × 368 mark). It appears at most once per page: resting above the homepage's closing
 * heading (64 px wide, from 640 px), or walking the trail on the 404 (120 px). Never beside a docs h1 or a check
 * eyebrow, never on a figure, never in the hero. Always aria-hidden.
 *
 * The strokes are one <symbol id="line-hound"> in the page sprite (<Sprite hound />); LineHound draws it with <use>.
 * The whole drawing is the hound's head, so its head group turns as one (around the neck, 35% / 85% of the box) with
 * no gap between strokes when the 404 hound dips and lifts its nose.
 */
export const houndStrokes = {
  // Fg strokes, drawn left to right like the mark's swept lines.
  lines: [
    "M15 140 C 90 130, 170 110, 220 82 C 250 66, 290 54, 326 56",
    "M160 200 C 230 175, 300 135, 350 110 C 390 92, 430 95, 446 118",
    "M372 100 C 330 120, 290 170, 270 205 C 255 235, 235 262, 210 276",
    "M150 22 C 250 8, 310 22, 345 38",
    "M553 162 C 570 180, 600 205, 618 216 C 628 222, 622 234, 606 236 C 580 250, 545 256, 505 238 C 470 222, 445 205, 425 202 C 390 205, 330 245, 300 285 C 280 310, 260 335, 228 352",
    "M425 200 C 420 185, 425 170, 430 160",
    "M492 143 C 510 142, 518 146, 520 152 C 523 160, 528 165, 535 170",
  ],
  // The mark's mint highlight along the brow.
  brow: "M345 38 C 380 55, 410 74, 460 80 C 500 88, 530 110, 545 135 C 550 145, 552 155, 553 162",
} as const;

/** The drawing's box: the mark's 640 × 368. */
export const houndBox = { width: 640, height: 368 } as const;

/** The hound's strokes as the sprite's <symbol id="line-hound">. Strokes take their colour and width from the <svg> using it. */
export function LineHoundSymbol() {
  return (
    <symbol id="line-hound" viewBox={`0 0 ${houndBox.width} ${houndBox.height}`}>
      {houndStrokes.lines.map((d) => (
        <path key={d} d={d} vectorEffect="non-scaling-stroke" />
      ))}
      <path className="line-hound-brow" d={houndStrokes.brow} vectorEffect="non-scaling-stroke" />
    </symbol>
  );
}

/**
 * The line hound, `size` px wide (64 at the homepage's close, 120 on the 404). `parts` marks it for the 404's motion
 * (DESIGN.md §4.3): the svg as data-part="hound" and its head group as data-part="head", both held (data-beat="late")
 * until the motion island or the 3 s fallback shows them.
 */
export function LineHound({ size = 64, parts = false, className }: { size?: 64 | 120; parts?: boolean; className?: string }) {
  const held = parts ? { "data-beat": "late" } : {};
  return (
    <svg
      className={className ? `line-hound ${className}` : "line-hound"}
      width={size}
      height={Math.round((size * houndBox.height) / houndBox.width)}
      viewBox={`0 0 ${houndBox.width} ${houndBox.height}`}
      aria-hidden="true"
      focusable="false"
      {...(parts ? { "data-part": "hound" } : {})}
      {...held}
    >
      <g className="line-hound-head" {...(parts ? { "data-part": "head" } : {})} {...held}>
        <use href="#line-hound" />
      </g>
    </svg>
  );
}
