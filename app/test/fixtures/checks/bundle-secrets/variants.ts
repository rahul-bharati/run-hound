/**
 * bundle-secrets fixtures. Every value here is FAKE: shaped like a real key so pattern matching
 * fires, but never valid anywhere. Scripts are served as external files from /assets/*.js so the
 * check has to scan loaded scripts, not just inline HTML.
 */
import { scriptRoute, type BookingVariant } from "../booking-page.js";

function base64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

/** A Supabase-style JWT with the given role and a fake signature. */
export function fakeSupabaseJwt(role: "anon" | "service_role"): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iss: "supabase", ref: "fakefakefakefake", role, iat: 1700000000, exp: 2000000000 }));
  return `${header}.${payload}.FAKEsignatureFAKEsignatureFAKEsignature_FAKE`;
}

/** LLM-provider-shaped key (S01). */
export const FAKE_LLM_KEY = "sk-proj-FAKEFAKEfakefake0000FAKEFAKEfakefake1111FAKEFAKEfake";
/** service_role JWT (S02). */
export const FAKE_SERVICE_ROLE_JWT = fakeSupabaseJwt("service_role");
/** Publishable values that must NOT be reported. */
export const FAKE_ANON_JWT = fakeSupabaseJwt("anon");
export const FAKE_STRIPE_PUBLISHABLE = "pk_test_FAKEFAKEfakefake0000FAKEFAKEfakefake1111";

function withConfigScript(source: string): BookingVariant {
  return {
    head: '<script src="/assets/app-config.js"></script>',
    routes: { "GET /assets/app-config.js": scriptRoute(source) },
  };
}

/** GOOD: only publishable values (Supabase anon key, Stripe pk_ key) in the bundle. */
export const good = withConfigScript(`
  window.__APP_CONFIG__ = {
    supabaseUrl: "http://127.0.0.1:54321",
    supabaseAnonKey: "${FAKE_ANON_JWT}",
    stripePublishableKey: "${FAKE_STRIPE_PUBLISHABLE}",
  };
`);

/** BAD (S01): an LLM-provider-shaped secret key shipped in a loaded script. */
export const llmKey = withConfigScript(`
  window.__APP_CONFIG__ = {
    stripePublishableKey: "${FAKE_STRIPE_PUBLISHABLE}",
    openaiApiKey: "${FAKE_LLM_KEY}",
  };
`);

/** BAD (S02): a service_role JWT shipped in a loaded script (alongside a harmless anon key). */
export const serviceRoleJwt = withConfigScript(`
  window.__APP_CONFIG__ = {
    supabaseUrl: "http://127.0.0.1:54321",
    supabaseAnonKey: "${FAKE_ANON_JWT}",
    supabaseServiceKey: "${FAKE_SERVICE_ROLE_JWT}",
  };
`);
