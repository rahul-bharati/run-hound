import { Check } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Radix Checkbox (a <button role="checkbox">). The button is a 24x24 target with a 20px box drawn inside it. The box
 * has a fixed 6px radius: the theme's rounded-md (10px) would turn a 20px box into a circle that reads as a radio.
 * Associate a visible <Label htmlFor> with its `id`.
 */
export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer group/checkbox grid size-6 shrink-0 cursor-pointer place-items-center rounded-lg",
        "outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid size-5 place-items-center rounded-[6px] border border-input bg-card shadow-xs transition-colors",
          "group-data-[state=checked]/checkbox:border-primary group-data-[state=checked]/checkbox:bg-primary group-data-[state=checked]/checkbox:text-primary-foreground",
          "group-aria-invalid/checkbox:border-destructive",
        )}
      >
        <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="grid place-items-center">
          <Check className="size-3.5" strokeWidth={3} />
        </CheckboxPrimitive.Indicator>
      </span>
    </CheckboxPrimitive.Root>
  );
}
