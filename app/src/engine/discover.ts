import type { Page, Route } from "playwright";
import { isDestructiveControl } from "../checks/dead-control.js";
import type { DiscoveredForm, DiscoveredPage, FormControl, FormField } from "../core/types.js";
import { NoFormFoundError } from "./errors.js";

/** What the in-page scan returns before accessible names are filled in from Playwright's aria snapshot. */
interface RawField extends Omit<FormField, "accessibleName"> {
  /** Name computed in the page (aria-label, labels, placeholder...), used when the aria snapshot has none. */
  fallbackName: string | null;
  /** Element whose accessible name is the field's name (the control, or the fieldset of a radio group); null to skip. */
  nameSelector: string | null;
  /** A widget whose options only exist while its list is open (no bubble <select>): open it to read them. */
  needsOptions?: boolean;
}

interface RawControl extends Omit<FormControl, "accessibleName"> {
  fallbackName: string | null;
  /** Role from markup; kept when the aria snapshot has none (e.g. clickable divs). */
  explicitRole: string | null;
  /**
   * Outside-form controls only (0.4.0): what the markup says a click opens. "dialog" (aria-haspopup="dialog"),
   * "expands" (aria-expanded or aria-controls), "other" (a menu or listbox popup, a tab, a switch or a toggle button,
   * or a link with a real href: never a form), or null when the markup says nothing.
   */
  opens?: "dialog" | "expands" | "other" | null;
}

interface RawForm {
  selector: string;
  name: string | null;
  search?: boolean;
  fields: RawField[];
  controls: RawControl[];
}

/**
 * What the in-page scan does: list the form scopes, describe one scope, list the controls outside the scopes, read the
 * options a widget's open list shows ("options-mark" before opening it), or find the forms a click just showed in a
 * dialog or popover ("popups-mark" before the click).
 */
type ScanOptions =
  | { mode: "list" }
  | { mode: "form"; scope: string | null }
  | { mode: "controls"; exclude: string[] }
  | { mode: "options-mark" }
  | { mode: "options"; trigger: string }
  | { mode: "popups-mark" }
  | { mode: "popup-scopes" };

/** At most this many forms per page (V1). */
const MAX_FORMS = 5;

/**
 * Runs in the page. Kept as a plain string, not a function: tsx/esbuild's keepNames would wrap nested
 * functions in a `__name` helper that does not exist in the browser. `__OPTS__` is replaced with the ScanOptions.
 */
const SCAN_SCRIPT = String.raw`((opts) => {
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const str = (s) => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const FIELD_SKIP = new Set(["hidden", "submit", "button", "reset", "image"]);
  const INTERACTIVE = "input, select, textarea, button, a[href], label, option, summary, [role=button], [role=link], [role=checkbox], [role=radio], [role=option], [role=tab], [role=menuitem], [role=switch], [contenteditable=true]";
  const PICKER_ROLES = new Set(["radio", "option", "menuitemradio"]);
  const NATIVE = "input, select, textarea";
  // 0.4.0: non-native widgets (Radix/shadcn, Headless UI, cmdk, MUI) that are fields, not buttons.
  const WIDGET = "[role=combobox], [role=checkbox], [role=switch], [role=radiogroup], [role=radio], [role=slider], button[aria-haspopup=listbox], [role=button][aria-haspopup=listbox]";
  // Parts of an open list or menu: a checkbox or radio in there is an item of that popup, not a field.
  const POPUP_PART = "[role=listbox], [role=menu], [role=menubar], [role=grid], [role=treegrid], [role=tree], [role=option]";
  // Where a form shown by a click lives: a dialog, sheet or popover.
  const POPUP = "[role=dialog], [role=alertdialog], dialog, [aria-modal=true], [popover], [data-radix-popper-content-wrapper]";
  // Ids a framework numbers in mount order, so the same element can get another id on the next load: React useId
  // (":r1:", "«r1»", "_r_1_", also inside "radix-:r2:" or "_r_1_-form-item"), Radix, Headless UI, MUI and friends,
  // Angular Material, Ember, Vue, and random UUIDs.
  const GENERATED_ID = /:[rR][0-9a-zA-Z]{0,12}:|«[rR][0-9a-zA-Z]{0,12}»|(?:^|[^0-9a-zA-Z])_[rR]_[0-9a-zA-Z]{1,12}_|^(?:radix|headlessui|mui|chakra|react-aria|downshift|mantine|base-ui|reach|rc_select|rc-tabs)[-_:]|^(?:mat|cdk)-[a-z-]+-\d+$|^ember\d+$|^v-\d+(?:-\d+)*$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const unique = (sel, el) => {
    try {
      const all = document.querySelectorAll(sel);
      return all.length === 1 && all[0] === el;
    } catch {
      return false;
    }
  };

  const stableId = (el) => (el.id && !GENERATED_ID.test(el.id) ? el.id : null);
  const attrSel = (tag, attr, v) => tag + "[" + attr + '="' + str(v) + '"]';

  /**
   * A unique selector from the element's own attributes, or null: its name (plus value for radios), a stable id, a
   * label attribute (aria-label, placeholder), a test id, a widget item's value, or its role for a dialog. Never a
   * generated id.
   */
  const ownSelector = (el) => {
    const tag = el.tagName.toLowerCase();
    const name = el.getAttribute("name");
    if (name) {
      let sel = attrSel(tag, "name", name);
      if (unique(sel, el)) return sel;
      const value = el.getAttribute("value");
      if (value !== null) {
        sel += '[value="' + str(value) + '"]';
        if (unique(sel, el)) return sel;
      }
    }
    const id = stableId(el);
    if (id && unique("#" + CSS.escape(id), el)) return "#" + CSS.escape(id);
    for (const attr of ["aria-label", "placeholder"]) {
      const v = el.getAttribute(attr);
      if (v && unique(attrSel(tag, attr, v), el)) return attrSel(tag, attr, v);
    }
    for (const attr of ["data-testid", "data-test", "data-cy", "data-qa"]) {
      const v = el.getAttribute(attr);
      if (v && unique("[" + attr + '="' + str(v) + '"]', el)) return "[" + attr + '="' + str(v) + '"]';
    }
    // A text field's value attribute follows what is typed (React keeps it in sync), so only other elements use it:
    // Radix radio items and <option>s carry value, cmdk items data-value.
    if (!el.matches(NATIVE)) {
      for (const attr of ["value", "data-value"]) {
        const v = el.getAttribute(attr);
        if (v && unique(attrSel(tag, attr, v), el)) return attrSel(tag, attr, v);
      }
    }
    const role = el.getAttribute("role");
    if ((role === "dialog" || role === "alertdialog") && unique(attrSel(tag, "role", role), el)) return attrSel(tag, "role", role);
    return null;
  };

  /**
   * Short, stable, unique CSS selector: the element's own (see ownSelector), else a path of tag names anchored at the
   * nearest ancestor that has one (or at the document).
   */
  const selectorFor = (el) => {
    const own = ownSelector(el);
    if (own) return own;
    const parts = [];
    let cur = el;
    while (cur && cur !== document.documentElement) {
      const parent = cur.parentElement;
      if (cur !== el) {
        const anchor = ownSelector(cur);
        if (anchor) {
          parts.unshift(anchor);
          break;
        }
      }
      const t = cur.tagName.toLowerCase();
      const same = parent ? Array.from(parent.children).filter((c) => c.tagName === cur.tagName) : [];
      parts.unshift(same.length > 1 ? t + ":nth-of-type(" + (same.indexOf(cur) + 1) + ")" : t);
      cur = parent;
    }
    return parts.join(" > ");
  };

  const isHidden = (el) => !!el.closest("[hidden], [aria-hidden=true]") || getComputedStyle(el).visibility === "hidden";
  const isRendered = (el) => !isHidden(el) && el.getClientRects().length > 0;

  /** Text of an element without the text of controls nested in it (e.g. a label wrapping a select). */
  const ownText = (el) => {
    const clone = el.cloneNode(true);
    for (const inner of clone.querySelectorAll("input, select, textarea, button, script, style, [aria-hidden=true]")) inner.remove();
    return norm(clone.textContent);
  };

  /** Like ownText, but keeps aria-hidden text: the "*" a label marks required fields with is usually aria-hidden. */
  const rawText = (el) => {
    const clone = el.cloneNode(true);
    for (const inner of clone.querySelectorAll("input, select, textarea, button, script, style")) inner.remove();
    return norm(clone.textContent);
  };

  const idsEls = (ids) => (ids || "").split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)).filter(Boolean);
  const byIds = (ids) => norm(idsEls(ids).map((n) => n.textContent).join(" ")) || null;

  /** The <label>s of an element: its own (labelable elements), else the label[for] naming its id (a div radiogroup). */
  const labelEls = (el) => {
    const own = Array.from(el.labels || []);
    if (own.length || !el.id) return own;
    try {
      return Array.from(document.querySelectorAll('label[for="' + str(el.id) + '"]'));
    } catch {
      return [];
    }
  };

  const labelText = (el) => {
    const labels = labelEls(el).map(ownText).filter(Boolean);
    return labels.length ? labels.join(" ") : null;
  };

  const nameFallback = (el) =>
    byIds(el.getAttribute("aria-labelledby")) || norm(el.getAttribute("aria-label")) || labelText(el) ||
    norm(el.getAttribute("placeholder")) || norm(el.getAttribute("title")) || null;

  const camel = (s) => {
    const words = norm(s).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(" ").filter(Boolean);
    return words.map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1))).join("");
  };
  /**
   * Text that labels a group from just before it: the previous sibling's text (not a control's), looking up to 3
   * levels up but not past stop. Returns { text, el } or null.
   */
  const textBefore = (node, stop) => {
    for (let hops = 0; node && node !== stop && hops < 3; node = node.parentElement, hops++) {
      const prev = node.previousElementSibling;
      if (prev && !prev.matches("input, select, textarea, button") && ownText(prev)) return { text: ownText(prev), el: prev };
    }
    return null;
  };
  /** A key from a label, without its required marker: "Team size (required)" gives "teamSize". */
  const labelKey = (s) => camel((s || "").replace(/\(\s*required\s*\)|\brequired\b|\*/gi, " "));

  // 0.4.0 (LOV-6): schema-validated forms (react-hook-form + zod) mark required fields only in the label.
  const marksRequired = (text) => {
    const t = norm(text);
    if (!t) return false;
    if (/^\*|\*:?$|\s\*\s/.test(t)) return true;
    return /\brequired\b/i.test(t) && !/\bnot\s+required\b|\boptional\b/i.test(t);
  };
  /** True when a label of the element (label, aria-labelledby, aria-label) says it is required. */
  const labelSaysRequired = (el) =>
    [...labelEls(el), ...idsEls(el.getAttribute("aria-labelledby"))].map(rawText).concat(norm(el.getAttribute("aria-label"))).some(marksRequired);
  const requiredInfo = (byAttribute, byLabel) =>
    byAttribute ? { required: true, requiredBy: "attribute" } : byLabel ? { required: true, requiredBy: "label" } : { required: false };

  const implicitRole = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === "textarea") return "textbox";
    if (tag === "select") return el.multiple || el.size > 1 ? "listbox" : "combobox";
    if (tag === "button") return "button";
    if (tag === "a") return "link";
    if (tag !== "input") return "generic";
    const type = el.type;
    if (type === "checkbox" || type === "radio") return type;
    if (type === "search") return "searchbox";
    if (type === "number") return "spinbutton";
    if (type === "range") return "slider";
    if (["submit", "button", "reset", "image"].includes(type)) return "button";
    return "textbox";
  };

  const isField = (el) =>
    (el.tagName === "INPUT" && !FIELD_SKIP.has(el.type)) || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
  const usable = (el) => isRendered(el) || ((el.type === "radio" || el.type === "checkbox") && !isHidden(el));
  const docOrder = (a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);

  const disabledWidget = (el) => el.disabled === true || el.getAttribute("aria-disabled") === "true" || el.hasAttribute("data-disabled");
  const widgetUsable = (el) => isRendered(el) && !disabledWidget(el);

  /**
   * The non-native widgets in a scope, in document order: { el, kind, items } with kind as FormField.widget. A
   * radiogroup is one widget whose items are its radios; radios without a radiogroup are grouped by the closest
   * ancestor holding several. A combobox that wraps a native input (ARIA 1.1) is left to that input.
   */
  const widgetsIn = (scope) => {
    const found = [];
    const radios = [];
    for (const el of scope.querySelectorAll(WIDGET)) {
      if (el.matches(NATIVE) || !widgetUsable(el)) continue;
      if (el.parentElement && el.parentElement.closest(POPUP_PART)) continue;
      const role = el.getAttribute("role");
      if (role === "radio") { radios.push(el); continue; }
      if (role === "combobox" && el.querySelector(NATIVE)) continue;
      if (found.some((w) => w.el.contains(el))) continue;
      const kind = role === "radiogroup" ? "aria-radio" : role === "checkbox" ? "aria-checkbox" : role === "switch" ? "aria-switch" : role === "slider" ? "aria-slider" : "aria-select";
      // A select trigger is focusable; one taken out of the tab order is the toggle button of a text combobox.
      if (kind === "aria-select" && el.tabIndex < 0) continue;
      found.push({ el, kind, items: [] });
    }
    const orphans = [];
    for (const r of radios) {
      const group = found.find((w) => w.kind === "aria-radio" && w.el.contains(r));
      if (group) group.items.push(r);
      else orphans.push(r);
    }
    for (const r of orphans) {
      let box = r.parentElement;
      while (box && box !== scope && orphans.filter((o) => box.contains(o)).length < 2) box = box.parentElement;
      if (!box || box === scope) box = r.parentElement;
      const group = found.find((w) => w.kind === "aria-radio" && w.el === box);
      if (group) group.items.push(r);
      else found.push({ el: box, kind: "aria-radio", items: [r] });
    }
    return found.filter((w) => w.kind !== "aria-radio" || w.items.length > 0).sort((a, b) => docOrder(a.el, b.el));
  };

  /** The hidden native input next to a widget that mirrors its value (Radix "bubble" inputs), or null. */
  const bubbleOf = (el, want) => {
    for (const sib of [el.nextElementSibling, el.previousElementSibling]) {
      if (sib && sib.matches(want) && (sib.getAttribute("aria-hidden") === "true" || sib.tabIndex < 0)) return sib;
    }
    return null;
  };
  const BUBBLE = { "aria-select": "select", "aria-checkbox": "input[type=checkbox]", "aria-switch": "input[type=checkbox]" };
  const bubblesOf = (widgets) => {
    const set = new Set();
    for (const w of widgets) {
      const b = BUBBLE[w.kind] ? bubbleOf(w.el, BUBBLE[w.kind]) : null;
      if (b) set.add(b);
      for (const item of w.items) {
        const rb = bubbleOf(item, "input[type=radio]");
        if (rb) set.add(rb);
      }
    }
    return set;
  };

  const fieldCount = (scope) => {
    const widgets = widgetsIn(scope);
    const bubbles = bubblesOf(widgets);
    const els = scope.tagName === "FORM" ? Array.from(scope.elements) : Array.from(scope.querySelectorAll("input, select, textarea"));
    const keys = new Set();
    for (const el of els) {
      if (!isField(el) || !usable(el) || bubbles.has(el)) continue;
      keys.add(el.type === "radio" && el.name ? "radio:" + el.name : el);
    }
    return keys.size + widgets.length;
  };

  /**
   * The tightest container holding the most usable fields that are outside every <form>, with a button in it;
   * null when there is none. With forms on the page, a container that holds a <form> is not a candidate.
   */
  const looseContainer = (formsExist) => {
    const counts = new Map();
    for (const el of document.querySelectorAll("input, select, textarea")) {
      if (!isField(el) || !usable(el) || el.closest("form")) continue;
      for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) counts.set(a, (counts.get(a) || 0) + 1);
    }
    let found = null, most = 0, depthBest = -1;
    for (const [el, n] of counts) {
      if (!el.querySelector("button, input[type=submit], [role=button]")) continue;
      if (formsExist && el.querySelector("form")) continue;
      let depth = 0;
      for (let a = el; a; a = a.parentElement) depth++;
      if (n > most || (n === most && depth > depthBest)) { most = n; depthBest = depth; found = el; }
    }
    return found ? { el: found, n: most } : null;
  };

  const CANCEL = /cancel|close|dismiss|clear|reset|back\b/i;

  // V1: every form scope on the page, most fields first (document order on a tie), at most 5.
  if (opts.mode === "list") {
    const found = Array.from(document.querySelectorAll("form")).map((el) => ({ el, n: fieldCount(el) })).filter((x) => x.n > 0);
    const loose = looseContainer(found.length > 0);
    if (loose) found.push(loose);
    found.sort((a, b) => b.n - a.n);
    return found.slice(0, 5).map((x) => selectorFor(x.el));
  }

  // V1: buttons and button-like controls outside every form scope. Links with a real href navigate by definition and
  // are only counted; href="#" and javascript: links act as buttons and are kept.
  if (opts.mode === "controls") {
    const scopes = (opts.exclude || []).map((sel) => { try { return document.querySelector(sel); } catch { return null; } }).filter(Boolean);
    const outside = (el) => !scopes.some((sc) => sc.contains(el));
    const pseudoLink = (el) => {
      const href = (el.getAttribute("href") || "").trim();
      return href === "" || href === "#" || /^javascript:/i.test(href);
    };
    // 0.4.0: what a click on the control opens, from its markup (discoverPage tries likely openers for hidden forms).
    const opens = (el) => {
      const popup = (el.getAttribute("aria-haspopup") || "").toLowerCase();
      if (popup === "dialog") return "dialog";
      if ((popup && popup !== "false") || el.matches("[role=tab], [role=switch], [aria-pressed]")) return "other";
      // A link with a real href goes to another page (a GET that may change something, "Join team"): never a dialog.
      if (el.tagName === "A" && !pseudoLink(el)) return "other";
      return el.hasAttribute("aria-expanded") || el.hasAttribute("aria-controls") ? "expands" : null;
    };
    let links = 0;
    const els = [];
    for (const el of document.querySelectorAll("button, input[type=button], input[type=submit], input[type=reset], input[type=image], [role=button], [role=switch], [role=tab], summary, a[href]")) {
      if (!outside(el) || !isRendered(el)) continue;
      if (el.parentElement && el.parentElement.closest("button, a[href], [role=button]")) continue;
      if (el.tagName === "A" && !el.matches("[role=button], [role=tab], [role=switch]") && !pseudoLink(el)) { links++; continue; }
      if (el.disabled) continue;
      els.push(el);
    }
    const controls = els.slice(0, 40).map((el) => ({
      text: ownText(el) || (el.tagName === "INPUT" ? norm(el.value) : ""),
      role: el.getAttribute("role") || implicitRole(el),
      explicitRole: el.getAttribute("role"),
      tag: el.tagName.toLowerCase(),
      selector: selectorFor(el),
      isSubmit: false,
      fallbackName: nameFallback(el) || ownText(el) || (el.tagName === "INPUT" ? norm(el.value) : null) || null,
      opens: opens(el),
    }));
    return { controls, links };
  }

  // 0.4.0: the options a widget's list shows once opened. "options-mark" remembers the options already on screen;
  // "options" returns those inside the element the trigger's aria-controls names, else the ones that appeared since.
  const shownOptions = (root) => Array.from(root.querySelectorAll("[role=option]")).filter(isRendered);
  if (opts.mode === "options-mark") {
    window.__rhOptionsBefore = new Set(shownOptions(document));
    return true;
  }
  if (opts.mode === "options") {
    let trigger = null;
    try { trigger = document.querySelector(opts.trigger); } catch { trigger = null; }
    if (!trigger) return [];
    const controlled = idsEls(trigger.getAttribute("aria-controls") || trigger.getAttribute("aria-owns")).flatMap(shownOptions);
    const before = window.__rhOptionsBefore || new Set();
    const shown = controlled.length ? controlled : shownOptions(document).filter((o) => !before.has(o));
    return shown.slice(0, 50).map((o) => ({ label: norm(o.getAttribute("aria-label")) || ownText(o) || norm(o.getAttribute("data-value")), selector: selectorFor(o) }))
      .filter((o) => o.label);
  }

  // 0.4.0: forms a click just showed in a dialog, sheet or popover. "popups-mark" remembers the popups already on
  // screen; "popup-scopes" returns a selector per form scope in the new ones (each <form> with a field, else a popup
  // with fields and a button that isn't Cancel/Close), innermost first, or null after a navigation.
  if (opts.mode === "popups-mark") {
    window.__rhPopups = new Set(Array.from(document.querySelectorAll(POPUP)).filter(isRendered));
    return true;
  }
  if (opts.mode === "popup-scopes") {
    const before = window.__rhPopups;
    if (!before) return null;
    let popups = 0;
    let scopes = [];
    for (const box of document.querySelectorAll(POPUP)) {
      if (before.has(box) || !isRendered(box)) continue;
      popups++;
      const forms = Array.from(box.querySelectorAll("form")).filter((f) => isRendered(f) && fieldCount(f) > 0);
      if (forms.length) scopes.push(...forms);
      else if (fieldCount(box) > 0 && Array.from(box.querySelectorAll("button, input[type=submit], [role=button]")).some((b) => isRendered(b) && !CANCEL.test(ownText(b) || nameFallback(b) || ""))) scopes.push(box);
    }
    scopes = scopes.filter((s, i) => scopes.indexOf(s) === i && !scopes.some((o) => o !== s && s.contains(o)));
    return { popups, scopes: scopes.map(selectorFor) };
  }

  // 1. Choose the form: the given scope; else the <form> with the most usable fields, else the tightest container
  // with fields and a button.
  let scope = null;
  let best = 0;
  if (opts.scope) {
    try { scope = document.querySelector(opts.scope); } catch { scope = null; }
    best = scope ? fieldCount(scope) : 0;
  } else {
    for (const form of document.querySelectorAll("form")) {
      const n = fieldCount(form);
      if (n > best) { best = n; scope = form; }
    }
    if (!scope) {
      const loose = looseContainer(false);
      if (loose) { scope = loose.el; best = loose.n; }
    }
  }
  if (!scope || best === 0) return null;
  const isForm = scope.tagName === "FORM";

  // 2. Form name: aria label, a heading inside, the dialog it is in, else the nearest heading before it.
  const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6, [role=heading]")).filter((h) => !isHidden(h));
  const inside = headings.find((h) => scope.contains(h));
  const before = headings.filter((h) => !scope.contains(h) && h.compareDocumentPosition(scope) & Node.DOCUMENT_POSITION_FOLLOWING).pop();
  const dialog = scope.parentElement && scope.parentElement.closest("[role=dialog], [role=alertdialog], dialog");
  const dialogName = dialog ? byIds(dialog.getAttribute("aria-labelledby")) || norm(dialog.getAttribute("aria-label")) || null : null;
  const formName =
    byIds(scope.getAttribute("aria-labelledby")) || norm(scope.getAttribute("aria-label")) ||
    (inside && norm(inside.textContent)) || dialogName || (before && norm(before.textContent)) || null;

  // Widgets first: their bubble inputs must not also show up as native fields.
  const widgets = widgetsIn(scope);
  const bubbles = bubblesOf(widgets);
  // The toggle button of a text combobox (Headless UI's ComboboxButton: aria-haspopup="listbox", out of the tab order)
  // is part of that field, not a control of its own.
  const comboboxToggle = (el) => el.matches("[aria-haspopup=listbox]") && el.tabIndex < 0;
  const inWidget = (el) => comboboxToggle(el) || widgets.some((w) => w.el.contains(el) || w.items.some((i) => i.contains(el)));

  // 3. Native fields, radio groups collapsed into one field each.
  const elements = isForm ? Array.from(scope.elements) : Array.from(scope.querySelectorAll("input, select, textarea, button"));
  const fields = [];
  const fieldEls = new Map();
  const radioGroups = new Map();
  for (const el of elements) {
    if (!isField(el) || !usable(el) || bubbles.has(el)) continue;
    const type = el.tagName === "INPUT" ? el.type : el.tagName.toLowerCase();
    const constraints = {};
    for (const attr of ["min", "max", "pattern"]) if (el.hasAttribute(attr)) constraints[attr] = el.getAttribute(attr);
    if (el.hasAttribute("minlength")) constraints.minLength = el.minLength;
    if (el.hasAttribute("maxlength")) constraints.maxLength = el.maxLength;
    const byAttribute = el.required || el.getAttribute("aria-required") === "true";

    if (type === "radio" && el.name) {
      let group = radioGroups.get(el.name);
      if (!group) {
        group = { radios: [], field: null, byAttribute: false };
        radioGroups.set(el.name, group);
        group.field = { key: el.name, label: null, placeholder: null, type: "radio", role: "radio", required: false, selector: "", options: [], fallbackName: null, nameSelector: null };
        fieldEls.set(group.field, el);
        fields.push(group.field);
      }
      group.radios.push(el);
      group.byAttribute = group.byAttribute || byAttribute;
      group.field.options.push({ label: nameFallback(el) || el.value, selector: selectorFor(el) });
      continue;
    }
    const options = type === "select"
      ? Array.from(el.options).filter((o) => o.value !== "" && !o.disabled).map((o) => ({ label: norm(o.label || o.textContent), selector: selectorFor(o) }))
      : undefined;
    const label = labelText(el);
    // A generated id changes between loads, so it is no key; the label is.
    const key = el.getAttribute("name") || stableId(el) || (el.id ? labelKey(label || el.getAttribute("placeholder") || el.getAttribute("aria-label")) : "");
    // A text input with role=combobox, or inside an ARIA 1.1 combobox, suggests values from a list (cmdk, Downshift).
    const combobox = el.tagName === "INPUT" && (el.getAttribute("role") === "combobox" || !!(el.parentElement && el.parentElement.closest("[role=combobox]")));
    fields.push({
      key,
      label,
      placeholder: el.getAttribute("placeholder"),
      type,
      role: el.getAttribute("role") || implicitRole(el),
      ...requiredInfo(byAttribute, labelSaysRequired(el)),
      selector: selectorFor(el),
      ...(options ? { options } : {}),
      ...(Object.keys(constraints).length ? { constraints } : {}),
      ...(norm(el.getAttribute("autocomplete")) ? { autocomplete: norm(el.getAttribute("autocomplete")).toLowerCase() } : {}),
      ...(combobox ? { widget: "aria-combobox" } : {}),
      fallbackName: nameFallback(el),
      nameSelector: null,
    });
    fields[fields.length - 1].nameSelector = fields[fields.length - 1].selector;
    fieldEls.set(fields[fields.length - 1], el);
  }

  // A radio group's container is the fieldset or radiogroup holding all of its radios.
  for (const { radios, field, byAttribute } of radioGroups.values()) {
    const first = radios[0];
    const containers = [first.closest("[role=radiogroup]"), first.closest("fieldset")].filter(Boolean);
    const container = containers.find((c) => radios.every((r) => c.contains(r)));
    let byLabel = false;
    let groupRequired = byAttribute;
    if (container) {
      const legend = container.tagName === "FIELDSET" ? container.querySelector(":scope > legend") : null;
      field.label = legend ? ownText(legend) || null : byIds(container.getAttribute("aria-labelledby"));
      field.fallbackName = byIds(container.getAttribute("aria-labelledby")) || norm(container.getAttribute("aria-label")) || field.label;
      field.role = container.getAttribute("role") === "radiogroup" ? "radiogroup" : "radio";
      groupRequired = groupRequired || container.getAttribute("aria-required") === "true";
      byLabel = (legend && marksRequired(rawText(legend))) || labelSaysRequired(container);
      field.selector = selectorFor(container);
      field.nameSelector = field.selector;
    } else {
      field.selector = selectorFor(first);
    }
    Object.assign(field, requiredInfo(groupRequired, byLabel));
  }

  // 0.4.0: non-native widgets, reported by their visible control. Selects and checkboxes name their bubble input
  // (nativeSelector); a radio group's nativeSelector matches the bubble radio of each item, in option order.
  const FIELDISH = NATIVE + ", " + WIDGET;
  const labelOf = (el) => labelText(el) || byIds(el.getAttribute("aria-labelledby")) || norm(el.getAttribute("aria-label")) || null;
  /** The widget's label, and the element carrying it: its own, else that of a close ancestor holding no other field. */
  const widgetLabel = (el) => {
    let label = labelOf(el);
    let source = el;
    for (let node = el.parentElement, hops = 0; !label && node && node !== scope && hops < 3; node = node.parentElement, hops++) {
      const others = Array.from(node.querySelectorAll(FIELDISH)).some((x) =>
        x !== el && !el.contains(x) && !x.contains(el) && (x.matches(NATIVE) ? isField(x) && usable(x) && !bubbles.has(x) : widgetUsable(x)));
      if (others) break;
      const legend = node.tagName === "FIELDSET" ? node.querySelector(":scope > legend") : null;
      label = labelOf(node) || (legend && ownText(legend)) || null;
      source = legend || node;
    }
    // Radios grouped by a plain container, like a custom picker: the text just before the container.
    const near = !label && el.getAttribute("role") !== "radiogroup" && el.querySelector("[role=radio]") ? textBefore(el, scope) : null;
    if (near) return { label: near.text, source: near.el };
    return { label, source };
  };
  const TYPE = { "aria-select": "select", "aria-checkbox": "checkbox", "aria-switch": "checkbox", "aria-radio": "radio", "aria-slider": "range" };
  for (const w of widgets) {
    const el = w.el;
    const { label, source } = widgetLabel(el);
    const bubble = BUBBLE[w.kind] ? bubbleOf(el, BUBBLE[w.kind]) : null;
    const itemBubbles = w.items.map((i) => bubbleOf(i, "input[type=radio]")).filter(Boolean);
    const selector = selectorFor(el);
    const byAttribute =
      el.getAttribute("aria-required") === "true" || !!(bubble && bubble.required) ||
      w.items.some((i) => i.getAttribute("aria-required") === "true") || itemBubbles.some((b) => b.required);
    const byLabel = labelSaysRequired(el) || (source !== el && (source.contains(el) ? labelSaysRequired(source) : marksRequired(rawText(source))));
    const name = (bubble && bubble.getAttribute("name")) || (itemBubbles[0] && itemBubbles[0].getAttribute("name")) || el.getAttribute("name");
    let options;
    if (w.kind === "aria-radio") {
      options = w.items.map((i) => ({ label: labelOf(i) || ownText(i) || norm(i.getAttribute("value")), selector: selectorFor(i) }));
    } else if (bubble && w.kind === "aria-select") {
      options = Array.from(bubble.options).filter((o) => o.value !== "" && !o.disabled).map((o) => ({ label: norm(o.label || o.textContent), selector: selectorFor(o) }));
    }
    let nativeSelector = bubble ? selectorFor(bubble) : null;
    if (w.kind === "aria-radio" && itemBubbles.length === w.items.length && el.getAttribute("role") === "radiogroup") {
      const all = selector + ' input[type="radio"]';
      try { if (document.querySelectorAll(all).length === itemBubbles.length) nativeSelector = all; } catch { nativeSelector = null; }
    }
    const constraints = {};
    if (w.kind === "aria-slider") {
      if (el.hasAttribute("aria-valuemin")) constraints.min = el.getAttribute("aria-valuemin");
      if (el.hasAttribute("aria-valuemax")) constraints.max = el.getAttribute("aria-valuemax");
    }
    fields.push({
      key: name || stableId(el) || labelKey(label) || "",
      label,
      // Radix marks a Select trigger that shows its placeholder with data-placeholder.
      placeholder: w.kind === "aria-select" && el.hasAttribute("data-placeholder") ? ownText(el) || null : null,
      type: TYPE[w.kind],
      role: w.kind === "aria-radio" ? "radiogroup" : el.getAttribute("role") || implicitRole(el),
      ...requiredInfo(byAttribute, byLabel),
      selector,
      ...(options ? { options } : {}),
      ...(Object.keys(constraints).length ? { constraints } : {}),
      widget: w.kind,
      ...(nativeSelector ? { nativeSelector } : {}),
      // Radios grouped by a plain container have no group name a screen reader would read.
      ...(w.kind === "aria-radio" && el.getAttribute("role") !== "radiogroup"
        ? { fallbackName: null, nameSelector: null }
        : { fallbackName: nameFallback(el) || label, nameSelector: selector }),
      ...(w.kind === "aria-select" && !options ? { needsOptions: true } : {}),
    });
    fieldEls.set(fields[fields.length - 1], el);
  }

  // 4. Custom pickers: two or more sibling clickable non-controls (cursor:pointer, onclick, or an option-like role).
  const clickable = (el) => {
    if (!isRendered(el) || el.matches("input, select, textarea, button, a, label, option, fieldset, legend, form, svg, svg *")) return false;
    if (el.parentElement && el.parentElement.closest("button, a[href], label, select, [role=button], [role=link]")) return false;
    if (inWidget(el)) return false;
    if (el.querySelector(INTERACTIVE)) return false;
    const role = el.getAttribute("role");
    if (role && PICKER_ROLES.has(role)) return true;
    if (role === "button" || role === "link") return false;
    if (el.hasAttribute("onclick")) return true;
    if (getComputedStyle(el).cursor !== "pointer") return false;
    // cursor is inherited: only the outermost pointer element counts.
    return !el.parentElement || getComputedStyle(el.parentElement).cursor !== "pointer";
  };
  const lone = [];
  const groups = new Map();
  for (const el of scope.querySelectorAll("*")) {
    if (!clickable(el) || !(ownText(el) || el.getAttribute("aria-label"))) continue;
    const list = groups.get(el.parentElement) || [];
    list.push(el);
    groups.set(el.parentElement, list);
  }
  const pickerOptions = new Set();
  let customIndex = 0;
  for (const [container, opts] of groups) {
    if (opts.length < 2) { lone.push(...opts); continue; }
    opts.forEach((o) => pickerOptions.add(o));
    let label = byIds(container.getAttribute("aria-labelledby")) || norm(container.getAttribute("aria-label")) || null;
    let labelEl = null;
    if (!label) {
      const heading = Array.from(container.children).find((c) => !opts.includes(c) && !opts.some((o) => c.contains(o)) && ownText(c));
      if (heading) { label = ownText(heading); labelEl = heading; }
    }
    const near = label ? null : textBefore(container, scope);
    if (near) { label = near.text; labelEl = near.el; }
    customIndex++;
    fields.push({
      key: container.getAttribute("name") || stableId(container) || (label && camel(label)) || "custom-" + customIndex,
      label,
      placeholder: null,
      type: "custom",
      role: container.getAttribute("role") || "generic",
      ...requiredInfo(container.getAttribute("aria-required") === "true", labelSaysRequired(container) || (labelEl && marksRequired(rawText(labelEl)))),
      selector: selectorFor(container),
      options: opts.map((o) => ({ label: norm(o.getAttribute("aria-label")) || ownText(o), selector: selectorFor(o) })),
      fallbackName: byIds(container.getAttribute("aria-labelledby")) || norm(container.getAttribute("aria-label")) || null,
      nameSelector: null,
    });
    fieldEls.set(fields[fields.length - 1], container);
  }

  // Report fields in document order (widgets and custom pickers were found last).
  fields.sort((a, b) => docOrder(fieldEls.get(a), fieldEls.get(b)));

  // Keys must be unique within the form.
  const seen = new Map();
  fields.forEach((f, i) => {
    let key = f.key || f.type + "-" + (i + 1);
    const n = seen.get(key) || 0;
    seen.set(key, n + 1);
    if (n > 0) key = key + "-" + (n + 1);
    f.key = key;
  });

  // 5. Controls: buttons, links and lone clickable elements (never a widget, which is a field). The submit control is
  // the form's default button.
  const controlEls = Array.from(scope.querySelectorAll("button, input[type=submit], input[type=button], input[type=reset], input[type=image], [role=button], [role=link], a[href]"))
    .filter((el) => isRendered(el) && !pickerOptions.has(el) && !inWidget(el) && !(el.parentElement && el.parentElement.closest("button, a[href]")));
  for (const el of lone) if (!controlEls.includes(el)) controlEls.push(el);
  controlEls.sort(docOrder);

  const submitType = (el) => (el.tagName === "BUTTON" || el.tagName === "INPUT") && (el.type === "submit" || el.type === "image");
  let submit = controlEls.find(submitType);
  if (!submit && !isForm) {
    const buttons = controlEls.filter((el) => implicitRole(el) === "button" || el.getAttribute("role") === "button");
    const text = (el) => ownText(el) || el.value || nameFallback(el) || "";
    submit = buttons.filter((el) => /submit|book|send|sign|register|create|continue|confirm|order|pay|save/i.test(text(el)) && !/draft|cancel|clear|reset/i.test(ownText(el))).pop() ||
      buttons.filter((el) => !CANCEL.test(text(el))).pop();
  }

  const controls = controlEls.map((el) => ({
    text: ownText(el) || (el.tagName === "INPUT" ? norm(el.value) : ""),
    role: el.getAttribute("role") || implicitRole(el),
    explicitRole: el.getAttribute("role"),
    tag: el.tagName.toLowerCase(),
    selector: selectorFor(el),
    isSubmit: el === submit,
    fallbackName: nameFallback(el) || ownText(el) || (el.tagName === "INPUT" ? norm(el.value) : null) || null,
  }));

  // A search form saves nothing: role=search, a <search> element, only search fields, or a GET form with an action
  // and one or two short text fields (no textarea).
  const method = isForm ? (scope.getAttribute("method") || "get").toLowerCase() : "";
  const shortFields = fields.length > 0 && fields.length <= 2 && fields.every((f) => f.type !== "textarea" && f.type !== "password");
  const search =
    !!scope.closest("[role=search], search") || !!scope.querySelector("[role=search]") ||
    (fields.length > 0 && fields.every((f) => f.type === "search")) ||
    (isForm && method === "get" && scope.hasAttribute("action") && shortFields);

  return { selector: selectorFor(scope), name: formName, fields, controls, ...(search ? { search: true } : {}) };
})(__OPTS__)`;

function scan(options: ScanOptions): string {
  return SCAN_SCRIPT.replace("__OPTS__", JSON.stringify(options));
}

interface AriaNode {
  role?: string;
  name?: string;
}

/** Role and accessible name as Playwright's aria snapshot computes them, or null when it can't tell. */
async function ariaOf(page: Page, selector: string): Promise<{ role: string; name: string | null } | null> {
  try {
    const nodes = (await page.locator(selector).ariaSnapshotJSON({ depth: 0, timeout: 2000 })) as unknown;
    const node = (Array.isArray(nodes) ? nodes[0] : undefined) as AriaNode | undefined;
    // Generic elements are flattened into "text" nodes; those say nothing about the element itself.
    if (!node || typeof node !== "object" || !node.role || node.role === "text") return null;
    return { role: node.role, name: typeof node.name === "string" && node.name.trim() ? node.name.trim() : null };
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Methods a click may send while discovery opens lists and dialogs: anything else could save or change data. */
const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Aborts every request a click sends that could write (anything but GET/HEAD/OPTIONS); lets the rest through. */
async function blockWrites(route: Route): Promise<void> {
  if (READ_ONLY_METHODS.has(route.request().method())) await route.fallback();
  else await route.abort("blockedbyclient");
}

/** Per page: how many withWritesBlocked calls are running. While any is, what the page sends over a WebSocket is dropped. */
const socketHolds = new WeakMap<Page, { holds: number }>();

/**
 * Routes the page's WebSockets through Playwright, so discovery can drop what the page sends over them while it
 * clicks: a Phoenix LiveView, Blazor Server or Socket.IO app saves over its socket, with no HTTP request to block. The
 * rest of the time every message is forwarded both ways, as if nothing were in between. Only sockets opened after this
 * call are routed, so the runner calls it before loading the page; discoverPage calls it too, for the loads it does
 * itself. Calling it again for the same page does nothing.
 */
export async function holdSocketWrites(page: Page): Promise<void> {
  if (socketHolds.has(page)) return;
  const state = { holds: 0 };
  socketHolds.set(page, state);
  await page
    .routeWebSocket(/.*/, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((message) => {
        if (state.holds === 0) server.send(message);
      });
    })
    .catch(() => undefined);
}

/**
 * Runs `body` (clicks that open a list or a dialog) with every write blocked: requests other than GET, HEAD and OPTIONS
 * are aborted, and messages the page sends over a WebSocket are dropped. GET requests go through: a page loads its
 * dialog's code and data with them.
 */
async function withWritesBlocked<T>(page: Page, body: () => Promise<T>): Promise<T> {
  await holdSocketWrites(page);
  const state = socketHolds.get(page)!;
  // A handler of its own, so a nested call's unroute leaves the outer one in place.
  const block = (route: Route) => blockWrites(route);
  await page.route("**/*", block);
  state.holds++;
  try {
    return await body();
  } finally {
    state.holds--;
    await page.unroute("**/*", block).catch(() => undefined);
  }
}

/** How long discovery waits for a widget's list to show its options, and for it to close again. */
const OPTIONS_WAIT_MS = 1_000;
/** At most this many widgets per form are opened to read their options. */
const MAX_OPENED_WIDGETS = 4;

/**
 * The options a widget without a bubble <select> (a cmdk combobox in a popover, a Headless UI Listbox) shows when it is
 * clicked open, or undefined when none appear. Closes the list again with Escape, but only when something opened, so
 * a dialog around the widget stays open. A trigger that would submit its form (a <button> without type="button") is
 * never clicked; the caller blocks writes meanwhile (blockWrites).
 */
async function readOptions(page: Page, selector: string): Promise<FormField["options"]> {
  const shown = async () => ((await page.evaluate(scan({ mode: "options", trigger: selector })).catch(() => [])) as NonNullable<FormField["options"]>);
  let options: NonNullable<FormField["options"]> = [];
  let opened = false;
  try {
    const trigger = page.locator(selector).first();
    const submits = await trigger.evaluate((el) => el instanceof HTMLButtonElement && el.type === "submit" && el.form !== null, undefined, { timeout: 1_000 });
    if (submits) return undefined;
    await page.evaluate(scan({ mode: "options-mark" }));
    await trigger.click({ timeout: 2_000 });
    for (let waited = 0; options.length === 0 && waited < OPTIONS_WAIT_MS; waited += 100) {
      await sleep(100);
      options = await shown();
    }
    opened = options.length > 0 || (await page.locator(selector).first().getAttribute("aria-expanded", { timeout: 500 }).catch(() => null)) === "true";
  } catch {
    // Not clickable: the options stay unknown.
  } finally {
    if (opened) {
      await page.keyboard.press("Escape").catch(() => undefined);
      for (let waited = 0; waited < OPTIONS_WAIT_MS && (await shown()).length > 0; waited += 100) await sleep(100);
    }
  }
  return options.length > 0 ? options : undefined;
}

/** Fills in accessible names and roles from Playwright's aria snapshot for a scanned form, and reads unknown options. */
async function finishForm(page: Page, raw: RawForm, index: number): Promise<DiscoveredForm> {
  const fields: FormField[] = [];
  const unread: FormField[] = [];
  for (const { fallbackName, nameSelector, needsOptions, ...field } of raw.fields) {
    const aria = nameSelector ? await ariaOf(page, nameSelector) : null;
    // Keep our role for radio groups (the fieldset is a "group") and custom pickers (always "generic" unless set).
    const role = field.type === "radio" || field.type === "custom" ? field.role : (aria?.role ?? field.role);
    fields.push({ ...field, role, accessibleName: aria ? aria.name : fallbackName });
    if (needsOptions) unread.push(fields[fields.length - 1]!);
  }
  const controls = await finishControls(page, raw.controls);
  // Opening a list hides the rest of the page from the aria snapshot, so this comes after every name is read. Nothing
  // may be saved meanwhile: a click that opens a list must not also send something.
  if (unread.length > 0) {
    await withWritesBlocked(page, async () => {
      for (const field of unread.slice(0, MAX_OPENED_WIDGETS)) {
        const options = await readOptions(page, field.selector);
        if (options) field.options = options;
      }
    });
  }
  return {
    url: page.url(),
    index,
    selector: raw.selector,
    name: raw.name,
    ...(raw.search ? { search: true } : {}),
    fields,
    controls,
  };
}

async function finishControls(page: Page, raw: RawControl[]): Promise<FormControl[]> {
  const controls: FormControl[] = [];
  for (const { fallbackName, explicitRole, opens: _opens, ...control } of raw) {
    const aria = await ariaOf(page, control.selector);
    controls.push({
      ...control,
      role: aria?.role ?? explicitRole ?? control.role,
      accessibleName: aria ? aria.name : fallbackName,
    });
  }
  return controls;
}

/**
 * Finds the main form on the loaded page (the <form> with the most fields; falls back to a container
 * with inputs and a submit-like button) and describes it. Fields include native inputs, textareas,
 * selects, radio groups (one field per group, with options), non-native widgets and custom pickers: groups of
 * clickable non-interactive elements (cursor:pointer or click handlers) labelled by nearby text, reported with
 * type "custom" and role as exposed ("generic" for divs). Throws NoFormFoundError if nothing is found.
 *
 * 0.4.0: widgets as Radix/shadcn, Headless UI, cmdk and MUI render them are fields with FormField.widget, reported by
 * their visible control: a select-like trigger (button[role=combobox], a button with aria-haspopup="listbox") is type
 * "select", a checkbox or switch "checkbox", a radiogroup "radio" (options: its radios), a slider "range" (min/max from
 * aria-valuemin/max), and a text input with role=combobox keeps its input type. The hidden native "bubble" input Radix
 * mirrors a value into is the widget's nativeSelector, never a field of its own. A select without one is clicked open
 * to read its options, then closed with Escape. A field whose label says it is required ("*", "(required)") is
 * required with requiredBy "label"; required/aria-required give requiredBy "attribute". Selectors never use ids a
 * framework generates in mount order (React useId, Radix, Headless UI, MUI): name, a stable id, aria-label or
 * placeholder, a test id, then a path anchored at the nearest ancestor with one of those.
 *
 * Accessible names and roles come from Playwright's aria snapshot (the same computation getByRole uses);
 * everything else from one DOM scan. Click handlers added with addEventListener are invisible to the
 * page, so custom pickers are recognised by cursor:pointer, an onclick attribute or an option-like role.
 */
export async function discoverForm(page: Page): Promise<DiscoveredForm> {
  const raw = (await page.evaluate(scan({ mode: "form", scope: null }))) as RawForm | null;
  if (!raw) throw new NoFormFoundError(page.url());
  const form = await finishForm(page, raw, 0);
  delete form.index;
  return form;
}

/** A form with nothing in it: Plan.form (and CheckContext.form of page scenarios) on a page without any form. */
export function emptyForm(url: string): DiscoveredForm {
  return { url, index: 0, selector: "body", name: null, fields: [], controls: [] };
}

/** Options for discoverPage. */
export interface DiscoverOptions {
  /**
   * 0.4.0: also find forms that only appear after a click (a dialog, sheet or popover). Tries up to MAX_OPENERS
   * controls outside the forms that look like they open something, each on a freshly loaded page, and reloads the page
   * once more at the end. Off by default, since it reloads the page and clicks; the runner turns it on.
   */
  openers?: boolean;
}

/** At most this many controls are clicked to look for forms behind them. */
export const MAX_OPENERS = 3;
/** How long a click gets to show a dialog with a form: a popup may load its fields after it opens. */
const OPENER_WAIT_MS = 2_500;
/** How long a click gets to show any popup at all (a lazy-loaded dialog fetches its code first). */
const NO_POPUP_WAIT_MS = 1_500;
/**
 * How long a reloaded page gets to reach network idle. Shorter than the runner's first load (5 s): a page that polls
 * never gets there, and each try also waits up to 3 s for its opener to show.
 */
const LOAD_IDLE_MS = 2_000;

/** Names of controls that usually open a form: "New project", "Add member", "Book a demo", "Get started". */
const OPENER_NAME = /\b(new|add|create|book|edit|invite|contact|request|get started|sign\s?-?up|register|join|subscribe|apply|feedback|compose|write|schedule)\b/i;

/**
 * V1: describes everything testable on the loaded page: every form scope (each <form> with a usable field, plus the
 * container of fields outside any form), main form first (most fields, as discoverForm picks it), at most 5; and the
 * buttons and button-like controls outside them. Never throws for a page without a form: page-wide checks still apply.
 *
 * 0.4.0, with `openers`: then tries controls that look like they open a dialog (see DiscoverOptions) and adds the forms
 * they show, after the on-load forms and within the 5-form cap, each with DiscoveredForm.opener.
 */
export async function discoverPage(page: Page, options: DiscoverOptions = {}): Promise<DiscoveredPage> {
  const url = page.url();
  const scopes = ((await page.evaluate(scan({ mode: "list" }))) as string[] | null) ?? [];
  const forms: DiscoveredForm[] = [];
  const used: string[] = [];
  for (const scope of scopes) {
    const raw = (await page.evaluate(scan({ mode: "form", scope }))) as RawForm | null;
    if (!raw || raw.fields.length === 0) continue;
    forms.push(await finishForm(page, raw, forms.length));
    used.push(raw.selector);
  }
  const outside = (await page.evaluate(scan({ mode: "controls", exclude: used }))) as { controls: RawControl[]; links: number };
  const title = (await page.title().catch(() => "")).replace(/\s+/g, " ").trim();
  const controls = await finishControls(page, outside.controls);
  if (options.openers && forms.length < MAX_FORMS) {
    const hints = outside.controls.map((c) => c.opens ?? null);
    await addFormsBehindOpeners(page, url, forms, openerCandidates(controls, hints));
  }
  return { url, title: title || null, forms, controls, links: outside.links };
}

/**
 * The controls worth clicking to find a hidden form, best first: aria-haspopup="dialog", then an opener-like name
 * ("New", "Add", "Create"...), then aria-expanded/aria-controls. Never a destructive control (isDestructiveControl),
 * a menu, tab, switch or toggle button, nor a link to another page (unless it says it opens a dialog).
 */
function openerCandidates(controls: FormControl[], hints: RawControl["opens"][]): FormControl[] {
  const rank = (control: FormControl, hint: RawControl["opens"]): number => {
    if (hint === "other" || isDestructiveControl(control)) return 0;
    if (hint === "dialog") return 3;
    if (OPENER_NAME.test(`${control.accessibleName ?? ""} ${control.text}`)) return 2;
    return hint === "expands" ? 1 : 0;
  };
  return controls
    .map((control, i) => ({ control, rank: rank(control, hints[i] ?? null) }))
    .filter((c) => c.rank > 0)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, MAX_OPENERS)
    .map((c) => c.control);
}

async function loadPage(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForLoadState("networkidle", { timeout: LOAD_IDLE_MS }).catch(() => undefined);
}

/**
 * Clicks each opener on a freshly loaded page and adds the forms that appear in a new dialog, sheet or popover to
 * `forms` (until MAX_FORMS), with the opener. Writes are blocked while it looks (withWritesBlocked: requests that
 * could write, and messages sent over a WebSocket), so a "New" button that saves a draft saves nothing. Reloads the
 * page at the end, so the caller gets it as it was loaded.
 */
async function addFormsBehindOpeners(page: Page, url: string, forms: DiscoveredForm[], openers: FormControl[]): Promise<void> {
  let clicked = false;
  // Before the first reload, so the sockets of every page loaded below can be held.
  if (openers.length > 0) await holdSocketWrites(page);
  try {
    for (const opener of openers) {
      if (forms.length >= MAX_FORMS) break;
      try {
        await loadPage(page, url);
        const target = page.locator(opener.selector).first();
        await target.waitFor({ state: "visible", timeout: 3_000 });
        await page.evaluate(scan({ mode: "popups-mark" }));
      } catch {
        continue;
      }
      clicked = true;
      await withWritesBlocked(page, async () => {
        await page.locator(opener.selector).first().click({ timeout: 3_000 });
        for (const scope of await popupScopes(page)) {
          if (forms.length >= MAX_FORMS) break;
          const raw = (await page.evaluate(scan({ mode: "form", scope }))) as RawForm | null;
          if (!raw || raw.fields.length === 0) continue;
          const form = await finishForm(page, raw, forms.length);
          // Two openers can show the same dialog (a header button and an empty-state button).
          const shape = (f: DiscoveredForm) => [f.name, f.selector, ...f.fields.map((x) => x.selector)].join("|");
          if (forms.some((f) => shape(f) === shape(form))) continue;
          forms.push({ ...form, url, opener: { selector: opener.selector, name: opener.accessibleName ?? (opener.text || null) } });
        }
      }).catch(() => {
        // The control could not be clicked, or the page went away: try the next one.
      });
    }
  } finally {
    if (clicked) await loadPage(page, url).catch(() => undefined);
  }
}

/**
 * Waits for the click to show a popup with a form and returns the form scopes' selectors: [] when no popup appeared
 * within NO_POPUP_WAIT_MS, when the popups that did still have no fields after OPENER_WAIT_MS, or after a navigation.
 */
async function popupScopes(page: Page): Promise<string[]> {
  const started = Date.now();
  for (;;) {
    const found = (await page.evaluate(scan({ mode: "popup-scopes" })).catch(() => null)) as { popups: number; scopes: string[] } | null;
    if (!found) return [];
    if (found.scopes.length > 0) return found.scopes;
    if (Date.now() - started > (found.popups > 0 ? OPENER_WAIT_MS : NO_POPUP_WAIT_MS)) return [];
    await sleep(150);
  }
}
