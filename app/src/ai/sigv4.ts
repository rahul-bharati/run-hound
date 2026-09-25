import { notImplemented } from "./not-implemented.js";

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

/**
 * AWS Signature Version 4 with node:crypto. Returns the headers to send: the input headers plus host,
 * x-amz-date, x-amz-content-sha256, x-amz-security-token (when a session token is set) and authorization.
 * Canonical URI: for every service except s3, each path segment of the (already URI-encoded) request path is
 * URI-encoded again per RFC 3986 (so a Bedrock model id "a:b" sent as "a%3Ab" is signed as "a%253Ab"); query
 * parameters sorted by name. `now` defaults to new Date(). Must reproduce AWS's published get-vanilla test vector.
 */
export function signV4(request: SignableRequest, credentials: AwsCredentials, region: string, service: string, now?: Date): Record<string, string> {
  return notImplemented("signV4");
}
