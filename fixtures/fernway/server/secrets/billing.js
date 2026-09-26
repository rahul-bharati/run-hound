// Fernway bug W06: a Stripe-style LIVE secret key shipped to the browser, the classic mistake of pasting the whole
// payments config into client code. Served (and loaded by index.html) only when FERNWAY_BUGS enables W06.
// The key is obviously FAKE and grants nothing anywhere; it exists so Run Hound's bundle-secrets check has
// something to find. The server fills the key in when it serves this file (server/app.mjs), so the repository
// never holds a string that secret scanners such as GitHub push protection would block.
window.fernwayBilling = {
  publishableKey: "pk_live_FAKEfernwayDemoOnly0000000000FAKE",
  secretKey: "__FERNWAY_FAKE_STRIPE_SECRET__",
};
