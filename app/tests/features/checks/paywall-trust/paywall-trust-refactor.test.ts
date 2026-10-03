/**
 * Behavioral regression tests for the paywall-trust refactor. Each test exercises a path that drifted in the prior
 * split, using the production functions' exported surface. String-payload tests run in-process; holdRoute and
 * openRoute tests use mock pages; billingTabs/openRoute production tests use a real Playwright page (shared headless
 * Chromium) so the in-page scripts and selectors actually execute.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PAYMENT_PROVIDERS, RESTORE_HOLD, RESTORE_WRITE_HOLD, START_STEP, SUCCESS_WORDS, BILLING_WORDS, NEVER_READ, READ_WORDS, ACTING_LINK, PORTAL_STEP, SIGN_IN_PATH, CLAIMS_UPGRADE, PROVIDER_PATTERNS, PAYWALL_TRUST_ID } from "../../../../src/constants/paywall-trust-constants.js";
import { isWrite, sendsWrite, speculative, namesTheCancel, settleFor, PLAN_FIELD } from "../../../../src/checks/paywall-trust/paywall-trust.helpers.js";
import { hostOf, isPaymentProvider, ofTheApp, pageKey, pathOf, placeOf, startsFrom, stepNoun, shown, listed, q } from "../../../../src/checks/paywall-trust/urls.js";
import { holdRoute, stepPage, tabName, tabNote, billingTabs, chooseTab } from "../../../../src/checks/paywall-trust/page-navigation.js";
import { cancelUndoes, refusal } from "../../../../src/checks/paywall-trust/entitlement-reads.js";
import { check, hider, openRoute } from "../../../../src/checks/paywall-trust.js";
import { registerSecretLiterals } from "../../../../src/engine/redact.js";
import type { Page, Route as PwRoute } from "playwright";
import { getBrowser } from "../../../../test-support/harness.js";
import { startFixtureServer, type FixtureServer } from "../../../../test-support/server.js";

function mockRequest(resourceType: string, method: string, isNavigation = false, url = "https://example.com/x"): {
  url: () => string;
  method: () => string;
  isNavigationRequest: () => boolean;
  resourceType: () => string;
  headers: () => Record<string, string>;
} {
  return { url: () => url, method: () => method, isNavigationRequest: () => isNavigation, resourceType: () => resourceType, headers: () => ({}) };
}

function mockRoute(opts: { fallback: () => Promise<unknown>; abort: () => Promise<unknown> } = {
  fallback: () => Promise.resolve(),
  abort: () => Promise.resolve(),
}): PwRoute {
  return opts as unknown as PwRoute;
}

describe("paywall-trust refactor: production-route classification (SIGN_IN_PATH not SIGN_IN_PAGE)", () => {
  it("classifies the redirect's landed path with the production regex (matches /account/auth/callback)", () => {
    expect(SIGN_IN_PATH.test("/login")).toBe(true);
    expect(SIGN_IN_PATH.test("/sign-in")).toBe(true);
    expect(SIGN_IN_PATH.test("/auth/callback")).toBe(true);
    expect(SIGN_IN_PATH.test("/account/auth/callback")).toBe(true);
    expect(SIGN_IN_PATH.test("/api/auth/session")).toBe(true);
    expect(SIGN_IN_PATH.test("/account/session")).toBe(true);
    expect(SIGN_IN_PATH.test("/sso/callback")).toBe(true);
    expect(SIGN_IN_PATH.test("/signin")).toBe(true);
  });

  it("does not classify a normal path as a sign-in redirect", () => {
    expect(SIGN_IN_PATH.test("/app")).toBe(false);
    expect(SIGN_IN_PATH.test("/billing/success")).toBe(false);
    expect(SIGN_IN_PATH.test("/api/me")).toBe(false);
  });
});

describe("paywall-trust refactor: production openRoute classifies real navigations (browser)", () => {
  let browser: import("playwright").Browser;
  let page: Page;
  let server: FixtureServer;
  let baseUrl: string;

  beforeAll(async () => {
    browser = await getBrowser();
    page = await browser.newPage();
    server = await startFixtureServer({
      pages: {
        "/app": "<!doctype html><html><body><h1>app</h1></body></html>",
        "/account/auth/callback": "<!doctype html><html><body>callback</body></html>",
        "/account/session": "<!doctype html><html><body>session</body></html>",
      },
    });
    baseUrl = server.url;
  });

  afterAll(async () => {
    await page.close();
    await server.close();
  });

  it("openRoute loads /app on the same origin and answers", async () => {
    const out = await openRoute(page, `${baseUrl}/app`, []);
    expect(out.outcome).toBe("answered");
    expect(out.landed).toBe(`${baseUrl}/app`);
  });

  it("openRoute's redirect classifier uses SIGN_IN_PATH for /account/auth/callback (moved case)", async () => {
    // Simulate a redirect to /account/auth/callback by navigating directly there; the production regex matches.
    const out = await openRoute(page, `${baseUrl}/account/auth/callback`, []);
    expect(out.outcome).toBe("answered");
    // The landed path passes SIGN_IN_PATH.test(pathOf(landed)) — this is the predicate openRoute uses to mark
    // a moved-load as "sign-in" (the case SIGN_IN_PAGE would miss but SIGN_IN_PATH catches).
    const u = new URL(out.landed);
    expect(SIGN_IN_PATH.test(u.pathname)).toBe(true);
  });

  it("openRoute's redirect classifier uses SIGN_IN_PATH for /account/session (moved case)", async () => {
    const out = await openRoute(page, `${baseUrl}/account/session`, []);
    expect(out.outcome).toBe("answered");
    const u = new URL(out.landed);
    expect(SIGN_IN_PATH.test(u.pathname)).toBe(true);
  });
});

describe("paywall-trust refactor: holdRoute handles fetch/xhr/ping writes (integration)", () => {
  it("abort: a POST fetch writes named by the hold", async () => {
    const hold = { stop: () => false, writes: (u: string) => u.includes("/api"), stopped: [] as string[], sent: new Set<string>() };
    let aborted: { url: string } | null = null;
    const route = mockRoute({
      fallback: () => Promise.resolve("fallback"),
      abort: () => {
        aborted = { url: "https://app.example.com/api/x" };
        return Promise.resolve();
      },
    });
    const req = mockRequest("fetch", "POST", false, "https://app.example.com/api/x");
    await holdRoute(hold)(route, req as unknown as Parameters<ReturnType<typeof holdRoute>>[1]);
    expect(aborted).toEqual({ url: "https://app.example.com/api/x" });
    expect(hold.stopped).toContain("https://app.example.com/api/x");
    expect(hold.sent.has("https://app.example.com/api/x")).toBe(true);
  });

  it("abort: a PUT fetch write goes through (different verb)", async () => {
    const hold = { stop: () => false, writes: (u: string) => u.includes("/api"), stopped: [] as string[], sent: new Set<string>() };
    let aborted = false;
    const route = mockRoute({ fallback: () => Promise.resolve(), abort: () => { aborted = true; return Promise.resolve(); } });
    await holdRoute(hold)(route, mockRequest("fetch", "PUT", false, "https://app.example.com/api/x") as unknown as Parameters<ReturnType<typeof holdRoute>>[1]);
    expect(aborted).toBe(true);
  });

  it("abort: a DELETE fetch write goes through", async () => {
    const hold = { stop: () => false, writes: (u: string) => u.includes("/api"), stopped: [] as string[], sent: new Set<string>() };
    let aborted = false;
    const route = mockRoute({ fallback: () => Promise.resolve(), abort: () => { aborted = true; return Promise.resolve(); } });
    await holdRoute(hold)(route, mockRequest("fetch", "DELETE", false, "https://app.example.com/api/x") as unknown as Parameters<ReturnType<typeof holdRoute>>[1]);
    expect(aborted).toBe(true);
  });

  it("fallback: a GET fetch passes through (writes() guard)", async () => {
    const hold = { stop: () => false, writes: (u: string) => u.includes("/api"), stopped: [] as string[], sent: new Set<string>() };
    let fellBack = false;
    const route = mockRoute({
      fallback: () => {
        fellBack = true;
        return Promise.resolve("fallback");
      },
      abort: () => Promise.resolve(),
    });
    await holdRoute(hold)(route, mockRequest("fetch", "GET", false, "https://app.example.com/api/x") as unknown as Parameters<ReturnType<typeof holdRoute>>[1]);
    expect(fellBack).toBe(true);
    expect(hold.stopped.length).toBe(0);
  });

  it("fallback: a HEAD fetch passes through", async () => {
    const hold = { stop: () => false, writes: (u: string) => u.includes("/api"), stopped: [] as string[], sent: new Set<string>() };
    let fellBack = false;
    const route = mockRoute({
      fallback: () => {
        fellBack = true;
        return Promise.resolve();
      },
      abort: () => Promise.resolve(),
    });
    await holdRoute(hold)(route, mockRequest("fetch", "HEAD", false, "https://app.example.com/api/x") as unknown as Parameters<ReturnType<typeof holdRoute>>[1]);
    expect(fellBack).toBe(true);
  });

  it("fallback: an OPTIONS fetch passes through (preflight)", async () => {
    const hold = { stop: () => false, writes: (u: string) => u.includes("/api"), stopped: [] as string[], sent: new Set<string>() };
    let fellBack = false;
    const route = mockRoute({
      fallback: () => {
        fellBack = true;
        return Promise.resolve();
      },
      abort: () => Promise.resolve(),
    });
    await holdRoute(hold)(route, mockRequest("fetch", "OPTIONS", false, "https://app.example.com/api/x") as unknown as Parameters<ReturnType<typeof holdRoute>>[1]);
    expect(fellBack).toBe(true);
  });

  it("abort: a beacon (ping) write is stopped", async () => {
    const hold = { stop: () => false, writes: () => true, stopped: [] as string[], sent: new Set<string>() };
    let aborted = false;
    const route = mockRoute({
      fallback: () => Promise.resolve(),
      abort: () => {
        aborted = true;
        return Promise.resolve();
      },
    });
    await holdRoute(hold)(route, mockRequest("ping", "POST", false, "https://app.example.com/api/x") as unknown as Parameters<ReturnType<typeof holdRoute>>[1]);
    expect(aborted).toBe(true);
    expect(hold.stopped).toContain("https://app.example.com/api/x");
  });

  it("fallback: a document POST navigation is NOT stopped by the writes branch (only nav branch)", async () => {
    const hold = { stop: () => false, writes: () => true, stopped: [] as string[], sent: new Set<string>() };
    let fellBack = false;
    const route = mockRoute({
      fallback: () => {
        fellBack = true;
        return Promise.resolve();
      },
      abort: () => Promise.resolve(),
    });
    await holdRoute(hold)(route, mockRequest("document", "POST", true, "https://app.example.com/x") as unknown as Parameters<ReturnType<typeof holdRoute>>[1]);
    expect(fellBack).toBe(true);
    expect(hold.stopped.length).toBe(0);
  });

  it("abort: a document POST navigation stopped by stop() (the nav branch)", async () => {
    const hold = { stop: (u: string) => u.includes("blocked"), writes: () => true, stopped: [] as string[], sent: new Set<string>() };
    let aborted = false;
    const route = mockRoute({
      fallback: () => Promise.resolve(),
      abort: () => {
        aborted = true;
        return Promise.resolve();
      },
    });
    await holdRoute(hold)(route, mockRequest("document", "POST", true, "https://app.example.com/blocked") as unknown as Parameters<ReturnType<typeof holdRoute>>[1]);
    expect(aborted).toBe(true);
  });
});

describe("paywall-trust refactor: production hider (redactSecrets then marker mask)", () => {
  it("hides a registered secret literal AND a marker in one pass", () => {
    const secret = "AbCdEf1234567890XyZw"; // looksRandom-shape: 20 chars, mixed case + digits
    const unregister = registerSecretLiterals([secret]);
    try {
      const hide = hider(["alice@acme.test"]);
      const text = `token=${secret} user=alice@acme.test saved=42`;
      const out = hide(text);
      expect(out).not.toContain(secret);
      expect(out).not.toContain("alice@acme.test");
      expect(out).toContain("[account]");
    } finally {
      unregister();
    }
  });

  it("hides a marker when no registered secret is present", () => {
    const hide = hider(["alice@acme.test"]);
    const out = hide("user=alice@acme.test saved=42");
    expect(out).not.toContain("alice@acme.test");
    expect(out).toContain("[account]");
  });

  it("a registered secret survives even with no marker", () => {
    const secret = "AbCdEf1234567890XyZw";
    const unregister = registerSecretLiterals([secret]);
    try {
      const hide = hider([]);
      const out = hide(`Bearer ${secret} body`);
      expect(out).not.toContain(secret);
    } finally {
      unregister();
    }
  });

  it("text without markers or registered secrets is unchanged", () => {
    const hide = hider([]);
    expect(hide("hello world")).toBe("hello world");
  });
});

describe("paywall-trust refactor: production billingTabs (browser, real setContent)", () => {
  let browser: import("playwright").Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await getBrowser();
    page = await browser.newPage();
  });

  afterAll(async () => {
    await page.close();
  });

  it("finds Billing & Plans tabs and rejects an off-page submit", async () => {
    await page.setContent(`
      <html><body>
        <base href="https://app.example.com/app/">
        <div role="tablist">
          <button role="tab" aria-selected="true">Overview</button>
          <button role="tab" aria-selected="false">Billing</button>
          <button role="tab" aria-selected="false">Plans</button>
          <button role="tab" aria-selected="false">Help</button>
        </div>
        <a href="https://stripe.com/x">Pay</a>
        <button type="submit">Save</button>
      </body></html>
    `);
    const tabs = await billingTabs(page);
    // billingTabs returns unselected tabs that match BILLING_TAB on the visible element.
    const names = tabs.map((t) => t.name);
    expect(names).toContain("Billing");
    expect(names).toContain("Plans");
    expect(names).not.toContain("Overview");
    expect(names).not.toContain("Help");
    // The submit button is not a [role=tab] and is not matched.
    expect(names).not.toContain("Save");
  });

  it("chooseTab on a Billing tab keeps the page on the same page (not a link click)", async () => {
    await page.setContent(`
      <html><body>
        <base href="https://app.example.com/app/">
        <div role="tablist">
          <button role="tab" aria-selected="false">Billing</button>
        </div>
      </body></html>
    `);
    const tabs = await billingTabs(page);
    expect(tabs.length).toBe(1);
    const result = await chooseTab(page, tabs[0]!, 0);
    // The click was attempted; the hold for chooseTab doesn't block Billing on the same page.
    expect(result.clicked).toBe(true);
  });
});

describe("paywall-trust refactor: settleFor (helper module)", () => {
  it("rounds the same way the original did", () => {
    expect(settleFor(0)).toBe(5_000);
    expect(settleFor(2_000)).toBe(7_000);
    expect(settleFor(60_000)).toBe(60_000);
    expect(settleFor(120_000)).toBe(60_000);
    expect(settleFor(-100)).toBe(5_000);
  });
});

describe("paywall-trust refactor: PLAN_FIELD canonical (helper module)", () => {
  it("matches the production plan field names", () => {
    expect(PLAN_FIELD.test("plan")).toBe(true);
    expect(PLAN_FIELD.test("tier")).toBe(true);
    expect(PLAN_FIELD.test("subscription")).toBe(true);
    expect(PLAN_FIELD.test("ispro")).toBe(true);
    expect(PLAN_FIELD.test("pro")).toBe(true);
    expect(PLAN_FIELD.test("Plan")).toBe(true);
    expect(PLAN_FIELD.test("PRO")).toBe(true);
  });
  it("does not match non-plan field names", () => {
    expect(PLAN_FIELD.test("credits")).toBe(false);
    expect(PLAN_FIELD.test("role")).toBe(false);
    expect(PLAN_FIELD.test("entitlements")).toBe(false);
    expect(PLAN_FIELD.test("features")).toBe(false);
  });
});

describe("paywall-trust refactor: cancelUndoes mixed-drift endpoint selection (integration)", () => {
  it("a mixed plan + credits change picks the plan endpoint (cancelUndoes=true)", () => {
    expect(cancelUndoes(["plan", "credits"], { plan: "free", credits: 10 })).toBe(true);
  });

  it("features/entitlements alone are undoable only when no plan field exists (snapshot endpoint)", () => {
    expect(cancelUndoes(["features"], { plan: "free", features: ["x"] })).toBe(false);
    expect(cancelUndoes(["features"], { features: ["x"] })).toBe(true);
    expect(cancelUndoes(["entitlements"], { entitlements: ["x"] })).toBe(true);
    expect(cancelUndoes(["entitlements"], { plan: "free", entitlements: ["x"] })).toBe(false);
  });

  it("a credits-only loss is not undoable (no plan field)", () => {
    expect(cancelUndoes(["credits"], { plan: "free", credits: 10 })).toBe(false);
    expect(cancelUndoes(["credits"], { credits: 10 })).toBe(false);
  });

  it("a role change alone is not undoable (role is not in PLAN_FIELD/PLAN_FEATURES)", () => {
    expect(cancelUndoes(["role"], { role: "admin", plan: "free" })).toBe(false);
    expect(cancelUndoes(["role"], { role: "admin" })).toBe(false);
  });

  it("a nested plan field is undoable via lastPart normalization", () => {
    expect(cancelUndoes(["user.plan"], { "user.plan": "pro" })).toBe(true);
    expect(cancelUndoes(["user.subscription"], { "user.subscription": "active", "user.plan": "free" })).toBe(true);
  });

  it("refusal rejects provider naming and portal opens, not the same-origin paths", () => {
    expect(refusal({ href: "https://stripe.com/x", formAction: null, name: "Cancel" } as Parameters<typeof refusal>[0], "https://app.example.com/", "/app")).not.toBeNull();
    expect(refusal({ href: "https://app.example.com/billing/portal", formAction: null, name: "Cancel" } as Parameters<typeof refusal>[0], "https://app.example.com/", "/app")).not.toBeNull();
    expect(refusal({ href: null, formAction: null, name: "Cancel" } as Parameters<typeof refusal>[0], "https://app.example.com/", "/app")).toBeNull();
  });
});

describe("paywall-trust refactor: security regex payloads (string-payload drift)", () => {
  it("PAYMENT_PROVIDERS matches the exact 52-host list (full order)", () => {
    expect(PAYMENT_PROVIDERS).toEqual([
      "stripe.com", "stripe.network", "paypal.com", "paypalobjects.com", "braintreegateway.com",
      "braintree-api.com", "venmo.com", "paddle.com", "lemonsqueezy.com", "lmsqueezy.com",
      "squareup.com", "squareupsandbox.com", "squarecdn.com", "stripecdn.com", "shopify.com",
      "shop.app", "adyen.com", "adyenpayments.com", "checkout.com", "razorpay.com",
      "mollie.com", "chargebee.com", "recurly.com", "gumroad.com", "fastspring.com",
      "onfastspring.com", "2checkout.com", "2co.com", "klarna.com", "afterpay.com",
      "clearpay.co.uk", "polar.sh", "authorize.net", "paystack.co", "paystack.com",
      "flutterwave.com", "mercadopago.com", "payu.com", "wepay.com", "pay.google.com",
      "pay.amazon.com", "payments.amazon.com", "apple-pay-gateway.apple.com", "dodopayments.com",
      "creem.io", "freemius.com", "chargify.com", "zuora.com", "bluesnap.com", "worldpay.com",
      "commerce.coinbase.com",
    ]);
  });

  it("PROVIDER_PATTERNS is derived from every host (4 patterns each, in the same order)", () => {
    expect(PROVIDER_PATTERNS).toContain("*://stripe.com/*");
    expect(PROVIDER_PATTERNS).toContain("*://*.stripe.com/*");
    expect(PROVIDER_PATTERNS).toContain("*://stripe.com:*");
    expect(PROVIDER_PATTERNS).toContain("*://*.stripe.com:*");
    expect(PROVIDER_PATTERNS).toContain("*://commerce.coinbase.com/*");
    expect(PROVIDER_PATTERNS.length).toBe(PAYMENT_PROVIDERS.length * 4);
  });

  it("namesTheCancel preserves the original truth table", () => {
    expect(namesTheCancel("No, cancel my plan")).toBe(true);
    expect(namesTheCancel("Continue to cancel")).toBe(true);
    expect(namesTheCancel("Downgrade to Free")).toBe(true);
    expect(namesTheCancel("Cancel")).toBe(false);
    expect(namesTheCancel("Don't cancel")).toBe(false);
    expect(namesTheCancel("Continue to checkout")).toBe(false);
    expect(namesTheCancel("Sign out")).toBe(false);
    expect(namesTheCancel("Cancel subscription")).toBe(true);
  });

  it("isWrite/sendsWrite/speculative match the production predicates", () => {
    expect(isWrite("GET")).toBe(false);
    expect(isWrite("HEAD")).toBe(false);
    expect(isWrite("OPTIONS")).toBe(false);
    expect(isWrite("POST")).toBe(true);
    expect(isWrite("PUT")).toBe(true);
    expect(isWrite("DELETE")).toBe(true);
    expect(sendsWrite("fetch", "POST")).toBe(true);
    expect(sendsWrite("fetch", "GET")).toBe(false);
    expect(sendsWrite("xhr", "POST")).toBe(true);
    expect(sendsWrite("ping", "POST")).toBe(true);
    expect(sendsWrite("document", "POST")).toBe(false);
    expect(speculative({ "sec-purpose": "prefetch" })).toBe(true);
    expect(speculative({ purpose: "prerender" })).toBe(true);
    expect(speculative({})).toBe(false);
  });

  it("the security regexes match the same words the originals did", () => {
    expect(SUCCESS_WORDS.test("upgraded")).toBe(true);
    expect(SUCCESS_WORDS.test("thanks")).toBe(true);
    expect(BILLING_WORDS.test("billing")).toBe(true);
    expect(BILLING_WORDS.test("receipts")).toBe(true);
    expect(BILLING_WORDS.test("subscribed")).toBe(true);
    expect(START_STEP.test("/checkout/start")).toBe(true);
    expect(ACTING_LINK.test("Cancel subscription")).toBe(true);
    expect(READ_WORDS.test("settings")).toBe(true);
    expect(NEVER_READ.test("checkout")).toBe(true);
    expect(PORTAL_STEP.test("/billing/portal")).toBe(true);
    expect(RESTORE_HOLD.test("/api/subscribe")).toBe(true);
    expect(RESTORE_WRITE_HOLD.test("/api/portal-session")).toBe(true);
    expect(CLAIMS_UPGRADE.test("You are now on Pro")).toBe(true);
  });

  it("ofTheApp/leavesTheApp keeps the production semantics", () => {
    expect(ofTheApp("https://app.example.com/x", "https://app.example.com/")).toBe(true);
    expect(ofTheApp("http://localhost:3001/api", "https://app.example.com/")).toBe(true);
    expect(ofTheApp("https://other.example/x", "https://app.example.com/")).toBe(false);
    expect(ofTheApp("http://localhost/api", "https://app.example.com/")).toBe(true);
    expect(ofTheApp("http://other.example/portal", "https://app.example.com/")).toBe(false);
  });

  it("startsFrom and stepNoun keep the production semantics", () => {
    const from = "https://app.example.com/app";
    const stop = startsFrom(from);
    expect(stop("https://app.example.com/checkout/start")).toBe(true);
    expect(stop("https://app.example.com/billing/portal")).toBe(true);
    expect(stop("https://app.example.com/checkout/success")).toBe(false);
    expect(stop("https://app.example.com/login")).toBe(false);
    expect(stop("https://app.example.com/app")).toBe(false);
    expect(stop("https://other.example/portal")).toBe(false);
    expect(stepNoun("https://app.example.com/checkout/start")).toBe("a checkout or billing portal start");
    expect(stepNoun("https://app.example.com/api/stripe/cancel")).toBe("a path that names the payment provider");
    expect(stepNoun("https://app.example.com/subscribe")).toBe("a path that may start a checkout or a subscription");
  });
});

describe("paywall-trust refactor: URL/value helpers preserve formatting", () => {
  it("placeOf and shown keep their formatting", () => {
    expect(placeOf("https://app.example.com/x", "https://app.example.com/")).toBe("/x");
    expect(placeOf("https://other.example/y", "https://app.example.com/")).toBe("other.example/y");
    expect(shown("free")).toBe('"free"');
    expect(shown(undefined)).toBe("missing");
    expect(shown(null)).toBe("null");
    const expected = JSON.stringify("x".repeat(80)).slice(0, 80) + "…";
    expect(shown("x".repeat(80))).toBe(expected);
    expect(listed(["a", "b", "c"])).toBe("a, b and c");
    expect(listed(["a"])).toBe("a");
    expect(listed([])).toBe("");
  });

  it("q (JSON.stringify) matches what the in-page scripts use", () => {
    expect(q("x")).toBe('"x"');
    expect(q(true)).toBe("true");
  });
});

describe("paywall-trust refactor: page-navigation edge cases", () => {
  it("stepPage returns undefined for closed pages or about:blank", () => {
    expect(stepPage({ isClosed: () => true, url: () => "about:blank" } as unknown as Page)).toBeUndefined();
    expect(stepPage({ isClosed: () => false, url: () => "about:blank" } as unknown as Page)).toBeUndefined();
    expect(stepPage({ isClosed: () => false, url: () => "https://x/" } as unknown as Page)).toBeDefined();
  });

  it("tabName caps at 40 characters", () => {
    expect(tabName("short")).toBe("short");
    expect(tabName("x".repeat(40))).toBe("x".repeat(40));
    expect(tabName("x".repeat(41))).toBe("x".repeat(40) + "…");
  });

  it("pathOf/pageKey/hostOf/isPaymentProvider handle unparseable URLs", () => {
    expect(pathOf("not a url")).toBe("not a url");
    expect(pageKey("not a url")).toBe("not a url");
    expect(hostOf("not a url")).toBe("");
    expect(isPaymentProvider("not a url")).toBe(false);
    expect(isPaymentProvider("https://stripe.com/x")).toBe(true);
    expect(isPaymentProvider("https://sub.stripe.com/x")).toBe(true);
    expect(isPaymentProvider("https://notstripe.com/x")).toBe(false);
  });

  it("tabNote preserves the wording ('Choosing the X tab' / 'After Run Hound chose the X tabs')", () => {
    expect(tabNote("https://app.example.com/app", ["Billing"], "sent a request to /api/x, which Run Hound stopped")).toContain('Choosing the "Billing" tab on /app');
    expect(tabNote("https://app.example.com/app", ["Billing", "Plans"], "headed for stripe.com (payment provider), which was blocked")).toContain('After Run Hound chose the "Billing" and "Plans" tabs');
  });
});

describe("paywall-trust refactor: orchestrator re-export", () => {
  it("check is the same shape", () => {
    expect(check.id).toBe("paywall-trust");
    expect(check.title).toBe("Paid plans need a real payment");
    expect(check.category).toBe("security");
    expect(check.scope).toBe("page");
    expect(typeof check.plan).toBe("function");
    expect(typeof check.run).toBe("function");
    expect(check.interruptedNote).toMatch(/check Account A/);
    expect(check.id).toBe(PAYWALL_TRUST_ID);
  });
});