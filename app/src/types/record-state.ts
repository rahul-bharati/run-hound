/** Type aliases for the record-state helpers shared by the write-side checks. */

import type { Capture } from "../core/types.js";

/** A plain JSON object: keys map to JSON values. */
export type JsonObject = Record<string, unknown>;

/** A request the page made, as the capture holds it. */
export type CapturedRequest = Capture["requests"][number];