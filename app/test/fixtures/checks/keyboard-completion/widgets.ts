/**
 * keyboard-completion fixtures for AI-built forms (0.4.0, LOV-2): a react-hook-form + zod + shadcn "New project" form
 * rebuilt in plain DOM with the keyboard behaviour Radix gives each widget:
 * - Select (Team size): a button[role=combobox]; Enter, Space, ArrowDown or ArrowUp open a listbox in a portal with
 *   focus on the chosen (or first) option; arrows move, Enter or Space picks and focus returns to the trigger. Its
 *   value is mirrored into an aria-hidden "bubble" <select>.
 * - RadioGroup (Priority): roving focus. The group is the tab stop until an item is checked; focusing it moves focus
 *   to the checked (or first) item; arrows move focus and check; Space checks the focused item.
 * - Checkbox (I accept the terms): a button[role=checkbox]; Space toggles (its own click), Enter does nothing.
 * - Switch (Notify the team, optional): like the checkbox.
 * - Combobox (Owner): a shadcn Popover + cmdk list; Enter or Space opens it with focus in the search input, the first
 *   match is highlighted and Enter picks it.
 * Nothing is marked required in the markup: the rules live in the script (zod-like), as in most AI-built apps.
 * `mouseOnlySelect` removes the keyboard handling of the Select.
 */
import type { DiscoveredForm, FormField } from "../../../../src/core/types.js";
import { json, startFixtureServer, type FixtureServer } from "../../../../test-support/server.js";

export interface WidgetFormOptions {
  /** The Select opens on mouse down only (no key handler), like a hand-made dropdown. */
  mouseOnlySelect?: boolean;
}

function html(options: WidgetFormOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Projects</title>
<link rel="icon" href="data:,">
<style>
  body { font-family: system-ui, sans-serif; margin: 0; padding: 16px; }
  .item { margin: 0 0 16px; position: relative; }
  label { font-weight: 600; }
  input[type=text], input:not([type]) { display: block; width: 320px; padding: 6px 8px; font-size: 16px; }
  button[role=combobox] { min-width: 220px; padding: 6px 10px; text-align: left; }
  button[role=checkbox], button[role=radio] { width: 18px; height: 18px; padding: 0; border: 1px solid #333; background: #fff; }
  button[role=radio] { border-radius: 50%; }
  button[data-state=checked] { background: #111; }
  button[role=switch] { width: 32px; height: 18px; padding: 0; border-radius: 9px; border: 1px solid #333; background: #ddd; }
  [role=radiogroup] { display: flex; gap: 16px; }
  .bubble { position: absolute; border: 0; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
  .popper { position: absolute; background: #fff; border: 1px solid #999; z-index: 50; min-width: 220px; }
  [role=option] { padding: 4px 10px; }
  [role=option][data-highlighted], [role=option][aria-selected=true] { background: #eee; }
  .msg { color: #b00020; font-size: 14px; margin: 4px 0 0; }
</style>
</head>
<body>
<main id="root">
<h1>Projects</h1>
<form id="project" novalidate>
  <div class="item"><label for="f-name">Project name</label><input id="f-name" name="name"><p class="msg" id="m-name"></p></div>
  <div class="item">
    <label for="f-team">Team size</label>
    <button type="button" role="combobox" aria-expanded="false" aria-autocomplete="none" data-state="closed" data-placeholder="" id="f-team"><span>Select team size</span></button>
    <select aria-hidden="true" tabindex="-1" class="bubble"><option value=""></option><option value="1-5">1–5</option><option value="6-20">6–20</option></select>
    <p class="msg" id="m-teamSize"></p>
  </div>
  <div class="item">
    <span id="priority-label">Priority</span>
    <div role="radiogroup" aria-labelledby="priority-label" id="f-priority" tabindex="0">
      <span><button type="button" role="radio" aria-checked="false" data-state="unchecked" value="low" id="f-p-low" tabindex="-1"></button> <label for="f-p-low">Low</label></span>
      <span><button type="button" role="radio" aria-checked="false" data-state="unchecked" value="high" id="f-p-high" tabindex="-1"></button> <label for="f-p-high">High</label></span>
    </div>
    <p class="msg" id="m-priority"></p>
  </div>
  <div class="item"><button type="button" role="switch" aria-checked="false" data-state="unchecked" id="f-notify"></button> <label for="f-notify">Notify the team</label></div>
  <div class="item">
    <label for="f-owner">Owner</label>
    <button type="button" role="combobox" aria-expanded="false" aria-haspopup="dialog" id="f-owner">Select owner</button>
    <p class="msg" id="m-owner"></p>
  </div>
  <div class="item">
    <button type="button" role="checkbox" aria-checked="false" data-state="unchecked" id="f-terms"></button><input aria-hidden="true" tabindex="-1" type="checkbox" class="bubble">
    <label for="f-terms">I accept the terms</label><p class="msg" id="m-terms"></p>
  </div>
  <button type="submit" id="create">Create project</button>
</form>
<p id="toast" role="status"></p>
</main>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var state = { teamSize: "", priority: "", notify: false, owner: "", terms: false };
  function popper(trigger) {
    var wrap = document.createElement("div");
    wrap.className = "popper";
    var r = trigger.getBoundingClientRect();
    wrap.style.left = r.left + scrollX + "px";
    wrap.style.top = r.bottom + scrollY + 4 + "px";
    document.body.appendChild(wrap);
    return wrap;
  }

  // Radix Select
  var team = $("f-team"), bubble = team.nextElementSibling, labels = { "1-5": "1–5", "6-20": "6–20" }, open = null;
  function setTeam(v) { state.teamSize = v; team.firstElementChild.textContent = labels[v]; team.removeAttribute("data-placeholder"); bubble.value = v; }
  function closeSelect() { if (!open) return; open.remove(); open = null; team.setAttribute("aria-expanded", "false"); team.focus(); }
  function openSelect() {
    if (open) return;
    open = popper(team);
    var box = document.createElement("div");
    box.setAttribute("role", "listbox");
    open.appendChild(box);
    var opts = Object.keys(labels).map(function (v) {
      var o = document.createElement("div");
      o.setAttribute("role", "option");
      o.setAttribute("aria-selected", String(state.teamSize === v));
      o.tabIndex = -1;
      o.textContent = labels[v];
      o.addEventListener("click", function () { setTeam(v); closeSelect(); });
      box.appendChild(o);
      return o;
    });
    opts.forEach(function (o, i) {
      o.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); o.click(); }
        else if (e.key === "ArrowDown") { e.preventDefault(); (opts[i + 1] || o).focus(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); (opts[i - 1] || o).focus(); }
        else if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); closeSelect(); }
      });
    });
    team.setAttribute("aria-expanded", "true");
    (box.querySelector('[aria-selected="true"]') || opts[0]).focus();
  }
  ${
    options.mouseOnlySelect
      ? 'team.addEventListener("mousedown", function (e) { e.preventDefault(); openSelect(); });'
      : 'team.addEventListener("click", openSelect);\n  team.addEventListener("keydown", function (e) { if ([" ", "Enter", "ArrowDown", "ArrowUp"].indexOf(e.key) >= 0) { e.preventDefault(); openSelect(); } });'
  }

  // Radix RadioGroup (roving focus)
  var group = $("f-priority"), radios = Array.prototype.slice.call(group.querySelectorAll("[role=radio]"));
  function check(r) {
    radios.forEach(function (x) { var on = x === r; x.setAttribute("aria-checked", String(on)); x.setAttribute("data-state", on ? "checked" : "unchecked"); x.tabIndex = on ? 0 : -1; });
    group.tabIndex = -1;
    state.priority = r.value;
  }
  group.addEventListener("focus", function (e) { if (e.target === group) (radios.find(function (x) { return x.getAttribute("aria-checked") === "true"; }) || radios[0]).focus(); });
  radios.forEach(function (r, i) {
    r.addEventListener("click", function () { check(r); });
    r.addEventListener("keydown", function (e) {
      var move = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (e.key === "Enter") e.preventDefault();
      if (!move) return;
      e.preventDefault();
      var next = radios[(i + move + radios.length) % radios.length];
      next.focus();
      check(next);
    });
  });

  // Radix Checkbox and Switch: Space is the button's own click; Enter is blocked.
  [["f-terms", "terms"], ["f-notify", "notify"]].forEach(function (pair) {
    var b = $(pair[0]);
    b.addEventListener("click", function () {
      var on = b.getAttribute("aria-checked") !== "true";
      b.setAttribute("aria-checked", String(on));
      b.setAttribute("data-state", on ? "checked" : "unchecked");
      state[pair[1]] = on;
      if (b.nextElementSibling && b.nextElementSibling.matches("input")) b.nextElementSibling.checked = on;
    });
    b.addEventListener("keydown", function (e) { if (e.key === "Enter") e.preventDefault(); });
  });

  // shadcn Combobox: Popover + cmdk
  var owner = $("f-owner"), pop = null, people = ["Alex Rivera", "Sam Lee"];
  function closeOwner() { if (!pop) return; pop.remove(); pop = null; owner.setAttribute("aria-expanded", "false"); owner.focus(); }
  owner.addEventListener("click", function () {
    if (pop) return closeOwner();
    pop = popper(owner);
    pop.innerHTML = '<div role="dialog"><input role="combobox" aria-expanded="true" aria-controls="owner-list" placeholder="Search people..." id="owner-search"><div role="listbox" id="owner-list"></div></div>';
    owner.setAttribute("aria-expanded", "true");
    var input = pop.querySelector("input"), list = pop.querySelector("[role=listbox]");
    function render() {
      var q = input.value.toLowerCase();
      list.innerHTML = "";
      people.filter(function (p) { return p.toLowerCase().indexOf(q) >= 0; }).forEach(function (p, i) {
        var item = document.createElement("div");
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", String(i === 0));
        item.textContent = p;
        item.addEventListener("click", function () { state.owner = p; owner.textContent = p; closeOwner(); });
        list.appendChild(item);
      });
    }
    input.addEventListener("input", render);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); var s = list.querySelector('[aria-selected="true"]'); if (s) s.click(); }
      if (e.key === "Escape") { e.preventDefault(); closeOwner(); }
    });
    render();
    input.focus();
  });

  // zod-like rules, then POST as JSON
  $("project").addEventListener("submit", function (e) {
    e.preventDefault();
    var values = { name: $("f-name").value.trim(), teamSize: state.teamSize, priority: state.priority, notify: state.notify, owner: state.owner, terms: state.terms };
    var rules = { name: values.name.length >= 2, teamSize: !!values.teamSize, priority: !!values.priority, owner: !!values.owner, terms: values.terms === true };
    var bad = false;
    Object.keys(rules).forEach(function (k) { $("m-" + k).textContent = rules[k] ? "" : "Required"; if (!rules[k]) bad = true; });
    if (bad) return;
    fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) })
      .then(function (res) { $("toast").textContent = res.ok ? "Project created" : "Could not save"; });
  });
})();
</script>
</body>
</html>`;
}

export interface WidgetFormApp extends FixtureServer {
  /** Parsed bodies of POST /api/projects. */
  saved: Record<string, unknown>[];
  formUrl: string;
}

export async function startWidgetForm(options: WidgetFormOptions = {}): Promise<WidgetFormApp> {
  const saved: Record<string, unknown>[] = [];
  const server = await startFixtureServer({
    pages: { "/projects": html(options) },
    routes: {
      "POST /api/projects": (req, res) => {
        saved.push(JSON.parse(req.body || "{}") as Record<string, unknown>);
        json(res, 201, { id: saved.length });
      },
    },
  });
  return { ...server, saved, formUrl: `${server.url}/projects` };
}

const field = (f: Partial<FormField> & Pick<FormField, "key" | "selector" | "type" | "role">): FormField => ({
  accessibleName: null,
  label: null,
  placeholder: null,
  required: false,
  ...f,
});

/** The form as discovery reports it under the 0.4.0 contract, written by hand so the test doesn't depend on discovery. */
export function widgetForm(url: string): DiscoveredForm {
  return {
    url,
    index: 0,
    selector: "#project",
    name: "Projects",
    fields: [
      field({ key: "name", accessibleName: "Project name", label: "Project name", type: "text", role: "textbox", selector: "#f-name" }),
      field({
        key: "teamSize",
        accessibleName: "Team size",
        label: "Team size",
        type: "select",
        role: "combobox",
        selector: "#f-team",
        widget: "aria-select",
        nativeSelector: "#f-team + select",
        options: [
          { label: "1–5", selector: "#f-team + select > option:nth-child(2)" },
          { label: "6–20", selector: "#f-team + select > option:nth-child(3)" },
        ],
      }),
      field({
        key: "priority",
        label: "Priority",
        accessibleName: "Priority",
        type: "radio",
        role: "radiogroup",
        selector: "#f-priority",
        widget: "aria-radio",
        options: [
          { label: "Low", selector: "#f-p-low" },
          { label: "High", selector: "#f-p-high" },
        ],
      }),
      field({ key: "notify", accessibleName: "Notify the team", label: "Notify the team", type: "checkbox", role: "switch", selector: "#f-notify", widget: "aria-switch" }),
      field({ key: "owner", accessibleName: "Owner", label: "Owner", type: "select", role: "combobox", selector: "#f-owner", widget: "aria-select" }),
      field({
        key: "terms",
        accessibleName: "I accept the terms",
        label: "I accept the terms",
        type: "checkbox",
        role: "checkbox",
        selector: "#f-terms",
        widget: "aria-checkbox",
        nativeSelector: "#f-terms + input",
      }),
    ],
    controls: [{ accessibleName: "Create project", text: "Create project", role: "button", tag: "button", selector: "#create", isSubmit: true }],
  };
}
