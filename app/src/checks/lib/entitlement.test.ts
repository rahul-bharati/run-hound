/**
 * lib/entitlement (0.6.0, docs/v2-spec.md "`paywall-trust` amendments"): finding Account A's own plan, role, credits and
 * entitlements among the GETs the app made while the page loaded, telling a paid plan from a free one, comparing two
 * reads structurally, and re-reading the entitlement as Account A. The re-read is driven with a fake CheckContext whose
 * request() answers from a handler and records every request, so the tests can check it only ever reads, as A.
 */
import { describe, expect, it } from "vitest";
import type { CheckContext, IdentityRequest, IdentityResponse } from "../../core/types.js";
import {
  ENTITLEMENT_KEYS,
  changedEntitlement,
  findEntitlement,
  isPaid,
  rereadEntitlement,
  type EntitlementSnapshot,
  type ObservedRead,
} from "./entitlement.js";

const ORIGIN = "http://127.0.0.1:4100";
/** Account A's username (the account marker): matched, never returned. */
const ALEX = "alex@example.test";
const SAM = "sam@example.test";
const ACCOUNT = { username: ALEX };

/** A GET the app made while the page loaded, answered 200 with `json` unless `o` says otherwise. */
function read(path: string, json: unknown, o: Partial<ObservedRead> = {}): ObservedRead {
  return { method: "GET", url: `${ORIGIN}${path}`, status: 200, json, ...o };
}

/** Keys lower-cased, so a test can compare the fields found without caring how the app spelled them. */
function lowerKeys(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]));
}

describe("entitlement: the fields that make an entitlement", () => {
  it("are the contract's list: plan, tier, subscription, isPro, pro, credits, entitlements, features, role", () => {
    expect([...ENTITLEMENT_KEYS].map((k) => k.toLowerCase()).sort()).toEqual(
      ["plan", "tier", "subscription", "ispro", "pro", "credits", "entitlements", "features", "role"].sort(),
    );
  });
});

describe("entitlement: findEntitlement picks Account A's own account object", () => {
  it("takes the signed-in account's object from /api/me, keeping only its entitlement fields", () => {
    const snap = findEntitlement([read("/api/me", { id: "u_alex", email: ALEX, name: "Alex Rivera", avatar: "a1", plan: "free", role: "member" })], ACCOUNT);
    expect(snap).toEqual({ url: `${ORIGIN}/api/me`, path: "", values: { plan: "free", role: "member" } });
  });

  it("finds the account object inside the response and names its dotted path", () => {
    const nested = findEntitlement([read("/api/session", { ok: true, user: { id: "u_alex", email: ALEX, tier: "free", credits: 3 } })], ACCOUNT);
    expect(nested).toEqual({ url: `${ORIGIN}/api/session`, path: "user", values: { tier: "free", credits: 3 } });

    const deeper = findEntitlement(
      [read("/api/account", { data: { account: { id: 7, username: "alex", isPro: false, features: ["export"] } } })],
      { username: "alex" },
    );
    expect(deeper).toEqual({ url: `${ORIGIN}/api/account`, path: "data.account", values: { isPro: false, features: ["export"] } });
  });

  it("takes the object that holds the entitlement fields when the account is named inside it", () => {
    const snap = findEntitlement([read("/api/me", { user: { id: "u_alex", email: ALEX }, plan: "free", credits: 10 })], ACCOUNT);
    expect(snap).toEqual({ url: `${ORIGIN}/api/me`, path: "", values: { plan: "free", credits: 10 } });
  });

  it("takes the outer object when it holds the plan and A's own object inside it holds more, keeping both (the inner ones by dotted name)", () => {
    // The subscription sits beside the user object; the user object has its own role. Neither is dropped, so a grant
    // that changes only the subscription is still seen.
    const subscription = { status: "inactive", plan: "free" };
    const snap = findEntitlement([read("/api/me", { user: { id: "u_alex", email: ALEX, role: "member" }, subscription })], ACCOUNT);
    expect(snap).toEqual({ url: `${ORIGIN}/api/me`, path: "", values: { subscription, "user.role": "member" } });
    expect(JSON.stringify(snap)).not.toContain(ALEX);
  });

  it("keeps an entitlement field whose value is an object or a list whole", () => {
    const subscription = { status: "inactive", plan: "free", renewsAt: null };
    const snap = findEntitlement([read("/api/me", { email: ALEX, subscription, entitlements: ["basic-export"] })], ACCOUNT);
    expect(snap?.path).toBe("");
    expect(snap?.values).toEqual({ subscription, entitlements: ["basic-export"] });
  });

  it("matches the entitlement keys case-insensitively", () => {
    const snap = findEntitlement([read("/api/me", { Email: ALEX, Plan: "free", IsPro: false })], ACCOUNT);
    expect(snap).not.toBeNull();
    expect(lowerKeys(snap!.values)).toEqual({ plan: "free", ispro: false });
  });

  it("never takes a list of other users' objects for Account A's", () => {
    const team = [
      { id: "u_sam", email: SAM, name: "Sam Lee", role: "owner", plan: "pro" },
      { id: "u_bo", email: "bo@example.test", name: "Bo", role: "member", plan: "free" },
    ];
    expect(findEntitlement([read("/api/team", team)], ACCOUNT)).toBeNull();
    expect(findEntitlement([read("/api/team", { members: team })], ACCOUNT)).toBeNull();
  });

  it("never takes another user's own object", () => {
    expect(findEntitlement([read("/api/users/u_sam", { id: "u_sam", email: SAM, plan: "pro", role: "owner" })], ACCOUNT)).toBeNull();
  });

  it("matches Account A by a whole field value, never by a value that merely contains it", () => {
    // Another user's email that contains A's.
    expect(findEntitlement([read("/api/users/u_sam", { id: "u_sam", email: "sam.alex@example.test", plan: "pro" })], ACCOUNT)).toBeNull();
    // Another user's username that starts with A's.
    expect(findEntitlement([read("/api/users/u_alexis", { id: "u_alexis", username: "alexis", plan: "pro" })], { username: "alex" })).toBeNull();
    // A's own email spelled with capitals is still A (emails are compared without case).
    expect(findEntitlement([read("/api/me", { email: "Alex@Example.test", plan: "free" })], ACCOUNT)).toEqual({
      url: `${ORIGIN}/api/me`,
      path: "",
      values: { plan: "free" },
    });
  });

  it("never takes plan data that doesn't name Account A (a pricing endpoint)", () => {
    expect(findEntitlement([read("/api/pricing", { plan: "pro", price: 1200, currency: "usd" })], ACCOUNT)).toBeNull();
  });

  it("takes Account A's object, never another user's values, when a list of other users came first", () => {
    const snap = findEntitlement(
      [
        read("/api/team", [{ id: "u_sam", email: SAM, name: "Sam Lee", role: "owner", plan: "pro" }]),
        read("/api/me", { id: "u_alex", email: ALEX, name: "Alex Rivera", plan: "free", role: "member" }),
      ],
      ACCOUNT,
    );
    expect(snap?.url).toBe(`${ORIGIN}/api/me`);
    expect(snap?.values).toEqual({ plan: "free", role: "member" });
  });

  it("never takes Account A's entry in a list of members (it holds a team role, not the account's plan); the account's own object wins", () => {
    // Fernway's shapes: GET /api/members is the workspace's team (Account A among them, with a job role), and the plan
    // lives on GET /api/users/<id>/profile.
    const members = [
      { id: "alex-rivera", name: "Alex Rivera", email: ALEX, role: "Studio lead", avatar: 0 },
      { id: "priya-shah", name: "Priya Shah", email: "priya@example.test", role: "Product designer", avatar: 1 },
    ];
    const profile = { id: "u_alex", displayName: "Alex Rivera", email: ALEX, bio: "", timeZone: "Europe/Lisbon", avatar: 0, role: "member", plan: "free" };
    expect(findEntitlement([read("/api/members", members), read("/api/users/u_alex/profile", profile)], ACCOUNT)).toEqual({
      url: `${ORIGIN}/api/users/u_alex/profile`,
      path: "",
      values: { role: "member", plan: "free" },
    });
    expect(findEntitlement([read("/api/members", members)], ACCOUNT)).toBeNull();
    expect(findEntitlement([read("/api/team", { members })], ACCOUNT)).toBeNull();
  });

  it("takes a one-row list that is Account A's own row with a plan field (PostgREST's select without .single()), at path \"0\"", () => {
    const url = "/rest/v1/profiles?id=eq.u_alex&select=*";
    expect(findEntitlement([read(url, [{ id: "u_alex", email: ALEX, display_name: "Alex Rivera", plan: "free", role: "member" }])], ACCOUNT)).toEqual({
      url: `${ORIGIN}${url}`,
      path: "0",
      values: { plan: "free", role: "member" },
    });
    // A solo workspace's members list: A's only row holds a team role and no plan field, so it is not the account's
    // entitlement, and the account's own object that follows is taken.
    const solo = [{ id: "alex-rivera", name: "Alex Rivera", email: ALEX, role: "Studio lead", avatar: 0 }];
    expect(findEntitlement([read("/api/members", solo)], ACCOUNT)).toBeNull();
    expect(findEntitlement([read("/api/members", solo), read("/api/users/u_alex/profile", { id: "u_alex", email: ALEX, role: "member", plan: "free" })], ACCOUNT)).toEqual({
      url: `${ORIGIN}/api/users/u_alex/profile`,
      path: "",
      values: { role: "member", plan: "free" },
    });
    // A list of several users is never taken, even when A's row in it holds a plan.
    const several = [
      { id: "u_sam", email: SAM, plan: "pro" },
      { id: "u_alex", email: ALEX, plan: "free" },
    ];
    expect(findEntitlement([read("/api/team", several)], ACCOUNT)).toBeNull();
  });

  it("never takes a workspace's plan because Account A is listed among its members (it describes the workspace, not the account)", () => {
    const workspace = { id: "w1", name: "Studio", plan: "free", members: [{ email: ALEX, role: "owner" }] };
    expect(findEntitlement([read("/api/workspace", workspace)], ACCOUNT)).toBeNull();
    expect(findEntitlement([read("/api/workspaces/w1", { workspace })], ACCOUNT)).toBeNull();
  });

  it("reads only successful GETs with a JSON body", () => {
    const snap = findEntitlement(
      [
        // The success page's confirm: a POST, not a read, even though it answers with A's plan.
        read("/api/billing/confirm", { email: ALEX, plan: "pro" }, { method: "POST" }),
        // An error answer is not A's entitlement.
        read("/api/profile", { email: ALEX, plan: "pro" }, { status: 404 }),
        // Not JSON.
        read("/api/me.html", null),
        read("/api/account", { email: ALEX, plan: "free" }),
      ],
      ACCOUNT,
    );
    expect(snap).toEqual({ url: `${ORIGIN}/api/account`, path: "", values: { plan: "free" } });
  });

  it("takes the first qualifying GET the app made", () => {
    const snap = findEntitlement(
      [read("/api/me", { email: ALEX, plan: "free" }), read("/api/users/u_alex/profile", { email: ALEX, displayName: "Alex", plan: "free", role: "member" })],
      ACCOUNT,
    );
    expect(snap?.url).toBe(`${ORIGIN}/api/me`);
  });

  it("returns null when nothing qualifies: no reads, or Account A's object with no entitlement field", () => {
    expect(findEntitlement([], ACCOUNT)).toBeNull();
    expect(findEntitlement([read("/api/me", { id: "u_alex", email: ALEX, name: "Alex Rivera" })], ACCOUNT)).toBeNull();
  });

  it("never returns Account A's username (it is matched, not kept)", () => {
    const snaps = [
      findEntitlement([read("/api/me", { id: "u_alex", email: ALEX, displayName: ALEX, plan: "free", role: "member" })], ACCOUNT),
      findEntitlement([read("/api/me", { user: { id: "u_alex", email: ALEX }, plan: "free" })], ACCOUNT),
    ];
    for (const snap of snaps) {
      expect(snap).not.toBeNull();
      expect(JSON.stringify(snap)).not.toContain(ALEX);
    }
  });
});

describe("entitlement: isPaid", () => {
  it("is false for a free plan, whatever else the account holds", () => {
    const unpaid: Record<string, unknown>[] = [
      { plan: "free" },
      { plan: "Free" },
      { tier: "FREE" },
      { plan: "free", role: "member", credits: 0 },
      { isPro: false },
      { pro: false },
      { plan: null },
      { subscription: null },
      { role: "member" },
      { credits: 0 },
      { entitlements: [] },
      { features: [] },
      { plan: { id: "free", name: "Free" } },
      // Credits on a free plan, or alone: a free tier often grants some.
      { plan: "free", credits: 10 },
      { credits: 10 },
      // A subscription that isn't active, whatever plan it names.
      { subscription: { status: "inactive", plan: "free", renewsAt: null } },
      { subscription: { status: "canceled", plan: "pro" } },
      // No plan, a trial (nothing paid yet), a role that isn't a plan.
      { plan: "" },
      { plan: "none" },
      { plan: "trial" },
      { role: "admin" },
      // Fields of A's own object inside the outer one, by dotted name.
      { subscription: { status: "inactive" }, "user.role": "member" },
    ];
    for (const values of unpaid) expect(isPaid(values), JSON.stringify(values)).toBe(false);
  });

  it("is true for a paid plan: a plan or tier that isn't free, isPro or pro true, an active paid subscription", () => {
    const paid: Record<string, unknown>[] = [
      { plan: "pro" },
      { plan: "Pro", role: "member" },
      { tier: "enterprise" },
      { isPro: true },
      { pro: true },
      { subscription: { status: "active", plan: "pro" } },
      { plan: { id: "pro", name: "Pro" } },
      // A field of A's own object inside the outer one is judged by its own name (the part after the last dot).
      { "user.plan": "pro" },
      { subscription: { status: "active", plan: "pro" }, "user.role": "member" },
    ];
    for (const values of paid) expect(isPaid(values), JSON.stringify(values)).toBe(true);
  });
});

describe("entitlement: changedEntitlement compares structurally", () => {
  it("names nothing when the values are the same, including new objects and lists with the same content", () => {
    const before = { plan: "free", features: { export: false, api: false }, entitlements: ["basic"], credits: 3 };
    const after = { credits: 3, entitlements: ["basic"], features: { api: false, export: false }, plan: "free" };
    expect(changedEntitlement(before, after)).toEqual([]);
  });

  it("names a field whose value changed", () => {
    expect(changedEntitlement({ plan: "free", role: "member" }, { plan: "pro", role: "member" })).toEqual(["plan"]);
  });

  it("names a field whose nested value changed", () => {
    expect(changedEntitlement({ features: { export: false } }, { features: { export: true } })).toEqual(["features"]);
    expect(changedEntitlement({ entitlements: ["basic"] }, { entitlements: ["basic", "pro"] })).toEqual(["entitlements"]);
    expect(changedEntitlement({ subscription: null }, { subscription: { status: "active" } })).toEqual(["subscription"]);
  });

  it("names a field that appeared or disappeared", () => {
    expect(changedEntitlement({ plan: "free", credits: 5 }, { plan: "free" })).toEqual(["credits"]);
    expect(changedEntitlement({ plan: "free" }, { plan: "free", isPro: true })).toEqual(["isPro"]);
  });

  it("tells values of different types apart", () => {
    expect(changedEntitlement({ credits: 5 }, { credits: "5" })).toEqual(["credits"]);
  });

  it("counts a list whose order changed as a change (lists compare in order; only object keys ignore order)", () => {
    expect(changedEntitlement({ entitlements: ["a", "b"] }, { entitlements: ["b", "a"] })).toEqual(["entitlements"]);
  });

  it("names every changed field", () => {
    const names = changedEntitlement({ plan: "free", credits: 0, role: "member" }, { plan: "pro", credits: 1000, role: "member" });
    expect([...names].sort()).toEqual(["credits", "plan"]);
  });
});

type Handler = (req: IdentityRequest & { as: string }) => IdentityResponse | Promise<IdentityResponse>;

/** A CheckContext whose request() answers from `handler`, recording what it was sent. Account A's marker is ALEX. */
function fakeContext(handler: Handler): { ctx: CheckContext; sent: (IdentityRequest & { as: string })[] } {
  const sent: (IdentityRequest & { as: string })[] = [];
  const ctx = {
    targetUrl: `${ORIGIN}/app`,
    runToken: "pw7e57a1",
    accountMarkers: () => [ALEX],
    request: async (as: string, req: IdentityRequest) => {
      sent.push({ as, ...req });
      return handler({ as, ...req });
    },
    log: () => undefined,
    step: () => undefined,
  } as unknown as CheckContext;
  return { ctx, sent };
}

const ok = (body: unknown): IdentityResponse => ({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("entitlement: rereadEntitlement reads again as Account A", () => {
  const snapAt = (path: string, values: Record<string, unknown>, url = `${ORIGIN}/api/me`): EntitlementSnapshot => ({ url, path, values });

  it("sends one GET as Account A to the snapshot's URL and returns the entitlement fields at its path", async () => {
    const { ctx, sent } = fakeContext(() => ok({ ok: true, user: { id: "u_alex", email: ALEX, name: "Alex Rivera", tier: "pro", credits: 3 } }));
    const values = await rereadEntitlement(ctx, snapAt("user", { tier: "free", credits: 3 }, `${ORIGIN}/api/session`));
    expect(values).toEqual({ tier: "pro", credits: 3 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.as).toBe("self");
    expect(sent[0]!.url).toBe(`${ORIGIN}/api/session`);
    expect((sent[0]!.method ?? "GET").toUpperCase()).toBe("GET");
    expect(sent[0]!.body).toBeUndefined();
    expect(JSON.stringify(values)).not.toContain(ALEX);
  });

  it("reads the root object and a deeper path", async () => {
    const root = fakeContext(() => ok({ id: "u_alex", email: ALEX, plan: "pro", role: "member" }));
    expect(await rereadEntitlement(root.ctx, snapAt("", { plan: "free", role: "member" }))).toEqual({ plan: "pro", role: "member" });

    const deep = fakeContext(() => ok({ data: { account: { username: ALEX, isPro: true, features: ["export", "api"] } } }));
    expect(await rereadEntitlement(deep.ctx, snapAt("data.account", { isPro: false, features: ["export"] }, `${ORIGIN}/api/account`))).toEqual({
      isPro: true,
      features: ["export", "api"],
    });
  });

  it("returns every entitlement field the object holds now, also one the snapshot didn't have", async () => {
    // A grant that adds isPro without touching plan must still show up as a change.
    const grown = fakeContext(() => ok({ id: "u_alex", email: ALEX, plan: "free", role: "member", isPro: true }));
    expect(await rereadEntitlement(grown.ctx, snapAt("", { plan: "free", role: "member" }))).toEqual({ plan: "free", role: "member", isPro: true });
  });

  it("reads the outer object and A's own object inside it the way findEntitlement took them", async () => {
    const { ctx } = fakeContext(() => ok({ user: { id: "u_alex", email: ALEX, role: "member" }, subscription: { status: "active", plan: "pro" } }));
    const before = { subscription: { status: "inactive", plan: "free" }, "user.role": "member" };
    expect(await rereadEntitlement(ctx, snapAt("", before))).toEqual({ subscription: { status: "active", plan: "pro" }, "user.role": "member" });
  });

  it("reads a one-row list at path \"0\", and returns null when the row is gone", async () => {
    const url = `${ORIGIN}/rest/v1/profiles?id=eq.u_alex&select=*`;
    const now = fakeContext(() => ok([{ id: "u_alex", email: ALEX, plan: "pro", role: "member" }]));
    expect(await rereadEntitlement(now.ctx, snapAt("0", { plan: "free", role: "member" }, url))).toEqual({ plan: "pro", role: "member" });
    expect(now.sent).toHaveLength(1);
    expect(now.sent[0]!.as).toBe("self");
    expect(now.sent[0]!.url).toBe(url);

    const gone = fakeContext(() => ok([]));
    expect(await rereadEntitlement(gone.ctx, snapAt("0", { plan: "free", role: "member" }, url))).toBeNull();
  });

  it("returns null, not a change, when the object at the path is no longer Account A's (another user's session)", async () => {
    const { ctx } = fakeContext(() => ok({ id: "u_sam", email: SAM, plan: "pro", role: "owner" }));
    expect(await rereadEntitlement(ctx, snapAt("", { plan: "free", role: "member" }))).toBeNull();
  });

  it("returns null, not a change, when the read itself fails", async () => {
    const snap = snapAt("user", { tier: "free" }, `${ORIGIN}/api/session`);
    const answers: IdentityResponse[] = [
      { status: 500, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "Down" }) },
      { status: 401, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "Sign in first" }) },
      // A sign-in page instead of JSON.
      { status: 200, headers: { "content-type": "text/html" }, body: "<!doctype html><title>Sign in</title><form><input type=password></form>" },
      // JSON, but the account object isn't there any more.
      ok({ error: "Try again later" }),
    ];
    for (const answer of answers) {
      const { ctx } = fakeContext(() => answer);
      expect(await rereadEntitlement(ctx, snap), `${answer.status} ${answer.body.slice(0, 40)}`).toBeNull();
    }
  });

  it("returns null when the root object no longer holds any entitlement field (a 200 error answer)", async () => {
    const { ctx } = fakeContext(() => ok({ error: "Too many requests" }));
    expect(await rereadEntitlement(ctx, snapAt("", { plan: "free", role: "member" }))).toBeNull();
  });

  it("returns null, not every field changed, when Account A's object is there but holds no entitlement field any more", async () => {
    // Can't tell what happened (a trimmed answer, another view of the account): inconclusive, never a finding.
    const { ctx } = fakeContext(() => ok({ id: "u_alex", email: ALEX, name: "Alex Rivera" }));
    expect(await rereadEntitlement(ctx, snapAt("", { plan: "free" }))).toBeNull();
  });

  it("returns null when the request is refused before it is sent (the safety gate)", async () => {
    const { ctx } = fakeContext(() => {
      throw new Error("That address isn't an allowed target.");
    });
    await expect(rereadEntitlement(ctx, snapAt("", { plan: "free" }))).resolves.toBeNull();
  });
});
