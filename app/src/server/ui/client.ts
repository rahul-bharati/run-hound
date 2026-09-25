/**
 * The UI's client script (inline in renderUi's document). Plain browser JavaScript kept as a string: it builds DOM with
 * textContent only (report text is never parsed as HTML; innerHTML is used for the static icon SVGs alone), routes by
 * URL hash and talks to the JSON API. Written without template literals so it can live in this String.raw block.
 */
export const CLIENT = String.raw`
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

  // ---------- small helpers ----------

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

  async function api(path, body) {
    const init = body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
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

  // ---------- routing ----------

  let gen = 0;
  let firstRender = true;

  function parseRoute() {
    const hash = location.hash;
    let m = /^#run=([\w-]+)$/.exec(hash);
    if (m) {
      history.replaceState(null, "", "#/runs/" + m[1]);
      return { name: "run", id: m[1], nav: "#/runs" };
    }
    if (hash === "" || hash === "#" || hash === "#/") return { name: "new", nav: "#/new" };
    m = /^#\/new(?:\?(.*))?$/.exec(hash);
    if (m) {
      const q = new URLSearchParams(m[1] || "");
      const from = q.get("from");
      return { name: "new", nav: "#/new", from: from && /^[\w-]+$/.test(from) ? from : null };
    }
    if (hash === "#/runs") return { name: "runs", nav: "#/runs" };
    m = /^#\/runs\/([\w-]+)$/.exec(hash);
    if (m) return { name: "run", id: m[1], nav: "#/runs" };
    if (hash === "#/settings") return { name: "settings", nav: "#/settings" };
    history.replaceState(null, "", "#/new");
    return { name: "new", nav: "#/new" };
  }

  function setNav(href) {
    for (const a of document.querySelectorAll("#main-nav a")) {
      if (a.getAttribute("href") === href) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
  }
  function setMenu(open) {
    sidebar.classList.toggle("open", open);
    menuButton.setAttribute("aria-expanded", String(open));
  }
  menuButton.addEventListener("click", () => setMenu(menuButton.getAttribute("aria-expanded") !== "true"));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menuButton.getAttribute("aria-expanded") === "true") {
      setMenu(false);
      menuButton.focus();
    }
  });
  document.addEventListener("click", (e) => {
    if (menuButton.getAttribute("aria-expanded") === "true" && !sidebar.contains(e.target)) setMenu(false);
    for (const d of document.querySelectorAll("details.download[open]")) if (!d.contains(e.target)) d.open = false;
  });

  function setTitle(t) { document.title = t ? t + " · Run Hound" : "Run Hound"; }

  /** After navigating (not on first load), move focus to the new view's heading so keyboard and screen reader users land there. */
  function focusHeading(my, initial) {
    if (initial || my !== gen) return;
    const h1 = view.querySelector("h1");
    if (!h1) return;
    h1.setAttribute("tabindex", "-1");
    h1.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  function render() {
    const r = parseRoute();
    const my = ++gen;
    const initial = firstRender;
    firstRender = false;
    setNav(r.nav);
    setMenu(false);
    view.replaceChildren();
    if (r.name === "new") viewNew(r, my, initial);
    else if (r.name === "runs") viewRuns(my, initial);
    else if (r.name === "run") viewRun(r.id, my, initial);
    else if (r.name === "settings") viewSettings(my, initial);
  }

  // ---------- New Run ----------

  /** Kept across views, so going to Runs and back keeps the plan you were looking at. */
  const newState = { url: "", resp: null, selected: null, options: null };

  function viewNew(r, my, initial) {
    setTitle("New run");
    view.append(document.getElementById("tpl-new").content.cloneNode(true));
    const $ = (id) => document.getElementById(id);
    const input = $("target-url");
    const planButton = $("plan-button");
    const targetError = $("target-error");
    const planSection = $("plan-section");
    const runButton = $("run-button");
    const planError = $("plan-error");
    const destructive = $("allow-destructive");
    const headed = $("headed");
    focusHeading(my, initial);

    function setStep(n) {
      for (const li of $("stepper").querySelectorAll("li")) {
        const k = Number(li.dataset.step);
        li.classList.toggle("done", k < n);
        if (k === n) li.setAttribute("aria-current", "step");
        else li.removeAttribute("aria-current");
      }
    }

    const scenarioInputs = () => [...$("scenarios").querySelectorAll('input[name="scenario"]')];
    function updateStart() {
      const n = scenarioInputs().filter((i) => i.checked).length;
      runButton.textContent = "Start run (" + plural(n, "scenario") + ")";
      newState.selected = scenarioInputs().filter((i) => i.checked).map((i) => i.value);
      newState.options = { allowDestructive: destructive.checked, headed: headed.checked };
    }

    function showError(message) {
      input.setAttribute("aria-invalid", "true");
      targetError.textContent = message;
    }
    function clearError() {
      input.removeAttribute("aria-invalid");
      targetError.textContent = "";
    }

    async function plan(url, preselect) {
      clearError();
      newState.url = url;
      if (!url) {
        showError("Enter the URL of the page with your form.");
        input.focus();
        return;
      }
      planButton.disabled = true;
      planButton.classList.add("busy");
      planButton.textContent = "Opening the page…";
      try {
        const resp = await api("/api/plan", { url });
        if (my !== gen) return;
        newState.resp = resp;
        showPlan(resp, preselect || null, null, true);
      } catch (err) {
        if (my !== gen) return;
        // A failed plan must not leave the previous target's plan on screen, ready to run.
        newState.resp = null;
        planSection.hidden = true;
        setStep(1);
        showError(err.message);
        input.focus();
      } finally {
        if (my === gen) {
          planButton.disabled = false;
          planButton.classList.remove("busy");
          planButton.textContent = "Plan checks";
        }
      }
    }

    function showPlan(resp, selected, options, focus) {
      const p = resp.plan;
      const summary = $("plan-summary");
      // V1 plans describe the whole page; V0 plans only their one form.
      const forms = p.page ? p.page.forms : (p.form ? [p.form] : []);
      const outside = p.page ? p.page.controls.length : 0;
      const formLabel = (f, i) => {
        const name = f.name ? f.name.replace(/\s+/g, " ").trim() : "";
        return name ? (/\bform$/i.test(name) ? name : name + " form") : "Form " + (i + 1);
      };
      summary.replaceChildren(
        forms.length === 1 && forms[0].name ? h("span", {}, "Found ", h("b", { text: "“" + forms[0].name + "”" })) : h("span", {}, "Found ", h("b", { text: forms.length ? plural(forms.length, "form") : "no form" })),
        " · " + plural(p.scenarios.length, "scenario"));
      const inv = $("page-inventory");
      const chips = forms.map((f, i) => h("li", { class: "inv" }, h("span", { class: "inv-name", text: formLabel(f, i) }), h("span", { class: "inv-meta", text: plural(f.fields.length, "field") + (f.controls.length ? " · " + plural(f.controls.length, "button") : "") })));
      if (p.page) {
        chips.push(h("li", { class: "inv" + (outside ? "" : " quiet") }, h("span", { class: "inv-name", text: "Outside the forms" }), h("span", { class: "inv-meta", text: plural(outside, "control") + (p.page.links ? " · " + plural(p.page.links, "link") : "") })));
        chips.push(h("li", { class: "inv" }, h("span", { class: "inv-name", text: "Whole page" }), h("span", { class: "inv-meta", text: "headers, cookies, CORS, scripts, layout" })));
      }
      inv.replaceChildren(...chips);
      inv.hidden = chips.length === 0;
      const multi = forms.length > 1;
      const V1 = new Set(CONFIG.v1Checks || []);
      const warn = $("plan-warnings");
      warn.replaceChildren(...(resp.warnings || []).map((w) => h("p", { text: w })));
      warn.hidden = !(resp.warnings && resp.warnings.length);

      const chosen = selected ? new Set(selected) : null;
      const byId = new Map(p.scenarios.map((s) => [s.id, s]));
      const groups = p.groups && p.groups.length ? p.groups : [{ id: "all", label: "Scenarios", scenarioIds: p.scenarios.map((s) => s.id) }];
      const box = $("scenarios");
      box.replaceChildren();
      let n = 0;
      for (const g of groups) {
        const list = g.scenarioIds.map((id) => byId.get(id)).filter(Boolean);
        if (list.length === 0) continue;
        const headingId = "grp-h-" + g.id;
        const all = h("input", { type: "checkbox", id: "grp-all-" + g.id, "aria-label": "Select all " + g.label });
        const rows = h("ul", { class: "scenario-rows" });
        const inputs = [];
        for (const s of list) {
          const id = "sc-" + (n++);
          const cb = h("input", { type: "checkbox", id, name: "scenario", value: s.id });
          cb.checked = chosen ? chosen.has(s.id) : s.defaultSelected;
          const tags = [h("span", { class: "tag" + (s.kind === "danger" ? " danger" : ""), text: s.kind })];
          if (s.destructive) tags.push(h("span", { class: "tag danger", text: "destructive" }));
          if (s.scope === "page") tags.push(h("span", { class: "tag scope", text: "Whole page" }));
          else if (multi && s.scopeLabel) tags.push(h("span", { class: "tag scope", text: s.scopeLabel }));
          if (V1.has(s.checkId)) tags.push(h("span", { class: "tag new", text: "New in V1" }));
          rows.append(h("li", { class: "scenario-row" }, cb, h("label", { for: id }, h("span", { class: "title", text: s.title }), tags, h("span", { class: "desc", text: s.description }))));
          inputs.push(cb);
        }
        const sync = () => {
          const on = inputs.filter((i) => i.checked).length;
          all.checked = on === inputs.length;
          all.indeterminate = on > 0 && on < inputs.length;
        };
        all.addEventListener("change", () => {
          for (const i of inputs) i.checked = all.checked;
          sync();
        });
        for (const i of inputs) i.addEventListener("change", sync);
        sync();
        const group = h("div", { class: "group", role: "group", "aria-labelledby": headingId },
          h("div", { class: "group-head" },
            h("h3", { id: headingId }, g.label, " ", h("span", { class: "count", text: String(list.length) })),
            h("label", { class: "check-label" }, all, h("span", { text: "Select all" }))),
          rows);
        box.append(group);
      }
      const opts = options || loadDefaults();
      destructive.checked = opts.allowDestructive === true;
      headed.checked = opts.headed === true && !headed.disabled;
      planError.textContent = "";
      planSection.hidden = false;
      setStep(2);
      updateStart();
      if (focus) $("plan-h").focus();
    }

    $("target-form").addEventListener("submit", (e) => {
      e.preventDefault();
      plan(input.value.trim());
    });
    input.addEventListener("input", () => { newState.url = input.value; });
    $("plan-form").addEventListener("change", updateStart);
    $("plan-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const approved = scenarioInputs().filter((i) => i.checked).map((i) => i.value);
      planError.textContent = "";
      if (!newState.resp) { planError.textContent = "Plan the checks for a page first."; return; }
      if (approved.length === 0) { planError.textContent = "Select at least one scenario to run."; return; }
      runButton.disabled = true;
      runButton.textContent = "Starting…";
      try {
        const { runId } = await api("/api/runs", { planId: newState.resp.planId, approved, allowDestructive: destructive.checked, headed: headed.checked });
        location.hash = "#/runs/" + runId;
      } catch (err) {
        if (my !== gen) return;
        runButton.disabled = false;
        updateStart();
        planError.textContent = err.status === 404 ? "This plan is no longer on the server. Plan the checks again." : err.message;
      }
    });

    if (r.from) {
      fromRun(r.from);
    } else {
      input.value = newState.url;
      if (newState.resp) showPlan(newState.resp, newState.selected, newState.options, false);
      else setStep(1);
    }

    /** "Back to test plan": plans the run's target again with the scenarios that run approved. */
    async function fromRun(runId) {
      setStep(1);
      try {
        const [list, st, live] = await Promise.all([api("/api/runs"), api("/api/runs/" + enc(runId)), api("/api/runs/" + enc(runId) + "/live")]);
        if (my !== gen) return;
        const entry = (list.runs || []).find((x) => x.runId === runId);
        const url = entry ? entry.target : "";
        const ids = st.report && st.report.approved ? st.report.approved : (live.scenarios || []).map((s) => s.id);
        input.value = url;
        plan(url, ids.length ? ids : null);
      } catch (err) {
        if (my !== gen) return;
        showError("Could not load that run's plan: " + err.message);
      }
    }
  }

  // ---------- Runs ----------

  function runRing(run) {
    if (run.status === "running") return ring("running");
    if (run.status === "error") return ring("error", { label: "Failed" });
    const s = run.summary;
    if (s && s.failed + s.errored > 0) return ring("fail", { label: "Issues found" });
    // Everything skipped (e.g. stopped at once): nothing was checked, so no pass mark.
    if (s && s.passed === 0) return ring("skipped", { label: "Nothing checked" });
    return ring("pass");
  }

  async function viewRuns(my, initial) {
    setTitle("Runs");
    const list = h("ul", { id: "runs-list", class: "card", "aria-label": "Runs, newest first" }, h("li", { class: "loading", text: "Loading runs…" }));
    view.append(h("div", { class: "page" },
      h("header", { class: "page-head" }, h("h1", { text: "Runs" }), h("p", { text: "Every run on this machine, newest first. Finished runs are read back from the runs folder, so the list survives a restart." })),
      list));
    focusHeading(my, initial);
    for (;;) {
      let data;
      try {
        data = await api("/api/runs");
      } catch (err) {
        if (my !== gen) return;
        list.replaceChildren(h("li", { class: "empty-state", text: "Could not load the runs: " + err.message }));
        return;
      }
      if (my !== gen) return;
      const runs = data.runs || [];
      if (runs.length === 0) {
        list.replaceChildren(h("li", { class: "empty-state" }, h("p", { text: "No runs yet." }), h("a", { class: "btn primary", href: "#/new" }, icon("play"), "Start a new run")));
      } else {
        list.replaceChildren(...runs.map(runRow));
      }
      if (!runs.some((x) => x.status === "running")) return;
      await sleep(2000);
      if (my !== gen) return;
    }
  }

  function runRow(run) {
    const counts = h("span", { class: "counts" });
    if (run.status === "running") {
      counts.append("Running · " + run.completed + " / " + run.total);
    } else if (run.status === "error") {
      counts.append(h("span", { class: "bad", text: "Run failed" }));
    } else if (run.summary) {
      const s = run.summary;
      const bits = [s.passed + " passed"];
      if (s.failed) bits.push(s.failed + " with issues");
      if (s.errored) bits.push(s.errored + " errored");
      if (s.skipped) bits.push(s.skipped + " skipped");
      bits.forEach((b, i) => {
        if (i) counts.append(" · ");
        counts.append(/issues|errored/.test(b) ? h("span", { class: "bad", text: b }) : b);
      });
    }
    if (run.status !== "running" && typeof run.durationMs === "number") counts.append(h("span", { class: "dur", text: formatDuration(run.durationMs) }));
    return h("li", {}, h("a", { class: "run-row", href: "#/runs/" + run.runId },
      runRing(run),
      h("span", { class: "what" }, h("span", { class: "target", text: hostPath(run.target) }), h("span", { class: "form", text: run.formName ? run.formName : "Page without a form name" })),
      h("time", { class: "when", datetime: run.startedAt, text: dateTime(run.startedAt) }),
      counts,
      icon("chevronRight")));
  }

  // ---------- Settings ----------

  function viewSettings(my, initial) {
    setTitle("Settings");
    const d = loadDefaults();
    const destructive = h("input", { type: "checkbox", id: "default-destructive" });
    destructive.checked = d.allowDestructive;
    const headed = h("input", { type: "checkbox", id: "default-headed", disabled: !CONFIG.canShowBrowser });
    headed.checked = d.headed;
    const saved = h("p", { class: "saved", text: "Saved in this browser only. Each plan starts with these, and you can still change them per run." });
    const save = () => {
      const ok = saveDefaults({ allowDestructive: destructive.checked, headed: headed.checked });
      saved.textContent = ok ? "Saved in this browser at " + hms(new Date().toISOString()) + "." : "This browser would not let Run Hound save settings (storage is blocked).";
    };
    destructive.addEventListener("change", save);
    headed.addEventListener("change", save);
    const info = h("dl", { class: "settings-list" },
      h("dt", { text: "Version" }), h("dd", {}, h("code", { text: CONFIG.version })),
      h("dt", { text: "Runs folder" }), h("dd", { class: "loading-cell", text: "Loading…" }));
    const help = h("ul", { class: "links" },
      h("li", {}, h("a", { class: "btn", href: "https://github.com/rahul-bharati/run-hound/blob/main/TESTING.md", target: "_blank", rel: "noopener" }, icon("file"), "TESTING.md", h("span", { class: "visually-hidden", text: " (opens in a new tab)" }))),
      h("li", {}, h("a", { class: "btn", href: "https://github.com/rahul-bharati/run-hound/issues/new/choose", target: "_blank", rel: "noopener" }, icon("external"), "Feedback form", h("span", { class: "visually-hidden", text: " (opens in a new tab)" }))));
    view.append(h("div", { class: "page" },
      h("header", { class: "page-head" }, h("h1", { text: "Settings" }), h("p", { text: "Defaults for new runs, and how this Run Hound server is set up." })),
      h("section", { class: "card", "aria-labelledby": "defaults-h" },
        h("h2", { id: "defaults-h", class: "card-title" }, "Defaults"),
        h("div", { class: "options", style: "border-top:0;padding-top:0;margin-top:0" },
          h("div", { class: "option" }, destructive, h("label", { for: "default-destructive" }, "Allow destructive scenarios", h("span", { class: "desc", text: "They may change or delete data beyond creating test records. Leave off unless this is a throwaway environment." }))),
          h("div", { class: "option" }, headed, h("label", { for: "default-headed" }, "Show the browser window", h("span", { class: "desc", text: CONFIG.headedDesc })))),
        saved),
      h("section", { class: "card", "aria-labelledby": "server-h" },
        h("h2", { id: "server-h", class: "card-title" }, "This server"),
        info),
      h("section", { class: "card", "aria-labelledby": "help-h" },
        h("h2", { id: "help-h", class: "card-title" }, "Help and feedback"),
        help)));
    focusHeading(my, initial);
    api("/api/settings").then((s) => {
      if (my !== gen) return;
      const list = (xs, none) => (xs && xs.length ? h("ul", { class: "plain-list" }, ...xs.map((x) => h("li", {}, h("code", { class: "mono", text: x })))) : h("span", { class: "dim", text: none }));
      info.replaceChildren(
        h("dt", { text: "Version" }), h("dd", {}, h("code", { text: s.version })),
        h("dt", { text: "Runs folder" }), h("dd", {}, h("code", { text: s.runsDir })),
        h("dt", { text: "Allowed extra hosts" }), h("dd", {}, list(s.allowedHosts, "None. Only localhost and private network addresses (set RUNHOUND_ALLOWED_HOSTS to add hosts you own).")),
        h("dt", { text: "Accepted server host names" }), h("dd", {}, list(s.serverHosts, "Loopback names and IP addresses only (set RUNHOUND_SERVER_HOSTS to add names).")));
    }).catch((err) => {
      if (my !== gen) return;
      info.append(h("dt", { text: "Server settings" }), h("dd", { class: "error", text: "Could not load them: " + err.message }));
    });
  }

  // ---------- A run: running view, then its report ----------

  async function viewRun(id, my, initial) {
    setTitle("Run " + id);
    view.append(h("p", { class: "loading", text: "Loading run " + id + "…" }));
    let st, list;
    try {
      [st, list] = await Promise.all([api("/api/runs/" + enc(id)), api("/api/runs").catch(() => null)]);
    } catch (err) {
      if (my !== gen) return;
      view.replaceChildren(h("div", { class: "page" },
        h("header", { class: "page-head" }, h("h1", { text: err.status === 404 ? "Run not found" : "Could not load this run" }),
          h("p", { text: err.status === 404 ? "There is no run " + id + " on this machine. It may have been deleted from the runs folder." : err.message })),
        h("a", { class: "btn", href: "#/runs" }, icon("list"), "All runs")));
      focusHeading(my, initial);
      return;
    }
    if (my !== gen) return;
    const meta = list && list.runs ? list.runs.find((x) => x.runId === id) : null;
    if (st.status === "running") runLive(id, st, meta, my, initial);
    else showReport(id, st, my, initial, false);
  }

  function runLive(id, st, meta, my, initial) {
    setTitle("Running tests…");
    const base = "/api/runs/" + enc(id);
    const ui = buildRunning(id, meta);
    view.replaceChildren(ui.root);
    focusHeading(my, initial);

    // Elapsed time: each poll gives the server's elapsedMs; in between it counts on locally, once a second.
    const clock = { base: 0, at: performance.now(), timer: null };
    const tick = () => {
      if (my !== gen) { clearInterval(clock.timer); return; }
      ui.elapsed.textContent = clockText(clock.base + (performance.now() - clock.at));
    };
    const runClock = (ms) => {
      clock.base = ms;
      clock.at = performance.now();
      if (clock.timer === null) { tick(); clock.timer = setInterval(tick, 1000); }
    };

    ui.stop.addEventListener("click", async () => {
      ui.stop.disabled = true;
      ui.stopLabel.textContent = "Stopping…";
      ui.stopError.textContent = "";
      try {
        await api(base + "/stop", {});
      } catch (err) {
        if (err.status === 409 && /already/.test(err.message)) return;
        ui.stop.disabled = false;
        ui.stopLabel.textContent = "Stop run";
        ui.stopError.textContent = err.message;
      }
    });

    (async () => {
      let failures = 0;
      for (;;) {
        let live;
        try {
          [st, live] = await Promise.all([api(base), api(base + "/live")]);
          failures = 0;
        } catch (err) {
          if (my !== gen) return;
          failures++;
          ui.stopError.textContent = "Lost contact with Run Hound (" + err.message + "). Retrying…";
          await sleep(Math.min(5000, 1000 * failures));
          continue;
        }
        if (my !== gen) return;
        if (!failures && /^Lost contact/.test(ui.stopError.textContent)) ui.stopError.textContent = "";
        if (st.status === "running" && typeof live.elapsedMs === "number") runClock(live.elapsedMs);
        updateRunning(ui, st, live);
        if (st.status !== "running") break;
        await sleep(500);
        if (my !== gen) return;
      }
      clearInterval(clock.timer);
      if (my !== gen) return;
      const focusWasInView = document.activeElement === document.body || view.contains(document.activeElement);
      showReport(id, st, my, true, true, focusWasInView);
    })();
  }

  function buildRunning(id, meta) {
    const ui = { id, rows: new Map(), frameSeq: 0, shownSeq: 0, lastFrameAt: 0, expanded: new Set(), collapsed: new Set(), lastScenario: null, lastGroup: null, activityKey: "", subKeys: new Map(), target: meta ? meta.target : "" };
    ui.counter = h("span", { id: "counter", text: meta ? meta.completed + " / " + meta.total : "0 / 0" });
    ui.barFill = h("span");
    ui.bar = h("div", { class: "bar", role: "progressbar", "aria-label": "Scenarios finished", "aria-valuemin": "0", "aria-valuemax": String(meta ? meta.total : 1), "aria-valuenow": "0" }, ui.barFill);
    ui.elapsed = h("time", { id: "elapsed", text: "00:00" });
    ui.browser = h("span", { class: "value", id: "browser-name", text: "Starting…" });
    ui.list = h("ol", { id: "scenario-list", "aria-label": "Scenarios in run order" });
    ui.stopLabel = h("span", { text: "Stop run" });
    ui.stop = h("button", { type: "button", class: "btn danger", id: "stop-run" }, icon("stop"), ui.stopLabel);
    ui.stopError = h("p", { class: "error" });
    ui.address = h("span", { id: "address", text: ui.target || "Waiting for the browser…" });
    ui.badge = h("span", { class: "badge", id: "live-badge", text: "Starting" });
    ui.frame = h("img", { id: "frame", alt: "Live view of the page under test", hidden: true });
    ui.placeholder = h("p", { class: "placeholder", text: "Starting the browser…" });
    ui.log = h("ol", { class: "log" });
    ui.logScroll = h("div", { class: "log-scroll", tabindex: "0", role: "region", "aria-label": "Steps so far, latest last" }, ui.log);
    ui.stepCount = h("span", { class: "badge", id: "step-count", text: "0 steps" });

    const left = h("div", { class: "run-col" },
      h("a", { class: "back", href: "#/new?from=" + id }, icon("back"), "Back to test plan"),
      h("div", { class: "run-title" }, h("h1", { text: "Running tests…" }), h("p", {}, h("span", { class: "visually-hidden", text: "Scenario " }), ui.counter)),
      h("div", { class: "run-sub" },
        h("p", { class: "form", text: meta && meta.formName ? "Testing “" + meta.formName + "”" : "Testing this page" }),
        h("p", { class: "target", text: ui.target })),
      ui.bar,
      h("div", { class: "stats" },
        h("div", { class: "stat", id: "elapsed-card" }, icon("clock"), h("div", {}, h("span", { class: "label", text: "Elapsed time" }), ui.elapsed)),
        h("div", { class: "stat", id: "browser-card" }, icon("globe"), h("div", {}, h("span", { class: "label", text: "Browser" }), ui.browser))),
      ui.list,
      ui.stop,
      ui.stopError);
    const right = h("div", { class: "run-col" },
      h("section", { class: "card preview", id: "browser-preview", "aria-labelledby": "preview-h" },
        h("div", { class: "preview-head" }, icon("globe"), h("h2", { id: "preview-h", text: "Browser preview" }), ui.badge),
        h("div", { class: "addressbar" }, icon("reload"), h("span", { class: "visually-hidden", text: "Current page: " }), ui.address),
        h("div", { class: "viewport" }, ui.frame, ui.placeholder)),
      h("section", { class: "card activity", id: "activity", "aria-labelledby": "activity-h" },
        h("div", { class: "activity-head" }, icon("activity"), h("h2", { id: "activity-h", text: "Live activity" }), ui.stepCount),
        ui.logScroll));
    ui.root = h("div", { class: "run-grid", id: "running" }, left, right);
    return ui;
  }

  function buildRows(ui, scenarios) {
    const groups = [];
    for (const s of scenarios) {
      const label = s.groupLabel || "Scenarios";
      let g = groups.find((x) => x.label === label);
      if (!g) groups.push((g = { label, items: [] }));
      g.items.push(s);
    }
    let n = 0;
    ui.groupCounts = [];
    for (const g of groups) {
      const rows = h("ol", { class: "rows", start: String(n + 1) });
      const count = h("span", { text: "0 of " + g.items.length });
      ui.groupCounts.push({ el: count, ids: g.items.map((s) => s.id) });
      for (const s of g.items) {
        n++;
        const ringSlot = h("span", { class: "ring-slot", style: "display:contents" }, ring("queued"));
        const dur = h("span", { class: "d", text: "—" });
        const sub = h("div", { class: "substeps", id: "steps-" + n, hidden: true });
        const toggle = h("button", { type: "button", class: "toggle", "aria-expanded": "false", "aria-controls": "steps-" + n, "aria-label": "Steps of “" + s.title + "”" }, icon("chevronDown"));
        const li = h("li", { class: "srow", "data-scenario-id": s.id, "data-status": "queued" },
          h("div", { class: "srow-main" }, h("span", { class: "n", text: String(n) }), ringSlot, h("span", { class: "t", text: s.title }), dur, toggle),
          sub);
        toggle.addEventListener("click", () => {
          const open = toggle.getAttribute("aria-expanded") !== "true";
          if (open) { ui.expanded.add(s.id); ui.collapsed.delete(s.id); } else { ui.expanded.delete(s.id); ui.collapsed.add(s.id); }
          setExpanded(ui.rows.get(s.id), open);
        });
        ui.rows.set(s.id, { li, ringSlot, dur, sub, toggle, status: "queued", title: s.title, n, group: s.groupLabel });
        rows.append(li);
      }
      ui.list.append(h("li", { class: "grp" }, h("h2", { class: "grp-h" }, g.label, " ", count), rows));
    }
  }

  function setExpanded(row, open) {
    row.toggle.setAttribute("aria-expanded", String(open));
    row.sub.hidden = !open;
  }

  function stepDuration(steps, i, running, now) {
    const at = Date.parse(steps[i].at);
    if (i + 1 < steps.length) return formatDuration(Math.max(0, Date.parse(steps[i + 1].at) - at));
    return running ? formatDuration(Math.max(0, now - at)) : "";
  }

  function updateRunning(ui, st, live) {
    const scenarios = live.scenarios || [];
    if (ui.rows.size === 0 && scenarios.length) buildRows(ui, scenarios);
    const total = st.total || scenarios.length;
    const running = st.status === "running";
    const finished = new Map((live.finished || []).map((f) => [f.scenarioId, f]));
    const current = running && live.scenarioId && !finished.has(live.scenarioId) ? live.scenarioId : null;
    const now = Date.now();

    ui.counter.textContent = (live.scenarioIndex || st.completed) + " / " + total;
    ui.barFill.style.width = (total ? (100 * st.completed) / total : 0) + "%";
    ui.bar.setAttribute("aria-valuemax", String(total));
    ui.bar.setAttribute("aria-valuenow", String(st.completed));
    ui.bar.setAttribute("aria-valuetext", st.completed + " of " + total + " scenarios finished");
    // "Chromium 153.0" on the card (as in the spec), the full build in the tooltip.
    if (live.browser) {
      ui.browser.textContent = live.browser.replace(/^(\S+ \d+\.\d+)[\d.]*$/, "$1");
      ui.browser.title = live.browser;
    } else ui.browser.textContent = running ? "Starting…" : "Not recorded";
    const url = live.url || ui.target;
    if (url && ui.address.textContent !== url) { ui.address.textContent = url; ui.address.title = url; }

    // Frames: only reload live.jpg when the server has a new one, and swap it in once it has loaded.
    if (live.frameSeq && live.frameSeq !== ui.frameSeq) {
      ui.frameSeq = live.frameSeq;
      const seq = live.frameSeq;
      const img = new Image();
      img.onload = () => {
        if (seq < ui.shownSeq) return;
        ui.shownSeq = seq;
        ui.frame.src = img.src;
        ui.frame.alt = "Live view of the page under test" + (live.url ? ", showing " + live.url : "");
        ui.frame.hidden = false;
        ui.placeholder.hidden = true;
        ui.lastFrameAt = Date.now();
      };
      img.src = "/api/runs/" + enc(ui.id) + "/live.jpg?frame=" + seq;
    }
    const liveNow = running && ui.lastFrameAt && now - ui.lastFrameAt < 4000;
    ui.badge.textContent = liveNow ? "Live" : running ? (ui.lastFrameAt ? "Idle" : "Starting") : "Ended";
    ui.badge.classList.toggle("on", Boolean(liveNow));
    if (!running && !ui.lastFrameAt) ui.placeholder.textContent = "No frames were captured.";

    // Steps by scenario.
    const steps = live.steps || [];
    const byScenario = new Map();
    for (const s of steps) {
      if (!s.scenarioId) continue;
      if (!byScenario.has(s.scenarioId)) byScenario.set(s.scenarioId, []);
      byScenario.get(s.scenarioId).push(s);
    }

    for (const [sid, row] of ui.rows) {
      const f = finished.get(sid);
      const status = f ? f.status : sid === current ? "running" : "queued";
      if (status !== row.status) {
        row.status = status;
        row.li.setAttribute("data-status", status);
        row.ringSlot.replaceChildren(ring(status));
      }
      const own = byScenario.get(sid) || [];
      if (f) row.dur.textContent = formatDuration(f.durationMs);
      else if (status === "running") row.dur.textContent = own.length ? formatDuration(Math.max(0, now - Date.parse(own[0].at))) : "…";
      else row.dur.textContent = "—";
      const open = status === "running" ? !ui.collapsed.has(sid) : ui.expanded.has(sid);
      setExpanded(row, open);
      // Hidden but still taking its place, so every row's duration lines up (as in mockup 1).
      row.toggle.style.visibility = own.length === 0 && status !== "running" ? "hidden" : "";
      const key = own.length + "|" + (own.length ? own[own.length - 1].at : "") + "|" + status;
      if (ui.subKeys.get(sid) !== key) {
        ui.subKeys.set(sid, key);
        renderSubsteps(row, own, status === "running", f);
      }
    }
    if (ui.groupCounts) for (const g of ui.groupCounts) g.el.textContent = g.ids.filter((x) => finished.has(x)).length + " of " + g.ids.length;

    // Polite announcements: a new group or scenario, nothing else while running.
    if (current && current !== ui.lastScenario) {
      ui.lastScenario = current;
      const row = ui.rows.get(current);
      const group = live.groupLabel || (row && row.group) || null;
      const groupChanged = group && group !== ui.lastGroup;
      ui.lastGroup = group || ui.lastGroup;
      announce((groupChanged ? group + ". " : "") + "Scenario " + (live.scenarioIndex || (row ? row.n : "")) + " of " + total + ": " + (live.scenarioTitle || (row ? row.title : current)));
    }

    renderActivity(ui, steps, running && current !== null, now, current);
  }

  function renderSubsteps(row, own, running, finished) {
    if (own.length === 0) {
      row.sub.replaceChildren(h("p", { class: "empty", text: running ? "Starting this scenario…" : finished && finished.status === "skipped" ? "Skipped before it took any steps." : "No steps recorded." }));
      return;
    }
    const list = h("ol", {});
    own.forEach((s, i) => {
      const isCurrent = running && i === own.length - 1;
      list.append(h("li", { class: isCurrent ? "current" : "" }, ring(isCurrent ? "running" : "pass", { silent: true }), h("span", { text: s.label })));
    });
    row.sub.replaceChildren(list);
    if (running) list.scrollTop = list.scrollHeight;
  }

  /** "running": a scenario is in progress. Only its latest step is current; a finished scenario's last step is done. */
  function renderActivity(ui, steps, running, now, current) {
    const last = steps[steps.length - 1];
    if (running && last && last.scenarioId !== current) running = false;
    const key = steps.length + "|" + (last ? last.at + last.label : "") + "|" + running;
    ui.stepCount.textContent = (steps.length >= 100 ? "Last " : "") + plural(steps.length, "step");
    if (key === ui.activityKey) {
      // Only the current step's running time changes.
      const cur = ui.log.lastElementChild;
      if (cur && running && steps.length) {
        const d = cur.querySelector(".dur");
        if (d) d.textContent = stepDuration(steps, steps.length - 1, running, now);
      }
      return;
    }
    ui.activityKey = key;
    const box = ui.logScroll;
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 32;
    if (steps.length === 0) {
      ui.log.replaceChildren(h("li", {}, h("span", { class: "empty", text: "Waiting for the first step…" })));
      return;
    }
    ui.log.replaceChildren(...steps.map((s, i) => {
      const isCurrent = running && i === steps.length - 1;
      return h("li", { class: isCurrent ? "current" : "" },
        h("time", { datetime: s.at, text: hms(s.at) }),
        ring(isCurrent ? "running" : "pass", { silent: true }),
        h("span", { class: "lbl", text: s.label }),
        h("span", { class: "dur", text: stepDuration(steps, i, running, now) }));
    }));
    if (atBottom) box.scrollTop = box.scrollHeight;
  }

  // ---------- Report ----------

  const isIssue = (r) => r.status === "fail" || r.status === "error" || (r.status === "pass" && r.findings && r.findings.length > 0);
  const visualEvidence = (f) => (f.evidence || []).filter((e) => e.path && VISUAL.includes(e.kind));
  /** A scenario skipped before it did anything has no running time worth showing. */
  const resultDuration = (r) => (r.status === "skipped" && !(r.durationMs >= 100) ? "—" : formatDuration(r.durationMs));
  const displayStatus = (r) => (r.status === "pass" && r.findings && r.findings.length ? "fail" : r.status);

  function orderedResults(report) {
    const byId = new Map(report.results.map((r) => [r.scenarioId, r]));
    const scen = new Map(((report.plan && report.plan.scenarios) || []).map((s) => [s.id, s]));
    const out = [];
    const seen = new Set();
    for (const g of report.groups || []) {
      for (const id of g.scenarioIds) {
        const r = byId.get(id);
        if (!r || seen.has(id)) continue;
        seen.add(id);
        out.push({ result: r, scenario: scen.get(id) || { id, title: id, description: "" }, group: g.label });
      }
    }
    for (const r of report.results) {
      if (seen.has(r.scenarioId)) continue;
      const s = scen.get(r.scenarioId) || { id: r.scenarioId, title: r.scenarioId, description: "" };
      const g = r.findings && r.findings[0] ? groupOfCategory(r.findings[0].category) : null;
      out.push({ result: r, scenario: s, group: g ? g.label : "Scenarios" });
    }
    return out;
  }

  function showReport(id, st, my, initial, fromLive, focusWasInView) {
    const root = st.status === "error" || !st.report ? failedView(id, st) : reportView(id, st.report, st, my);
    view.replaceChildren(root);
    if (fromLive) {
      // The running view is gone (often scrolled down to "Stop run"); the report starts at its header.
      window.scrollTo(0, 0);
      if (st.status === "error") announce("The run failed.");
      else {
        const s = st.report.summary;
        announce((st.report.stopped ? "Run stopped. " : "Test run complete. ") + s.passed + " passed, " + (s.failed + s.errored) + " with issues, " + s.skipped + " skipped.");
      }
      if (focusWasInView) {
        const h1 = view.querySelector("h1");
        if (h1) { h1.setAttribute("tabindex", "-1"); h1.focus({ preventScroll: true }); }
      }
    } else {
      focusHeading(my, initial);
    }
  }

  function failedView(id, st) {
    setTitle("Run failed");
    return h("div", { id: "report", class: "report" },
      h("div", { class: "report-top" }, h("nav", { class: "crumbs", "aria-label": "Breadcrumb" }, h("ol", {}, h("li", {}, h("a", { href: "#/runs", text: "Runs" })), h("li", { "aria-current": "page", text: "Run " + id }))),
        h("time", { class: "when", datetime: st.startedAt, text: dateTime(st.startedAt) })),
      h("div", { class: "report-head" }, h("div", { class: "verdict" }, ring("error", { cls: "big", shape: "bigFail", label: "Failed" }), h("div", {}, h("h1", { text: "Run failed" }), h("p", { class: "summary" }, h("span", { text: st.error || "The run ended with an error." })),
          typeof st.total === "number" && st.total > 0
            ? h("p", { class: "fail-progress", text: st.completed + " of " + plural(st.total, "scenario") + " had finished when it failed" + (typeof st.durationMs === "number" ? ", after " + formatDuration(st.durationMs) : "") + "." })
            : null)),
        h("div", { class: "head-actions" }, rerunButton(id), h("a", { class: "btn", href: "#/new" }, icon("play"), "New run"))));
  }

  function rerunButton(id, errorSlot) {
    const label = h("span", { text: "Re-run" });
    const b = h("button", { type: "button", class: "btn accent-outline" }, icon("rerun"), label);
    b.addEventListener("click", async () => {
      b.disabled = true;
      label.textContent = "Planning again…";
      try {
        const { runId } = await api("/api/runs/" + enc(id) + "/rerun", {});
        location.hash = "#/runs/" + runId;
      } catch (err) {
        b.disabled = false;
        label.textContent = "Re-run";
        if (errorSlot) errorSlot.textContent = "Could not re-run: " + err.message;
      }
    });
    return b;
  }

  function reportView(id, report, st, my) {
    const base = "/api/runs/" + enc(id) + "/";
    const entries = orderedResults(report);
    const n = { pass: 0, issues: 0, fail: 0, error: 0, skipped: 0, stopped: 0 };
    for (const e of entries) {
      const r = e.result;
      if (r.status === "error") n.error++;
      else if (isIssue(r)) n.fail++;
      else if (r.status === "pass") n.pass++;
      else if (r.status === "skipped") { n.skipped++; if (r.notes === STOPPED_NOTE) n.stopped++; }
    }
    n.issues = n.fail + n.error;
    const confirmed = (report.findings || []).filter((f) => f.confidence === "confirmed").length;
    const clean = confirmed === 0 && n.error === 0;
    // No confirmed findings but nothing passed either (all skipped): a neutral mark, not a pass.
    const nothingChecked = clean && n.pass === 0 && n.fail === 0;
    const title = report.stopped ? "Run stopped" : "Test run complete";
    setTitle(title);

    const ranFor = typeof report.durationMs === "number" ? report.durationMs : Date.parse(report.finishedAt) - Date.parse(report.startedAt);
    const summary = h("p", { class: "summary" },
      h("span", { text: report.stopped ? (entries.length - n.stopped) + " of " + plural(entries.length, "scenario") + " run" : plural(entries.length, "scenario") + " run" }),
      h("span", { text: n.pass + " passed" }),
      h("span", { class: n.fail ? "n-issues" : "", text: n.fail + " with issues" }),
      n.error ? h("span", { class: "n-issues", text: n.error + " errored" }) : null,
      // A scenario can skip itself (with a reason) before you stop the run; say which skips were yours.
      n.skipped ? h("span", { text: n.skipped + " skipped" + (n.stopped === 0 ? "" : n.stopped === n.skipped ? " (stopped by you)" : " (" + n.stopped + " stopped by you)") }) : null,
      h("span", { text: formatDuration(ranFor) }));

    const headError = h("p", { class: "error" });
    const specs = (report.findings || []).filter((f) => f.spec);
    const download = h("details", { class: "download" },
      h("summary", { class: "btn" }, icon("download"), "Download"),
      h("ul", {},
        h("li", {}, h("a", { href: base + "report.md", download: "report.md" }, icon("file"), "report.md (Markdown)")),
        h("li", {}, h("a", { href: base + "report.json", download: "report.json" }, icon("file"), "report.json (all data)")),
        specs.map((f) => h("li", {}, h("a", { href: base + "specs/" + enc(f.spec.filename), download: f.spec.filename }, icon("code"), f.spec.filename)))));
    download.addEventListener("keydown", (e) => { if (e.key === "Escape" && download.open) { download.open = false; download.querySelector("summary").focus(); } });

    const head = [
      h("div", { class: "report-top" },
        h("nav", { class: "crumbs", "aria-label": "Breadcrumb" }, h("ol", {},
          h("li", {}, h("a", { href: "#/runs", text: "Runs" })),
          h("li", { text: hostPath(report.target) }),
          h("li", { "aria-current": "page", text: "Run " + id }))),
        h("time", { class: "when", datetime: report.startedAt, text: dateTime(report.startedAt) })),
      h("div", { class: "report-head" },
        h("div", { class: "verdict" },
          nothingChecked
            ? ring("skipped", { cls: "big", shape: "bigSkipped", label: "Nothing was checked" })
            : ring(clean ? "pass" : "fail", { cls: "big", shape: clean ? "bigPass" : "bigFail", label: clean ? "No confirmed findings" : plural(confirmed, "confirmed finding") }),
          h("div", {}, h("h1", { text: title }), summary)),
        h("div", { class: "head-actions" },
          rerunButton(id, headError),
          h("a", { class: "btn", href: base + "report.html", target: "_blank", rel: "noopener" }, icon("external"), "Open HTML report", h("span", { class: "visually-hidden", text: " (opens in a new tab)" })),
          download)),
      headError,
    ];
    if (report.stopped) head.push(h("p", { class: "stopped-note", text: "You stopped this run. The scenario in progress and the ones after it are marked skipped (“" + STOPPED_NOTE + "”). The report covers what ran." }));

    // Tabs and rows.
    const tabsDef = [["all", "All", entries.length], ["passed", "Passed", n.pass], ["issues", "Issues", n.issues]];
    if (n.skipped) tabsDef.push(["skipped", "Skipped", n.skipped]);
    const inTab = (key, r) => key === "all" || (key === "passed" && r.status === "pass" && !isIssue(r)) || (key === "issues" && isIssue(r)) || (key === "skipped" && r.status === "skipped");
    const tablist = h("div", { role: "tablist", "aria-label": "Filter results" });
    const resultsBox = h("div", { id: "results", role: "tabpanel", "aria-labelledby": "tab-all" });
    const tabs = tabsDef.map(([key, label, count]) => {
      const t = h("button", { type: "button", role: "tab", id: "tab-" + key, "aria-selected": key === "all" ? "true" : "false", "aria-controls": "results", tabindex: key === "all" ? "0" : "-1", text: label + " (" + count + ")" });
      t.dataset.key = key;
      t.addEventListener("click", () => selectTab(key));
      tablist.append(t);
      return t;
    });
    tablist.addEventListener("keydown", (e) => {
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      let j = -1;
      if (e.key === "ArrowRight") j = (i + 1) % tabs.length;
      else if (e.key === "ArrowLeft") j = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === "Home") j = 0;
      else if (e.key === "End") j = tabs.length - 1;
      if (j < 0) return;
      e.preventDefault();
      tabs[j].focus();
      selectTab(tabs[j].dataset.key);
    });

    const rowEls = new Map();
    const groupEls = [];
    const groupsSeen = [];
    for (const e of entries) {
      let g = groupsSeen.find((x) => x.label === e.group);
      if (!g) groupsSeen.push((g = { label: e.group, items: [] }));
      g.items.push(e);
    }
    for (const g of groupsSeen) {
      const ul = h("ul", {});
      const items = [];
      for (const e of g.items) {
        const r = e.result;
        const first = (r.findings || []).map(visualEvidence).find((x) => x.length);
        const thumb = first ? h("img", { class: "thumb", src: base + "artifacts/" + enc(first[0].path), alt: "" }) : h("span", { class: "thumb-gap", "aria-hidden": "true" });
        const btn = h("button", { type: "button", class: "rrow", "data-scenario-id": e.scenario.id, "data-issue": isIssue(r) ? "" : null },
          ring(displayStatus(r)), h("span", { class: "t", text: e.scenario.title }), h("span", { class: "d", text: resultDuration(r) }), thumb, icon("chevronRight"));
        btn.addEventListener("click", () => select(e.scenario.id, true));
        const li = h("li", {}, btn);
        rowEls.set(e.scenario.id, { li, btn, entry: e });
        items.push({ li, r });
        ul.append(li);
      }
      const block = h("div", { class: "rgroup" }, h("h3", { text: g.label }), ul);
      groupEls.push({ block, items });
      resultsBox.append(block);
    }
    const empty = h("p", { class: "results-empty", text: "No scenarios in this view.", hidden: true });
    resultsBox.append(empty);
    resultsBox.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const visible = [...rowEls.values()].filter((x) => !x.li.hidden).map((x) => x.btn);
      const i = visible.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const next = visible[e.key === "ArrowDown" ? Math.min(visible.length - 1, i + 1) : Math.max(0, i - 1)];
      next.focus();
    });

    function selectTab(key) {
      for (const t of tabs) {
        const on = t.dataset.key === key;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
      }
      resultsBox.setAttribute("aria-labelledby", "tab-" + key);
      let any = false;
      for (const g of groupEls) {
        let shown = 0;
        for (const it of g.items) {
          it.li.hidden = !inTab(key, it.r);
          if (!it.li.hidden) shown++;
        }
        g.block.hidden = shown === 0;
        any = any || shown > 0;
      }
      empty.hidden = any;
    }

    const detail = h("article", { id: "detail", class: "card", "aria-labelledby": "detail-title", tabindex: "-1" });
    function select(sid, fromClick) {
      for (const [k, x] of rowEls) {
        if (k === sid) x.btn.setAttribute("aria-current", "true");
        else x.btn.removeAttribute("aria-current");
      }
      const x = rowEls.get(sid);
      if (!x) return;
      renderDetail(detail, x.entry, report, base);
      if (fromClick && window.matchMedia("(max-width: 68rem)").matches) detail.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }

    const firstIssue = entries.find((e) => isIssue(e.result)) || entries[0];
    if (firstIssue) select(firstIssue.scenario.id, false);

    const grid = h("div", { class: "report-grid" },
      h("section", { class: "card results-panel", "aria-labelledby": "results-h" }, h("h2", { id: "results-h", text: "Test results" }), tablist, resultsBox),
      entries.length ? detail : h("div", { id: "detail", class: "card" }, h("p", { class: "muted", text: "This run has no results." })));

    return h("div", { id: "report", class: "report" }, head, grid, reportExtras(report));
  }

  function tagList(items) {
    return h("ul", { class: "tags" }, items.filter(Boolean));
  }

  function renderDetail(detail, entry, report, base) {
    const r = entry.result;
    const s = entry.scenario;
    const findings = r.findings || [];
    let fi = 0;
    const draw = () => {
      const f = findings[fi] || null;
      const parts = [];
      const status = displayStatus(r);
      const head = h("div", { class: "detail-head" },
        f ? sevRing(f.severity) : ring(status, { cls: "" }),
        h("div", { class: "grow" },
          h("h2", { id: "detail-title", text: f ? f.title : s.title }),
          // A passed or skipped scenario's description is under "What was checked"; don't say it twice.
          f ? h("p", { class: "meaning", text: f.meaning }) : null,
          tagList(f
            ? [h("li", { class: "sev-" + f.severity }, h("span", { class: "sw", "aria-hidden": "true" }), (SEVERITY_TEXT[f.severity] || f.severity)),
               h("li", { text: entry.group }), h("li", { class: "mono", text: f.checkId }),
               h("li", { text: f.confidence === "confirmed" ? "Confirmed" : "Advisory" })]
            : [h("li", { text: STATUS_TEXT[status] || status }), h("li", { text: entry.group }), h("li", { class: "mono", text: r.checkId })])),
        h("span", { class: "detail-dur" }, icon("clock"), h("span", { class: "visually-hidden", text: "Took " }), resultDuration(r)));
      parts.push(head);

      if (findings.length > 1) {
        const pick = h("select", { id: "finding-pick" }, findings.map((x, i) => h("option", { value: String(i), text: (i + 1) + ". " + x.title })));
        pick.value = String(fi);
        pick.addEventListener("change", () => { fi = Number(pick.value); draw(); document.getElementById("finding-pick").focus(); });
        parts.push(h("div", { class: "switcher" },
          h("label", { for: "finding-pick", text: "This scenario found " + findings.length + " problems. Showing:" }), pick));
      }

      const steps = r.steps || [];
      if (f) {
        const imgs = visualEvidence(f);
        if (imgs.length) parts.push(evidenceViewer(imgs, base));
      } else {
        const checked = [h("p", { text: s.description || "No description." })];
        if (r.notes) checked.push(h("p", { text: (r.status === "skipped" ? "Why it was skipped: " : r.status === "error" ? "What went wrong: " : "Result: ") + r.notes }));
        parts.push(h("section", { class: "panel", "aria-labelledby": "checked-h" }, h("h3", { id: "checked-h" }, icon("info"), "What was checked"), checked));
      }

      // Reproduction steps and key facts, side by side.
      let prevUrl = null;
      const repro = h("section", { class: "panel", "aria-labelledby": "repro-h" },
        h("h3", { id: "repro-h" }, icon("steps"), "Reproduction steps"),
        steps.length
          ? h("ol", { class: "repro" }, steps.map((x) => {
              const showUrl = x.url && x.url !== prevUrl;
              prevUrl = x.url;
              return h("li", {}, h("span", {}, x.label, showUrl ? h("span", { class: "u", text: x.url }) : null));
            }))
          : h("p", { text: "No steps were recorded for this scenario." }));
      parts.push(h("div", { class: "two" }, repro, keyFacts(f, r, steps, report)));

      if (f) {
        parts.push(h("section", { class: "panel", "aria-labelledby": "why-h" }, h("h3", { id: "why-h" }, icon("shield"), "Why it matters"), h("p", { text: f.impact })));
        parts.push(h("section", { class: "panel", "aria-labelledby": "ask-h" },
          h("h3", { id: "ask-h" }, icon("sparkle"), h("span", { class: "grow", text: "What to ask your AI" }), copyButton("Copy", () => f.fix)),
          h("p", { style: "color:var(--fg)", text: f.fix })));
        if (f.spec) parts.push(specPanel(f.spec, base));
      }
      detail.replaceChildren(...parts);
    };
    draw();
  }

  function evidenceViewer(imgs, base) {
    let cur = 0;
    const main = h("figure", { class: "evidence-main" });
    const strip = imgs.length > 1 ? h("ul", { class: "strip", "aria-label": "All evidence for this finding" }) : null;
    const buttons = [];
    const drawMain = () => {
      const e = imgs[cur];
      const href = base + "artifacts/" + enc(e.path);
      const kind = KIND_NAMES[e.kind] || e.kind;
      const meta = [
        e.step ? "Step: " + e.step : "",
        e.url ? "Page: " + e.url : "",
        e.capturedAt ? "Captured: " + e.capturedAt : "",
        e.kind === "gif" && e.frames ? e.frames + " frames, " + formatDuration(e.durationMs || 0) : "",
      ].filter(Boolean).join(" · ");
      main.replaceChildren(
        h("a", { href, target: "_blank", rel: "noopener", title: "Open the full-size image" }, h("img", { src: href, alt: kind + ": " + e.label })),
        h("figcaption", {}, h("b", { text: kind + ": " + e.label }), meta ? h("span", { class: "meta", text: meta }) : null));
      buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === cur)));
    };
    if (strip) {
      imgs.forEach((e, i) => {
        const b = h("button", { type: "button", "aria-label": "Show evidence " + (i + 1) + " of " + imgs.length + ": " + e.label }, h("img", { src: base + "artifacts/" + enc(e.path), alt: "" }));
        b.addEventListener("click", () => { cur = i; drawMain(); });
        buttons.push(b);
        strip.append(h("li", {}, b));
      });
    }
    drawMain();
    return h("section", { class: "evidence-sec", "aria-labelledby": "evidence-h" },
      h("h3", { id: "evidence-h", class: "visually-hidden", text: "Evidence" }),
      h("div", { class: "evidence-viewer" + (strip ? "" : " single") }, main, strip));
  }

  function keyFacts(f, r, steps, report) {
    const pageUrl = (f && (f.evidence || []).map((e) => e.url).find(Boolean)) || (steps[0] && steps[0].url) || report.target;
    const dl = h("dl", { class: "facts" });
    const codeRow = (label, value, copyLabel) => {
      // Full width (label above the value): URLs and selectors don't fit the label column's neighbour.
      dl.append(h("dt", { class: "wide", text: label }), h("dd", { class: "wide" }, h("span", { class: "code" }, h("code", { text: value }), copyButton(copyLabel, () => value, true))));
    };
    codeRow("Page URL", pageUrl, "Copy page URL");
    if (f && f.locations && f.locations.length > 1) {
      dl.append(h("dt", { class: "wide", text: "Where (" + f.locations.length + ")" }), h("dd", { class: "wide" }, h("ul", {}, f.locations.map((l) => h("li", {}, h("code", { text: l }))))));
    } else if (f && f.location) {
      codeRow("Element", f.location, "Copy element");
    }
    if (!f) dl.append(h("dt", { text: "Result" }), h("dd", { text: STATUS_TEXT[r.status] || r.status }));
    const seen = new Set();
    for (const e of f ? f.evidence || [] : []) {
      for (const x of e.facts || []) {
        const k = x.label + "\u0000" + x.value;
        if (seen.has(k)) continue;
        seen.add(k);
        dl.append(h("dt", { text: x.label }), h("dd", { text: x.value }));
      }
    }
    return h("section", { class: "panel", "aria-labelledby": "facts-h" }, h("h3", { id: "facts-h" }, icon("info"), "Key facts"), dl);
  }

  function specPanel(spec, base) {
    const lines = spec.source.replace(/\n$/, "").split("\n");
    const code = h("code", {}, lines.map((l) => h("span", { class: "line", text: l })));
    return h("section", { class: "panel spec-panel", "aria-labelledby": "spec-h" },
      h("div", { class: "spec-head" }, icon("code"), h("h3", { id: "spec-h", text: "Generated Playwright test" }), h("span", { class: "lang", text: "TypeScript" }), copyButton("Copy code", () => spec.source)),
      h("pre", { tabindex: "0", "aria-label": "Playwright test source, " + plural(lines.length, "line") }, code),
      h("p", { class: "spec-file" }, "specs/" + spec.filename + " · ", h("a", { href: base + "specs/" + enc(spec.filename), download: spec.filename, text: "Download" })));
  }

  function reportExtras(report) {
    const cards = [];
    if (report.groups && report.groups.length) {
      const cell = (v, cls) => h("td", { class: cls || "", text: String(v) });
      const row = (...cells) => h("tr", {}, cells.flatMap((c) => [c, " "]));
      cards.push(h("section", { class: "card", "aria-labelledby": "groups-h" },
        h("h2", { id: "groups-h", text: "Results by group" }),
        h("div", { class: "table-scroll" }, h("table", { class: "groups" },
          h("thead", {}, row(...[["Group"], ["Tests", "Scenarios"], ["Pass", "Passed"], ["Issues"], ["Skip", "Skipped"], ["Time"]].map(([t, full]) => h("th", { scope: "col", text: t, ...(full ? { title: full } : {}) })))),
          h("tbody", {}, report.groups.map((g) => row(
            h("th", { scope: "row", text: g.label }),
            cell(g.scenarioIds.length), cell(g.passed, g.passed ? "good" : ""), cell(g.failed + g.errored, g.failed + g.errored ? "bad" : ""), cell(g.skipped),
            cell(formatDuration(g.durationMs)))))))));
    }
    const pages = report.pagesVisited || [];
    const pagesCard = h("section", { class: "card", "aria-labelledby": "pages-h" },
      h("h2", { id: "pages-h", text: "Pages tested" }),
      pages.length
        ? h("ul", { class: "plain-list" }, pages.map((p) => h("li", {}, h("span", { class: "mono", text: p.url }), " · " + plural(p.scenarioIds.length, "scenario"))))
        : h("p", { class: "muted", text: "No pages were recorded." }));
    if (typeof report.testRecordsCreated === "number") {
      pagesCard.append(h("p", { class: "note", text: report.testRecordsCreated === 0
        ? "This run created no test records in your app."
        : "This run may have created " + plural(report.testRecordsCreated, "test record") + " in your app. Run Hound does not delete them." }));
    }
    cards.push(pagesCard);
    if (report.notVisible && report.notVisible.length) {
      cards.push(h("section", { class: "card", "aria-labelledby": "nv-h" },
        h("h2", { id: "nv-h", text: "Not visible from outside" }),
        h("ul", { class: "plain-list" }, report.notVisible.map((t) => h("li", { text: t })))));
    }
    if (report.browser || report.runHoundVersion) {
      pagesCard.append(h("p", { class: "note", text: [report.browser ? "Browser: " + report.browser : "", report.runHoundVersion ? "Run Hound " + report.runHoundVersion : ""].filter(Boolean).join(" · ") }));
    }
    return h("div", { class: "report-extra" }, cards);
  }

  window.addEventListener("hashchange", render);
  render();
})();
`;
