"use client";

/**
 * What a page renders for its motion (DESIGN.md §4.4): `<MotionGate islands={[…]} />`, with MotionGate this module's
 * default export. It fetches the motion gate (motion-gate.tsx) and renders it. The gate is imported only through
 * import(), here and in the 404's body (components/not-found/not-found-body.tsx), so the bundler emits it once, as one
 * small chunk the pages with motion share (§4.6 #11), instead of merging a copy into each page's own chunk.
 *
 * The import starts when this module is evaluated in the browser (at hydration), not in an effect, so the gate is there
 * as early as it can be: a Save-Data reader's hold is released as soon as it mounts (§4.5). Until it is loaded this
 * renders nothing, as the gate itself does on the server and before its effects run: every figure is the server's
 * finished frame, and the HTML matches. A failed load (offline, a deploy skew) leaves the held parts to the CSS hold's
 * 3 s fallback.
 */
import { type ComponentType, useEffect, useState } from "react";
import type { Island } from "./motion-gate";

type Gate = ComponentType<{ islands: readonly Island[] }>;

/** The gate once loaded (set before the first render when the chunk came first). */
let loaded: Gate | undefined;
const gate: Promise<Gate | undefined> | undefined =
  typeof window === "undefined"
    ? undefined
    : import("./motion-gate").then(
        (mod) => (loaded = mod.MotionGate),
        () => undefined,
      );

/** The default export is what pages import (as MotionGate); the name is for the tests. */
export { MotionGateLoader };

export default function MotionGateLoader({ islands }: { islands: readonly Island[] }) {
  // The gate renders nothing until its own effects run, so rendering it at hydration matches the server's HTML.
  const [Gate, setGate] = useState<Gate | undefined>(() => loaded);
  useEffect(() => {
    if (Gate) return;
    let live = true;
    void gate?.then((found) => {
      if (live && found) setGate(() => found);
    });
    return () => {
      live = false;
    };
  }, [Gate]);
  return Gate ? <Gate islands={islands} /> : null;
}
