/**
 * In-page evaluation scripts and the marking search (SCAN_LINKS, NOT_FOUND_VIEW, SHOWS_PASSWORD, FINGERPRINT,
 * PAGE_HARDENING, markScript, marked, locatorOf, CLICKABLE, DIALOGS).
 */
import type { Page } from "playwright";
import type { Marked } from "../../interfaces/paywall-trust.js";
import { SHARED_WORKER_REFUSED } from "../../constants/paywall-trust-constants.js";
import { q } from "./urls.js";

/** Every link with a real href, hidden ones too (a Billing tab's panel), with its name, in document order. */
const SCAN_LINKS = String.raw`(() => {
  const out = [];
  for (const a of document.querySelectorAll("a[href]")) {
    if (a.hasAttribute("download")) continue;
    const raw = (a.getAttribute("href") || "").trim();
    if (!raw || raw.charAt(0) === "#" || /^(javascript|mailto|tel|data|blob):/i.test(raw)) continue;
    let url;
    try { url = new URL(raw, location.href); } catch (e) { continue; }
    const text = (a.getAttribute("aria-label") || a.textContent || a.getAttribute("title") || "").replace(/\s+/g, " ").trim();
    out.push({ url: url.href, text: text.slice(0, 200) });
    if (out.length >= 500) break;
  }
  return out;
})()`;

/** True when the page shows a "this page doesn't exist" view (its title or main heading says so). */
const NOT_FOUND_VIEW = String.raw`(() => {
  const title = (document.title || "").toLowerCase();
  const h1 = (document.querySelector("h1") ? document.querySelector("h1").innerText || "" : "").toLowerCase();
  return /\b404\b|not[\s-]?found|does\s?n['’]?t exist|no such page|page (does\s?n['’]?t|cannot be) found/.test(title + " " + h1);
})()`;

/** True when a visible password field is on the page (a success page never asks for one; a sign-in page does). */
const SHOWS_PASSWORD = String.raw`(() => Array.from(document.querySelectorAll("input[type=password]")).some((el) => {
  const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
}))()`;

/**
 * A fingerprint of what the page shows: its title, its main heading and the start of its main content (whitespace
 * collapsed). Two routes with the same fingerprint showed the same page (a single-page app's catch-all that renders the
 * dashboard at any path and keeps the URL). Read from the page as it is: no request.
 */
const FINGERPRINT = String.raw`(() => {
  const t = (s) => (s || "").replace(/\s+/g, " ").trim();
  const h1 = document.querySelector("h1");
  const main = document.querySelector("main, [role=main]") || document.body;
  return t(document.title) + "\n" + t(h1 ? h1.innerText : "") + "\n" + t(main ? main.innerText : "").slice(0, 1500);
})()`;

/**
 * Marks the visible, enabled elements of `selector` whose name matches `match` and not `avoid` (and, when `within` is
 * set, only inside a visible element of `within`, whose text is returned as `area`; with `unselected` or `selected`,
 * only those whose aria-selected isn't or is "true") with their own attribute data-rh-<prefix>="<n>" (so one search never
 * unmarks another's), and returns a selector for each, in document order, with the heading of the section it sits in
 * (the nearest ancestor with a heading, a legend or an aria-label; the page's title and main heading when none) and
 * whether that is a sub-section's, the text of the list item or table row it sits in and how many other rows of that
 * list or table hold an element of the same name, where a link goes, where the form around it sends (its own
 * formaction, else the form's action attribute) and whether a click submits that form.
 */
function markScript(o: { selector: string; match: RegExp; avoid?: RegExp; within?: string; prefix: string; unselected?: boolean; selected?: boolean }): string {
  return `(() => {
  const match = new RegExp(${q(o.match.source)}, "i");
  const avoid = ${o.avoid ? `new RegExp(${q(o.avoid.source)}, "i")` : "null"};
  const attr = ${q(`data-rh-${o.prefix}`)};
  const shown = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const s = getComputedStyle(el); return s.visibility !== "hidden" && s.display !== "none"; };
  const nameOf = (el) => (el.getAttribute("aria-label") || el.innerText || el.value || el.getAttribute("title") || "").replace(/\\s+/g, " ").trim();
  const clean = (t) => (t || "").replace(/\\s+/g, " ").trim().slice(0, 120);
  const formOf = (el) => el.form || el.closest("form");
  const actionOf = (el) => {
    try {
      const own = el.getAttribute("formaction");
      if (own && own.trim()) return new URL(own, location.href).href;
      const form = formOf(el);
      const action = form ? form.getAttribute("action") : null;
      return action && action.trim() ? new URL(action, location.href).href : null;
    } catch (e) { return null; }
  };
  const submitsForm = (el) => {
    if (!formOf(el)) return false;
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (el.tagName === "BUTTON") return type === "" || type === "submit";
    return el.tagName === "INPUT" && (type === "submit" || type === "image");
  };
  const sectionOf = (el) => {
    let node = el.parentElement;
    for (let depth = 0; node && node !== document.body && depth < 8; depth++, node = node.parentElement) {
      const label = node.getAttribute("aria-label");
      const heading = node.querySelector(":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > legend, :scope > [role=heading], :scope > header h1, :scope > header h2, :scope > header h3");
      if (label || heading) {
        const pageHeading = heading && (heading.tagName === "H1" || heading.getAttribute("aria-level") === "1");
        const main = node.tagName === "MAIN" || node.getAttribute("role") === "main";
        return { text: clean((label || "") + " " + (heading ? heading.textContent : "")), sub: heading ? !pageHeading : !main };
      }
    }
    const h1 = document.querySelector("h1");
    return { text: clean(document.title + " " + (h1 ? h1.textContent : "")), sub: false };
  };
  const ROWS = "li, tr, [role=row], [role=listitem]";
  const rowOf = (el) => {
    const row = el.closest(ROWS);
    return row ? (row.innerText || row.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 200) : "";
  };
  // The other rows of the list or table the element's row is in that hold an element of the same name (hidden too).
  const peersOf = (el, name) => {
    const row = el.closest(ROWS);
    const list = row ? row.parentElement : null;
    if (!list) return 0;
    const key = name.toLowerCase();
    let n = 0;
    for (const other of list.children) {
      if (other === row || !other.matches(ROWS)) continue;
      if (Array.from(other.querySelectorAll(${q(o.selector)})).some((c) => nameOf(c).toLowerCase() === key)) n++;
    }
    return n;
  };
  const roots = ${o.within ? `Array.from(document.querySelectorAll(${q(o.within)})).filter(shown)` : "[document]"};
  const out = [];
  let n = 0;
  for (const root of roots) {
    const area = root === document ? "" : (root.innerText || root.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 600);
    for (const el of root.querySelectorAll(${q(o.selector)})) {
      if (!shown(el) || el.disabled || el.getAttribute("aria-disabled") === "true" || el.closest("[inert]")) continue;
      ${o.unselected ? `if (el.getAttribute("aria-selected") === "true") continue;` : ""}
      ${o.selected ? `if (el.getAttribute("aria-selected") !== "true") continue;` : ""}
      const name = nameOf(el);
      if (!name || name.length > 80 || !match.test(name) || (avoid && avoid.test(name))) continue;
      const id = String(n++);
      el.setAttribute(attr, id);
      const section = sectionOf(el);
      out.push({ selector: "[" + attr + '="' + id + '"]', name, href: el.tagName === "A" ? el.href : null, formAction: actionOf(el), submits: submitsForm(el), section: section.text, subSection: section.sub, row: rowOf(el), inRow: el.closest(ROWS) !== null, peers: peersOf(el, name), area });
    }
  }
  return out;
})()`;
}

const CLICKABLE = "button, a[href], [role=button], [role=menuitem], [role=link], input[type=submit], input[type=button]";
const DIALOGS = "[role=dialog], [role=alertdialog], dialog[open]";

let markCounter = 0;
async function marked(page: Page, o: Omit<Parameters<typeof markScript>[0], "prefix">): Promise<Marked[]> {
  markCounter += 1;
  const found = await page.evaluate(markScript({ ...o, prefix: `mark${markCounter}` })).catch(() => []);
  return Array.isArray(found) ? (found as Marked[]) : [];
}

const locatorOf = (page: Page, m: Marked) => page.locator(m.selector).first();

/**
 * Added to every page of Account A's context before any page script runs (0.6.0 review, round 1), for the loads no
 * route and no tab-level DevTools block sees:
 * - **Shared workers.** Their requests go past the context's routes and the page's DevTools block (Playwright detaches
 *   from them), so a page's own SharedWorker could call a payment provider. The constructor throws instead (and says
 *   so on the console, for the notes); a dedicated Worker is still seen and stays. Second layer: watchBrowser.
 * - **Speculation rules.** A `<script type="speculationrules">` prefetch or prerender (a billing portal start among
 *   the page's links, followed to the provider) is seen by no interception layer, so a rules script is removed as soon
 *   as it is in the document, before the browser reads its rules (a MutationObserver's callback runs before they are
 *   acted on), anywhere in it or in a shadow root the page attaches, and again when a script's children change. Every
 *   built-in it uses is taken before any page script runs. The Speculation-Rules header is dropped by blockAtBrowser.
 * The same channels sign-in closes (auth.ts SIGN_IN_HARDENING). Declares no named function: tsx/esbuild's keepNames
 * would wrap one in a `__name` helper the browser doesn't have.
 */
const PAGE_HARDENING = String.raw`(() => {
  try {
    var warn = console.warn;
    Object.defineProperty(window, "SharedWorker", { configurable: true, writable: true, value: function () {
      try { warn.call(console, ${q(SHARED_WORKER_REFUSED)}); } catch (e) {}
      throw new Error("Run Hound blocks shared workers while it checks paid plans");
    } });
  } catch (e) {}
  try {
    var apply = Reflect.apply;
    var getter = function (proto, name) { return Object.getOwnPropertyDescriptor(proto, name).get; };
    var nodeType = getter(Node.prototype, "nodeType"), localName = getter(Element.prototype, "localName");
    var getAttribute = Element.prototype.getAttribute, remove = Element.prototype.remove, test = RegExp.prototype.test;
    var elementAll = Element.prototype.querySelectorAll, fragmentAll = DocumentFragment.prototype.querySelectorAll, documentAll = Document.prototype.querySelectorAll;
    var listLength = getter(NodeList.prototype, "length"), listItem = NodeList.prototype.item;
    var recordTarget = getter(MutationRecord.prototype, "target"), recordAdded = getter(MutationRecord.prototype, "addedNodes");
    var Observer = MutationObserver, observe = MutationObserver.prototype.observe, attachShadow = Element.prototype.attachShadow;
    var SPEC = /speculationrules/i;
    var isSpec = function (n) {
      try { return !!n && apply(nodeType, n, []) === 1 && apply(localName, n, []) === "script" && apply(test, SPEC, [String(apply(getAttribute, n, ["type"]) || "")]); } catch (e) { return false; }
    };
    var drop = function (n) { try { apply(remove, n, []); } catch (e) {} };
    var each = function (list, fn) { var count = apply(listLength, list, []); for (var i = 0; i < count; i++) fn(apply(listItem, list, [i])); };
    var strip = function (n) {
      try {
        if (isSpec(n)) return drop(n);
        var type = apply(nodeType, n, []);
        var all = type === 1 ? elementAll : type === 11 ? fragmentAll : type === 9 ? documentAll : null;
        if (all) each(apply(all, n, ["script"]), function (s) { if (isSpec(s)) drop(s); });
      } catch (e) {}
    };
    var observer = new Observer(function (records) {
      for (var r = 0; r < records.length; r++) {
        try {
          var target = apply(recordTarget, records[r], []);
          if (isSpec(target)) drop(target);
          each(apply(recordAdded, records[r], []), strip);
        } catch (e) {}
      }
    });
    var watch = function (root) { try { apply(observe, observer, [root, { childList: true, subtree: true }]); strip(root); } catch (e) {} };
    if (typeof attachShadow === "function") {
      Object.defineProperty(Element.prototype, "attachShadow", {
        configurable: true,
        writable: true,
        value: function () { var root = apply(attachShadow, this, arguments); watch(root); return root; },
      });
    }
    watch(document);
  } catch (e) {}
})()`;

export {
  SCAN_LINKS,
  NOT_FOUND_VIEW,
  SHOWS_PASSWORD,
  FINGERPRINT,
  PAGE_HARDENING,
  markScript,
  marked,
  CLICKABLE,
  DIALOGS,
  locatorOf,
};