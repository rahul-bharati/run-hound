import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * D18 on /_design/ (DESIGN.md §2.2; brief D18): Bricolage Grotesque's display steps with its opsz (optical size) axis
 * and without it, at 40, 60 and 80 px, so the maintainer can decide whether the axis earns its 35.6 KB on every first
 * visit. The layout loads Bricolage with the axis (app/layout.tsx, axes: ["opsz"]), so:
 * - "with" is what the site renders today: font-optical-sizing auto, which sets opsz to the size in px;
 * - "without" is what a file without the axis renders: the font's default opsz, pinned with font-variation-settings.
 *   next/font requests only the weight axis unless told otherwise (next/dist/docs/01-app/03-api-reference/02-components/
 *   font.md, "axes"), and Google then serves the default instance of every other axis. The default is read from the
 *   font data next/font itself uses, not typed here.
 *
 * Each pair is set as the site sets that size: 40 px is Display M's desktop size (weight 700), 60 and 80 px take
 * Display XL's weight 800, each with its step's tracking. The sizes and the pinned opsz live in design.css (no inline
 * style in a Server Component, §2.9 rule 6); design.test.ts checks the pinned value equals opszDefault(). The lab
 * (scripts/lab/specs/design.spec.mjs) checks both render in Bricolage and records each pair's widths and the share of
 * pixels that differ.
 */
export const opszSizes = [40, 60, 80] as const;

type FontData = Record<string, { axes?: { tag: string; defaultValue: number }[] }>;

/** Bricolage Grotesque's default opsz, from next/font's Google font data (installed with next). */
export function opszDefault(): number {
  const file = join(process.cwd(), "node_modules", "next", "dist", "compiled", "@next", "font", "dist", "google", "font-data.json");
  const data = JSON.parse(readFileSync(file, "utf8")) as FontData;
  const axis = data["Bricolage Grotesque"]?.axes?.find((a) => a.tag === "opsz");
  if (!axis) throw new Error(`${file}: Bricolage Grotesque has no opsz axis`);
  return axis.defaultValue;
}

const sample = "Find the bugs";

export function OpszComparison() {
  const pinned = opszDefault();
  return (
    <div className="dz-opsz">
      {opszSizes.map((size) => (
        <div key={size} className="dz-opsz-pair" role="group" aria-label={`${size} px`}>
          <p className="font-mono text-mono text-muted">{size} px</p>
          {/* A region that scrolls sideways where the line is wider than the screen, so the page never does. */}
          <div className="dz-opsz-lines" tabIndex={0} role="region" aria-label={`${size} px, with and without the axis`}>
            <p className="dz-opsz-line">
              <span className="dz-opsz-label">With the axis (opsz {size})</span>
              <span className="dz-opsz-sample dz-opsz-auto" data-opsz="auto" data-size={size}>
                {sample}
              </span>
            </p>
            <p className="dz-opsz-line">
              <span className="dz-opsz-label">Without it (opsz {pinned})</span>
              <span className="dz-opsz-sample" data-opsz="default" data-size={size}>
                {sample}
              </span>
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
