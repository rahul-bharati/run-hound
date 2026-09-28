/**
 * Account A's entitlement (plan, role, credits, entitlements), read and compared as Account A (0.6.0, docs/v2-spec.md
 * "`paywall-trust` amendments"). Used by paywall-trust only. Every read is a GET as Account A through
 * CheckContext.request (the safety gate applies). Nothing here writes: restoring a changed plan goes through the app's
 * own UI in paywall-trust.
 *
 * Which object is Account A's: a JSON object that names Account A by a whole identity value (its email or username in
 * a field such as `email`, `username`, `login`, `name`; compared without case, never as a substring) and holds at least
 * one ENTITLEMENT_KEYS field, or one that holds the fields and has Account A's own object as a direct child
 * (`{ user: { email }, plan }`), whose entitlement fields are then kept too, by dotted name (`user.role`). A list of
 * several objects is never Account A's (a team, other users); a one-row list is (PostgREST's select without
 * `.single()`) only when that row holds a plan-like field, not a bare team `role`. An object that only lists Account A
 * among its members inside a list (a workspace) is not Account A's either. An object with no entitlement field of its
 * own is taken when Account A's own object inside it holds one and it has a key that may hold a trial marker (`{ user:
 * { email, plan }, subscription_status }`, 0.6.0 review, round 2), so the trial kept beside Account A's object is read
 * too. The username is matched, never returned: a value that holds it is kept with it replaced by "[account]".
 */
import type { CheckContext } from "../../core/types.js";

/**
 * The fields that make a JSON object an entitlement, matched on the key lower-cased without "-", "_" or spaces (0.6.0
 * review, round 2: `is_pro`, a Supabase or Postgres profile's column, is `isPro`).
 */
export const ENTITLEMENT_KEYS = ["plan", "tier", "subscription", "isPro", "pro", "credits", "entitlements", "features", "role"] as const;

/** A request the app itself made as Account A while the page loaded (method, absolute URL, JSON response body). */
export interface ObservedRead {
  method: string;
  url: string;
  status: number;
  /** The parsed JSON body, or null when it wasn't JSON. */
  json: unknown;
}

/** Where Account A's entitlement lives, and its values when it was found. */
export interface EntitlementSnapshot {
  /** The GET that returned it (same origin as the page, or the app's local API). */
  url: string;
  /** Dotted path to the object inside the response (e.g. "" for the root, "user", "data.account"). */
  path: string;
  /** The entitlement fields found, with their values (JSON values, compared structurally). */
  values: Record<string, unknown>;
}

type JsonObject = Record<string, unknown>;

/** A key as it is compared: lower-case, without "-", "_" or spaces (`is_pro`, `IS-PRO` and `isPro` are "ispro"). */
const normKey = (k: string) => k.toLowerCase().replace(/[-_\s]/g, "");

const KEYS = new Set<string>(ENTITLEMENT_KEYS.map(normKey));

/** How deep a response is searched for Account A's object. */
const MAX_DEPTH = 8;

/** What a string holding Account A's username is kept as. */
const HIDDEN = "[account]";

/**
 * Keys whose value says who an object is (compared lower-case, without "-", "_" or spaces). Not `owner`, `createdBy`
 * or `invitedBy`: those name Account A on an object that belongs to something else (a workspace, an invitation).
 */
const IDENTITY_KEY =
  /^(e?mail|emailaddress|primaryemail|useremail|accountemail|username|user|login|userlogin|handle|name|displayname|fullname|accountname|preferredusername|nickname)$/;

const isObject = (v: unknown): v is JsonObject => v !== null && typeof v === "object" && !Array.isArray(v);
const isEntitlementKey = (k: string) => KEYS.has(normKey(k));

/** Account A's names as they are compared: trimmed, lower-case, never empty. */
function namesOf(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim().toLowerCase()).filter((v) => v.length > 0))];
}

/** True when `obj` names Account A by a whole identity value (never a value that merely contains it). */
function namesAccount(obj: JsonObject, names: string[]): boolean {
  return Object.entries(obj).some(([k, v]) => typeof v === "string" && IDENTITY_KEY.test(normKey(k)) && names.includes(v.trim().toLowerCase()));
}

/** `value` with every string that holds one of `names` (3 characters or more, any case) rewritten to hide it. */
function hideNames(value: unknown, names: string[]): unknown {
  const long = names.filter((n) => n.length >= 3);
  if (long.length === 0) return value;
  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === "string") {
      let out = v;
      for (const n of long) {
        const lower = out.toLowerCase();
        if (!lower.includes(n)) continue;
        let rebuilt = "";
        let at = 0;
        for (let i = lower.indexOf(n); i >= 0; i = lower.indexOf(n, at)) {
          rebuilt += out.slice(at, i) + HIDDEN;
          at = i + n.length;
        }
        out = rebuilt + out.slice(at);
      }
      return out;
    }
    if (depth > MAX_DEPTH * 2) return v;
    if (Array.isArray(v)) return v.map((item) => walk(item, depth + 1));
    if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, item]) => [k, walk(item, depth + 1)]));
    return v;
  };
  return walk(value, 0);
}

/**
 * Trial markers kept beside the entitlement fields of the same object (0.6.0 review, round 1: a trial is often kept
 * beside the plan, `{ plan: "pro", subscription_status: "trialing" }`, `trial_ends_at`, `isTrial`), so onTrial can
 * tell a trial starting from a paid plan. Compared on the key lower-cased without "-", "_" or spaces. They never make
 * an object an entitlement on their own. A flag (`isTrial`) and an end date (`trial_ends_at`, Stripe's `trial_end`) and
 * a subscription status of its own (`subscription_status`) are kept whatever their value; a bare `status` or `state`
 * only while it says trial (an account's own `status: "active"` says nothing about the plan, and would only add a
 * value that may move on its own).
 */
const TRIAL_FLAG_KEY = /^(trial|istrial|ontrial|intrial|trialing|istrialing|trialactive|istrialactive)$/;
/**
 * A trial's end date: `trial_ends_at`, Stripe's `trial_end`, and (0.6.0 review, round 2) any other spelling of a trial
 * that ends, expires or runs until a date or time (`trial_expires_on`, `trialEndDate`, `trial_period_ends_at`).
 */
const TRIAL_END_KEY = /^trial(period)?(end|ends|ended|expire|expires|expiry|expiration|until)(at|on|date|time|timestamp)?$/;
/** Days left of a trial (`trialDaysLeft`, `trial_days_remaining`, `days_left_in_trial`): a trial while more than 0. */
const TRIAL_LEFT_KEY = /^(trial(days)?(left|remaining)|days(left|remaining)(in)?trial)$/;
/** A subscription status of its own, kept whatever its value: Laravel Cashier's `stripe_status` among them. */
const STATUS_KEY = /^(subscription|billing|plan|stripe|stripesubscription|paddle|paddlesubscription|lemonsqueezy|sub)status$/;
const PLAIN_STATUS_KEY = /^(status|state)$/;
/**
 * A direct child object that holds the account's billing state beside it (`billing: { status: "trialing",
 * trial_ends_at }`, 0.6.0 review, round 2): its trial markers are kept as "<key>.<field>".
 */
const MARKER_HOLDER = /^(billing|billinginfo|billingdetails|billingstate|trialinfo|subscriptioninfo|subscriptiondetails|subscriptionstate|membership|stripe|paddle|lemonsqueezy|payment|payments)$/;

/** True when `key: value` is a trial marker to keep beside the entitlement fields (see TRIAL_FLAG_KEY). */
function keptMarker(key: string, value: unknown): boolean {
  const k = normKey(key);
  if (TRIAL_FLAG_KEY.test(k) || TRIAL_END_KEY.test(k) || TRIAL_LEFT_KEY.test(k) || STATUS_KEY.test(k)) return true;
  return PLAIN_STATUS_KEY.test(k) && typeof value === "string" && TRIAL_WORD.test(normPlan(value));
}

/**
 * True when `key` may hold a trial marker, whatever its value now (a trial flag, end date, days left or status of its
 * own, or an object that holds the billing state: MARKER_HOLDER). An object whose plan comes only from Account A's own
 * object inside it is taken as Account A's when it has one, so a trial kept beside that object is read too.
 */
function markerKey(key: string): boolean {
  const k = normKey(key);
  return TRIAL_FLAG_KEY.test(k) || TRIAL_END_KEY.test(k) || TRIAL_LEFT_KEY.test(k) || STATUS_KEY.test(k) || MARKER_HOLDER.test(k);
}

/**
 * The entitlement fields of `obj` (its own, by their key) and of every direct child object that names Account A (by
 * "<child key>.<field>"), with Account A's username hidden, and the trial markers beside them (keptMarker): the
 * object's own, those of a child object that holds the billing state (MARKER_HOLDER, by "<key>.<field>"), and a child
 * of Account A's own. `own` lists the object's own entitlement keys (never a marker); `viaChild` says a direct child
 * object names Account A, and `childHeld` that such a child holds an entitlement field.
 */
function entitlementOf(obj: JsonObject, names: string[]): { values: JsonObject; own: string[]; viaChild: boolean; childHeld: boolean } {
  const values: JsonObject = {};
  const own: string[] = [];
  let viaChild = false;
  let childHeld = false;
  for (const [k, v] of Object.entries(obj)) {
    if (!isEntitlementKey(k)) continue;
    values[k] = hideNames(v, names);
    own.push(k);
  }
  for (const [k, child] of Object.entries(obj)) {
    if (isEntitlementKey(k) || !isObject(child) || !namesAccount(child, names)) continue;
    viaChild = true;
    let childHolds = false;
    for (const [ck, cv] of Object.entries(child)) {
      if (!isEntitlementKey(ck)) continue;
      values[`${k}.${ck}`] = hideNames(cv, names);
      childHolds = true;
    }
    if (childHolds) for (const [ck, cv] of Object.entries(child)) if (keptMarker(ck, cv)) values[`${k}.${ck}`] = hideNames(cv, names);
    childHeld ||= childHolds;
  }
  // The markers beside the plan: kept when the object holds the plan itself or through Account A's own object (0.6.0
  // review, round 2: `{ user: { email, plan }, subscription_status: "trialing" }`).
  if (own.length > 0 || childHeld) {
    for (const [k, v] of Object.entries(obj)) {
      if (isEntitlementKey(k)) continue;
      if (keptMarker(k, v)) {
        values[k] = hideNames(v, names);
      } else if (isObject(v) && MARKER_HOLDER.test(normKey(k)) && !namesAccount(v, names)) {
        for (const [ck, cv] of Object.entries(v)) if (!isEntitlementKey(ck) && keptMarker(ck, cv)) values[`${k}.${ck}`] = hideNames(cv, names);
      }
    }
  }
  return { values, own, viaChild, childHeld };
}

/** True when `values` holds an entitlement field (not only trial markers). */
const holdsEntitlement = (values: JsonObject) => Object.keys(values).some((k) => isEntitlementKey(k.split(".").pop() ?? k));

/**
 * Account A's entitlement at `obj` when it is Account A's account object (see the file comment), else null. `oneRow`:
 * `obj` is the only row of a list, which counts only with a plan-like field of its own (a bare `role` is a team role).
 * An object with no entitlement field of its own counts when Account A's own object inside it holds one and it has a
 * key that may hold a trial marker (markerKey: `{ user: { email, plan }, subscription_status }`, 0.6.0 review, round
 * 2), so the trial kept beside Account A's object is read with it; without such a key, Account A's own object is taken.
 */
function accountEntitlement(obj: JsonObject, names: string[], oneRow: boolean): JsonObject | null {
  const { values, own, viaChild, childHeld } = entitlementOf(obj, names);
  if (own.length === 0) return !oneRow && childHeld && Object.keys(obj).some((k) => !isEntitlementKey(k) && markerKey(k)) ? values : null;
  if (!namesAccount(obj, names) && !viaChild) return null;
  if (oneRow && !own.some((k) => normKey(k) !== "role")) return null;
  return values;
}

/** The first object in `json` (depth first, in document order) that is Account A's account object, with its path. */
function locate(json: unknown, names: string[]): { path: string; values: JsonObject } | null {
  const walk = (node: unknown, path: string[], oneRow: boolean, depth: number): { path: string; values: JsonObject } | null => {
    if (depth > MAX_DEPTH) return null;
    if (Array.isArray(node)) {
      // A list of several objects is other users (a team) or several records: never Account A's own account.
      if (node.length !== 1) return null;
      return walk(node[0], [...path, "0"], true, depth + 1);
    }
    if (!isObject(node)) return null;
    const values = accountEntitlement(node, names, oneRow);
    if (values) return { path: path.join("."), values };
    for (const [k, v] of Object.entries(node)) {
      if (v === null || typeof v !== "object") continue;
      const found = walk(v, [...path, k], false, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(json, [], false, 0);
}

/**
 * The first observed GET whose JSON describes the signed-in account and holds at least one ENTITLEMENT_KEYS field.
 * `account` names Account A (its username or email) so a list of other users' objects isn't taken for A's; the value is
 * matched but never returned or logged. Null when none qualifies.
 */
export function findEntitlement(reads: ObservedRead[], account: { username: string }): EntitlementSnapshot | null {
  const names = namesOf([account.username]);
  if (names.length === 0) return null;
  for (const read of reads) {
    if (read.method.toUpperCase() !== "GET" || read.status < 200 || read.status >= 300) continue;
    if (read.json === null || typeof read.json !== "object") continue;
    const found = locate(read.json, names);
    if (found) return { url: read.url, path: found.path, values: found.values };
  }
  return null;
}

/**
 * Paths of a GET that describes the session rather than the account as stored now: an auth or session endpoint
 * (NextAuth's `/api/auth/session`, `/session`, a token echo). Such an answer often carries the plan the account had when
 * it signed in (a JWT's claims), so it is ranked after the account's and billing endpoints.
 */
const SESSION_ENDPOINT = /(^|\/)(auth|sessions?|tokens?|jwt|oauth2?|userinfo|whoami)(\/|$)/i;

/** 1 for an auth or session endpoint (SESSION_ENDPOINT), 0 for any other: the lower is re-read and named first. */
export function endpointRank(url: string): number {
  try {
    return SESSION_ENDPOINT.test(new URL(url).pathname) ? 1 : 0;
  } catch {
    return 0;
  }
}

/**
 * Every observed GET (at most `max`, one per URL) whose JSON holds Account A's entitlement (see findEntitlement), the
 * account and billing endpoints first and auth or session endpoints after them (SESSION_ENDPOINT), each group in the
 * order the app made them (0.6.0 review, round 1: a page that reads the session first and the account after it would
 * otherwise have only the session's cached plan re-read). Empty when none qualifies.
 */
export function findEntitlements(reads: ObservedRead[], account: { username: string }, max = 4): EntitlementSnapshot[] {
  const names = namesOf([account.username]);
  if (names.length === 0) return [];
  const found: EntitlementSnapshot[] = [];
  const seen = new Set<string>();
  for (const read of reads) {
    if (read.method.toUpperCase() !== "GET" || read.status < 200 || read.status >= 300) continue;
    if (read.json === null || typeof read.json !== "object" || seen.has(read.url)) continue;
    const at = locate(read.json, names);
    if (!at) continue;
    seen.add(read.url);
    found.push({ url: read.url, path: at.path, values: at.values });
  }
  return found
    .map((snap, i) => ({ snap, i, rank: endpointRank(snap.url) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .slice(0, max)
    .map((o) => o.snap);
}

/** The node at a dotted `path` ("" = the root; a number indexes a list), or undefined when it isn't there. */
function at(json: unknown, path: string): unknown {
  let node = json;
  for (const seg of path === "" ? [] : path.split(".")) {
    if (Array.isArray(node)) {
      if (!/^\d+$/.test(seg)) return undefined;
      node = node[Number(seg)];
    } else if (isObject(node)) {
      node = Object.prototype.hasOwnProperty.call(node, seg) ? node[seg] : undefined;
    } else {
      return undefined;
    }
  }
  return node;
}

/** Re-read the entitlement as Account A; null when the read itself failed (not "changed"). */
export async function rereadEntitlement(ctx: CheckContext, snap: EntitlementSnapshot): Promise<Record<string, unknown> | null> {
  const names = namesOf(ctx.accountMarkers());
  if (names.length === 0) return null;
  const answer = await ctx.request("self", { method: "GET", url: snap.url }).catch(() => null);
  if (!answer || answer.status < 200 || answer.status >= 300) return null;
  let json: unknown;
  try {
    json = JSON.parse(answer.body);
  } catch {
    return null;
  }
  const node = at(json, snap.path);
  if (!isObject(node)) return null;
  const { values, viaChild } = entitlementOf(node, names);
  // Not Account A's object any more (another user's session, an error answer): can't tell, never "changed".
  if (!namesAccount(node, names) && !viaChild) return null;
  // Account A's object with no entitlement field left (a trimmed answer): inconclusive, never "every field changed".
  if (!holdsEntitlement(values)) return null;
  return values;
}

/** Structural equality of JSON values: object keys in any order, lists in order, types kept apart. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => sameJson(item, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameJson(a[k], b[k]));
  }
  return Number.isNaN(a) && Number.isNaN(b);
}

/** The field names whose values differ between the snapshot and a re-read (structural comparison). */
export function changedEntitlement(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys.filter((k) => {
    const had = Object.prototype.hasOwnProperty.call(before, k);
    const has = Object.prototype.hasOwnProperty.call(after, k);
    return had !== has || !sameJson(before[k], after[k]);
  });
}

/**
 * True when an isPro/pro flag (or a trial flag) is on: true, 1, or "true" or "1" (SQLite and MySQL's tinyint keep a
 * boolean as 0/1). 0, "0", false and anything else is off.
 */
function on(value: unknown): boolean {
  if (value === true || value === 1) return true;
  return typeof value === "string" && /^(true|1)$/i.test(value.trim());
}

/** The last part of a dotted field name, as a key is compared (`user.isPro` and `user.is_pro` → "ispro"). */
const fieldName = (field: string) => normKey(field.split(".").pop() ?? field);
/** Fields that say which plan the account is on (isPaid reads them). */
const PLAN_FIELDS = new Set(["plan", "tier", "subscription", "ispro", "pro"]);

/** A number, or a string that is one ("25"); null for anything else. */
function numberOf(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(value)) return Number(value);
  return null;
}

/** True when a flag, limit or entry is on: true, a positive number, a string that isn't "off", or a non-empty list or object. */
function enabled(value: unknown): boolean {
  if (value === true) return true;
  const n = numberOf(value);
  if (n !== null) return n > 0;
  if (typeof value === "string") return value.trim() !== "" && !/^(false|no|off|none|disabled|null)$/i.test(value.trim());
  if (Array.isArray(value)) return value.length > 0;
  if (isObject(value)) return Object.keys(value).length > 0;
  return false;
}

/**
 * Keys that name a list entry of entitlements or features (matched by it across two reads), in the order they are
 * read (0.6.0 review, round 3: a display `title`, `label`, `displayName` or `type` too; compared lower-case).
 */
const IDENTITY_OF_ENTRY = ["key", "id", "name", "feature", "slug", "code", "handle", "title", "label", "displayname", "display_name", "type"];

/** The words of a key: `usedThisMonth` and `used_this_month` → ["used", "this", "month"]. */
const wordsOf = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * A counter of use (`used`, `usage`, `count`, `consumed`, `spent`, `current…`, `ai_used`, `usedThisMonth`): it goes up
 * as Account A uses what it already has, never a gain.
 */
function usageCounter(key: string): boolean {
  return wordsOf(key).some((w) => /^(used|usage|uses|count|consumed|spent|current)$/.test(w));
}

/**
 * A key that names a moment (0.6.0 review, round 3): `last_used_at`, `updatedAt`, `created`, `lastUsed`,
 * `timestamp`, `resets_at`. It moves as Account A uses what it has, or on its own, and is never a gain.
 */
function momentKey(key: string): boolean {
  const words = wordsOf(key);
  if (words.length === 0) return false;
  return /^(at|date|time|timestamp|ts|datetime)$/.test(words.at(-1)!) || /^(last|updated|created|modified|seen)$/.test(words[0]!);
}

/** A value that is a moment: an ISO date string, or a Firestore timestamp (`{ seconds, nanoseconds }`, `{ _seconds }`). */
function momentValue(value: unknown): boolean {
  if (typeof value === "string") return /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(value.trim());
  if (!isObject(value)) return false;
  const keys = Object.keys(value).sort().join(",");
  return keys === "nanoseconds,seconds" || keys === "_nanoseconds,_seconds" || keys === "seconds" || keys === "_seconds";
}

/** The identity of a list entry (IDENTITY_OF_ENTRY, compared as text), or null when it has none. */
function identityOf(entry: unknown): string | null {
  if (typeof entry === "string" || typeof entry === "number") return `=${String(entry)}`;
  if (!isObject(entry)) return null;
  const lower = new Map(Object.entries(entry).map(([k, v]) => [k.toLowerCase(), v]));
  for (const key of IDENTITY_OF_ENTRY) {
    const v = lower.get(key);
    if (typeof v === "string" || typeof v === "number") return `${key}=${String(v)}`;
  }
  return null;
}

/**
 * True when a value of a map entry (or a matched list entry's field, `key`) holds more than before: a flag turned on, a
 * limit or allowance raised (never a usage counter going up), or, for an object, any of its own fields that did. A
 * moment (momentKey, momentValue: a timestamp set or moved) is never more. With `raises` false, a number that went up
 * (or appeared) counts for nothing either: what is left is a gain a second visit can't repeat (see onlyRaised).
 */
function valueGained(key: string, was: unknown, now: unknown, depth: number, raises: boolean): boolean {
  if (momentKey(key) || momentValue(now)) return false;
  if (isObject(now) && (isObject(was) || was === null || was === undefined)) {
    if (depth > MAX_DEPTH) return false;
    const had = isObject(was) ? was : {};
    return Object.entries(now).some(([k, v]) => !IDENTITY_OF_ENTRY.includes(k.toLowerCase()) && valueGained(k, had[k], v, depth + 1, raises));
  }
  const from = numberOf(was);
  const to = numberOf(now);
  if (from !== null && to !== null) return raises && to > from && !usageCounter(key);
  if (Array.isArray(now) && (Array.isArray(was) || was === null || was === undefined)) return entriesGained(was, now, depth + 1, raises);
  if (to !== null) return raises && enabled(now) && !enabled(was) && !usageCounter(key);
  return enabled(now) && !enabled(was);
}

/**
 * True when a list or map of entitlements or features holds more than before (0.6.0 review, round 1: entries are
 * matched by who they are, so a metered entry whose usage went up isn't a new entry):
 * - a list: an entry whose identity (IDENTITY_OF_ENTRY: key, id, name, feature, slug, code, handle, title, label,
 *   display name or type; a string or number is its own) it didn't hold is a gain; a matched entry gained when one of
 *   its fields did (valueGained: a flag turned on, a limit raised, never a usage counter going up or a timestamp
 *   moving). An entry with no identity, or one whose identity two entries share, is never matched by position (0.6.0
 *   review, round 3: rows read with no ORDER BY come back in another order): it gained only when no entry before was
 *   at least as good (each entry before misses something it has, on flags, limits and nested lists).
 * - a map: a key whose value gained (valueGained).
 * A list in another order, an entry taken away, a flag turned off, a counter of use going up or a timestamp moving is
 * not a gain (the caller then counts the change as inconclusive).
 */
function entriesGained(before: unknown, after: unknown, depth: number, raises: boolean): boolean {
  if (depth > MAX_DEPTH) return false;
  if (Array.isArray(after)) {
    const had = Array.isArray(before) ? before : [];
    const counted = (list: unknown[]) => {
      const n = new Map<string, number>();
      for (const e of list) {
        const id = identityOf(e);
        if (id !== null) n.set(id, (n.get(id) ?? 0) + 1);
      }
      return n;
    };
    const hadIds = counted(had);
    const nowIds = counted(after);
    /** An identity that names one entry on each side (else the entries are told apart as if they had none). */
    const unique = (id: string | null): id is string => id !== null && (hadIds.get(id) ?? 0) <= 1 && (nowIds.get(id) ?? 0) <= 1;
    const byIdentity = new Map<string, unknown>();
    for (const old of had) {
      const id = identityOf(old);
      if (unique(id)) byIdentity.set(id, old);
    }
    /** True when `item` holds something `old` doesn't (undefined: holds anything at all). */
    const beyond = (old: unknown, item: unknown) =>
      isObject(item) ? valueGained("", isObject(old) ? old : {}, item, depth + 1, raises) : valueGained("", old, item, depth + 1, raises);
    return after.some((item) => {
      const id = identityOf(item);
      if (unique(id) && (hadIds.get(id) ?? 0) === 0) return true;
      if (unique(id)) {
        const old = byIdentity.get(id);
        return isObject(item) && isObject(old) && valueGained("", old, item, depth + 1, raises);
      }
      if (had.some((old) => sameJson(old, item))) return false;
      return beyond(undefined, item) && had.every((old) => beyond(old, item));
    });
  }
  if (isObject(after)) {
    const had = isObject(before) ? before : {};
    return Object.entries(after).some(([k, v]) => valueGained(k, had[k], v, depth + 1, raises));
  }
  return false;
}

/**
 * The fields in which Account A gained something between the snapshot and a re-read (0.6.0 verdict, docs/v2-spec.md
 * "`paywall-trust` amendments"): the plan fields that made it a paid plan (isPaid after and not before, or isPro/pro
 * turned true), credits that went up (from none too), and entitlements or features that gained an entry. Empty when
 * nothing was gained: credits spent, a free plan moved to a trial, a role, a date or a lost entry are changes, never a
 * grant.
 */
export function gainedEntitlement(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return gained(before, after, true);
}

/**
 * True when Account A gained something and every gain is a number that went up (0.6.0 review, round 3): credits, or a
 * limit or allowance in the entitlements or features. A balance that refills on a timer looks the same, and a second
 * visit to the page can add more; a new entry, a flag turned on or a paid plan can't be added twice.
 */
export function onlyRaised(before: Record<string, unknown>, after: Record<string, unknown>): boolean {
  return gained(before, after, true).length > 0 && gained(before, after, false).length === 0;
}

/** gainedEntitlement; with `raises` false, a number that went up counts for nothing (see valueGained). */
function gained(before: Record<string, unknown>, after: Record<string, unknown>, raises: boolean): string[] {
  const changed = changedEntitlement(before, after);
  // A free plan moved to a trial, a named one of a paid tier too ("pro_trial", "Pro trial", {plan: "pro", subscription:
  // {status: "trialing"}}), is the trial starting, never a paid plan: nothing it brings counts as a grant. isPaid still
  // reads such a name as paid, so a before-state on a trial skips probing (the safe side).
  if (onTrial(after) && !onTrial(before)) return [];
  // A trial before is not a paid plan either: a trial moved to a paid plan with no payment is a gain. After, only a
  // plan that surely is paid counts (surelyPaid: a name that says so, or an active subscription): a free plan renamed
  // (`free_2026`, "Free (legacy)"), a status word (`pending`) or a name nothing says is paid is a change, not a gain.
  const paidNow = surelyPaid(after) && !(isPaid(before) && !onTrial(before));
  return changed.filter((field) => {
    const name = fieldName(field);
    const was = before[field];
    const now = after[field];
    if ((name === "ispro" || name === "pro") && on(now) && !on(was)) return true;
    if (PLAN_FIELDS.has(name)) return paidNow;
    if (name === "credits") {
      const to = numberOf(now);
      const from = was === null || was === undefined ? 0 : numberOf(was);
      return raises && to !== null && from !== null && to > from;
    }
    if (name === "entitlements" || name === "features") return entriesGained(was, now, 0, raises);
    return false;
  });
}

/**
 * Plan names that mean nothing was paid (compared lower-case, with "-"/"_" as spaces and the words "plan"/"tier"
 * left out), including the common names of free tiers ("Hobby", "Community", "Free forever"). Any other name counts
 * as paid, so an unknown plan makes the check skip rather than probe a paying account.
 */
const FREE_PLAN =
  /^(free|free trial|trial|trialing|freemium|none|no|no plan|null|undefined|n\/a|unpaid|inactive|expired|cancell?ed|guest|anonymous|starter free|basic free|hobby|community|free forever|forever free|personal free|developer free)$/;
/** Subscription states that are not a paid plan now. */
const INACTIVE =
  /^(inactive|cancell?ed|expired|ended|none|free|trial|trialing|on trial|in trial|free trial|trial period|incomplete|incomplete expired|unpaid|paused|pending|draft|void|refunded|null)$/;
/** Subscription states that are a paid plan now. */
const ACTIVE = /^(active|paid|past due)$/;
/** Fields of a plan or subscription object that name the plan, in the order they are read. */
const PLAN_NAME_KEYS = ["name", "slug", "key", "code", "tier", "plan", "id", "title", "nickname", "type"];
/**
 * The same for a subscription object's own fields: its `id` is the subscription's (sub_123), and its `type` is often
 * the provider's, never the plan's. A nested plan object (`subscription.plan.id`) is still read in full.
 */
const SUBSCRIPTION_PLAN_KEYS = PLAN_NAME_KEYS.filter((k) => k !== "id" && k !== "type");

const normPlan = (s: string) =>
  s
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\b(plan|tier)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The string that names a plan object (`{ id: "pro", name: "Pro" }` → "Pro"), or null. */
function planName(obj: JsonObject, keys: string[] = PLAN_NAME_KEYS): string | null {
  const lower = new Map(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
  for (const key of keys) {
    const v = lower.get(key);
    if (typeof v === "string") return v;
    if (isObject(v)) return planName(v);
  }
  return null;
}

/** The status of a subscription-like object (`status`, `state`), normalized, or null. */
function statusOf(obj: JsonObject): string | null {
  const lower = new Map(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
  const v = lower.get("status") ?? lower.get("state");
  return typeof v === "string" ? v.toLowerCase().replace(/[-_]+/g, " ").trim() : null;
}

/** True when a JSON value holds nothing: null, "", false, 0, [] or {}, or a list or object of only such values. */
function isBlank(value: unknown, depth = 0): boolean {
  if (value === null || value === undefined || value === "" || value === false || value === 0) return true;
  if (depth > MAX_DEPTH) return false;
  if (Array.isArray(value)) return value.every((v) => isBlank(v, depth + 1));
  if (isObject(value)) return Object.values(value).every((v) => isBlank(v, depth + 1));
  return false;
}

/**
 * Words of a plan name that say it is paid (compared on normPlan's form, as whole words). Only these make a plan in
 * the after-state a gain (surelyPaid).
 */
const PAID_WORD = /\b(pro|premium|plus|business|teams?|enterprise|paid|professional|unlimited|growth|scale)\b/;

/**
 * A plan name that says free without saying paid or trial (`free_2026`, "Free (legacy)", "Free tier 2026"): a free
 * plan by another name. "Pro free trial" is not (it names a paid tier and a trial).
 */
const namesFree = (name: string) => /\bfree\b/.test(name) && !PAID_WORD.test(name) && !TRIAL_WORD.test(name);

function paidPlan(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (value === true) return true;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const name = normPlan(value);
    return name !== "" && !FREE_PLAN.test(name) && !namesFree(name);
  }
  if (isObject(value)) {
    const status = statusOf(value);
    if (status !== null && INACTIVE.test(status)) return false;
    const name = planName(value);
    return name === null ? status !== null && ACTIVE.test(status) : paidPlan(name);
  }
  return false;
}

/**
 * What a subscription says about paying: "paid", "free", or "unclear" (a state that is neither a known active nor a
 * known inactive one, with no plan name: counted as paid unless a plan, tier or isPro field of the same account says
 * free).
 *
 * A subscription object that holds nothing (every value null, "", false, 0, [] or {}) is free, and so is one with
 * neither a state nor a plan name: an id alone (a customer created at sign-up, `stripeCustomerId`) isn't a payment.
 */
function subscriptionState(value: unknown, depth = 0): "paid" | "free" | "unclear" {
  if (value === null || value === undefined || value === false) return "free";
  if (value === true) return "paid";
  if (typeof value === "number") return value !== 0 ? "paid" : "free";
  if (typeof value === "string") {
    const s = value.toLowerCase().replace(/[-_]+/g, " ").trim();
    if (s === "" || INACTIVE.test(s)) return "free";
    if (ACTIVE.test(s)) return "paid";
    return paidPlan(value) ? "paid" : "free";
  }
  if (Array.isArray(value)) {
    // Several subscriptions: any paid one is a paid plan.
    if (depth > 0) return "free";
    const states = value.map((v) => subscriptionState(v, depth + 1));
    return states.includes("paid") ? "paid" : states.includes("unclear") ? "unclear" : "free";
  }
  if (isObject(value)) {
    if (isBlank(value)) return "free";
    const status = statusOf(value);
    if (status !== null && INACTIVE.test(status)) return "free";
    const name = planName(value, SUBSCRIPTION_PLAN_KEYS);
    if (name !== null) return paidPlan(name) ? "paid" : "free";
    if (status === null) return "free";
    return ACTIVE.test(status) ? "paid" : "unclear";
  }
  return "free";
}

/** A plan name or state that says trial ("trial", "Pro trial", "pro_trial", "trial-pro", "trialing", "on trial"). */
const TRIAL_WORD = /\btrial(l?ing)?\b/;

/**
 * True when `value` is a date (an ISO string, a Unix time in seconds or milliseconds, or, 0.6.0 review, round 2, a
 * Firestore timestamp `{ _seconds }` or `{ seconds }` or MongoDB's `{ $date }`) later than now.
 */
function futureDate(value: unknown): boolean {
  if (isObject(value)) {
    const seconds = value["_seconds"] ?? value["seconds"];
    if (typeof seconds === "number" && Number.isFinite(seconds)) return seconds * 1000 > Date.now();
    const date = value["$date"];
    return typeof date === "string" || typeof date === "number" ? futureDate(date) : false;
  }
  let at: number | null = null;
  if (typeof value === "number" && Number.isFinite(value)) at = value > 1e12 ? value : value > 1e9 ? value * 1000 : null;
  else if (typeof value === "string" && /\d{4}-\d{2}-\d{2}/.test(value)) at = Date.parse(value);
  else if (typeof value === "string" && /^\s*\d{10,13}\s*$/.test(value)) return futureDate(Number(value));
  return at !== null && Number.isFinite(at) && at > Date.now();
}

/** A trial flag's word that says it is on (`trial: "active"`). */
const TRIAL_ON = /^(active|on|yes|running|trialing|in progress)$/;
/** Keys of a trial object's own flag (`trial: { active: true }`). */
const TRIAL_OBJECT_FLAG = /^(active|isactive|on|enabled|isenabled|running|isrunning|current|iscurrent|valid|isvalid|trialing|istrialing|ontrial|intrial)$/;
/** Keys of a trial object's end date (`trial: { ends_at }`). */
const TRIAL_OBJECT_END = /^(end|ends|ended|endat|endsat|endon|endson|enddate|endtime|expire|expires|expiresat|expireson|expiry|expiration|expirationdate|until|validuntil)$/;
/** A trial object's status that says it is over. */
const TRIAL_OVER = /^(expired|ended|over|cancell?ed|inactive|none|void|converted)$/;

/**
 * True when a trial object (`trial: { active: true, ends_at }`, 0.6.0 review, round 2) says the trial runs: its flag
 * is on, its end date is still to come, it has days left, or its status says trial or active. A flag that is off, or a
 * status that says it is over, says it doesn't.
 */
function trialObject(obj: JsonObject): boolean {
  let flag: boolean | null = null;
  let runs = false;
  let over = false;
  for (const [key, v] of Object.entries(obj)) {
    const k = normKey(key);
    if (TRIAL_OBJECT_FLAG.test(k)) {
      flag = (flag ?? false) || on(v);
    } else if (TRIAL_OBJECT_END.test(k) || TRIAL_END_KEY.test(k)) {
      runs ||= futureDate(v);
    } else if (TRIAL_LEFT_KEY.test(k) || k === "daysleft" || k === "daysremaining") {
      const n = numberOf(v);
      runs ||= n !== null && n > 0;
    } else if ((PLAIN_STATUS_KEY.test(k) || STATUS_KEY.test(k)) && typeof v === "string") {
      const status = normPlan(v);
      if (TRIAL_OVER.test(status)) over = true;
      else runs ||= TRIAL_WORD.test(status) || TRIAL_ON.test(status);
    }
  }
  if (flag === false || over) return false;
  return flag === true || runs;
}

/**
 * True when a trial marker (keptMarker) says Account A is on a trial: a trial flag that is on (or a trial object that
 * says it runs: trialObject), a trial end date still to come, days of a trial left, or a subscription status or state
 * that says trial (`trialing`).
 */
function trialMarker(key: string, value: unknown): boolean {
  const k = normKey(key);
  if (TRIAL_FLAG_KEY.test(k)) {
    if (isObject(value)) return trialObject(value);
    return on(value) || (typeof value === "string" && TRIAL_ON.test(value.trim().toLowerCase()));
  }
  if (TRIAL_END_KEY.test(k)) return futureDate(value);
  if (TRIAL_LEFT_KEY.test(k)) {
    const n = numberOf(value);
    return n !== null && n > 0;
  }
  if (STATUS_KEY.test(k) || PLAIN_STATUS_KEY.test(k)) return typeof value === "string" && TRIAL_WORD.test(normPlan(value));
  return false;
}

/**
 * True when a plan, tier or subscription value says it is a trial: its name, or its status or state, or a trial
 * marker of its own (`{ id: "pro", trial_ends_at: <a date to come> }`).
 */
function trialValue(value: unknown, depth = 0): boolean {
  if (typeof value === "string") return TRIAL_WORD.test(normPlan(value));
  if (depth > MAX_DEPTH) return false;
  if (Array.isArray(value)) return value.some((v) => trialValue(v, depth + 1));
  if (!isObject(value)) return false;
  const status = statusOf(value);
  if (status !== null && TRIAL_WORD.test(status)) return true;
  if (Object.entries(value).some(([k, v]) => trialMarker(k, v))) return true;
  const name = planName(value);
  return name !== null && TRIAL_WORD.test(normPlan(name));
}

/**
 * True when the values say Account A is on a trial: a plan or tier whose name says trial, a subscription whose name,
 * status or state does (`trialing`), or a trial marker kept beside them (`subscription_status: "trialing"`, `isTrial`
 * or `trial: true` or 1, a `trial_ends_at` or `trial_end` still to come), of the same account.
 */
function onTrial(values: Record<string, unknown>): boolean {
  return Object.entries(values).some(([key, value]) => {
    const name = fieldName(key);
    if (name === "plan" || name === "tier" || name === "subscription") return trialValue(value);
    return trialMarker(name, value);
  });
}

/**
 * A plan or tier value that surely is a paid plan: its name says so (PAID_WORD), or, for a plan object with no name,
 * an active status. A plan object's name decides over its status (a plan record's own `status: "active"` is often
 * the catalog's, the free plan's too).
 */
function surelyPaidPlan(value: unknown, depth = 0): boolean {
  if (value === true) return true;
  if (typeof value === "string") return paidPlan(value) && PAID_WORD.test(normPlan(value));
  if (!isObject(value) || depth > MAX_DEPTH) return false;
  const status = statusOf(value);
  if (status !== null && INACTIVE.test(status)) return false;
  const name = planName(value);
  return name !== null ? surelyPaidPlan(name, depth + 1) : status !== null && ACTIVE.test(status);
}

/** A subscription value that surely is paid: active (and not naming a free plan), or naming a paid plan. */
function surelyPaidSubscription(value: unknown, depth = 0): boolean {
  if (value === true) return true;
  if (typeof value === "string") {
    const s = value.toLowerCase().replace(/[-_]+/g, " ").trim();
    return ACTIVE.test(s) || surelyPaidPlan(value, depth + 1);
  }
  if (Array.isArray(value)) return depth === 0 && value.some((v) => surelyPaidSubscription(v, depth + 1));
  if (!isObject(value) || isBlank(value)) return false;
  const status = statusOf(value);
  if (status !== null && INACTIVE.test(status)) return false;
  const name = planName(value, SUBSCRIPTION_PLAN_KEYS);
  if (name !== null && !paidPlan(name)) return false;
  return (status !== null && ACTIVE.test(status)) || (name !== null && surelyPaidPlan(name, depth + 1));
}

/**
 * True when the values surely describe a paid plan (0.6.0 review, round 1): a plan or tier whose name says paid (pro,
 * premium, plus, business, team, enterprise, paid, professional, unlimited, growth, scale) or an active plan object,
 * isPro or pro on, or an active subscription (or one naming a paid plan). Stricter than isPaid, which counts an
 * unknown name as paid (the safe side before probing): after a probe, only this makes a plan field a gain.
 */
function surelyPaid(values: Record<string, unknown>): boolean {
  return Object.entries(values).some(([key, value]) => {
    const name = fieldName(key);
    if (name === "plan" || name === "tier") return surelyPaidPlan(value);
    if (name === "ispro" || name === "pro") return on(value);
    if (name === "subscription") return surelyPaidSubscription(value);
    return false;
  });
}

/**
 * True when the values say Account A is on a free plan (0.6.0 review, round 1): a plan or tier field that names a free
 * plan (FREE_PLAN, or a name that says free without saying paid or trial: `free_2026`), no isPro or pro on, no
 * subscription that could be paid, and no trial. A cancel or downgrade has nothing to undo then: paywall-trust never
 * clicks one to put back a change that left the plan free.
 */
export function saysFree(values: Record<string, unknown>): boolean {
  if (onTrial(values)) return false;
  let free = false;
  for (const [key, value] of Object.entries(values)) {
    const name = fieldName(key);
    if (name === "plan" || name === "tier") {
      if (paidPlan(value)) return false;
      if (typeof value === "string" || isObject(value)) free = true;
    } else if ((name === "ispro" || name === "pro") && on(value)) {
      return false;
    } else if (name === "subscription" && subscriptionState(value) !== "free") {
      return false;
    }
  }
  return free;
}

/**
 * True when the values already describe a paid plan (e.g. plan/tier not "free", isPro/pro true, an active
 * subscription). A subscription in an unknown state counts as paid (the check then skips rather than probe a paying
 * account) unless a plan, tier, isPro or pro field says the account is on the free plan.
 */
export function isPaid(values: Record<string, unknown>): boolean {
  let unclear = false;
  let saysFree = false;
  for (const [key, value] of Object.entries(values)) {
    const name = fieldName(key);
    if (name === "plan" || name === "tier") {
      if (paidPlan(value)) return true;
      saysFree = true;
    } else if (name === "ispro" || name === "pro") {
      if (on(value)) return true;
      saysFree = true;
    } else if (name === "subscription") {
      const state = subscriptionState(value);
      if (state === "paid") return true;
      if (state === "unclear") unclear = true;
    }
    // Credits (a free tier often grants some), entitlements, features and a role say nothing about paying.
  }
  return unclear && !saysFree;
}
