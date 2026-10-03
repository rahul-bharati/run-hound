/**
 * Write construction for write-access: builds the Write a scenario sends for an observed one (updateFrom), with the
 * record's run-token field set to a marker, and sends it (send). The run-token marker is built in
 * `./identity.ts`; the body kinds and the form/object/nested handling live in `./record-body.ts`; the
 * content-type map and the sensitive-key regex live in `constants/write-access-constants.ts`. The other
 * focused modules (CSRF tokens, credentials, version stamps, restoration) live alongside this one.
 */
import { NESTED_FORM_KEY, jsonObjectBody, type CapturedRequest, type JsonObject, type RecordSnapshot } from "../../checks/lib/record-state.js";
import { CONTENT_TYPE, SENSITIVE_KEY } from "../../constants/write-access-constants.js";
import { kindOf, sensitiveBody } from "./record-body.js";
import { markValue } from "./identity.js";
import type { CheckContext, Identity } from "../../core/types.js";
import type { Write } from "../../interfaces/write-access.js";

/**
 * The update this scenario sends for an observed one: the app's own body with one run-token field of the record set to
 * a new marker, where the app's body holds the record: at the top, or one level down ({"task": {...}}) when the top has
 * no run-token field and one object under it does (as isTheRecord reads it; never inside an array). A server that
 * reads the record from body.task would ignore a marker set beside it and read as a pass. Null when the body is neither
 * JSON nor form-encoded, has a password or email key, or the record has no run-token text field. `observed` is always
 * a write for the test record (the `own` writes in run): in the test record's own collection, or at a URL naming its id
 * whose body or answer is the record itself (isTheRecord) and that reads, as Account A, as the whole record
 * (wholeRecordDiff). So the fallback to a run-token field the app's body doesn't send only ever goes to the test
 * record's own URL, never to another record that shares the id and merely mentions, or copies in, a test value.
 */
export function updateFrom(observed: CapturedRequest, snap: RecordSnapshot, key: string, tag: string): Write | null {
  const kind = kindOf(observed.postData);
  if (!kind || sensitiveBody(observed.postData)) return null;
  const record = snap.record;
  const carriesToken = (k: string) => typeof record[k] === "string" && (record[k] as string).toLowerCase().includes(key);
  if (kind === "form") {
    // The key the app sent that holds a run-token field of the record: flat (title) or nested under the model's name
    // (Rails' task[title]). The marker goes there, where the server reads it: a new top-level field the app never sent
    // (title beside task[title]) is one a server with strong params ignores, and would read as a pass.
    const params = new URLSearchParams(observed.postData ?? "");
    const sentKey = [...params.keys()].find((k) => carriesToken(NESTED_FORM_KEY.exec(k)?.[2] ?? k));
    if (!sentKey) return null;
    const field = NESTED_FORM_KEY.exec(sentKey)?.[2] ?? sentKey;
    if (SENSITIVE_KEY.test(field)) return null;
    const value = markValue(record[field] as string, key, tag);
    params.set(sentKey, value);
    return { method: observed.method.toUpperCase(), url: observed.url, body: params.toString(), kind, field, value, ...(sentKey !== field ? { formKey: sentKey } : {}), observed };
  }
  const sent = jsonObjectBody(observed.postData)!;
  const isObject = (v: unknown): v is JsonObject => !!v && typeof v === "object" && !Array.isArray(v);
  // Where the app's own JSON body holds the record: at the top, or one level down when the top has no run-token field.
  const nest =
    !Object.keys(sent).some(carriesToken)
      ? Object.keys(sent).find((k) => {
          const v = sent[k];
          return isObject(v) && Object.keys(v).some(carriesToken);
        })
      : undefined;
  const holder: JsonObject = nest ? (sent[nest] as JsonObject) : sent;
  // A field the app's own update sends and the record holds, else any run-token field of the record (addedField: an
  // accepted write that leaves the record unchanged then proves nothing, see run).
  const sentField = Object.keys(holder).find(carriesToken);
  const field = sentField ?? Object.keys(record).find(carriesToken);
  if (!field || SENSITIVE_KEY.test(field)) return null;
  const value = markValue(record[field] as string, key, tag);
  const body = JSON.stringify(nest ? { ...sent, [nest]: { ...holder, [field]: value } } : { ...sent, [field]: value });
  return {
    method: observed.method.toUpperCase(),
    url: observed.url,
    body,
    kind,
    field,
    value,
    ...(nest ? { nest } : {}),
    ...(sentField ? {} : { addedField: true }),
    observed,
  };
}

/** Sends `w` as `who`; its status, or null when no answer came. */
export async function send(ctx: CheckContext, who: Identity, w: Write): Promise<number | null> {
  const withBody = w.body !== null && w.kind !== null;
  const headers = { ...(withBody ? { "content-type": CONTENT_TYPE[w.kind!] } : undefined), ...w.headers };
  const answer = await ctx
    .request(who, { method: w.method, url: w.url, ...(Object.keys(headers).length > 0 ? { headers } : undefined), ...(withBody ? { body: w.body! } : undefined) })
    .catch(() => null);
  return answer ? answer.status : null;
}
