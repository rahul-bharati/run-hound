import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Field control styles shared by Input, Textarea and SelectTrigger. */
export const fieldClasses = [
  "w-full min-w-0 rounded-xl border border-input bg-card text-foreground shadow-xs transition-colors",
  "placeholder:text-muted-foreground",
  "outline-hidden focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  "aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive",
  "disabled:cursor-not-allowed disabled:opacity-60",
].join(" ");

export function Input({ className, type = "text", ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        fieldClasses,
        "h-10 px-3 py-2 text-base sm:text-sm",
        "file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        "[&::-webkit-calendar-picker-indicator]:cursor-pointer dark:[&::-webkit-calendar-picker-indicator]:invert",
        className,
      )}
      {...props}
    />
  );
}
