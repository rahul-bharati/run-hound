import { cva, type VariantProps } from "class-variance-authority";
import { Slot as SlotPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";

/** Shared focus ring: a 2px ring with offset on keyboard focus (never outline-none without a ring). */
export const focusRing =
  "outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold",
    "transition-colors select-none cursor-pointer disabled:pointer-events-none disabled:opacity-60",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    focusRing,
  ],
  {
    variants: {
      variant: {
        // Hover mixes the fill towards --foreground rather than making it translucent: a translucent fill lets the
        // page show through and drops the label under AA while the pointer rests on the button (e.g. right after a
        // click). Towards the foreground is darker in light mode and lighter in dark mode, so contrast only goes up.
        default: "bg-primary text-primary-foreground shadow-soft hover:bg-[color-mix(in_oklch,var(--primary)_88%,var(--foreground))]",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        outline: "border border-input bg-card text-foreground shadow-xs hover:bg-accent hover:text-accent-foreground",
        ghost: "text-foreground hover:bg-accent hover:text-accent-foreground",
        destructive:
          "bg-destructive text-destructive-foreground shadow-soft hover:bg-[color-mix(in_oklch,var(--destructive)_88%,var(--foreground))]",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-lg px-3 text-[13px]",
        lg: "h-11 px-6 text-base",
        icon: "size-10",
        "icon-sm": "size-9 rounded-lg",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    /** Render the single child (e.g. a router <Link>) with button styles instead of a <button>. */
    asChild?: boolean;
    /**
     * Pending state for a save: disables the button, sets aria-busy and shows a spinner before the label. The
     * accessible name stays the label text. Ignored with asChild.
     */
    loading?: boolean;
  };

/** shadcn/ui-style button. Like any <button>, it submits its form unless you pass type="button". */
export function Button({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className);
  if (asChild) {
    return (
      <SlotPrimitive.Slot data-slot="button" className={classes} {...props}>
        {children}
      </SlotPrimitive.Slot>
    );
  }
  return (
    <button data-slot="button" className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}
