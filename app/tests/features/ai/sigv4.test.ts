import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signV4, type AwsCredentials } from "./sigv4.js";

/** AWS's published SigV4 test-suite credentials (not real). */
const CREDS: AwsCredentials = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
};
const VECTOR_DATE = new Date(Date.UTC(2015, 7, 30, 12, 36, 0));
const GET_VANILLA_SIGNATURE = "5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31";
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const hmac = (key: string | Buffer, s: string) => createHmac("sha256", key).update(s, "utf8").digest();

/**
 * Independent SigV4 reference, written step by step from the AWS docs: canonical request, string to sign,
 * derived signing key, signature. The caller supplies the canonical URI and query so the test states them exactly.
 */
function referenceSignature(input: {
  method: string;
  canonicalUri: string;
  canonicalQuery: string;
  headers: Record<string, string>;
  signedHeaders: string[];
  payloadHash: string;
  amzDate: string;
  region: string;
  service: string;
  secret: string;
}): string {
  const canonicalHeaders = input.signedHeaders.map((h) => `${h}:${(input.headers[h] ?? "").trim().replace(/\s+/g, " ")}\n`).join("");
  const canonicalRequest = [
    input.method,
    input.canonicalUri,
    input.canonicalQuery,
    canonicalHeaders,
    input.signedHeaders.join(";"),
    input.payloadHash,
  ].join("\n");
  const date = input.amzDate.slice(0, 8);
  const scope = `${date}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", input.amzDate, scope, sha256(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${input.secret}`, date);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, "aws4_request");
  return createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
}

/** Lower-cases header names so the assertions don't depend on the casing the signer picks. */
function lower(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
}

function parseAuthorization(auth: string) {
  const m = /^AWS4-HMAC-SHA256 Credential=([^,]+), ?SignedHeaders=([^,]+), ?Signature=([0-9a-f]{64})$/.exec(auth);
  if (!m) throw new Error(`Authorization header has the wrong shape: ${auth}`);
  return { credential: m[1]!, signedHeaders: m[2]!.split(";"), signature: m[3]! };
}

describe("the reference signer used by these tests", () => {
  it("reproduces AWS's get-vanilla vector", () => {
    const signature = referenceSignature({
      method: "GET",
      canonicalUri: "/",
      canonicalQuery: "",
      headers: { host: "example.amazonaws.com", "x-amz-date": "20150830T123600Z" },
      signedHeaders: ["host", "x-amz-date"],
      payloadHash: EMPTY_SHA256,
      amzDate: "20150830T123600Z",
      region: "us-east-1",
      service: "service",
      secret: CREDS.secretAccessKey,
    });
    expect(signature).toBe(GET_VANILLA_SIGNATURE);
  });
});

describe("signV4", () => {
  const vanilla = () =>
    lower(signV4({ method: "GET", url: "https://example.amazonaws.com/", headers: {}, body: "" }, CREDS, "us-east-1", "service", VECTOR_DATE));

  it("adds host, x-amz-date, x-amz-content-sha256 and authorization for the get-vanilla request", () => {
    const headers = vanilla();
    expect(headers.host).toBe("example.amazonaws.com");
    expect(headers["x-amz-date"]).toBe("20150830T123600Z");
    expect(headers["x-amz-content-sha256"]).toBe(EMPTY_SHA256);
    expect(headers.authorization).toBeDefined();
    expect(headers["x-amz-security-token"]).toBeUndefined();
  });

  it("formats the Authorization header with the right credential scope and signed headers", () => {
    const auth = parseAuthorization(vanilla().authorization!);
    expect(auth.credential).toBe("AKIDEXAMPLE/20150830/us-east-1/service/aws4_request");
    expect(auth.signedHeaders).toContain("host");
    expect(auth.signedHeaders).toContain("x-amz-date");
    expect([...auth.signedHeaders].sort()).toEqual(auth.signedHeaders);
  });

  it("signs the get-vanilla request exactly as the AWS algorithm does for the headers it declares", () => {
    const headers = vanilla();
    const auth = parseAuthorization(headers.authorization!);
    const expected = referenceSignature({
      method: "GET",
      canonicalUri: "/",
      canonicalQuery: "",
      headers,
      signedHeaders: auth.signedHeaders,
      payloadHash: EMPTY_SHA256,
      amzDate: "20150830T123600Z",
      region: "us-east-1",
      service: "service",
      secret: CREDS.secretAccessKey,
    });
    expect(auth.signature).toBe(expected);
  });

  it("gives the published get-vanilla signature when only host and x-amz-date are signed", () => {
    const auth = parseAuthorization(vanilla().authorization!);
    if (auth.signedHeaders.join(";") === "host;x-amz-date") expect(auth.signature).toBe(GET_VANILLA_SIGNATURE);
    else expect(auth.signature).not.toBe(GET_VANILLA_SIGNATURE); // extra signed headers must change the signature
  });

  it("keeps the input headers", () => {
    const headers = lower(
      signV4(
        { method: "POST", url: "https://example.amazonaws.com/", headers: { "content-type": "application/json" }, body: "{}" },
        CREDS,
        "us-east-1",
        "service",
        VECTOR_DATE,
      ),
    );
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["x-amz-content-sha256"]).toBe(sha256("{}"));
  });

  it("sends and signs the session token when one is set", () => {
    const headers = lower(
      signV4(
        { method: "GET", url: "https://example.amazonaws.com/", headers: {}, body: "" },
        { ...CREDS, sessionToken: "FAKE-session-token" },
        "us-east-1",
        "service",
        VECTOR_DATE,
      ),
    );
    expect(headers["x-amz-security-token"]).toBe("FAKE-session-token");
    const auth = parseAuthorization(headers.authorization!);
    expect(auth.signedHeaders).toContain("x-amz-security-token");
    const expected = referenceSignature({
      method: "GET",
      canonicalUri: "/",
      canonicalQuery: "",
      headers,
      signedHeaders: auth.signedHeaders,
      payloadHash: EMPTY_SHA256,
      amzDate: "20150830T123600Z",
      region: "us-east-1",
      service: "service",
      secret: CREDS.secretAccessKey,
    });
    expect(auth.signature).toBe(expected);
  });

  it("double-encodes path segments, so a Bedrock model id with a colon is signed as %253A", () => {
    const body = JSON.stringify({ messages: [] });
    const url = "https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-v2%3A1/converse";
    const headers = lower(
      signV4({ method: "POST", url, headers: { "content-type": "application/json" }, body }, CREDS, "us-east-1", "bedrock", VECTOR_DATE),
    );
    const auth = parseAuthorization(headers.authorization!);
    expect(auth.credential).toBe("AKIDEXAMPLE/20150830/us-east-1/bedrock/aws4_request");
    const common = {
      method: "POST",
      canonicalQuery: "",
      headers,
      signedHeaders: auth.signedHeaders,
      payloadHash: sha256(body),
      amzDate: "20150830T123600Z",
      region: "us-east-1",
      service: "bedrock",
      secret: CREDS.secretAccessKey,
    };
    expect(auth.signature).toBe(referenceSignature({ ...common, canonicalUri: "/model/anthropic.claude-v2%253A1/converse" }));
    expect(auth.signature).not.toBe(referenceSignature({ ...common, canonicalUri: "/model/anthropic.claude-v2%3A1/converse" }));
  });

  it("sorts query parameters by name in the canonical request", () => {
    const headers = lower(
      signV4({ method: "GET", url: "https://example.amazonaws.com/?b=2&a=1", headers: {}, body: "" }, CREDS, "us-east-1", "service", VECTOR_DATE),
    );
    const auth = parseAuthorization(headers.authorization!);
    expect(auth.signature).toBe(
      referenceSignature({
        method: "GET",
        canonicalUri: "/",
        canonicalQuery: "a=1&b=2",
        headers,
        signedHeaders: auth.signedHeaders,
        payloadHash: EMPTY_SHA256,
        amzDate: "20150830T123600Z",
        region: "us-east-1",
        service: "service",
        secret: CREDS.secretAccessKey,
      }),
    );
  });
});
