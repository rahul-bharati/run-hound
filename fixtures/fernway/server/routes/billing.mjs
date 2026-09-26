// The Pro upgrade (CONTRACT.md "Billing"): a local test checkout, so the plan can change without any payment provider.
// The account's plan lives on its profile record (`plan`, "free" or "pro"); only this module ever changes it (V04
// aside). Node built-ins only.
//
//   POST /api/billing/checkout          { plan } -> 201 Checkout { id, plan, amount, currency, status: "open" }. The
//                                       price comes from PLANS: an amount, price or currency the client sends is ignored.
//   POST /api/billing/checkout/:id/pay  {} -> 200 Checkout (status "paid"). Stands in for the payment provider: it is
//                                       the only thing that marks a checkout paid (test mode, nothing is charged). The
//                                       SPA then opens /app/upgraded?checkout=<id>.
//   POST /api/billing/confirm           { checkout } -> 200 { confirmed, plan }. What /app/upgraded sends on load. The
//                                       plan is granted only for a checkout of the session user that the server itself
//                                       recorded as paid (once; confirming it again answers confirmed: true, and grants
//                                       nothing new). Anything else answers 200 { confirmed: false, plan } and changes
//                                       nothing.
//   POST /api/billing/cancel            {} -> 200 { plan: "free" }. Back to Free straight away (the Billing tab's
//                                       "Switch back to Free").
//
// Every endpoint needs a signed-in session (401 without one; V03 does not apply here). Another user's checkout id
// answers 404 (pay) or confirmed: false (confirm).
//
// Planted bug (CONTRACT.md "V2 planted bugs"):
//   V09  POST /api/billing/confirm grants "pro" to whoever loads /app/upgraded: no checkout, and no payment, needed.

import { badRequest, created, notFound, ok, unauthorized, validator } from "../http.mjs";
import { AUTH_MESSAGES } from "./auth.mjs";

/** The plans an upgrade can buy, with their monthly price in cents. "free" is what every account starts on. */
export const PLANS = Object.freeze({ pro: Object.freeze({ name: "Pro", amount: 1200, currency: "usd" }) });

/** The plan every account starts on, and goes back to on cancel. */
export const FREE_PLAN = "free";

/** @param {import("../seed.mjs").Checkout} c */
const publicCheckout = (c) => ({ id: c.id, plan: c.plan, amount: c.amount, currency: c.currency, status: c.status });

/**
 * @param {import("../http.mjs").Router} router
 * @param {import("../app.mjs").AppContext} ctx
 */
export function register(router, ctx) {
  /**
   * Wraps a handler that needs a signed-in user (no V03 fallback: billing is not part of that bug).
   * @param {(request: import("../http.mjs").ApiRequest & { user: import("../seed.mjs").User,
   *   profile: import("../seed.mjs").Profile }) => import("../http.mjs").ApiResponse} handler
   * @returns {import("../http.mjs").Handler}
   */
  const signedIn = (handler) => (request) => {
    const user = ctx.sessionUser(request.cookies);
    const ws = user ? ctx.workspaceOf(user.id) : undefined;
    if (!user || !ws) return unauthorized(AUTH_MESSAGES.signInFirst);
    return handler({ ...request, user, profile: ws.profile });
  };

  /** The session user's checkout with that id, or undefined (another user's id is never found). */
  const ownCheckout = (/** @type {string} */ userId, /** @type {unknown} */ id) =>
    typeof id === "string" ? ctx.store.checkouts.find((c) => c.id === id && c.userId === userId) : undefined;

  router.post(
    "/api/billing/checkout",
    signedIn(({ body, user }) => {
      const v = validator(body);
      const plan = v.oneOf("plan", Object.keys(PLANS), { required: "Choose a plan.", invalid: "Choose the Pro plan." });
      if (!v.ok) return badRequest(v.errors);
      const price = PLANS[/** @type {keyof typeof PLANS} */ (plan)];
      /** @type {import("../seed.mjs").Checkout} */
      const checkout = {
        id: `chk_${ctx.newId()}`,
        userId: user.id,
        plan,
        amount: price.amount,
        currency: price.currency,
        status: "open",
        createdAt: ctx.now(),
      };
      ctx.store.checkouts.push(checkout);
      return created(publicCheckout(checkout));
    }),
  );

  router.post(
    "/api/billing/checkout/:id/pay",
    signedIn(({ params, user }) => {
      const checkout = ownCheckout(user.id, params.id);
      if (!checkout) return notFound();
      if (checkout.status === "open") checkout.status = "paid";
      return ok(publicCheckout(checkout));
    }),
  );

  router.post(
    "/api/billing/confirm",
    signedIn(({ body, profile, user }) => {
      // V09: the success page is trusted: loading it is taken as proof of payment.
      if (ctx.bugOn("V09")) {
        profile.plan = "pro";
        return ok({ confirmed: true, plan: profile.plan });
      }
      const checkout = ownCheckout(user.id, body.checkout);
      if (checkout?.status === "paid") {
        profile.plan = checkout.plan;
        checkout.status = "fulfilled";
      }
      const confirmed = checkout?.status === "fulfilled";
      return ok({ confirmed, plan: profile.plan });
    }),
  );

  router.post(
    "/api/billing/cancel",
    signedIn(({ profile }) => {
      profile.plan = FREE_PLAN;
      return ok({ plan: profile.plan });
    }),
  );
}
