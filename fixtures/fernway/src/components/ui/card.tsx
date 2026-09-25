import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Rounded-2xl surface with a hairline border and a soft shadow. Add `glass` for a translucent header-style card. */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn("flex flex-col gap-6 rounded-2xl border bg-card py-6 text-card-foreground shadow-soft", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto]",
        className,
      )}
      {...props}
    />
  );
}

/** Card heading. Renders an <h3> by default; pass `as` for another level so the page outline stays correct. */
export function CardTitle({ className, as: Tag = "h3", ...props }: ComponentProps<"h3"> & { as?: "h2" | "h3" | "h4" | "p" }) {
  return <Tag data-slot="card-title" className={cn("text-base leading-6 font-semibold tracking-tight", className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return <p data-slot="card-description" className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

/** Top-right slot in a CardHeader (a button or menu). */
export function CardAction({ className, ...props }: ComponentProps<"div">) {
  return (
    <div data-slot="card-action" className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)} {...props} />
  );
}

export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("px-6", className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card-footer" className={cn("flex items-center px-6", className)} {...props} />;
}
