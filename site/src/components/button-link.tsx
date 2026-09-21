import Link from "next/link";
import type { ComponentProps } from "react";

type Variant = "primary" | "secondary" | "ghost";

const variants: Record<Variant, string> = {
  primary: "bg-amber text-amber-ink hover:bg-[#ffc55c]",
  secondary: "border border-line-strong text-fg hover:border-amber hover:text-amber",
  ghost: "text-muted hover:text-amber",
};

// Same look without hover, dimmed to read as unavailable.
const disabledVariants: Record<Variant, string> = {
  primary: "bg-amber/70 text-amber-ink",
  secondary: "border border-line-strong text-muted",
  ghost: "text-dim",
};

const badgeVariants: Record<Variant, string> = {
  primary: "bg-amber-ink/15 text-amber-ink",
  secondary: "border border-line-strong text-muted",
  ghost: "border border-line-strong text-muted",
};

/** Small "Coming soon" tag for things that aren't released yet. */
export function ComingSoonBadge({ variant = "secondary" }: { variant?: Variant }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-widest ${badgeVariants[variant]}`}
    >
      Coming soon
    </span>
  );
}

const base =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-6 py-3 text-base font-semibold transition-colors";

/**
 * Button-styled link. With `comingSoon`, it renders a disabled button with a
 * "Coming soon" tag instead of a link, until the thing it points to is released.
 */
export function ButtonLink({
  variant = "primary",
  comingSoon = false,
  className = "",
  children,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; comingSoon?: boolean }) {
  if (comingSoon) {
    return (
      <button
        type="button"
        disabled
        className={`${base} ${disabledVariants[variant]} cursor-not-allowed ${className}`}
      >
        {children}
        <ComingSoonBadge variant={variant} />
      </button>
    );
  }

  return (
    <Link {...props} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </Link>
  );
}
