// Every key the site stores in a visitor's browser is listed in lib/storage-keys.ts and disclosed in the privacy
// page's "Cookies and similar storage" table, so a new key can't ship undisclosed (brief §8.3, rule 8). `pnpm test`.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { storageKeys } from "@/lib/storage-keys";
import { sourceFiles } from "../../scripts/lib/build-output.mjs";

const src = new URL("../", import.meta.url).pathname;
/**
 * The privacy page's sources: the page, and the content modules its table may move to (G3 moves
 * components/legal/pages.ts to content/legal.ts; F3 rewrites the legal pages), whichever exist.
 */
const privacySources = ["app/(legal)/privacy/page.tsx", "content/legal.ts", "components/legal/pages.ts"].filter((file) =>
  existsSync(join(src, file)),
);
const privacy = privacySources.map((file) => readFileSync(join(src, file), "utf8")).join("\n");
const known = new Set<string>(Object.values(storageKeys));

/** Whether the privacy sources name a key: in a <code> element, or as a string a table row renders. */
const disclosed = (key: string) =>
  privacy.includes(`<code>${key}</code>`) || [`"${key}"`, `'${key}'`, `\`${key}\``].some((literal) => privacy.includes(literal));

/** Code that reads or writes browser storage (not text that only mentions it). */
const storageCall = /\b(?:localStorage|sessionStorage)\s*\.\s*(?:getItem|setItem|removeItem)\s*\(/;

/**
 * The keys a file's storage calls use that storage-keys.ts doesn't list: a key typed in the call, or kept in a
 * constant whose value isn't listed (a constant imported from storage-keys.ts is fine).
 */
function unlistedKeys(text: string): string[] {
  if (!storageCall.test(text)) return [];
  const found: string[] = [];
  for (const [, key] of text.matchAll(/(?:getItem|setItem|removeItem)\s*\(\s*["'`]([^"'`]+)["'`]/g)) {
    if (!known.has(key)) found.push(key);
  }
  for (const [, name] of text.matchAll(/(?:getItem|setItem|removeItem)\s*\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g)) {
    const value = new RegExp(`\\bconst\\s+${name}\\s*=\\s*["'\`]([^"'\`]+)["'\`]`).exec(text)?.[1];
    const imported = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*["']@/lib/storage-keys["']`).test(text);
    if (value === undefined ? !imported : !known.has(value)) found.push(`${name} = ${value ?? "(not a constant here)"}`);
  }
  return found;
}

test("every storage key is disclosed in the privacy page's table", () => {
  assert.ok(known.size > 0);
  assert.ok(privacySources.length > 0, "no privacy page source found");
  for (const key of known) assert.ok(disclosed(key), `${key} is missing from the privacy table (${privacySources.join(", ")})`);
});

test("every file that touches browser storage uses only keys from storage-keys.ts", () => {
  const files = sourceFiles(src).map((file) => ({ file, text: readFileSync(file, "utf8") }));
  assert.ok(files.some(({ text }) => storageCall.test(text)), "no file touches storage; has the pattern stopped matching?");
  const offenders = files.flatMap(({ file, text }) => unlistedKeys(text).map((key) => `${relative(src, file)}: ${key}`));
  assert.deepEqual(offenders, []);
});

test("the check catches an unlisted key, typed in place or kept in a constant", () => {
  assert.deepEqual(unlistedKeys(`localStorage.setItem("rh-theme", "dark");`), ["rh-theme"]);
  assert.deepEqual(unlistedKeys(`const KEY = "rh-theme";\nwindow.localStorage.getItem(KEY);`), ["KEY = rh-theme"]);
  assert.deepEqual(unlistedKeys(`const KEY = "${storageKeys.consent}";\nlocalStorage.setItem(KEY, "x");`), []);
  assert.deepEqual(
    unlistedKeys(`import { storageKeys, THEME } from "@/lib/storage-keys";\nsessionStorage.removeItem(THEME);`),
    [],
  );
  // An event name that only looks like a key is not a storage key.
  assert.deepEqual(unlistedKeys(`const KEY = "${storageKeys.consent}"; const EVENT = "rh-consent";\nlocalStorage.getItem(KEY);`), []);
});

test("the consent choice is the key the consent code uses", () => {
  const consent = readFileSync(join(src, "lib/consent.ts"), "utf8");
  assert.match(consent, new RegExp(`["']${storageKeys.consent}["']`));
});
