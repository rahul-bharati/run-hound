/**
 * A labelled AWS secret access key (0.6.1, docs/launch-spec.md "Redaction"): an AWS secret access key has no prefix
 * of its own (40 characters of A-Z, a-z, 0-9, "/" and "+"), so the pattern "aws-secret-key" only matches one that
 * follows its label: aws_secret_access_key, AWS_SECRET_ACCESS_KEY, aws-secret-access-key, SecretAccessKey or
 * secretAccessKey, then optional quotes (JSON-escaped too), ":" or "=", and optional quotes. Only the value is
 * replaced; the label stays readable. An unlabelled 40-character string, a shorter or a longer value is not flagged.
 * Saved and resolved secrets are hidden whatever their shape by literal registration (ai-secrets-redacted.test.ts).
 */
import { describe, expect, it } from "vitest";
import { findSecrets, redactSecrets } from "./redact.js";

/** AWS's documented example secret access key (40 characters; not real). */
const KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const MARK = "[REDACTED:aws-secret-key]";

describe("the labelled AWS secret access key pattern", () => {
  it.each([
    ["a shared credentials file", `aws_secret_access_key = ${KEY}`, `aws_secret_access_key = ${MARK}`],
    ["an environment line", `AWS_SECRET_ACCESS_KEY=${KEY}`, `AWS_SECRET_ACCESS_KEY=${MARK}`],
    ["an exported variable in quotes", `export AWS_SECRET_ACCESS_KEY="${KEY}"`, `export AWS_SECRET_ACCESS_KEY="${MARK}"`],
    ["credential_process JSON", `{"Version": 1, "SecretAccessKey": "${KEY}"}`, `{"Version": 1, "SecretAccessKey": "${MARK}"}`],
    ["a JavaScript object", `const aws = { secretAccessKey: '${KEY}' };`, `const aws = { secretAccessKey: '${MARK}' };`],
    ["JSON escaped inside a bundle", `JSON.parse("{\\"secretAccessKey\\":\\"${KEY}\\"}")`, `JSON.parse("{\\"secretAccessKey\\":\\"${MARK}\\"}")`],
    ["YAML", `aws-secret-access-key: ${KEY}`, `aws-secret-access-key: ${MARK}`],
  ])("redacts the value in %s and keeps the label", (_where, text, redacted) => {
    expect(redactSecrets(text)).toBe(redacted);
  });

  it("is reported by findSecrets as kind aws-secret-key, with a 4-character preview", () => {
    const found = findSecrets(`AWS_SECRET_ACCESS_KEY=${KEY}`);
    expect(found).toEqual([{ kind: "aws-secret-key", index: "AWS_SECRET_ACCESS_KEY=".length, preview: `${KEY.slice(0, 4)}…(40 chars)` }]);
  });

  it("does not flag an unlabelled 40-character value, nor a labelled value that is shorter or longer", () => {
    for (const text of [
      `checksum ${KEY}`,
      "commit 0123456789abcdef0123456789abcdef01234567",
      "aws_secret_access_key = too-short-to-be-a-key",
      `aws_secret_access_key = ${KEY}AB`,
      `secret = ${KEY}`,
    ]) {
      expect(findSecrets(text), text).toEqual([]);
      expect(redactSecrets(text), text).toBe(text);
    }
  });
});
