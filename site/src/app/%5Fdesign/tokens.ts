/**
 * The token values /_design/ shows, read from src/styles/tokens.css at build time (the page is prerendered), so the
 * page never keeps a second copy of the numbers. Contrast ratios are WCAG 2.2's (relative luminance of sRGB).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { declarationsAt, parseCss, resolveVar } from "@/styles/read-tokens";

/** tokens.css, as the build reads it (next build runs in site/). */
export function tokensCss(): string {
  return readFileSync(join(process.cwd(), "src", "styles", "tokens.css"), "utf8");
}

/**
 * The declarations in the blocks found along `path` (each step a block's prelude, whitespace collapsed): [":root"] for
 * the top-level :root blocks, ["@media (width >= 40rem)", ":root"] for those from 640 px. Read with the same reader as
 * src/styles/tokens.test.ts.
 */
export function declarationsIn(css: string, path: readonly string[]): Map<string, string> {
  return declarationsAt(parseCss(css), path);
}

/** A role's colour, following var() to the palette's literal. */
export function resolveColour(name: string, declarations: Map<string, string>): string | undefined {
  const value = resolveVar(`var(${name})`, [declarations]);
  return value.startsWith("var(") ? undefined : value;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio of two #rrggbb colours, to two decimals. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
}

/** A rem length as px ("2.625rem" is "42"). */
export const px = (rem: string | undefined): string => (rem?.endsWith("rem") ? String(parseFloat(rem) * 16) : (rem ?? "–"));
