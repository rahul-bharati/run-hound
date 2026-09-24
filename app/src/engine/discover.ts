import type { Page } from "playwright";
import type { DiscoveredForm, FormControl, FormField } from "../core/types.js";
import { NoFormFoundError } from "./errors.js";

/** What the in-page scan returns before accessible names are filled in from Playwright's aria snapshot. */
interface RawField extends Omit<FormField, "accessibleName"> {
  /** Name computed in the page (aria-label, labels, placeholder...), used when the aria snapshot has none. */
  fallbackName: string | null;
  /** Element whose accessible name is the field's name (the control, or the fieldset of a radio group); null to skip. */
  nameSelector: string | null;
}

interface RawControl extends Omit<FormControl, "accessibleName"> {
  fallbackName: string | null;
  /** Role from markup; kept when the aria snapshot has none (e.g. clickable divs). */
  explicitRole: string | null;
}

interface RawForm {
  selector: string;
  name: string | null;
  fields: RawField[];
  controls: RawControl[];
}

/**
 * Runs in the page. Kept as a plain string, not a function: tsx/esbuild's keepNames would wrap nested
 * functions in a `__name` helper that does not exist in the browser.
 */
const SCAN_SCRIPT = String.raw`(() => {
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const str = (s) => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const FIELD_SKIP = new Set(["hidden", "submit", "button", "reset", "image"]);
  const INTERACTIVE = "input, select, textarea, button, a[href], label, option, summary, [role=button], [role=link], [role=checkbox], [role=radio], [role=option], [role=tab], [role=menuitem], [role=switch], [contenteditable=true]";
  const PICKER_ROLES = new Set(["radio", "option", "menuitemradio"]);

  const unique = (sel, el) => {
    try {
      const all = document.querySelectorAll(sel);
      return all.length === 1 && all[0] === el;
    } catch {
      return false;
    }
  };

  /** Short, stable, unique CSS selector: #id, a name/data attribute, else a path anchored at an id. */
  const selectorFor = (el) => {
    if (el.id && unique("#" + CSS.escape(el.id), el)) return "#" + CSS.escape(el.id);
    const tag = el.tagName.toLowerCase();
    for (const attr of ["data-testid", "data-test", "data-cy", "data-qa"]) {
      const v = el.getAttribute(attr);
      if (v && unique("[" + attr + '="' + str(v) + '"]', el)) return "[" + attr + '="' + str(v) + '"]';
    }
    const name = el.getAttribute("name");
    if (name) {
      let sel = tag + '[name="' + str(name) + '"]';
      if (unique(sel, el)) return sel;
      const value = el.getAttribute("value");
      if (value !== null) {
        sel += '[value="' + str(value) + '"]';
        if (unique(sel, el)) return sel;
      }
    }
    const parts = [];
    let cur = el;
    while (cur && cur !== document.documentElement) {
      const parent = cur.parentElement;
      if (cur !== el && cur.id && document.querySelectorAll("#" + CSS.escape(cur.id)).length === 1) {
        parts.unshift("#" + CSS.escape(cur.id));
        break;
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

  const byIds = (ids) =>
    norm((ids || "").split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map((n) => n.textContent).join(" ")) || null;

  const labelText = (el) => {
    const labels = Array.from(el.labels || []).map(ownText).filter(Boolean);
    return labels.length ? labels.join(" ") : null;
  };

  const nameFallback = (el) =>
    byIds(el.getAttribute("aria-labelledby")) || norm(el.getAttribute("aria-label")) || labelText(el) ||
    norm(el.getAttribute("placeholder")) || norm(el.getAttribute("title")) || null;

  const camel = (s) => {
    const words = norm(s).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(" ").filter(Boolean);
    return words.map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1))).join("");
  };

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

  const fieldCount = (scope) => {
    const els = scope.tagName === "FORM" ? Array.from(scope.elements) : Array.from(scope.querySelectorAll("input, select, textarea"));
    const keys = new Set();
    for (const el of els) {
      if (!isField(el) || !usable(el)) continue;
      keys.add(el.type === "radio" && el.name ? "radio:" + el.name : el);
    }
    return keys.size;
  };

  // 1. Choose the form: the <form> with the most usable fields, else the tightest container with fields and a button.
  let scope = null;
  let best = 0;
  for (const form of document.querySelectorAll("form")) {
    const n = fieldCount(form);
    if (n > best) { best = n; scope = form; }
  }
  if (!scope) {
    const counts = new Map();
    for (const el of document.querySelectorAll("input, select, textarea")) {
      if (!isField(el) || !usable(el) || el.closest("form")) continue;
      for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) counts.set(a, (counts.get(a) || 0) + 1);
    }
    let depthBest = -1;
    for (const [el, n] of counts) {
      if (!el.querySelector("button, input[type=submit], [role=button]")) continue;
      let depth = 0;
      for (let a = el; a; a = a.parentElement) depth++;
      if (n > best || (n === best && depth > depthBest)) { best = n; depthBest = depth; scope = el; }
    }
  }
  if (!scope || best === 0) return null;
  const isForm = scope.tagName === "FORM";

  // 2. Form name: aria label, a heading inside, else the nearest heading before it.
  const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6, [role=heading]")).filter((h) => !isHidden(h));
  const inside = headings.find((h) => scope.contains(h));
  const before = headings.filter((h) => !scope.contains(h) && h.compareDocumentPosition(scope) & Node.DOCUMENT_POSITION_FOLLOWING).pop();
  const formName =
    byIds(scope.getAttribute("aria-labelledby")) || norm(scope.getAttribute("aria-label")) ||
    (inside && norm(inside.textContent)) || (before && norm(before.textContent)) || null;

  // 3. Native fields, radio groups collapsed into one field each.
  const elements = isForm ? Array.from(scope.elements) : Array.from(scope.querySelectorAll("input, select, textarea, button"));
  const fields = [];
  const fieldEls = new Map();
  const radioGroups = new Map();
  for (const el of elements) {
    if (!isField(el) || !usable(el)) continue;
    const type = el.tagName === "INPUT" ? el.type : el.tagName.toLowerCase();
    const constraints = {};
    for (const attr of ["min", "max", "pattern"]) if (el.hasAttribute(attr)) constraints[attr] = el.getAttribute(attr);
    if (el.hasAttribute("minlength")) constraints.minLength = el.minLength;
    if (el.hasAttribute("maxlength")) constraints.maxLength = el.maxLength;
    const required = el.required || el.getAttribute("aria-required") === "true";

    if (type === "radio" && el.name) {
      let group = radioGroups.get(el.name);
      if (!group) {
        group = { radios: [], field: null };
        radioGroups.set(el.name, group);
        group.field = { key: el.name, label: null, placeholder: null, type: "radio", role: "radio", required: false, selector: "", options: [], fallbackName: null, nameSelector: null };
        fieldEls.set(group.field, el);
        fields.push(group.field);
      }
      group.radios.push(el);
      group.field.required = group.field.required || required;
      group.field.options.push({ label: nameFallback(el) || el.value, selector: selectorFor(el) });
      continue;
    }
    const options = type === "select"
      ? Array.from(el.options).filter((o) => o.value !== "" && !o.disabled).map((o) => ({ label: norm(o.label || o.textContent), selector: selectorFor(o) }))
      : undefined;
    fields.push({
      key: el.getAttribute("name") || el.id || "",
      label: labelText(el),
      placeholder: el.getAttribute("placeholder"),
      type,
      role: el.getAttribute("role") || implicitRole(el),
      required,
      selector: selectorFor(el),
      ...(options ? { options } : {}),
      ...(Object.keys(constraints).length ? { constraints } : {}),
      ...(norm(el.getAttribute("autocomplete")) ? { autocomplete: norm(el.getAttribute("autocomplete")).toLowerCase() } : {}),
      fallbackName: nameFallback(el),
      nameSelector: null,
    });
    fields[fields.length - 1].nameSelector = fields[fields.length - 1].selector;
    fieldEls.set(fields[fields.length - 1], el);
  }

  // A radio group's container is the fieldset or radiogroup holding all of its radios.
  for (const { radios, field } of radioGroups.values()) {
    const first = radios[0];
    const containers = [first.closest("[role=radiogroup]"), first.closest("fieldset")].filter(Boolean);
    const container = containers.find((c) => radios.every((r) => c.contains(r)));
    if (container) {
      const legend = container.tagName === "FIELDSET" ? container.querySelector(":scope > legend") : null;
      field.label = legend ? ownText(legend) || null : byIds(container.getAttribute("aria-labelledby"));
      field.fallbackName = byIds(container.getAttribute("aria-labelledby")) || norm(container.getAttribute("aria-label")) || field.label;
      field.role = container.getAttribute("role") === "radiogroup" ? "radiogroup" : "radio";
      field.required = field.required || container.getAttribute("aria-required") === "true";
      field.selector = selectorFor(container);
      field.nameSelector = field.selector;
    } else {
      field.selector = selectorFor(first);
    }
  }

  // 4. Custom pickers: two or more sibling clickable non-controls (cursor:pointer, onclick, or an option-like role).
  const clickable = (el) => {
    if (!isRendered(el) || el.matches("input, select, textarea, button, a, label, option, fieldset, legend, form, svg, svg *")) return false;
    if (el.parentElement && el.parentElement.closest("button, a[href], label, select, [role=button], [role=link]")) return false;
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
    if (!label) {
      const heading = Array.from(container.children).find((c) => !opts.includes(c) && !opts.some((o) => c.contains(o)) && ownText(c));
      if (heading) label = ownText(heading);
    }
    for (let node = container, hops = 0; !label && node && node !== scope && hops < 3; node = node.parentElement, hops++) {
      const prev = node.previousElementSibling;
      if (prev && !prev.matches("input, select, textarea, button") && ownText(prev)) label = ownText(prev);
    }
    customIndex++;
    fields.push({
      key: container.getAttribute("name") || container.id || (label && camel(label)) || "custom-" + customIndex,
      label,
      placeholder: null,
      type: "custom",
      role: container.getAttribute("role") || "generic",
      required: container.getAttribute("aria-required") === "true",
      selector: selectorFor(container),
      options: opts.map((o) => ({ label: norm(o.getAttribute("aria-label")) || ownText(o), selector: selectorFor(o) })),
      fallbackName: byIds(container.getAttribute("aria-labelledby")) || norm(container.getAttribute("aria-label")) || null,
      nameSelector: null,
    });
    fieldEls.set(fields[fields.length - 1], container);
  }

  // Report fields in document order (custom pickers were found last).
  fields.sort((a, b) => (fieldEls.get(a).compareDocumentPosition(fieldEls.get(b)) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));

  // Keys must be unique within the form.
  const seen = new Map();
  fields.forEach((f, i) => {
    let key = f.key || f.type + "-" + (i + 1);
    const n = seen.get(key) || 0;
    seen.set(key, n + 1);
    if (n > 0) key = key + "-" + (n + 1);
    f.key = key;
  });

  // 5. Controls: buttons, links and lone clickable elements. The submit control is the form's default button.
  const controlEls = Array.from(scope.querySelectorAll("button, input[type=submit], input[type=button], input[type=reset], input[type=image], [role=button], [role=link], a[href]"))
    .filter((el) => isRendered(el) && !pickerOptions.has(el) && !(el.parentElement && el.parentElement.closest("button, a[href]")));
  for (const el of lone) if (!controlEls.includes(el)) controlEls.push(el);
  controlEls.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));

  const submitType = (el) => (el.tagName === "BUTTON" || el.tagName === "INPUT") && (el.type === "submit" || el.type === "image");
  let submit = controlEls.find(submitType);
  if (!submit && !isForm) {
    const buttons = controlEls.filter((el) => implicitRole(el) === "button" || el.getAttribute("role") === "button");
    submit = buttons.filter((el) => /submit|book|send|sign|register|create|continue|confirm|order|pay|save/i.test(ownText(el) || el.value || "") && !/draft|cancel|clear|reset/i.test(ownText(el))).pop() || buttons.pop();
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

  return { selector: selectorFor(scope), name: formName, fields, controls };
})()`;

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

/**
 * Finds the main form on the loaded page (the <form> with the most fields; falls back to a container
 * with inputs and a submit-like button) and describes it. Fields include native inputs, textareas,
 * selects, radio groups (one field per group, with options) and custom pickers: groups of clickable
 * non-interactive elements (cursor:pointer or click handlers) labelled by nearby text, reported with
 * type "custom" and role as exposed ("generic" for divs). Throws NoFormFoundError if nothing is found.
 *
 * Accessible names and roles come from Playwright's aria snapshot (the same computation getByRole uses);
 * everything else from one DOM scan. Click handlers added with addEventListener are invisible to the
 * page, so custom pickers are recognised by cursor:pointer, an onclick attribute or an option-like role.
 */
export async function discoverForm(page: Page): Promise<DiscoveredForm> {
  const raw = (await page.evaluate(SCAN_SCRIPT)) as RawForm | null;
  if (!raw) throw new NoFormFoundError(page.url());

  const fields: FormField[] = [];
  for (const { fallbackName, nameSelector, ...field } of raw.fields) {
    const aria = nameSelector ? await ariaOf(page, nameSelector) : null;
    // Keep our role for radio groups (the fieldset is a "group") and custom pickers (always "generic" unless set).
    const role = field.type === "radio" || field.type === "custom" ? field.role : (aria?.role ?? field.role);
    fields.push({ ...field, role, accessibleName: aria ? aria.name : fallbackName });
  }

  const controls: FormControl[] = [];
  for (const { fallbackName, explicitRole, ...control } of raw.controls) {
    const aria = await ariaOf(page, control.selector);
    controls.push({
      ...control,
      role: aria?.role ?? explicitRole ?? control.role,
      accessibleName: aria ? aria.name : fallbackName,
    });
  }

  return { url: page.url(), selector: raw.selector, name: raw.name, fields, controls };
}
