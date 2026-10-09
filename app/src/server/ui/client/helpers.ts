import { checkPageUrl } from "../../../core/links.js";
import { CHECK_IDS } from "../../../core/types.js";

const CHECK_PAGES_JSON = JSON.stringify(Object.fromEntries(CHECK_IDS.map((id) => [id, checkPageUrl(id)]))).replace(/</g, "\\u003c");

/**
 * Section of the inline client script: preamble and small helpers.
 * Concatenated in order with the others to form the body of String.raw in client.ts.
 */
export const HELPERS = String.raw`
(() => {
  "use strict";
  const CONFIG = JSON.parse(document.getElementById("rh-config").textContent);
  const ICONS = CONFIG.icons;
  const GROUPS = CONFIG.groups;
  const groupOfCategory = (c) => (GROUPS.find((g) => g.categories.includes(c)) || null);
  const view = document.getElementById("view");
  const announcer = document.getElementById("announcer");
  const sidebar = document.getElementById("sidebar");
  const menuButton = document.getElementById("menu-button");
  const DEFAULTS_KEY = "run-hound.defaults";
  const VISUAL = ["frame", "gif", "card", "screenshot"];
  const KIND_NAMES = { frame: "Annotated screenshot", gif: "Recording", card: "Data card", screenshot: "Screenshot" };
  const STATUS_TEXT = { pass: "Passed", fail: "Failed", error: "Errored", skipped: "Skipped", running: "Running", queued: "Queued" };
  const SEVERITY_TEXT = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
  const STOPPED_NOTE = "Stopped by you";
  // Each check's page on Run Hound's site, by check id (core/links.ts).
  const CHECK_PAGES = ${CHECK_PAGES_JSON};

  // ---------- small helpers ----------

  /**
   * The desktop app (desktop/src/preload.ts marks <html data-shell="desktop"> before any script runs). There, Run Hound
   * runs on this computer with no environment to configure, so copy about servers, browsers and RUNHOUND_* variables
   * is said the desktop's way.
   */
  const onDesktop = document.documentElement.dataset.shell === "desktop";
  /** An engine message as the desktop says it: no RUNHOUND_ALLOWED_HOSTS, which a desktop user can't set. */
  function desktopWording(text) {
    if (!onDesktop || typeof text !== "string") return text;
    return text.replace(/,? ?(?:private addresses )?or hosts listed in RUNHOUND_ALLOWED_HOSTS/g, (m) => (m.includes("private") ? " and private network addresses" : ""));
  }

  function h(tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k.slice(0, 2) === "on" && typeof v === "function") el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, "");
        else el.setAttribute(k, String(v));
      }
    }
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { for (const x of c) append(el, x); return; }
    el.append(c instanceof Node ? c : String(c));
  }
  // Replaces an element's children, skipping null/undefined/false like h() does (the DOM's own replaceChildren would
  // print them as the text "null").
  function fill(el) {
    el.replaceChildren();
    for (let i = 1; i < arguments.length; i++) append(el, arguments[i]);
  }
  function icon(name) {
    const s = document.createElement("span");
    s.className = "ic";
    s.setAttribute("aria-hidden", "true");
    s.innerHTML = ICONS[name] || "";
    return s;
  }
  /** Lucide status icons (CONFIG.icons); the big verdict variants reuse them at 64 px. */
  const RINGS = {
    pass: ICONS.statusPass,
    fail: ICONS.statusFail,
    error: ICONS.statusFail,
    running: ICONS.statusRunning,
    skipped: ICONS.statusSkipped,
    queued: ICONS.statusQueued,
    bigPass: ICONS.statusPass,
    bigSkipped: ICONS.statusSkipped,
    bigFail: ICONS.statusFail,
  };
  /** A status ring; the status is spoken by a visually hidden word (the SVG is decorative). */
  function ring(status, opts) {
    const o = opts || {};
    const s = h("span", { class: "ring st-" + status + (o.cls ? " " + o.cls : "") });
    const art = document.createElement("span");
    art.setAttribute("aria-hidden", "true");
    art.style.display = "contents";
    art.innerHTML = RINGS[o.shape || status] || RINGS.queued;
    s.append(art);
    if (!o.silent) s.append(h("span", { class: "visually-hidden", text: (o.label || STATUS_TEXT[status] || status) + ": " }));
    return s;
  }
  function sevRing(severity) {
    const s = severity === "medium" ? "sev-medium" : severity === "low" ? "sev-low" : "";
    return ring("fail", { cls: s, shape: severity === "low" ? "error" : "fail", label: (SEVERITY_TEXT[severity] || severity) + " severity" });
  }
  const plural = (n, word, many) => n + " " + (n === 1 ? word : many || word + "s");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pad = (n) => String(n).padStart(2, "0");
  /** Same contract as core/format.ts formatDuration: "4.2 s", "42 s", "1 min 12 s", "1 h 3 min". */
  function formatDuration(ms) {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "";
    if (ms < 10000) { const t = Math.floor(ms / 100); return Math.floor(t / 10) + "." + (t % 10) + " s"; }
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return sec + " s";
    if (sec < 3600) return Math.floor(sec / 60) + " min" + (sec % 60 ? " " + (sec % 60) + " s" : "");
    const min = Math.floor((sec % 3600) / 60);
    return Math.floor(sec / 3600) + " h" + (min ? " " + min + " min" : "");
  }
  /** Ticking clock text: mm:ss, or h:mm:ss from an hour. */
  function clockText(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const hh = Math.floor(s / 3600);
    return (hh ? hh + ":" + pad(Math.floor((s % 3600) / 60)) : pad(Math.floor(s / 60))) + ":" + pad(s % 60);
  }
  function hms(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "--:--:--" : pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function dateTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return MONTHS[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear() + " · " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  /** "127.0.0.1:3000/book" from a target URL (the breadcrumb and runs list); the raw text when it isn't a URL. */
  function hostPath(url) {
    try {
      const u = new URL(url);
      return u.host + (u.pathname === "/" ? "" : u.pathname);
    } catch (e) {
      return String(url || "");
    }
  }
  const enc = encodeURIComponent;

  // Test accounts (0.4.0). Plans, reports and runs name an account by its label only, never its username.
  const ACCOUNT_SLOTS = ["a", "b"];
  const defaultAccountLabel = (id) => "Account " + (id === "b" ? "B" : "A");
  /** An AccountRef's name: its label, or "Account A" / "Account B" when it has none. */
  const accountName = (ref) => (ref && typeof ref.label === "string" && ref.label.trim() ? ref.label.trim() : defaultAccountLabel(ref && ref.id));
  /** Who a report ran as, and the other account it used: Report.accounts, else the plan's account; null when signed out (and in 0.3.0 reports). */
  function reportAccountsOf(report) {
    const self = (report.accounts ? report.accounts.signedInAs : report.plan && report.plan.account) || null;
    return { self, other: self && report.accounts ? report.accounts.other || null : null };
  }

  // Every API call carries X-Run-Hound: 1; the server requires it on /api/ai* and /api/accounts* (another site's page
  // can't send it).
  async function api(path, body, method) {
    const init = body === undefined
      ? { cache: "no-store", headers: { "x-run-hound": "1" } }
      : { method: method || "POST", headers: { "content-type": "application/json", "x-run-hound": "1" }, body: JSON.stringify(body) };
    const res = await fetch(path, init);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json.error || "Request failed (" + res.status + ").");
      err.status = res.status;
      throw err;
    }
    return json;
  }

  function announce(text) {
    announcer.textContent = "";
    setTimeout(() => { announcer.textContent = text; }, 60);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = h("textarea", { class: "visually-hidden", "aria-hidden": "true" });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
      ta.remove();
      return ok;
    }
  }
  /** A copy button: text label, or an icon button named by aria-label. */
  function copyButton(label, getText, iconOnly) {
    const text = iconOnly ? null : h("span", { text: label });
    const b = h("button", { type: "button", class: iconOnly ? "icon-btn" : "btn small", "aria-label": iconOnly ? label : null, title: iconOnly ? label : null }, icon("copy"), text);
    b.addEventListener("click", async () => {
      const ok = await copyText(getText());
      if (text) {
        text.textContent = ok ? "Copied" : "Copy failed";
        setTimeout(() => { text.textContent = label; }, 1600);
      } else {
        b.title = ok ? "Copied" : "Copy failed";
        setTimeout(() => { b.title = label; }, 1600);
      }
    });
    return b;
  }

  function loadDefaults() {
    let v = {};
    try { v = JSON.parse(localStorage.getItem(DEFAULTS_KEY) || "{}") || {}; } catch (e) { v = {}; }
    return { allowDestructive: v.allowDestructive === true, headed: v.headed === true && CONFIG.canShowBrowser };
  }
  function saveDefaults(d) {
    try { localStorage.setItem(DEFAULTS_KEY, JSON.stringify(d)); return true; } catch (e) { return false; }
  }

`;
