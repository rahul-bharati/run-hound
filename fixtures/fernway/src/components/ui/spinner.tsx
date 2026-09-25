import { LoaderCircle } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * A spinning loader. Without `label` it is decorative (aria-hidden), e.g. inside a busy button whose own text stays
 * the accessible name. With `label` it announces itself as a polite status ("Loading projects").
 */
export function Spinner({ className, label, ...props }: ComponentProps<"svg"> & { label?: string }) {
  const icon = <LoaderCircle aria-hidden="true" className={cn("size-4 shrink-0 animate-spin", className)} {...props} />;
  if (!label) return icon;
  return (
    <span role="status" className="inline-flex items-center gap-2">
      {icon}
      <span className="sr-only">{label}</span>
    </span>
  );
}
