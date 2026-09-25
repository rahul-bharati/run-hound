import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** A pulsing placeholder block for loading states (decorative). */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="skeleton" aria-hidden="true" className={cn("animate-pulse rounded-lg bg-muted", className)} {...props} />;
}
