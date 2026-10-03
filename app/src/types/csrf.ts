/** Type aliases for the csrf check. */

import type { CSRF_ID as _CsrfId } from "../constants/csrf-constants.js";

export type CsrfId = typeof _CsrfId;

/** How a re-read of the record endpoint as Account A is made: through A's browser page or through CheckContext.request. */
export type ReadVia = "page" | "request";

/** A read of the record endpoint as Account A: its JSON, "gone" for a 404 or 410, null when the read failed. */
export type Reread = { json: unknown } | "gone" | null;