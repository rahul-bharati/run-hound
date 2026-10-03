/**
 * Anti-CSRF header helpers for write-access: gives each write whose app's own request carried an anti-CSRF header
 * the scenario identity's own token in that header, read where Account A's came from. The "drifted" cookies a
 * token goes with (driftedFor) live in `./drift.ts`; the by-header-name source map (HEADER_SOURCE) lives in
 * `constants/write-access-constants.ts`; `decodeValue` (a URL-decoded value) lives in `./format.ts`. The other
 * focused modules (identity, record matching, record body, write build, CSRF tokens, credentials, version
 * stamps, restoration) live alongside this one.
 */
import { HEADER_SOURCE } from "../../constants/write-access-constants.js";
import { decodeValue } from "./format.js";
import { driftedFor } from "./drift.js";
import type { TokenSource } from "../../checks/lib/csrf-tokens.js";
import type { Write } from "../../interfaces/write-access.js";

/**
 * Gives each write whose app's own request carried an anti-CSRF header (Capture csrfHeaders: X-CSRFToken, X-XSRF-TOKEN,
 * X-CSRF-Token) the scenario identity's own token in that header (0.6.0 close-out round 1), read where Account A's came
 * from: the source in Account A's page (`ours`: the same cookie or <meta>) whose value, as it is or URL-decoded
 * (Laravel's XSRF-TOKEN cookie, which axios decodes), is the header's, paired by kind and name with the source a page
 * opened as that identity holds (`theirs`), decoded the same way. When no source on Account A's page holds the value any
 * more (Laravel encrypts XSRF-TOKEN anew on every answer, so the cookie never equals the value an earlier request
 * carried), the header is paired with its usual source by name (HEADER_SOURCE; close-out round 2), and the identity's
 * current value goes. Account A's value is never sent: a header with no token of the identity's own is left out, its
 * `headerTokens` say so, and a refusal of it (TOKEN_REFUSALS) is then no proof of an ownership check.
 */
export function withOwnHeaderTokens(writes: Write[], ours: TokenSource[], theirs: TokenSource[], drift: ReadonlySet<string>): Write[] {
  return writes.map((w) => {
    const sent = Object.entries(w.observed.csrfHeaders ?? {});
    if (sent.length === 0) return w;
    const headers: Record<string, string> = {};
    const headerTokens = sent.map(([name, value]) => {
      const source = ours.find((t) => t.value === value) ?? ours.find((t) => decodeValue(t.value) === value);
      let token: string | null = null;
      let mine: TokenSource | undefined;
      if (source) {
        const decoded = source.value !== value;
        mine = theirs.find((t) => t.kind === source.kind && t.name === source.name);
        token = mine ? (decoded ? decodeValue(mine.value) : mine.value) : null;
      } else {
        const usual: { kind: "cookie" | "meta" | "input"; name: string; decode: boolean } | undefined = HEADER_SOURCE[name.toLowerCase()];
        mine = usual ? theirs.find((t) => t.kind === usual.kind && t.name.toLowerCase() === usual.name) : undefined;
        if (usual && mine) token = usual.decode ? decodeValue(mine.value) : mine.value;
      }
      if (!token || token === value || !mine) return { name, swapped: false };
      headers[name] = token;
      const drifted = driftedFor(mine, drift);
      return { name, swapped: true, ...(drifted.length > 0 ? { drifted } : {}) };
    });
    return { ...w, headers, headerTokens };
  });
}
