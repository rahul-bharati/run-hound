import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { fieldClasses } from "./input";

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={cn(fieldClasses, "min-h-24 px-3 py-2 text-base sm:text-sm", className)} {...props} />;
}
