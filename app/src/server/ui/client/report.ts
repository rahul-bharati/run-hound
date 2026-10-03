/**
 * Section of the inline client script: Report.
 * Concatenated in order with the others to form the body of String.raw in client.ts.
 */
export const REPORT = String.raw`  // ---------- Report ----------

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
    fill(view, root);
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
    const headError = h("p", { class: "error" });
    return h("div", { id: "report", class: "report" },
      h("div", { class: "report-top" }, h("nav", { class: "crumbs", "aria-label": "Breadcrumb" }, h("ol", {}, h("li", {}, h("a", { href: "#/runs", text: "Runs" })), h("li", { "aria-current": "page", text: "Run " + id }))),
        h("time", { class: "when", datetime: st.startedAt, text: dateTime(st.startedAt) })),
      h("div", { class: "report-head" }, h("div", { class: "verdict" }, ring("error", { cls: "big", shape: "bigFail", label: "Failed" }), h("div", {}, h("h1", { text: "Run failed" }), h("p", { class: "summary" }, h("span", { text: st.error || "The run ended with an error." })),
          typeof st.total === "number" && st.total > 0
            ? h("p", { class: "fail-progress", text: st.completed + " of " + plural(st.total, "scenario") + " had finished when it failed" + (typeof st.durationMs === "number" ? ", after " + formatDuration(st.durationMs) : "") + "." })
            : null)),
        h("div", { class: "head-actions" }, rerunButton(id, headError), h("a", { class: "btn", href: "#/new" }, icon("play"), "New run"))),
      headError);
  }

  function rerunButton(id, errorSlot) {
    const label = h("span", { text: "Re-run" });
    const b = h("button", { type: "button", class: "btn accent-outline" }, icon("rerun"), label);
    b.addEventListener("click", async () => {
      b.disabled = true;
      label.textContent = "Planning again…";
      if (errorSlot) errorSlot.textContent = "";
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
      else if (r.status === "skipped") { n.skipped++; if ((r.notes || "").indexOf(STOPPED_NOTE) === 0) n.stopped++; }
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
          h("div", {}, h("h1", { text: title }), summary, reportAccountLine(report))),
        h("div", { class: "head-actions" },
          rerunButton(id, headError),
          h("a", { class: "btn", href: base + "report.html", target: "_blank", rel: "noopener" }, icon("external"), "Open HTML report", h("span", { class: "visually-hidden", text: " (opens in a new tab)" })),
          download)),
      headError,
    ];
    if (report.ai) {
      const who = report.ai.provider + "/" + report.ai.model;
      head.push(h("p", { class: "plan-ai report-ai" }, icon("sparkle"), h("span", { text: "Findings explained by " + who + " (" + report.ai.explained + " of " + plural((report.findings || []).length, "finding") + "). Advisory text only." })));
      if (report.ai.warnings && report.ai.warnings.length) head.push(h("div", { class: "warning", id: "report-ai-warnings" }, report.ai.warnings.map((w) => h("p", { text: w }))));
    }
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

  /**
   * What the run used the other account for (0.6.0 close-out), as the HTML and Markdown reports say it (report.ts
   * otherAccountUse): from the other-account scenarios that ran (a result that isn't "skipped"), else the approved
   * ones; "read" for access-control's other-account scenario, "change" for write-access's, "read or change" for both,
   * "read" when neither is named (a report written before 0.6.0); "change or delete" ("read, change or delete") when a
   * write-access other-account scenario that ran sent the app's DELETE as the other account ("Sending DELETE <url> as").
   */
  function otherAccountUse(report) {
    const other = /(?:^|:)other-account(?:@form-\d+)?(?:#\d+)?$/;
    const scenarios = (report.plan && report.plan.scenarios) || [];
    const checkOf = new Map(scenarios.map((s) => [s.id, s.checkId]));
    const ran = new Set((report.results || [])
      .filter((r) => r.status !== "skipped" && other.test(r.scenarioId))
      .map((r) => r.checkId || checkOf.get(r.scenarioId)));
    const approved = new Set(report.approved || []);
    const used = ran.size > 0 ? ran : new Set(scenarios.filter((s) => approved.has(s.id) && other.test(s.id)).map((s) => s.checkId));
    const reads = used.has("access-control");
    const changes = used.has("write-access");
    const deletes = (report.results || []).some((r) => r.status !== "skipped" && other.test(r.scenarioId)
      && (r.checkId || checkOf.get(r.scenarioId)) === "write-access"
      && (r.steps || []).some((st) => /^Sending DELETE\b.* as /.test(String((st && st.label) || ""))));
    const change = deletes ? "change or delete" : "change";
    return reads && changes ? (deletes ? "read, change or delete" : "read or change") : changes ? change : "read";
  }

  /** "Signed in as Account A · other account Account B, …" under the report's summary; null for a signed-out run. */
  function reportAccountLine(report) {
    const { self, other } = reportAccountsOf(report);
    if (!self) return null;
    return h("p", { class: "report-account" },
      h("span", { class: "dot", "aria-hidden": "true" }),
      h("span", {}, "Signed in as ", h("b", { text: accountName(self) }),
        other ? h("span", { class: "muted" }, " · other account ", h("b", { text: accountName(other) }), ", used to check that it can't " + otherAccountUse(report) + " " + accountName(self) + "'s data") : null));
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
               h("li", { text: entry.group }), f.scope ? h("li", { text: f.scope }) : null, h("li", { class: "mono", text: f.checkId }),
               h("li", { text: f.confidence === "confirmed" ? "Confirmed" : "Advisory" })].filter(Boolean)
            : [h("li", { text: STATUS_TEXT[status] || status }), h("li", { text: entry.group }), s && s.scopeLabel ? h("li", { text: s.scopeLabel }) : null, h("li", { class: "mono", text: r.checkId })].filter(Boolean))),
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
        parts.push(h("section", { class: "panel", "aria-labelledby": "why-h" }, h("h3", { id: "why-h" }, icon("shield"), "Why it matters"), h("p", { text: f.impact }), checkLink(f.checkId)));
        parts.push(h("section", { class: "panel", "aria-labelledby": "ask-h" },
          h("h3", { id: "ask-h" }, icon("sparkle"), h("span", { class: "grow", text: "What to ask your AI" }), copyButton("Copy", () => f.fix)),
          h("p", { class: "fg", text: f.fix })));
        if (f.ai) parts.push(aiExplanationPanel(f.ai));
        if (f.spec) parts.push(specPanel(f.spec, base));
      }
      fill(detail, ...parts);
    };
    draw();
  }

  /**
   * "About the <id> check" under Why it matters: the check's page on Run Hound's site, in a new tab with no opener and
   * no referrer (the link carries nothing from the run). Null for an id this version doesn't know (a hand-edited report).
   */
  function checkLink(checkId) {
    if (!Object.prototype.hasOwnProperty.call(CHECK_PAGES, checkId)) return null;
    return h("p", { class: "check-link" },
      h("a", { href: CHECK_PAGES[checkId], target: "_blank", rel: "noopener noreferrer" },
        icon("external"), "About the " + checkId + " check", h("span", { class: "visually-hidden", text: " (opens in a new tab)" })));
  }

  /** A model's explanation of a finding (0.3.0), after the built-in "What to ask your AI". Advisory only. */
  function aiExplanationPanel(ai) {
    return h("section", { class: "panel ai-panel", "aria-labelledby": "ai-exp-h" },
      h("h3", { id: "ai-exp-h" }, icon("sparkle"), h("span", { class: "grow" }, "AI explanation", h("span", { class: "tag ai", text: "Advisory" }))),
      h("p", { class: "fg", text: ai.summary }),
      h("div", { class: "ask" },
        h("h4", {}, h("span", { class: "grow", text: "Ask your AI" }), copyButton("Copy", () => ai.askYourAi)),
        h("p", { class: "ask-text", text: ai.askYourAi })),
      h("p", { class: "note", text: "Written by " + ai.model + ". It doesn't change the verdict, severity or the built-in advice." }));
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
      fill(main, 
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
      const as = reportAccountsOf(report).self;
      pagesCard.append(h("p", { class: "note", text: report.testRecordsCreated === 0
        ? "This run created no test records in your app."
        : "This run may have created " + plural(report.testRecordsCreated, "test record") + " in your app" + (as ? ", as " + accountName(as) : "") + ". Run Hound does not delete them." }));
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
