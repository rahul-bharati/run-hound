// Tests for scripts/check-security-txt.mjs (`pnpm test`): /.well-known/security.txt (RFC 9116) must name a contact
// and expire between 30 days and a year from the build; a Canonical on another address only warns.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

const script = join(import.meta.dirname, "check-security-txt.mjs");
const root = mkdtempSync(join(tmpdir(), "security-txt-"));
after(() => rmSync(root, { recursive: true, force: true }));

const now = "2026-09-28T00:00:00.000Z";
const inDays = (days) => new Date(Date.parse(now) + days * 86_400_000).toISOString();

const file = ({ expires = inDays(200), extra = "", contact = "Contact: https://github.com/rahul-bharati/run-hound/security/advisories/new" } = {}) =>
  [
    contact,
    "Policy: https://run-hound.example/security/",
    "Canonical: https://run-hound.example/.well-known/security.txt",
    "Preferred-Languages: en",
    expires === null ? "" : `Expires: ${expires}`,
    extra,
    "",
  ]
    .filter((line, i, all) => line !== "" || i === all.length - 1)
    .join("\n");

let fixture = 0;
function check(text, { siteUrl = "" } = {}) {
  const path = join(root, `${(fixture += 1)}.txt`);
  writeFileSync(path, text);
  const result = spawnSync(process.execPath, [script, "--file", path, "--now", now], {
    encoding: "utf8",
    env: { ...process.env, NEXT_PUBLIC_SITE_URL: siteUrl },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("check-security-txt passes", () => {
  test("a contact, and an Expires 200 days away", () => {
    const { status, output } = check(file());
    assert.equal(status, 0, output);
    assert.match(output, /check-security-txt: expires in 200 days/);
  });

  test("the canonical on the deployed address", () => {
    const { status, output } = check(file(), { siteUrl: "https://run-hound.example" });
    assert.equal(status, 0, output);
    assert.doesNotMatch(output, /warning/);
  });

  test("a canonical on another address than NEXT_PUBLIC_SITE_URL (a preview or example build) only warns", () => {
    // The production file names the production address; a build for https://example.com (site/README.md, the
    // Dockerfile's hint) or a preview still builds. §5.2 gates only Expires.
    const { status, output } = check(file(), { siteUrl: "https://runhound.dev" });
    assert.equal(status, 0, output);
    assert.match(
      output,
      /check-security-txt: warning: Canonical https:\/\/run-hound\.example\/\.well-known\/security\.txt is not https:\/\/runhound\.dev\/\.well-known\/security\.txt \(NEXT_PUBLIC_SITE_URL\)/,
    );
  });

  test("comments and a trailing blank line", () => {
    assert.equal(check(`# Run Hound\n${file()}\n`).status, 0);
  });
});

describe("check-security-txt fails the build when", () => {
  const cases = {
    "Expires is 20 days away": [file({ expires: inDays(20) }), /Expires .* is 20 days away; renew it \(at least 30 days\)/],
    "Expires has passed": [file({ expires: inDays(-1) }), /Expires .* is -1 days away; renew it/],
    "Expires is over a year away": [file({ expires: inDays(400) }), /Expires .* is 400 days away; RFC 9116 wants less than a year/],
    "Expires is missing": [file({ expires: null }), /no Expires field/],
    "Expires is not a date": [file({ expires: "next year" }), /Expires "next year" is not an ISO 8601 date and time/],
    "there are two Expires fields": [file({ extra: `Expires: ${inDays(100)}` }), /2 Expires fields; RFC 9116 allows one/],
    "there is no Contact": [file({ contact: "" }), /no Contact field/],
    "a Contact is neither https: nor mailto:": [file({ contact: "Contact: http://example.com/report" }), /Contact "http:\/\/example\.com\/report" must be https: or mailto:/],
  };
  for (const [name, [text, message]] of Object.entries(cases)) {
    test(name, () => {
      const { status, output } = check(text);
      assert.equal(status, 1, output);
      assert.match(output, message);
    });
  }

  test("the file is missing", () => {
    const result = spawnSync(process.execPath, [script, "--file", join(root, "none.txt"), "--now", now], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /is missing/);
  });
});
