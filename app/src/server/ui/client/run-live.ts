/**
 * Section of the inline client script: A run: running view, then its report.
 * Concatenated in order with the others to form the body of String.raw in client.ts.
 */
export const RUN_LIVE = String.raw`  // ---------- A run: running view, then its report ----------

  async function viewRun(id, my, initial) {
    setTitle("Run " + id);
    view.append(h("p", { class: "loading", text: "Loading run " + id + "…" }));
    let st, list;
    try {
      [st, list] = await Promise.all([api("/api/runs/" + enc(id)), api("/api/runs").catch(() => null)]);
    } catch (err) {
      if (my !== gen) return;
      fill(view, h("div", { class: "page" },
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
    fill(view, ui.root);
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
        h("p", { class: "target", text: ui.target }),
        meta && meta.account ? h("p", { class: "acct", text: "Signed in as " + accountName(meta.account) }) : null),
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
        const ringSlot = h("span", { class: "ring-slot" }, ring("queued"));
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
        fill(row.ringSlot, ring(status));
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
      fill(row.sub, h("p", { class: "empty", text: running ? "Starting this scenario…" : finished && finished.status === "skipped" ? "Skipped before it took any steps." : "No steps recorded." }));
      return;
    }
    const list = h("ol", {});
    own.forEach((s, i) => {
      const isCurrent = running && i === own.length - 1;
      list.append(h("li", { class: isCurrent ? "current" : "" }, ring(isCurrent ? "running" : "pass", { silent: true }), h("span", { text: s.label })));
    });
    fill(row.sub, list);
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
      fill(ui.log, h("li", {}, h("span", { class: "empty", text: "Waiting for the first step…" })));
      return;
    }
    fill(ui.log, ...steps.map((s, i) => {
      const isCurrent = running && i === steps.length - 1;
      return h("li", { class: isCurrent ? "current" : "" },
        h("time", { datetime: s.at, text: hms(s.at) }),
        ring(isCurrent ? "running" : "pass", { silent: true }),
        h("span", { class: "lbl", text: s.label }),
        h("span", { class: "dur", text: stepDuration(steps, i, running, now) }));
    }));
    if (atBottom) box.scrollTop = box.scrollHeight;
  }

`;
