/**
 * Literal secrets in every form a page or a request carries them (round-2 review), and account usernames:
 * - a registered password is also hidden form-URL-encoded (application/x-www-form-urlencoded writes ! ' ( ) ~ as
 *   %21 %27 %28 %29 %7E, which encodeURIComponent leaves alone), with upper- or lowercase hex;
 * - registerAccountUsernames hides configured usernames of 3 characters or more in any letter case, as
 *   "[REDACTED:account-username]" (the same rule as the server's usernameHider), until unregistered;
 * - redactAccountSecrets replaces only the registered passwords and session values: it is what a plan's address
 *   fields (selectors, URLs, link targets) get, where hiding a username or a pattern would break the plan.
 */
import { afterEach, describe, expect, it } from "vitest";
import { redactAccountSecrets, redactSecrets, registerAccountUsernames, registerSecretLiterals } from "./redact.js";

const SECRET = "[REDACTED:account-secret]";
const USERNAME = "[REDACTED:account-username]";

const held: (() => void)[] = [];
const hold = (unregister: () => void) => {
  held.push(unregister);
  return unregister;
};
afterEach(() => {
  for (const unregister of held.splice(0)) unregister();
});

/** How a browser form (and URLSearchParams) encodes a value in a query string or a urlencoded body. */
const formEncoded = (value: string) => new URLSearchParams({ x: value }).toString().slice(2);
const lowerHex = (text: string) => text.replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase());

describe("a registered password, form-URL-encoded", () => {
  it("is hidden when ! ' ( ) ~ are percent-encoded, in upper- or lowercase hex", () => {
    const password = "horse(battery)!~staple'";
    hold(registerSecretLiterals([password]));
    const encoded = formEncoded(password);
    expect(encoded).toBe("horse%28battery%29%21%7Estaple%27");
    expect(redactSecrets(`/session?username=a&password=${encoded}&x=1`)).toBe(`/session?username=a&password=${SECRET}&x=1`);
    expect(redactSecrets(`password=${lowerHex(encoded)}`)).toBe(`password=${SECRET}`);
  });

  it("is hidden with spaces as + and non-ASCII letters as UTF-8 bytes", () => {
    const password = "grüne Äpfel 42";
    hold(registerSecretLiterals([password]));
    const encoded = formEncoded(password);
    expect(encoded).toBe("gr%C3%BCne+%C3%84pfel+42");
    expect(redactSecrets(`body: password=${encoded}`)).toBe(`body: password=${SECRET}`);
    expect(redactSecrets(`body: password=${lowerHex(encoded)}`)).toBe(`body: password=${SECRET}`);
    expect(redactSecrets(`q=${encodeURIComponent(password)}`)).toBe(`q=${SECRET}`);
  });
});

describe("registerAccountUsernames", () => {
  it("hides a username in any letter case, and URL-encoded, until unregistered", () => {
    const unregister = hold(registerAccountUsernames(["Rahul.Bharati@Example.test"]));
    expect(redactSecrets("Signed in as rahul.bharati@example.test")).toBe(`Signed in as ${USERNAME}`);
    expect(redactSecrets("RAHUL.BHARATI@EXAMPLE.TEST said hi")).toBe(`${USERNAME} said hi`);
    expect(redactSecrets("/u?email=rahul.bharati%40example.test")).toBe(`/u?email=${USERNAME}`);
    unregister();
    expect(redactSecrets("Signed in as rahul.bharati@example.test")).toBe("Signed in as rahul.bharati@example.test");
  });

  it("hides short usernames too (3 characters or more), as the server's usernameHider does", () => {
    hold(registerAccountUsernames(["rahulb", "bob", "ab", ""]));
    expect(redactSecrets('"rahulb" button does nothing')).toBe(`"${USERNAME}" button does nothing`);
    expect(redactSecrets("Bob's menu")).toBe(`${USERNAME}'s menu`);
    // Two letters would hide ordinary words: never registered.
    expect(redactSecrets("ab cd")).toBe("ab cd");
  });

  it("counts registrations like registerSecretLiterals: one unregister keeps another's value", () => {
    const first = hold(registerAccountUsernames(["alice@example.test"]));
    hold(registerAccountUsernames(["alice@example.test"]));
    first();
    first();
    expect(redactSecrets("alice@example.test")).toBe(USERNAME);
  });

  it("redacting twice changes nothing more, even for a username or password that is part of a marker", () => {
    hold(registerAccountUsernames(["user"]));
    hold(registerSecretLiterals(["secret"]));
    const once = redactSecrets("user typed secret");
    expect(once).toBe(`${USERNAME} typed ${SECRET}`);
    expect(redactSecrets(once)).toBe(once);
  });

  it("a password next to or inside a username leaves no part of either", () => {
    hold(registerAccountUsernames(["alice"]));
    hold(registerSecretLiterals(["alice-pass-1234"]));
    const out = redactSecrets("pw=alice-pass-1234 user=Alice");
    expect(out).toBe(`pw=${SECRET} user=${USERNAME}`);
  });
});

describe("redactAccountSecrets (a plan's address fields)", () => {
  it("replaces registered passwords and session values only: usernames and pattern secrets stay, so selectors still work", () => {
    const sid = "b858e74f0a1c42d7b3e9aa51c0ffee42";
    hold(registerSecretLiterals([sid, "alice-pass-1234"]));
    hold(registerAccountUsernames(["alice"]));
    const stripe = "sk_live_FAKEFAKEFAKE1234567890abcdEFGH";
    expect(redactAccountSecrets(`http://127.0.0.1:4000/help?session=${sid}`)).toBe(`http://127.0.0.1:4000/help?session=${SECRET}`);
    expect(redactAccountSecrets(`a[href="/u/alice?k=${stripe}"]`)).toBe(`a[href="/u/alice?k=${stripe}"]`);
    expect(redactAccountSecrets("#pw[value='alice-pass-1234']")).toBe(`#pw[value='${SECRET}']`);
  });
});
