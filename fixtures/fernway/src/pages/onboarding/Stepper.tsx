import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const STEPS = ["Workspace", "Invite teammates", "Review"] as const;

/**
 * The wizard's progress: an <ol> whose current item has aria-current="step" (none once setup is finished).
 * Finished steps say so to screen readers; the bars and numbers are decorative.
 */
export function Stepper({ current, finished }: { current: number; finished: boolean }) {
  return (
    <ol aria-label="Setup progress" className="grid grid-cols-3 gap-2 sm:gap-4">
      {STEPS.map((label, i) => {
        const state = finished || i < current ? "complete" : i === current ? "current" : "upcoming";
        return (
          <li key={label} aria-current={state === "current" ? "step" : undefined} className="flex min-w-0 flex-col gap-2.5">
            <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-muted-foreground/15">
              <span
                className={cn(
                  "block h-full origin-left rounded-full bg-linear-to-r from-primary to-brand-via transition-transform duration-500 ease-out",
                  state === "upcoming" ? "scale-x-0" : state === "current" ? "scale-x-50" : "scale-x-100",
                )}
              />
            </span>
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold transition-colors",
                  state === "complete" && "bg-primary text-primary-foreground",
                  state === "current" && "bg-accent text-accent-foreground ring-2 ring-primary",
                  state === "upcoming" && "bg-muted text-muted-foreground",
                )}
              >
                {state === "complete" ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
              </span>
              <span className={cn("min-w-0 text-xs font-medium sm:text-sm", state === "upcoming" ? "text-muted-foreground" : "text-foreground")}>
                {label}
                {state === "complete" && <span className="sr-only"> (done)</span>}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
