import { useEffect, useRef } from "react";

/**
 * "Step n of 3" + the step's <h2> (it names the step's form) + a sentence. With `focusOnMount` the heading takes
 * focus when the step appears, so keyboard and screen reader users land at the top of the new step.
 */
export function StepHeader({ id, step, title, description, focusOnMount }: { id: string; step?: number; title: string; description: string; focusOnMount: boolean }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // Only when the step first appears.
    if (focusOnMount) ref.current?.focus();
  }, []);
  return (
    <div className="flex flex-col gap-1.5">
      {step !== undefined && <p className="text-sm font-semibold text-primary">Step {step} of 3</p>}
      <h2 id={id} ref={ref} tabIndex={-1} className="text-xl font-semibold tracking-tight text-balance outline-hidden sm:text-2xl">
        {title}
      </h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
