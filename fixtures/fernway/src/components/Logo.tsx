import { useId } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";

/**
 * The fern mark (decorative). The gradient id is unique per instance: pages show the mark several times, and a
 * shared id breaks every copy's fill in browsers that skip gradients defined inside a hidden (display: none) copy.
 */
export function LogoMark({ className }: { className?: string }) {
  const gradient = `fernway-mark-${useId()}`;
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" className={cn("size-8 shrink-0", className)}>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#10b981" />
          <stop offset="0.55" stopColor="#0d9488" />
          <stop offset="1" stopColor="#0284c7" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${gradient})`} />
      <path d="M16 25.5V8.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M16 12c-2.2-.3-4-1.6-4.8-3.4M16 16c-2.8-.3-5.1-1.9-6.1-4.1M16 20c-3.1-.2-5.8-2-7-4.6M16 12c2.2-.3 4-1.6 4.8-3.4M16 16c2.8-.3 5.1-1.9 6.1-4.1M16 20c3.1-.2 5.8-2 7-4.6"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
        opacity="0.92"
      />
    </svg>
  );
}

/** Mark + "Fernway" wordmark. With `to`, it is a link whose accessible name is "Fernway". */
export function Logo({ to, className, compact = false }: { to?: string; className?: string; compact?: boolean }) {
  const body = (
    <>
      <LogoMark />
      <span className={cn("text-lg font-bold tracking-tight text-foreground", compact && "sr-only")}>Fernway</span>
    </>
  );
  const classes = cn(
    "inline-flex min-h-10 items-center gap-2.5 rounded-lg",
    to && "outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    className,
  );
  return to ? (
    <Link to={to} className={classes}>
      {body}
    </Link>
  ) : (
    <span className={classes}>{body}</span>
  );
}
