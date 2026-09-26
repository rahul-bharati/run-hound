/**
 * The pure parts of signIn (0.4.0, docs/v2-spec.md "Signing in"): which values of a session are secrets to redact
 * (sessionSecrets), which form is the sign-in form and which field takes the username (steps 2 and 3).
 */
import { describe, expect, it } from "vitest";
import type { DiscoveredForm, FormField } from "../core/types.js";
import { accountLabel, identifierField, sessionSecrets, signInForm, type SessionState } from "./auth.js";

const cookie = (name: string, value: string) => ({ name, value, domain: "127.0.0.1", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" as const });
const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const JWT = `${b64url({ alg: "HS256" })}.${b64url({ sub: "u1", role: "authenticated" })}.FAKEsignatureFAKEsignature_-012`;

describe("sessionSecrets", () => {
  it("takes session cookie values and long random cookie values, not settings", () => {
    const state: SessionState = {
      cookies: [
        cookie("sid", "0123456789abcdef0123456789abcdef"),
        cookie("session", "s%3AAbc123def456.ghi789"),
        cookie("_ga", "GA1.1.1234567890.1700000000"),
        cookie("theme", "dark"),
        cookie("locale", "en-US"),
        cookie("consent", "yes"),
      ],
      origins: [],
    };
    const secrets = sessionSecrets(state);
    expect(secrets).toContain("0123456789abcdef0123456789abcdef");
    // URL-encoded as sent, and decoded as a page might show it.
    expect(secrets).toContain("s%3AAbc123def456.ghi789");
    expect(secrets).toContain("s:Abc123def456.ghi789");
    expect(secrets).toContain("GA1.1.1234567890.1700000000");
    for (const setting of ["dark", "en-US", "yes"]) expect(secrets).not.toContain(setting);
  });

  it("takes bearer tokens from localStorage: a token-like key, any JWT, and the token fields of a JSON value", () => {
    const supabase = JSON.stringify({
      access_token: JWT,
      token_type: "bearer",
      refresh_token: "r3fr35hT0k3n",
      expires_at: 1700000000,
      user: { id: "u1", email: "alice@example.test", role: "authenticated", app_metadata: { provider: "email" } },
    });
    const state: SessionState = {
      cookies: [],
      origins: [
        {
          origin: "http://127.0.0.1:5173",
          localStorage: [
            { name: "token", value: "a1b2c3d4e5f6a1b2c3d4e5f6" },
            { name: "sb-fakeref-auth-token", value: supabase },
            { name: "cached", value: JWT },
            { name: "theme", value: "dark" },
            { name: "draft", value: "Remember the milk and 42 eggs" },
          ],
        },
      ],
    };
    const secrets = sessionSecrets(state);
    expect(secrets).toContain("a1b2c3d4e5f6a1b2c3d4e5f6");
    expect(secrets).toContain(JWT);
    expect(secrets).toContain("r3fr35hT0k3n");
    for (const kept of ["bearer", "dark", "alice@example.test", "authenticated", "email", "Remember the milk and 42 eggs"]) expect(secrets).not.toContain(kept);
  });

  it("is empty for an empty session", () => {
    expect(sessionSecrets({ cookies: [], origins: [] })).toEqual([]);
  });
});

function field(key: string, type: string, extra: Partial<FormField> = {}): FormField {
  return { key, accessibleName: key, label: key, placeholder: null, type, role: "textbox", required: false, selector: `#${key}`, ...extra };
}

function form(fields: FormField[], name = "Form"): DiscoveredForm {
  return { url: "http://127.0.0.1:9/login", selector: `#${name}`, name, fields, controls: [] };
}

describe("the sign-in form and its username field", () => {
  it("picks the form with exactly one password field, else the first with any, else none", () => {
    const twoPasswords = form([field("email", "email"), field("pw", "password"), field("confirm", "password")], "access");
    const signin = form([field("email", "email"), field("pw", "password")], "signin");
    const newsletter = form([field("email", "email")], "news");
    expect(signInForm([newsletter, twoPasswords, signin])?.name).toBe("signin");
    expect(signInForm([newsletter, twoPasswords])?.name).toBe("access");
    expect(signInForm([newsletter])).toBeNull();
    // A form that says it creates an account never gets the account's credentials, even as the only one.
    const signup = form([field("email", "email"), field("pw", "password"), field("confirm", "password")], "signup");
    expect(signInForm([newsletter, signup])).toBeNull();
  });

  it("finds the username field by autocomplete, then type=email, then its words, then the text field before the password", () => {
    const byAutocomplete = form([field("a", "text"), field("b", "text", { autocomplete: "username" }), field("pw", "password")]);
    expect(identifierField(byAutocomplete)?.key).toBe("b");
    const byType = form([field("a", "text"), field("b", "email"), field("pw", "password")]);
    expect(identifierField(byType)?.key).toBe("b");
    const byWords = form([field("company", "text"), field("login_name", "text"), field("pw", "password")]);
    expect(identifierField(byWords)?.key).toBe("login_name");
    const byPlace = form([field("who", "text"), field("pw", "password"), field("remember", "checkbox")]);
    expect(identifierField(byPlace)?.key).toBe("who");
    expect(identifierField(form([field("pw", "password"), field("after", "checkbox")]))).toBeNull();
  });

  it("names an account by its label, else by its slot", () => {
    expect(accountLabel({ id: "a", label: "Owner" })).toBe("Owner");
    expect(accountLabel({ id: "b", label: "  " })).toBe("Account B");
  });
});
