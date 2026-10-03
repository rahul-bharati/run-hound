/**
 * Reusable fixed values and small predicates for the paywall-trust check: regexes, the conventional success paths,
 * the payment-provider host list, INTERRUPTED_NOTE, PAYWALL_TRUST_ID, and the predicates isWrite/sendsWrite/
 * speculative/namesTheCancel.
 */

/** The contract's conventional success paths, tried in this order after the links. */
export const CONVENTIONAL_PATHS = ["/upgraded", "/app/upgraded", "/success", "/checkout/success", "/billing/success", "/payment/success", "/thank-you", "/thanks", "/app/billing/success"];

/** Words that name a success or upgrade result (in a link's path or text; never its query). */
export const SUCCESS_WORDS = /\b(upgraded|success|successful(ly)?|thank\s?you|thanks|welcome|activated|confirmed)\b/i;

/** Billing words: a success link counts only together with one of them (or under such a path). */
export const BILLING_WORDS = /\b(billing|check\s?out|plans?|upgrade[sd]?|pro|premium|subscriptions?|subscribed|payments?|paid|purchased?|pricing|receipts?)\b/i;

/**
 * Path words of a step that starts something (a checkout, a subscription, a billing portal session): loading one makes
 * the app's server create it and usually redirect to the payment provider. A link whose path names one is a candidate
 * only when the path itself also names the result (`/checkout/success`), never through its query or text.
 */
export const START_STEP = /\b(check\s?out|subscribe|upgrade|buy|purchase|pay|portal|sessions?|create|order|trial|pricing)\b/i;

/**
 * Link names and path words that act when opened. Narrower than linkActs on purpose: "Payment received" and a
 * checkout path are what a success link looks like, not something that acts.
 */
export const ACTING_LINK =
  /\b(log\s?-?out|sign\s?-?out|log\s?off|sign\s?off|delete|remove|cancel|unsubscribe|revoke|deactivate|disconnect|unlink|downgrade|refund|decline|reject|leave|close\s+(my\s+)?account|reset|invite|share|destroy|erase|archive|trash)\b/i;

/** Pages whose links are read too: the page's billing, plan, settings and account pages. */
export const READ_WORDS = /\b(billing|plans?|subscriptions?|settings|account|membership|profile)\b/i;

/**
 * Never opened only to read links: loading them may start a checkout, a payment or a billing portal session on the
 * app's server, or choose a plan ("Choose Pro" → /billing/plans/pro, /account/plan-select), which on a real app
 * usually starts a checkout at the payment provider.
 */
export const NEVER_READ =
  /\b(check\s?out|upgrade[sd]?|subscribe|pay|payments?|purchase|buy|orders?|pricing|trial|invite|delete|cancel|portal|sessions?|create|choose|select|get|go|start|switch|change|pro|premium|plus|business|enterprise|annual|yearly|monthly|lifetime|seats?|top\s?up|add\s?ons?|credits?|stripe|paddle|lemon\s?squeezy)\b/i;

/**
 * Path words of a control that opens a billing portal or a checkout (a same-origin `/billing/portal` or a form posting
 * to `/create-portal-session`): the app's server creates the session and sends the browser to the payment provider.
 * The restore never clicks one.
 */
export const PORTAL_STEP = /\b(portal|sessions?|check\s?out|billing\s?portal|customer\s?portal|stripe|paddle|lemon\s?squeezy)\b/i;

/**
 * Path words of a page a cancel or downgrade never needs to open: a billing portal or checkout (PORTAL_STEP), or a
 * step that starts a payment. A navigation to one on this site during the restore's clicks is held (never sent).
 */
export const RESTORE_HOLD = new RegExp(`${PORTAL_STEP.source}|\\b(subscribe|upgrade|buy|purchase|pay|order|trial)\\b`, "i");

/**
 * Path words of a write (fetch or XHR) a cancel never sends: one that opens a billing portal or starts a checkout or a
 * payment (`POST /api/billing/portal-session`). Narrower than RESTORE_HOLD on purpose: no provider name, "session" or
 * "pay", so the app's own `/api/stripe/cancel-subscription` or `/api/auth/session` still goes through.
 */
export const RESTORE_WRITE_HOLD = /\b(portal|check\s?out|billing\s?portal|customer\s?portal|subscribe|upgrade|buy|purchase|order|trial)\b/i;

/** Path words that name a checkout or a billing portal start (a note says "a checkout or billing portal start"). */
export const CHECKOUT_OR_PORTAL = /\b(check\s?out|portal|sessions?)\b/i;

/** Path words that name a payment provider (`/api/stripe/…`). */
export const PROVIDER_NAME = /\b(stripe|paddle|lemon\s?squeezy)\b/i;

/** A path that is the app's sign-in page (a page ending there was "sent to sign-in"). */
export const SIGN_IN_PATH = /(^|\/)(log-?in|sign-?in|signin|login|auth|session|sso)(\/|$)/i;

/**
 * The same, narrower, for a navigation a hold lets through (startsFrom): a sign-in word anywhere, or `auth` and
 * `session` only as the first segment (`/session/new`), never `/api/checkout/session`.
 */
export const SIGN_IN_PAGE = /(^|\/)(log-?in|sign-?in|signin|login|sso)(\/|$)|^\/(auth|session)(\/|$)/i;

/** Common file extensions a link downloads rather than navigates to. */
export const DOWNLOAD_EXT = /\.(pdf|zip|tar|gz|csv|xlsx?|docx?|pptx?|dmg|exe|apk|mp4|mp3|png|jpe?g|gif|svg)(\?|#|$)/i;

/**
 * A control whose name says it cancels or downgrades the plan (the restore's only click). "Downgrade" only as the
 * whole name, or naming the plan or a free tier ("Downgrade to Free"), never "Downgrade member" or "Downgrade to
 * viewer" (a person's role).
 */
export const PLAN_CONTROL =
  /^\s*downgrade(\s+(my\s+|your\s+|the\s+)?(plan|subscription|membership))?(\s+to\s+(the\s+)?(free|basic|starter|hobby)(\s+plan)?)?\s*$|\b(cancel\s+(my\s+|your\s+|the\s+)?(plan|subscription|membership|pro|premium)|switch\s+(back\s+)?to\s+(the\s+)?free|(go\s+)?back\s+to\s+(the\s+)?free|end\s+(my\s+|your\s+)?(plan|subscription|membership))\b/i;

/**
 * A control in a list item or table row is Account A's plan's only when its name says plan or a free tier: a bare
 * "Downgrade" or an add-on's "Cancel subscription" in a row acts on that row's item.
 */
export const NAMES_THE_PLAN = /\b(plan|free|basic|starter|hobby)\b/i;

/**
 * A sub-section heading about Account A's own plan ("Your plan", "Current subscription", a bare "Plan"). A control
 * whose name another control on the page shares is clicked only under one, and when the page has one, only its
 * controls are clicked.
 */
export const YOUR_PLAN_SECTION = /\b(your|current|my)\s+(plan|subscription|membership)\b|^\s*(plan|subscription|membership)\s*$/i;

/**
 * A row (a list item or a table row) about a person: an e-mail address, or a member, role or seat word. A plan control
 * in one ("Downgrade" beside a teammate) is that person's, never Account A's plan.
 */
export const PERSON_ROW =
  /[^\s@]+@[^\s@]+\.[^\s@]+|\b(members?|teammates?|users?|admins?|owners?|editors?|viewers?|guests?|roles?|seats?|invited|collaborators?)\b/i;

/**
 * The heading of a sub-section (an h2 to h4, a legend or an aria-label: not the page's own h1) that is about billing
 * or the account's plan. A plan control in a sub-section with any other heading ("This week's meal plan") is never
 * clicked. A bare tier word ("Jo Park · Pro", a teammate's card) doesn't make a heading a billing one: only together
 * with plan, billing or subscription ("Pro plan") does it (0.6.0 review, round 1).
 */
export const BILLING_SECTION =
  /^\s*(plans?|your\s+plan)\s*$|\b(billing|subscriptions?|membership|payments?|pricing|upgrade|account|plans?\s*(&|and)\s*billing|(your|current|account|paid|pro|premium|plus|business|free|starter|basic|team|enterprise|hobby|growth|standard|monthly|annual|yearly)\s+plan)\b/i;

/**
 * A sub-section heading that names a person by an e-mail address ("jo@acme.test · Pro", a teammate's card): a plan
 * control under it is that person's, never Account A's plan, unless the heading says it is Account A's own
 * (YOUR_PLAN_SECTION).
 */
export const PERSON_HEADING = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/** Names a plan control never has: it would end the session or delete the account. */
export const NEVER_CLICK = /\b(delete|remove|close\s+(my\s+)?account|deactivate|sign\s?-?out|log\s?-?out|log\s?off|invite)\b/i;

/**
 * Subscriptions that aren't the plan ("Cancel subscription" under a newsletter or e-mail settings): never clicked as
 * the plan's control.
 */
export const NOT_THE_PLAN = /\b(newsletters?|e-?mails?|digests?|notifications?|alerts?|updates|marketing|mailing)\b/i;

/** Names never clicked as the plan's control. */
export const PLAN_CONTROL_AVOID = new RegExp(`${NEVER_CLICK.source}|${NOT_THE_PLAN.source}`, "i");

/** The button of the app's own confirmation that goes ahead ("Yes, switch to Free", "Cancel subscription"). */
export const CONFIRM =
  /\b(yes|confirm|ok|okay|continue|proceed|downgrade|switch\s+(back\s+)?to\s+(the\s+)?free|cancel\s+(my\s+|your\s+|the\s+)?(plan|subscription|membership|pro|premium)|end\s+(my\s+|your\s+)?(plan|subscription|membership))\b/i;

/** A confirmation button that names the cancel or downgrade itself: preferred over a bare "OK" or "Continue". */
export const CONFIRM_NAMES_IT = /\b(cancel|downgrade|free|end)\b/i;

/** The button of a confirmation that backs out ("Keep my plan", "Not now"). */
export const KEEP = /\b(keep|stay|no|not\s+now|never\s?mind|go\s+back|dismiss)\b/i;

/**
 * Buttons of a cancel flow that change the billing some other way (a retention offer, a pause, a checkout step):
 * never clicked as its confirmation ("Continue with 50% off", "Continue to checkout", "Pause instead").
 */
export const RETENTION =
  /\d+\s?%|\b(offers?|discounts?|coupons?|deals?|pause[sd]?|upgrade|subscribe|check\s?out|pay|purchase|buy|trial|(switch|move|change)\s+to\s+(an?\s+)?(annual|yearly|monthly)|(annual|yearly)\s+(billing|pricing|price|discount)|portal|billing\s?portal|manage\s+(billing|subscription|plan)|stripe|paddle|lemon\s?squeezy)\b/i;

/** Names never clicked as the app's confirmation. */
export const CONFIRM_AVOID = new RegExp(`${KEEP.source}|${NEVER_CLICK.source}|${RETENTION.source}`, "i");

/**
 * A confirmation button whose own name says the cancel or downgrade goes ahead ("No, cancel my plan", "Yes, cancel",
 * "Continue to cancel", "Downgrade to Free"): chosen even when KEEP's "no" is in it (0.6.0 review, round 2), and the
 * only kind chosen in an offer (OFFER). Never a bare "Cancel" (a dialog's own way out), a negated one ("Don't cancel"),
 * nor one that names an offer, a checkout step or a portal (RETENTION) or would end the session (NEVER_CLICK).
 */
export const CANCELS = /\b(cancel(l?ing|l?ation)?|downgrade|end\s+(my\s+|your\s+|the\s+)?(plan|subscription|membership)|switch\s+(back\s+)?to\s+(the\s+)?free)\b/i;
export const BARE_CANCEL = /^\s*cancel\s*$/i;
export const NEGATED = /\b(don['’]?t|do\s+not|never|not)\b/i;

/** What the restore looks for in the app's confirmation: a go-ahead (CONFIRM) or a button that names the cancel. */
export const CONFIRM_OR_CANCEL = new RegExp(`${CONFIRM.source}|${CANCELS.source}`, "i");

/**
 * Text of a cancel flow's step that offers something instead of the cancel (a retention offer: "Stay on Pro for 50% off
 * your next 3 months?", a free month, a pause, a yearly price). In one, a bare "Yes please", "OK" or "Continue" takes
 * the offer, so only a button that names the cancel is clicked (namesTheCancel), and the browser's own confirm() that
 * reads as one is never accepted (0.6.0 review, round 2).
 */
export const OFFER =
  /\d+\s?%|\b(offers?|discounts?|coupons?|deals?|pause[sd]?|free\s+months?|months?\s+(free|off)|off\s+(your|the|next|for)|stay\s+(on|with)|special\s+(price|pricing|rate)|half\s+(price|off)|before\s+you\s+go|(switch|move|change)\s+to\s+(an?\s+)?(annual|yearly|monthly))\b/i;

/** Tabs that may hold the plan (Fernway's Settings → Billing). */
export const BILLING_TAB = /\b(billing|plans?|subscriptions?|payments?|membership)\b/i;

/** Page text that claims an upgrade: never a finding on its own. */
export const CLAIMS_UPGRADE =
  /\b(you('re|\s+are)\s+(now\s+)?(on|a)\s+(the\s+)?(pro|premium|plus|paid|business)|(pro|premium)\s+is\s+(now\s+)?active|thanks?\s+(you\s+)?for\s+upgrading|upgrade\s+(is\s+)?(complete|successful)|you('ve|\s+have)\s+been\s+upgraded)\b/i;

/**
 * Hosts of payment providers (and their subdomains). Every request to one, from any page this check opens, is
 * stopped before it leaves the browser and listed as "blocked (payment provider)".
 */
export const PAYMENT_PROVIDERS = [
  "stripe.com",
  "stripe.network",
  "paypal.com",
  "paypalobjects.com",
  "braintreegateway.com",
  "braintree-api.com",
  "venmo.com",
  "paddle.com",
  "lemonsqueezy.com",
  "lmsqueezy.com",
  "squareup.com",
  "squareupsandbox.com",
  "squarecdn.com",
  "stripecdn.com",
  "shopify.com",
  "shop.app",
  "adyen.com",
  "adyenpayments.com",
  "checkout.com",
  "razorpay.com",
  "mollie.com",
  "chargebee.com",
  "recurly.com",
  "gumroad.com",
  "fastspring.com",
  "onfastspring.com",
  "2checkout.com",
  "2co.com",
  "klarna.com",
  "afterpay.com",
  "clearpay.co.uk",
  "polar.sh",
  "authorize.net",
  "paystack.co",
  "paystack.com",
  "flutterwave.com",
  "mercadopago.com",
  "payu.com",
  "wepay.com",
  "pay.google.com",
  "pay.amazon.com",
  "payments.amazon.com",
  "apple-pay-gateway.apple.com",
  "dodopayments.com",
  "creem.io",
  "freemius.com",
  "chargify.com",
  "zuora.com",
  "bluesnap.com",
  "worldpay.com",
  "commerce.coinbase.com",
];

/**
 * Fetch patterns of every address on a payment provider's host or a subdomain of it, with or without a port (the
 * browser-level block, watchBrowser). Loose on purpose: each paused request is checked with isPaymentProvider.
 */
export const PROVIDER_PATTERNS = PAYMENT_PROVIDERS.flatMap((d) => [`*://${d}/*`, `*://*.${d}/*`, `*://${d}:*`, `*://*.${d}:*`]);

/** What this check's note says when an interruption left Account A's plan, role or credits changed. */
export const INTERRUPTED_NOTE = "If Run Hound had already opened a success page, Account A's plan, role or credits may have changed: check Account A.";

/** What the page's console says when PAGE_HARDENING refused a shared worker. */
export const SHARED_WORKER_REFUSED = "run-hound: a shared worker was refused";

/** The response header whose rule sets could prefetch or prerender a page. */
export const SPECULATION_RULES_HEADER = /^speculation-rules$/i;

/** The check id literal (canonical name shared with `types/paywall-trust.ts`). */
export const PAYWALL_TRUST_ID = "paywall-trust" as const;