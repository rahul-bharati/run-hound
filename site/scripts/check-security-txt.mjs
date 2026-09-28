/**
 * Runs in `pnpm build`: public/.well-known/security.txt (RFC 9116) must say where to report a vulnerability and must
 * not go stale. It fails the build when:
 * - there is no Contact field, or a Contact is neither https: nor mailto:;
 * - there isn't exactly one Expires field, it isn't an ISO 8601 date and time, or it is less than 30 days or more than
 *   a year away (RFC 9116 §2.5.5 wants less than a year): renew it with each release.
 *
 * It warns, without failing, when NEXT_PUBLIC_SITE_URL is set (the Docker build) and a Canonical isn't that address's
 * /.well-known/security.txt: the file names the production address, and a build for another one (a preview, or the
 * https://example.com of site/README.md and the Dockerfile's hint) still builds. §5.2 gates only Expires.
 *
 * Usage: node scripts/check-security-txt.mjs [--file <path>] [--now <ISO date>]
 */
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { siteDir } from "./lib/build-output.mjs";
import { option } from "./lib/registry.mjs";

const args = process.argv.slice(2);
const file = resolve(option(args, "file") ?? join(siteDir, "public", ".well-known", "security.txt"));
const now = Date.parse(option(args, "now") ?? new Date().toISOString());
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
const DAY = 86_400_000;

if (!existsSync(file)) {
  console.error(`check-security-txt: ${relative(siteDir, file) || file} is missing.`);
  process.exit(1);
}

const errors = [];
/** Fields by lower-cased name: "Name: value" lines, comments (#) and blank lines skipped. */
const fields = new Map();
for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
  if (!line.trim() || line.startsWith("#")) continue;
  const match = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line);
  if (!match) {
    errors.push(`line ${JSON.stringify(line)} is not "Name: value"`);
    continue;
  }
  const name = match[1].toLowerCase();
  fields.set(name, [...(fields.get(name) ?? []), match[2].trim()]);
}

const contacts = fields.get("contact") ?? [];
if (contacts.length === 0) errors.push("no Contact field: say where to report a vulnerability");
for (const contact of contacts) {
  if (!/^(https:|mailto:)/.test(contact)) errors.push(`Contact ${JSON.stringify(contact)} must be https: or mailto:`);
}

const expires = fields.get("expires") ?? [];
let days;
if (expires.length === 0) errors.push("no Expires field");
else if (expires.length > 1) errors.push(`${expires.length} Expires fields; RFC 9116 allows one`);
else {
  const value = expires[0];
  const at = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
  if (Number.isNaN(at)) errors.push(`Expires ${JSON.stringify(value)} is not an ISO 8601 date and time`);
  else {
    days = Math.round((at - now) / DAY);
    if (days < 30) errors.push(`Expires ${value} is ${days} days away; renew it (at least 30 days)`);
    else if (days > 365) errors.push(`Expires ${value} is ${days} days away; RFC 9116 wants less than a year`);
  }
}

const warnings = [];
if (siteUrl) {
  const want = `${new URL(siteUrl).origin}/.well-known/security.txt`;
  for (const canonical of fields.get("canonical") ?? []) {
    if (canonical !== want) warnings.push(`Canonical ${canonical} is not ${want} (NEXT_PUBLIC_SITE_URL)`);
  }
}

for (const warning of warnings) console.warn(`check-security-txt: warning: ${warning}`);
for (const error of errors) console.error(`check-security-txt: ${error}`);
if (errors.length > 0) process.exit(1);
console.log(`check-security-txt: expires in ${days} days, ${contacts.length} contact${contacts.length === 1 ? "" : "s"}`);
