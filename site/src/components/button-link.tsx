import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ComponentProps } from "react";
import { Icon, type IconSize } from "@/components/icon";

type Variant = "primary" | "secondary" | "ghost";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-strong",
  secondary: "border border-line-strong bg-bg/40 text-fg hover:border-accent hover:text-accent",
  ghost: "text-muted hover:text-accent",
};

// Same look without hover, dimmed to read as unavailable.
const disabledVariants: Record<Variant, string> = {
  primary: "bg-accent/60 text-accent-ink",
  secondary: "border border-line-strong text-muted",
  ghost: "text-dim",
};

const badgeVariants: Record<Variant, string> = {
  primary: "bg-accent-ink/15 text-accent-ink",
  secondary: "border border-line-strong text-muted",
  ghost: "border border-line-strong text-muted",
};

/** Small "Coming soon" tag for things that aren't built yet. Unused while every feature shown is live. */
export function ComingSoonBadge({ variant = "secondary" }: { variant?: Variant }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-widest ${badgeVariants[variant]}`}
    >
      Coming soon
    </span>
  );
}

/** Right arrow for primary calls to action. */
export function ArrowIcon({ size = 16, className = "" }: { size?: IconSize; className?: string }) {
  return <Icon icon={ArrowRight} size={size} className={className} />;
}

/** GitHub mark, for links to the repository. Lucide has no brand icons, so this one stays hand-drawn. */
export function GitHubIcon({ size = 20, className = "" }: { size?: IconSize; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

const base =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-6 py-3 text-base font-semibold transition-colors";

/**
 * Button-styled link (internal routes or absolute URLs). `comingSoon` renders a disabled button with a
 * "Coming soon" tag instead; nothing uses it while every call to action is live.
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
