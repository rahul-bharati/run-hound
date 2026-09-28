/**
 * What the scroll runtime's island (scroll-runtime.tsx) needs to arm before the runtime itself is loaded (DESIGN.md
 * §4.4): which [data-motion] roots are scroll effects, and how near one must come for the runtime to be imported. Its
 * own module, so the island's after-load chunk doesn't carry runtime-core.ts (which reads the same two values).
 */

/** The scroll effects: the data-motion names the scroll runtime plays (the islands' roots are not among them). */
export const scrollEffectNames = ["pipeline", "evidence-trio", "card-trace", "reveal"] as const;

/** Effects are near when they come within half a viewport below the screen. */
export const nearMargin = "0px 0px 50% 0px";
