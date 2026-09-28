/**
 * Resuming ScrollTrigger without rewinding the pipeline (the scroll engine's; its own module, so the runtime's
 * after-load shell doesn't carry it).
 */
import type { ScrollTriggerLike } from "../runtime-core";

/**
 * ScrollTrigger as the runtime drives it, resumed without losing the pipeline's place. ScrollTrigger.enable()
 * re-measures every trigger from progress 0 and renders its animation there (ScrollTrigger.js: enable() calls each
 * trigger's enable(0, 1), which resets its progress and refreshes; measured on the M1 harness, desktop, the pipeline's
 * timeline went from 0.506 to 0 on a resume and stayed there until the next scroll event), so a resume would put lit
 * nodes out (§4.6 #10, DESIGN.md §5.10 R3). This puts the timeline back where it was and has ScrollTrigger re-read the
 * scroll at once, so the scrub carries on from there.
 */
export function keepProgressOnEnable(
  scrollTrigger: ScrollTriggerLike & { update(): void },
  timeline: () => { progress(): number; progress(value: number): unknown } | undefined,
): ScrollTriggerLike {
  return {
    enable() {
      const current = timeline();
      const at = current?.progress();
      scrollTrigger.enable();
      if (current && at !== undefined) {
        current.progress(at);
        scrollTrigger.update();
      }
    },
    disable: (reset) => scrollTrigger.disable(reset),
  };
}
