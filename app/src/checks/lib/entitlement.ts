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
 * among its members inside a list (a workspace) is not Account A's either. The username is matched, never returned:
 * a value that holds it is kept with it replaced by "[account]".
 */
import type { CheckContext } from "../../core/types.js";

/** The fields that make a JSON object an entitlement, matched case-insensitively on the key. */
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

const KEYS = new Set<string>(ENTITLEMENT_KEYS.map((k) => k.toLowerCase()));

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
const isEntitlementKey = (k: string) => KEYS.has(k.toLowerCase());
const normKey = (k: string) => k.toLowerCase().replace(/[-_\s]/g, "");

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
 * The entitlement fields of `obj` (its own, by their key) and of every direct child object that names Account A (by
 * "<child key>.<field>"), with Account A's username hidden. `own` lists the object's own entitlement keys; `viaChild`
 * says a direct child object names Account A.
 */
function entitlementOf(obj: JsonObject, names: string[]): { values: JsonObject; own: string[]; viaChild: boolean } {
  const values: JsonObject = {};
  const own: string[] = [];
  let viaChild = false;
  for (const [k, v] of Object.entries(obj)) {
    if (!isEntitlementKey(k)) continue;
    values[k] = hideNames(v, names);
    own.push(k);
  }
  for (const [k, child] of Object.entries(obj)) {
    if (isEntitlementKey(k) || !isObject(child) || !namesAccount(child, names)) continue;
    viaChild = true;
    for (const [ck, cv] of Object.entries(child)) if (isEntitlementKey(ck)) values[`${k}.${ck}`] = hideNames(cv, names);
  }
  return { values, own, viaChild };
}

/**
 * Account A's entitlement at `obj` when it is Account A's account object (see the file comment), else null. `oneRow`:
 * `obj` is the only row of a list, which counts only with a plan-like field of its own (a bare `role` is a team role).
 */
function accountEntitlement(obj: JsonObject, names: string[], oneRow: boolean): JsonObject | null {
  const { values, own, viaChild } = entitlementOf(obj, names);
  if (own.length === 0) return null;
  if (!namesAccount(obj, names) && !viaChild) return null;
  if (oneRow && !own.some((k) => k.toLowerCase() !== "role")) return null;
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
  if (Object.keys(values).length === 0) return null;
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

/** The last part of a dotted field name, lower-case (`user.isPro` → "ispro"). */
const fieldName = (field: string) => (field.split(".").pop() ?? field).toLowerCase();
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
 * True when a list or map of entitlements or features holds more than before: a list entry it didn't hold, or a key
 * whose flag turned on or whose limit went up. A list in another order, an entry taken away or a flag turned off is not.
 */
function entriesGained(before: unknown, after: unknown): boolean {
  if (Array.isArray(after)) {
    const had = Array.isArray(before) ? before : [];
    return after.some((item) => !had.some((old) => sameJson(old, item)));
  }
  if (isObject(after)) {
    const had = isObject(before) ? before : {};
    return Object.entries(after).some(([k, v]) => {
      const was = had[k];
      const from = numberOf(was);
      const to = numberOf(v);
      if (from !== null && to !== null) return to > from;
      return enabled(v) && !enabled(was);
    });
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
  const changed = changedEntitlement(before, after);
  // A free plan moved to a trial, a named one of a paid tier too ("pro_trial", "Pro trial", {plan: "pro", subscription:
  // {status: "trialing"}}), is the trial starting, never a paid plan: nothing it brings counts as a grant. isPaid still
  // reads such a name as paid, so a before-state on a trial skips probing (the safe side).
  if (onTrial(after) && !onTrial(before)) return [];
  // A trial before is not a paid plan either: a trial moved to a paid plan with no payment is a gain.
  const paidNow = isPaid(after) && !(isPaid(before) && !onTrial(before));
  return changed.filter((field) => {
    const name = fieldName(field);
    const was = before[field];
    const now = after[field];
    if (name === "ispro" || name === "pro") {
      const on = (v: unknown) => v === true || (typeof v === "string" && v.trim().toLowerCase() === "true");
      if (on(now) && !on(was)) return true;
    }
    if (PLAN_FIELDS.has(name)) return paidNow;
    if (name === "credits") {
      const to = numberOf(now);
      const from = was === null || was === undefined ? 0 : numberOf(was);
      return to !== null && from !== null && to > from;
    }
    if (name === "entitlements" || name === "features") return entriesGained(was, now);
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

function paidPlan(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (value === true) return true;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const name = normPlan(value);
    return name !== "" && !FREE_PLAN.test(name);
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

/** True when a plan, tier or subscription value says it is a trial: its name, or its status or state. */
function trialValue(value: unknown, depth = 0): boolean {
  if (typeof value === "string") return TRIAL_WORD.test(normPlan(value));
  if (depth > MAX_DEPTH) return false;
  if (Array.isArray(value)) return value.some((v) => trialValue(v, depth + 1));
  if (!isObject(value)) return false;
  const status = statusOf(value);
  if (status !== null && TRIAL_WORD.test(status)) return true;
  const name = planName(value);
  return name !== null && TRIAL_WORD.test(normPlan(name));
}

/**
 * True when the values say Account A is on a trial: a plan or tier whose name says trial, or a subscription whose name,
 * status or state does (`trialing`), of the same account.
 */
function onTrial(values: Record<string, unknown>): boolean {
  return Object.entries(values).some(([key, value]) => {
    const name = (key.split(".").pop() ?? key).toLowerCase();
    return (name === "plan" || name === "tier" || name === "subscription") && trialValue(value);
  });
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
    const name = (key.split(".").pop() ?? key).toLowerCase();
    if (name === "plan" || name === "tier") {
      if (paidPlan(value)) return true;
      saysFree = true;
    } else if (name === "ispro" || name === "pro") {
      if (value === true || (typeof value === "string" && value.toLowerCase() === "true")) return true;
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
