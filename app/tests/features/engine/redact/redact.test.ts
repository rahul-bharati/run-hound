import { describe, expect, it } from "vitest";
import { findSecrets, redactSecrets, secretSpans } from "./redact.js";

/** All values below are fake: they only match the shape of real credentials. */
const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (payload: Record<string, unknown>) =>
  `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.FAKEsignatureFAKEsignatureFAKEsig_-0123456789`;

const FAKE = {
  openai: "sk-proj-FAKEFAKEfake1234567890abcdefghijklmnopqrstuvwxyzABCDEFGH",
  stripeSecret: "sk_live_FAKEFAKEFAKE1234567890abcdEFGH",
  aws: "AKIAFAKEFAKEFAKE1234",
  privateKey: [
    "-----BEGIN RSA PRIVATE KEY-----",
    "MIIEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE",
    "FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE=",
    "-----END RSA PRIVATE KEY-----",
  ].join("\n"),
  serviceRole: jwt({ iss: "supabase", ref: "fakeprojectref", role: "service_role", iat: 1700000000, exp: 2000000000 }),
};

const PUBLISHABLE = {
  stripePk: "pk_live_FAKEFAKEFAKE1234567890abcdEFGH",
  anon: jwt({ iss: "supabase", ref: "fakeprojectref", role: "anon", iat: 1700000000, exp: 2000000000 }),
  firebase: "AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKE12345",
};

const secretCases: { name: string; value: string; kind: string }[] = [
  { name: "OpenAI project key", value: FAKE.openai, kind: "openai-key" },
  { name: "Stripe secret key", value: FAKE.stripeSecret, kind: "stripe-secret" },
  { name: "AWS access key id", value: FAKE.aws, kind: "aws-access-key" },
  { name: "PEM private key", value: FAKE.privateKey, kind: "private-key" },
  { name: "Supabase service_role JWT", value: FAKE.serviceRole, kind: "supabase-service-role" },
];

describe("findSecrets", () => {
  it.each(secretCases)("detects a $name", ({ value, kind }) => {
    const text = `const config = { key: "${value}" };\nexport default config;`;
    const matches = findSecrets(text);
    const match = matches.find((m) => m.kind === kind);
    expect(match, `expected a ${kind} match`).toBeDefined();
    expect(match!.index).toBe(text.indexOf(value));
  });

  it.each(secretCases)("never puts the full $name in the preview", ({ value, kind }) => {
    const [match] = findSecrets(`x=${value};`).filter((m) => m.kind === kind);
    expect(match).toBeDefined();
    const preview = match!.preview;
    expect(preview).not.toContain(value);
    expect(preview.startsWith(value.slice(0, 4))).toBe(true);
    expect(preview).toContain("…");
    expect(preview).toContain(String(value.length));
    // No more than the first 4 characters of the value may leak.
    expect(preview).not.toContain(value.slice(0, 5));
  });

  it("finds every secret in a bundle that contains several", () => {
    const bundle = [
      `var a="${FAKE.openai}";`,
      `var b="${FAKE.stripeSecret}";`,
      `var c="${FAKE.aws}";`,
      `var d=\`${FAKE.privateKey}\`;`,
      `var e="${FAKE.serviceRole}";`,
    ].join("\n");
    const kinds = findSecrets(bundle).map((m) => m.kind).sort();
    expect(kinds).toEqual(["aws-access-key", "openai-key", "private-key", "stripe-secret", "supabase-service-role"]);
  });

  it.each([
    { name: "Stripe publishable key", value: PUBLISHABLE.stripePk },
    { name: "Supabase anon JWT", value: PUBLISHABLE.anon },
    { name: "Firebase apiKey", value: PUBLISHABLE.firebase },
  ])("does not flag a $name", ({ value }) => {
    const text = `const firebaseConfig = { apiKey: "${value}", authDomain: "fake.firebaseapp.com" };`;
    expect(findSecrets(text)).toEqual([]);
  });

  it("does not flag ordinary text", () => {
    expect(findSecrets("Book a sitter for your dog. Email owner@example.test, phone 555-0100.")).toEqual([]);
    expect(findSecrets("")).toEqual([]);
  });
});

describe("redactSecrets", () => {
  it.each(secretCases)("removes a $name and names its kind", ({ value, kind }) => {
    const text = `before ${value} after`;
    const out = redactSecrets(text);
    expect(out).not.toContain(value);
    expect(out).toContain(`[REDACTED:${kind}]`);
    expect(out.startsWith("before ")).toBe(true);
    expect(out.endsWith(" after")).toBe(true);
  });

  it("removes every secret from a mixed text and leaves publishable keys alone", () => {
    const text = JSON.stringify({
      openai: FAKE.openai,
      stripe: FAKE.stripeSecret,
      aws: FAKE.aws,
      pem: FAKE.privateKey,
      supabase: FAKE.serviceRole,
      publishable: PUBLISHABLE.stripePk,
      anon: PUBLISHABLE.anon,
    });
    const out = redactSecrets(text);
    for (const value of Object.values(FAKE)) expect(out).not.toContain(value);
    // The secret-bearing parts of the JWT and PEM body must be gone too.
    expect(out).not.toContain(FAKE.serviceRole.split(".")[1]!);
    expect(out).not.toContain("MIIEFAKEFAKE");
    expect(out).toContain(PUBLISHABLE.stripePk);
    expect(out).toContain(PUBLISHABLE.anon);
    expect(findSecrets(out)).toEqual([]);
  });

  it("returns text without secrets unchanged", () => {
    const text = `Pet name: Rex\napiKey: "${PUBLISHABLE.firebase}"`;
    expect(redactSecrets(text)).toBe(text);
  });
});

describe("review hardening", () => {
  it("detects GitHub fine-grained tokens (github_pat_)", () => {
    const token = `github_pat_11FAKEFAKE0${"a1B2c3D4e5".repeat(8)}`;
    expect(findSecrets(`token = "${token}"`).map((m) => m.kind)).toContain("github-token");
    expect(redactSecrets(`token = "${token}"`)).not.toContain(token);
  });

  it.each([
    "sk-skeleton-loader-container-wrapper",
    "sk-button-primary-hover-state-dark",
    "sk-ant-design-system-theme-variables",
  ])("does not flag kebab-case identifiers that start with sk- (%s)", (identifier) => {
    const css = `.${identifier} { color: red; } const cls = "${identifier}";`;
    expect(findSecrets(css)).toEqual([]);
    expect(redactSecrets(css)).toBe(css);
  });

  it("still detects random-looking sk- keys, including the Kennel fixture's", () => {
    for (const key of ["sk-proj-FAKEFAKEkennelDemoOnly0000000000FAKE", "sk-FAKE1234567890abcdefABCDEFghijklmnop", "sk-ant-api03-FAKEfake1234567890FAKEfake"]) {
      expect(findSecrets(key), key).toHaveLength(1);
    }
  });
});

describe("secretSpans", () => {
  it("gives start and end offsets of every secret findSecrets reports", () => {
    const text = `a ${FAKE.openai} b ${FAKE.aws} c`;
    const spans = secretSpans(text);
    expect(spans.map((s) => text.slice(s.start, s.end))).toEqual([FAKE.openai, FAKE.aws]);
    expect(spans.map((s) => s.kind)).toEqual(["openai-key", "aws-access-key"]);
  });
});
