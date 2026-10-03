/**
 * Section of the inline client script: Runs.
 * Concatenated in order with the others to form the body of String.raw in client.ts.
 */
export const RUNS = String.raw`  // ---------- Runs ----------

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
        fill(list, h("li", { class: "empty-state", text: "Could not load the runs: " + err.message }));
        return;
      }
      if (my !== gen) return;
      const runs = data.runs || [];
      if (runs.length === 0) {
        fill(list, h("li", { class: "empty-state" }, h("p", { text: "No runs yet." }), h("a", { class: "btn primary", href: "#/new" }, icon("play"), "Start a new run")));
      } else {
        fill(list, ...runs.map(runRow));
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
      h("span", { class: "what" }, h("span", { class: "target", text: hostPath(run.target) }), h("span", { class: "form", text: run.formName ? run.formName : "Page without a form name" }),
        run.account ? h("span", { class: "acct", text: "Signed in as " + accountName(run.account) }) : null),
      h("time", { class: "when", datetime: run.startedAt, text: dateTime(run.startedAt) }),
      counts,
      icon("chevronRight")));
  }

`;
