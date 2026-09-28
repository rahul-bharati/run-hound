/**
 * Runs in `pnpm build` after check-registry: the homepage word budget, with one word-count method and no browser.
 * It reads the prerendered home page and counts the words in <main> a reader can get as text: every text node outside
 * <script>, <style>, <svg>, aria-hidden="true" and .sr-only (the brief's list, §4.3; the bare class only: words that
 * "md:not-sr-only" or "sm:sr-only" show at some widths count), INCLUDING text in [hidden] panels,
 * <noscript> and <template> (a tab, an accordion or a script can't hide words from the budget). A word is the brief's
 * regex (readability.md): a letter or digit, then letters, digits and ' ’ . : / _ -, so "0.6.0" and "localhost:4000"
 * are one word each. A tag separates words, in the total and in the text the copy rules read.
 *
 * It fails when the page has more than 750 words, once the homepage is written in src/content/home.ts; until then it
 * only reports. It warns (never fails) on the copy rules of brief §4.5: an h2 over 8 words, an intro (the first
 * paragraph after an h2) over 25, a sentence over 25, a caption over 15, more than one tablist, and any hidden words.
 *
 * Usage: node scripts/check-copy.mjs [--file <index.html>] [--budget 750] [--enforce | --report] [--sections]
 * (the file is the home page of the build in NEXT_DIST_DIR or .next).
 */
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { appDir, decode, mainOf, siteDir } from "./lib/build-output.mjs";
import { option } from "./lib/registry.mjs";

const args = process.argv.slice(2);
const file = option(args, "file") ?? join(appDir, "index.html");
const budget = Number(option(args, "budget") ?? 750);
const homeModule = join(siteDir, "src", "content", "home.ts");
const enforce = args.includes("--enforce") || (!args.includes("--report") && existsSync(homeModule));

if (!existsSync(file)) {
  console.error(`check-copy: ${relative(siteDir, file) || file} is missing. Run this after next build (pnpm build does).`);
  process.exit(1);
}

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’.:/_\-]*/gu;
const count = (text) => (text.match(WORD) ?? []).length;
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const SKIP = new Set(["script", "style", "svg"]);

const main = mainOf(readFileSync(file, "utf8"));

let words = 0;
let hiddenWords = 0;
let tablists = 0;
const sections = [];
let current = { heading: "(before the first h2)", words: 0 };
/** Open elements: { name, skip, hidden }. */
const stack = [];
/** Text being collected for an element whose words the rules look at: h2, p, li, figcaption. */
const collecting = [];
/** The next paragraph after an h2 is its intro. */
let awaitingIntro = false;
const warnings = [];

const skipping = () => stack.some((element) => element.skip);
const hidden = () => stack.some((element) => element.hidden);

function text(raw) {
  if (skipping()) return;
  const decoded = decode(raw);
  const n = count(decoded);
  words += n;
  current.words += n;
  if (hidden()) hiddenWords += n;
  for (const element of collecting) element.text += decoded;
}

function finish(element) {
  const content = element.text.replace(/\s+/g, " ").trim();
  const n = count(content);
  const sample = content.slice(0, 60);
  if (element.name === "h2") {
    current.heading = content;
    if (n > 8) warnings.push(`h2 has ${n} words (at most 8): "${sample}"`);
    awaitingIntro = true;
    return;
  }
  // A list item that holds its own heading or paragraphs is checked through them, not as one run-on sentence.
  if (element.blocks) return;
  if (element.name === "figcaption" && n > 15) warnings.push(`caption has ${n} words (at most 15): "${sample}"`);
  if (element.name === "p" && element.intro && n > 25) warnings.push(`intro has ${n} words (at most 25): "${sample}"`);
  for (const sentence of content.split(/(?<=[.!?])\s+/)) {
    const m = count(sentence);
    if (m > 25) warnings.push(`sentence has ${m} words (at most 25): "${sentence.slice(0, 60)}"`);
  }
}

/**
 * Whether a start tag's class list hides its text at every width: the bare "sr-only" token, and no "…:not-sr-only"
 * that shows it again at some width. A prefixed "sm:sr-only" hides it only at some widths, so its words count.
 */
function isScreenReaderOnly(attributes) {
  const value = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attributes);
  if (!value) return false;
  const classes = (value[1] ?? value[2] ?? value[3]).split(/\s+/);
  return classes.includes("sr-only") && !classes.some((name) => name.endsWith(":not-sr-only"));
}

const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|<!--[\s\S]*?-->/g;
let last = 0;
for (let m = tag.exec(main); m; m = tag.exec(main)) {
  text(main.slice(last, m.index));
  last = tag.lastIndex;
  if (!m[2]) continue; // a comment
  // A tag ends a word: "<span>STEP</span>One" is two words for the copy rules too.
  for (const open of collecting) open.text += " ";
  const [, close, rawName, attributes, selfClosing] = m;
  const name = rawName.toLowerCase();
  if (VOID.has(name) || selfClosing) continue;
  if (close) {
    // Close up to the matching element (tolerates unclosed <p> and <li>).
    const at = stack.map((e) => e.name).lastIndexOf(name);
    if (at < 0) continue;
    for (const element of stack.splice(at)) {
      const collected = collecting.indexOf(element);
      if (collected >= 0) {
        collecting.splice(collected, 1);
        if (!element.skip) finish(element);
      }
    }
    continue;
  }
  const element = {
    name,
    skip: SKIP.has(name) || /\baria-hidden\s*=\s*["']?true/i.test(attributes) || isScreenReaderOnly(attributes),
    // The hidden attribute itself, not a "hidden" class inside an attribute's value.
    hidden: /(^|\s)hidden(\s|$)/i.test(attributes.replace(/\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g, "")),
    text: "",
  };
  if (/\brole\s*=\s*["']?tablist/i.test(attributes)) tablists += 1;
  stack.push(element);
  if (skipping()) continue;
  if (/^(p|h[1-6]|li|div|figcaption|ul|ol)$/.test(name)) for (const open of collecting) if (open.name === "li" && open !== element) open.blocks = true;
  if (name === "h2") {
    sections.push(current);
    current = { heading: "", words: 0 };
    collecting.push(element);
  } else if (["p", "li", "figcaption"].includes(name)) {
    if (name === "p" && awaitingIntro) element.intro = true;
    collecting.push(element);
  }
  if (name === "p" || /^h[1-6]$/.test(name)) awaitingIntro = name === "h2" ? awaitingIntro : false;
}
text(main.slice(last));
sections.push(current);

if (hiddenWords > 0) warnings.push(`${hiddenWords} words are in hidden panels: every fact should be visible (brief P4)`);
if (tablists > 1) warnings.push(`${tablists} tablists (at most 1)`);

const over = words > budget;
const verdict = over ? (enforce ? "OVER" : `OVER (report only: ${relative(siteDir, homeModule)} does not exist yet)`) : "ok";
console.log(`check-copy: ${words} words in <main> (${hiddenWords} in hidden panels), budget ${budget}: ${verdict}`);
if (args.includes("--sections")) for (const s of sections) console.log(`  ${String(s.words).padStart(4)}  ${s.heading}`);
for (const warning of warnings) console.warn(`check-copy: warning: ${warning}`);
if (over && enforce) process.exit(1);
