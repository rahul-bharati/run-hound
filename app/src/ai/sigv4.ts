import { createHash, createHmac } from "node:crypto";

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface SignableRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const hmac = (key: string | Buffer, s: string) => createHmac("sha256", key).update(s, "utf8").digest();

/** RFC 3986 encoding: encodeURIComponent plus the reserved characters it leaves alone. */
const rfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function canonicalQuery(search: string): string {
  const pairs = [...new URLSearchParams(search)].map(([k, v]) => [rfc3986(k), rfc3986(v)] as const);
  pairs.sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

/**
 * AWS Signature Version 4 with node:crypto. Returns the headers to send (names lower-cased): the input headers plus
 * host, x-amz-date, x-amz-content-sha256, x-amz-security-token (when a session token is set) and authorization.
 * Every header is signed except x-amz-content-sha256 (only S3 requires it), so a bare GET signs "host;x-amz-date".
 * Canonical URI: for every service except s3, each path segment of the (already URI-encoded) request path is
 * URI-encoded again per RFC 3986 (so a Bedrock model id "a:b" sent as "a%3Ab" is signed as "a%253Ab"); query
 * parameters sorted by name. `now` defaults to new Date(). Reproduces AWS's published get-vanilla test vector.
 */
export function signV4(request: SignableRequest, credentials: AwsCredentials, region: string, service: string, now: Date = new Date()): Record<string, string> {
  const url = new URL(request.url);
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256(request.body);

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(request.headers)) headers[k.toLowerCase()] = v;
  delete headers.authorization;
  headers.host = url.host;
  headers["x-amz-date"] = amzDate;
  if (credentials.sessionToken) headers["x-amz-security-token"] = credentials.sessionToken;

  const signed = Object.keys(headers).sort();
  const canonicalHeaders = signed.map((h) => `${h}:${headers[h]!.trim().replace(/\s+/g, " ")}\n`).join("");
  const canonicalUri =
    service === "s3" ? url.pathname || "/" : (url.pathname || "/").split("/").map(rfc3986).join("/");
  const canonicalRequest = [request.method.toUpperCase(), canonicalUri, canonicalQuery(url.search), canonicalHeaders, signed.join(";"), payloadHash].join("\n");

  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, date), region), service), "aws4_request");
  const signature = createHmac("sha256", key).update(stringToSign, "utf8").digest("hex");

  return {
    ...headers,
    "x-amz-content-sha256": payloadHash,
    authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signed.join(";")}, Signature=${signature}`,
  };
}
