import { Circle } from "lucide-react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Radix RadioGroup (role="radiogroup"; arrow keys move between items). Name the group with aria-labelledby
 * (FormControl labelMode="labelledby" does it) and give each item a visible <Label htmlFor>.
 */
export function RadioGroup({ className, ...props }: ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root data-slot="radio-group" className={cn("grid gap-3", className)} {...props} />;
}

/** One option: a 24x24 target (<button role="radio">) with a 20px circle inside. */
export function RadioGroupItem({ className, ...props }: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        "peer group/radio grid size-6 shrink-0 cursor-pointer place-items-center rounded-full",
        "outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="grid size-5 place-items-center rounded-full border border-input bg-card shadow-xs transition-colors group-data-[state=checked]/radio:border-primary"
      >
        <RadioGroupPrimitive.Indicator data-slot="radio-group-indicator" className="grid place-items-center">
          <Circle className="size-2.5 fill-primary text-primary" />
        </RadioGroupPrimitive.Indicator>
      </span>
    </RadioGroupPrimitive.Item>
  );
}
