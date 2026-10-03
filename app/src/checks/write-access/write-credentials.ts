/**
 * `withOwnCredentials`: rewrites a Write's URL credentials to the identity's own where one is known. The
 * credential extractor lives in `./credentials.ts`.
 */
import { credentialParams } from "./credentials.js";
import type { Write } from "../../interfaces/write-access.js";

/**
 * `w` with the credentials its URL carries in the query (credentialParams: ?access_token=, ?api_token=, ?auth=) made
 * the scenario identity's own: its value where a page opened as that identity sent the same parameter to the same
 * origin (`theirs`, from credentialsSent), else left out. Account A's URL sent as it is would still be Account A's own
 * request, whatever cookies go with it. Its `credentials` name each parameter and whether the identity's own value
 * went in.
 */
export function withOwnCredentials(w: Write, theirs: ReadonlyMap<string, string>, runToken: string): Write {
  const found = credentialParams(w.url, runToken);
  if (found.length === 0) return w;
  const url = new URL(w.url);
  const credentials = [...new Set(found.map((c) => c.name))].map((param) => {
    const own = theirs.get(`${url.origin} ${param}`);
    if (own !== undefined) url.searchParams.set(param, own);
    else url.searchParams.delete(param);
    return { param, swapped: own !== undefined };
  });
  return { ...w, url: url.href, credentials };
}
