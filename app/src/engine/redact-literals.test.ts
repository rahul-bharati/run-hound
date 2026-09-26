/**
 * Literal secrets (0.4.0, docs/v2-spec.md "Test accounts"): the engine registers each configured test-account
 * password, and the session cookie values and bearer tokens sign-in produces, so redactSecrets replaces them wherever
 * they appear with "[REDACTED:account-secret]", until the function registerSecretLiterals returned unregisters them.
 * Values shorter than 4 characters are ignored.
 */
import { afterEach, describe, expect, it } from "vitest";
import { redactSecrets, registerSecretLiterals } from "./redact.js";

const MARK = "[REDACTED:account-secret]";

/** Fake values only; the Stripe key matches the built-in "stripe-secret" pattern. */
const PASSWORD = "alice-pass-1234";
const STRIPE = "sk_live_FAKEFAKEFAKE1234567890abcdEFGH";

/** Every registration a test made, unregistered after it so no test leaks literals into the next. */
const registered: (() => void)[] = [];

function register(values: string[]): () => void {
  const unregister = registerSecretLiterals(values);
  registered.push(unregister);
  return unregister;
}

afterEach(() => {
  for (const unregister of registered.splice(0)) unregister();
});

describe("registerSecretLiterals", () => {
  it("makes redactSecrets replace a registered value wherever it appears", () => {
    register([PASSWORD]);
    const text = `{"password":"${PASSWORD}"}\nPOST /login?pw=${PASSWORD}&again=${PASSWORD}`;
    expect(redactSecrets(text)).toBe(`{"password":"${MARK}"}\nPOST /login?pw=${MARK}&again=${MARK}`);
    expect(redactSecrets(`Typed ${PASSWORD}.`)).toBe(`Typed ${MARK}.`);
  });

  it("returns a function (a value is registered until it is called)", () => {
    const unregister = register([PASSWORD]);
    expect(typeof unregister).toBe("function");
    expect(redactSecrets(PASSWORD)).toBe(MARK);
  });

  it("registers several values at once, each redacted on its own", () => {
    register(["alice-pass-1234", "bob-pass-5678", "0123456789abcdef0123456789abcdef"]);
    expect(redactSecrets("a=alice-pass-1234 b=bob-pass-5678 sid=0123456789abcdef0123456789abcdef")).toBe(`a=${MARK} b=${MARK} sid=${MARK}`);
  });

  it("matches values literally: characters that mean something in a regular expression are just characters", () => {
    register(["p@ss.w*rd+(1)?[x]$"]);
    expect(redactSecrets("pw: p@ss.w*rd+(1)?[x]$ end")).toBe(`pw: ${MARK} end`);
    // "." and "*" are not wildcards: text that only looks like the value stays.
    expect(redactSecrets("pw: p@ssXw*rd+(1)?[x]$ end")).toBe("pw: p@ssXw*rd+(1)?[x]$ end");
    expect(redactSecrets("pw: p@ss.wwwrd+1 end")).toBe("pw: p@ss.wwwrd+1 end");
  });

  it("redacts the whole of a value that contains another registered value (no tail is left)", () => {
    register(["alice-pass", "alice-pass-1234"]);
    expect(redactSecrets("pw=alice-pass-1234;")).toBe(`pw=${MARK};`);
    expect(redactSecrets("pw=alice-pass;")).toBe(`pw=${MARK};`);
  });

  it("stops redacting a value once it is unregistered", () => {
    const unregister = register([PASSWORD]);
    expect(redactSecrets(`pw=${PASSWORD}`)).toBe(`pw=${MARK}`);
    unregister();
    expect(redactSecrets(`pw=${PASSWORD}`)).toBe(`pw=${PASSWORD}`);
  });

  it("keeps each registration independent: unregistering one keeps the same value registered by another", () => {
    // Two runs (the web server can run one while another is being planned) may register the same password.
    const first = register([PASSWORD]);
    const second = register([PASSWORD, "second-only-value"]);
    first();
    expect(redactSecrets(`pw=${PASSWORD}`)).toBe(`pw=${MARK}`);
    // Calling an unregister function twice changes nothing.
    first();
    expect(redactSecrets(`pw=${PASSWORD}`)).toBe(`pw=${MARK}`);
    second();
    expect(redactSecrets(`pw=${PASSWORD} x=second-only-value`)).toBe(`pw=${PASSWORD} x=second-only-value`);
  });

  it("ignores values shorter than 4 characters (they would redact ordinary text)", () => {
    register(["", "a", "ab", "abc"]);
    const text = "a cab sat on abc; ab-a";
    expect(redactSecrets(text)).toBe(text);
    register(["abcd"]);
    expect(redactSecrets("x abcd y")).toBe(`x ${MARK} y`);
  });

  it("leaves text without a registered value unchanged", () => {
    register([PASSWORD]);
    expect(redactSecrets("Book a sitter for Rex. Email owner@example.test.")).toBe("Book a sitter for Rex. Email owner@example.test.");
    expect(redactSecrets("")).toBe("");
  });
});

describe("registered values together with the built-in secret patterns", () => {
  it("redacts both kinds in one text, each with its own marker", () => {
    register([PASSWORD]);
    const text = `a=${STRIPE} b=${PASSWORD} c=${STRIPE} d=${PASSWORD}`;
    expect(redactSecrets(text)).toBe(`a=[REDACTED:stripe-secret] b=${MARK} c=[REDACTED:stripe-secret] d=${MARK}`);
  });

  it("redacts a registered value that is also a pattern secret once, with one marker", () => {
    register([STRIPE]);
    const out = redactSecrets(`key=${STRIPE};`);
    expect(out).not.toContain(STRIPE);
    expect(out).toMatch(/^key=\[REDACTED:(?:account-secret|stripe-secret)\];$/);
  });

  it("leaves no part of either when a registered value overlaps a pattern secret", () => {
    // The password starts inside the Stripe key ("abcdEFGH") and runs past its end ("-tail-9").
    const overlapping = "abcdEFGH-tail-9";
    register([overlapping]);
    const out = redactSecrets(`x ${STRIPE}-tail-9 y`);
    expect(out).not.toContain(STRIPE);
    expect(out).not.toContain(overlapping);
    expect(out).not.toContain("tail-9");
    expect(out).not.toContain("FAKE");
    expect(out).toMatch(/^x (?:\[REDACTED:[a-z-]+\]){1,2} y$/);
  });

  it("leaves no part of a registered value that contains a pattern secret", () => {
    const wrapping = `pw-${STRIPE}`;
    register([wrapping]);
    const out = redactSecrets(`value=${wrapping};`);
    expect(out).not.toContain("pw-");
    expect(out).not.toContain("FAKE");
    expect(out).toMatch(/^value=(?:\[REDACTED:[a-z-]+\]){1,2};$/);
  });
});
