import type { LucideIcon, LucideProps } from "lucide-react";
import { Accessibility, Bug, Lock } from "lucide-react";

/** The only icon sizes the site uses. */
export type IconSize = 14 | 16 | 18 | 20 | 24;

type IconProps = Omit<LucideProps, "size" | "strokeWidth" | "ref"> & {
  /** A Lucide icon component, e.g. `ArrowRight`. */
  icon: LucideIcon;
  size?: IconSize;
};

/**
 * Every icon on the site goes through here so stroke and sizing stay identical: Lucide glyphs at a 1.75
 * stroke, coloured with currentColor (set it with a theme text class such as text-accent or text-dim).
 * Icons are decorative by default; pass an `aria-label` for a standalone icon that must be announced.
 */
export function Icon({ icon: Glyph, size = 20, className = "", ...rest }: IconProps) {
  const labelled = rest["aria-label"] !== undefined || rest["aria-labelledby"] !== undefined;
  return (
    <Glyph
      size={size}
      strokeWidth={1.75}
      aria-hidden={labelled ? undefined : true}
      role={labelled ? "img" : undefined}
      className={`shrink-0 ${className}`}
      {...rest}
    />
  );
}

/** One icon per V0 check group, shared wherever the groups are shown. */
export const groupIcons: Record<string, LucideIcon> = {
  accessibility: Accessibility,
  features: Bug,
  security: Lock,
};
