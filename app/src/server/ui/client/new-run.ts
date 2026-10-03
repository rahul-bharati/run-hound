/**
 * Section of the inline client script: New Run.
 * Concatenated in order with the others to form the body of String.raw in client.ts.
 */
export const NEW_RUN = String.raw`  // ---------- New Run ----------

  /** Kept across views, so going to Runs and back keeps the plan you were looking at. */
  const newState = { url: "", resp: null, selected: null, options: null, aiReview: null, signInAs: "" };

  /** A form field's name as a person reads it on the page. */
  function fieldName(form, key) {
    const f = form && (form.fields || []).find((x) => x.key === key);
    if (!f) return key;
    return f.label || f.accessibleName || f.placeholder || f.key;
  }
  /** A control's name as a person reads it (by its index among the form's controls). */
  function controlName(form, i) {
    const c = form && form.controls ? form.controls[i] : null;
    if (!c) return "control " + (i + 1);
    return c.accessibleName || c.text || (c.isSubmit ? "the submit button" : "control " + (i + 1));
  }
  const EXPECT_TEXT = {
    "request-ok": () => "the app accepts the save",
    "text-visible": (t) => "“" + (t || "") + "” appears on the page",
    "text-absent": (t) => "“" + (t || "") + "” does not appear on the page",
    "url-changes": () => "the page address changes",
    "no-errors": () => "no errors on the page",
    "field-kept": () => "the filled fields keep their values",
  };
  /** One AI flow step in plain words: Type "x" into Email, Click Sign up, Press Enter, Check: … */
  function flowStepText(step, form) {
    if (!step) return "";
    if (step.action === "fill") return "Type “" + step.value + "” into " + fieldName(form, step.field);
    if (step.action === "choose") return "Choose “" + step.option + "” in " + fieldName(form, step.field);
    if (step.action === "click") return "Click " + controlName(form, step.control);
    if (step.action === "press") return "Press " + step.key;
    if (step.action === "expect") return "Check: " + (EXPECT_TEXT[step.expect] ? EXPECT_TEXT[step.expect](step.text) : step.expect);
    return String(step.action || "");
  }
  const isSuggested = (s) => Boolean((s.ai && s.ai.suggested) || s.checkId === "ai-flow" || /^ai-flow:/.test(s.id));

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

    // "Review with AI" (0.3.0): offered only when AI is on and usable.
    let aiBox = null;
    let aiName = "";
    const aiRow = h("div", { class: "option ai-option", id: "ai-review-row", hidden: true });
    const planProgress = h("p", { class: "field-hint plan-progress", id: "plan-progress", hidden: true });

    // "Sign in as" (0.4.0): plan, and so run, as a test account. A slot that isn't set up is listed but disabled.
    const signIn = h("select", { id: "sign-in-as", class: "input", "aria-describedby": "sign-in-hint" }, h("option", { value: "", text: "Not signed in" }));
    const signInHint = h("p", { class: "field-hint", id: "sign-in-hint" });
    const signInRow = h("div", { class: "signin-row" }, h("label", { class: "field-label", for: "sign-in-as", text: "Sign in as" }), signIn, signInHint);
    $("target-hint").after(signInRow, aiRow, planProgress);
    let accounts = null;
    const slotOf = (id) => (accounts && accounts.accounts && accounts.accounts[id]) || null;
    const slotReady = (id) => Boolean(slotOf(id) && slotOf(id).ready);
    const slotName = (id) => accountName({ id, label: slotOf(id) ? slotOf(id).label : "" });
    function fillSignIn() {
      fill(signIn, h("option", { value: "", text: "Not signed in" }), ACCOUNT_SLOTS.map((id) => {
        const name = slotName(id) === defaultAccountLabel(id) ? slotName(id) : slotName(id) + " (" + defaultAccountLabel(id) + ")";
        return h("option", { value: id, disabled: !slotReady(id), text: slotReady(id) ? name : name + " · Set it up in Settings" });
      }));
      signIn.value = slotReady(newState.signInAs) ? newState.signInAs : "";
      newState.signInAs = signIn.value;
      updateSignInHint();
    }
    function updateSignInHint() {
      const who = signIn.value;
      if (accounts && !who && !ACCOUNT_SLOTS.some(slotReady)) {
        fill(signInHint, "Testing pages behind a sign-in? Add test accounts in ", h("a", { href: "#/settings", text: "Settings" }), ".");
        return;
      }
      const bits = [];
      if (who) bits.push("Run Hound signs in as " + slotName(who) + " first, and every check runs signed in.");
      else if (accounts) bits.push("Opens the page signed out. Choose an account to test pages behind a sign-in and to run the access checks.");
      const shown = newState.resp && !planSection.hidden ? newState.resp.plan : null;
      if (shown && ((shown.account && shown.account.id) || "") !== who) {
        bits.push("The plan below was made " + (shown.account ? "signed in as " + accountName(shown.account) : "signed out") + ". Plan the checks again to use this choice.");
      }
      fill(signInHint, bits.join(" "));
    }
    signIn.addEventListener("change", () => {
      newState.signInAs = signIn.value;
      updateSignInHint();
    });
    const accountsLoaded = api("/api/accounts").then((st) => {
      if (my !== gen) return null;
      accounts = st && st.accounts ? st : null;
      fillSignIn();
      return accounts;
    }).catch((err) => {
      if (my === gen) signInHint.textContent = "Could not load the test accounts: " + err.message;
      return null;
    });
    api("/api/ai").then((st) => {
      if (my !== gen || !st || !st.enabled || st.problem) return;
      aiName = st.provider + "/" + st.model;
      aiBox = h("input", { type: "checkbox", id: "ai-review" });
      aiBox.checked = newState.aiReview !== false;
      aiBox.addEventListener("change", () => { newState.aiReview = aiBox.checked; });
      const does = st.features && st.features.review === false ? "suggest extra flows for" : st.features && st.features.suggest === false ? "review" : "review and suggest flows for";
      fill(aiRow, aiBox, h("label", { for: "ai-review" }, "Review with AI",
        h("span", { class: "desc", text: "Asks " + aiName + " to " + does + " the plan. Only redacted page structure is sent (labels, field types, button names), never values." })));
      aiRow.hidden = false;
    }).catch(() => {});

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
      // "Not signed in" sends no account at all.
      const who = signIn.value;
      const body = aiBox ? { url, ai: aiBox.checked } : { url };
      if (who) body.signInAs = who;
      planButton.disabled = true;
      planButton.classList.add("busy");
      planButton.textContent = who ? "Signing in…" : "Opening the page…";
      const opening = who ? "Signing in as " + slotName(who) + ", opening the page" : "Opening the page";
      const useAi = aiBox !== null && aiBox.checked;
      if (useAi) {
        planProgress.textContent = opening + ", then asking " + aiName + " to review the plan. The model can take a while (a minute or more for a small local model).";
        planProgress.hidden = false;
      }
      try {
        const resp = await api("/api/plan", body);
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
          planProgress.hidden = true;
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
        return name ? (/\bform$/i.test(name) ? name : name + " form") : (f.search ? "Search form" : "Form " + (i + 1));
      };
      fill(summary, 
        forms.length === 1 && forms[0].name ? h("span", {}, "Found ", h("b", { text: "“" + forms[0].name + "”" })) : h("span", {}, "Found ", h("b", { text: forms.length ? plural(forms.length, "form") : "no form" })),
        " · " + plural(p.scenarios.length, "scenario"));
      const inv = $("page-inventory");
      const chips = forms.map((f, i) => h("li", { class: "inv" }, h("span", { class: "inv-name", text: formLabel(f, i) }), h("span", { class: "inv-meta", text: plural(f.fields.length, "field") + (f.controls.length ? " · " + plural(f.controls.length, "button") : "") })));
      if (p.page) {
        chips.push(h("li", { class: "inv" + (outside ? "" : " quiet") }, h("span", { class: "inv-name", text: "Outside the forms" }), h("span", { class: "inv-meta", text: plural(outside, "control") + (p.page.links ? " · " + plural(p.page.links, "link") : "") })));
        chips.push(h("li", { class: "inv" }, h("span", { class: "inv-name", text: "Whole page" }), h("span", { class: "inv-meta", text: "headers, cookies, CORS, scripts, layout" })));
      }
      fill(inv, ...chips);
      inv.hidden = chips.length === 0;
      const multi = forms.length > 1;
      const V1 = new Set(CONFIG.v1Checks || []);
      const warn = $("plan-warnings");
      const warnings = (resp.warnings || []).slice();
      for (const w of (p.ai && p.ai.warnings) || []) if (!warnings.includes(w)) warnings.push(w);
      // The first "Sign in as a test account…" hint gets the way to do it (a plan can carry two such hints).
      let offered = false;
      fill(warn, ...warnings.map((w) => {
        const action = offered ? null : signInAction(w, p);
        offered = offered || action !== null;
        return h("p", {}, w, action);
      }));
      warn.hidden = warnings.length === 0;
      // Who the page was planned as (0.4.0); the run signs in as the same account.
      let acctLine = $("plan-account");
      if (!acctLine) {
        acctLine = h("p", { id: "plan-account", class: "plan-account" });
        summary.parentNode.after(acctLine);
      }
      if (p.account) fill(acctLine, h("span", { class: "dot", "aria-hidden": "true" }), h("span", {}, "Signed in as ", h("b", { text: accountName(p.account) })));
      else fill(acctLine);
      acctLine.hidden = !p.account;
      let aiLine = $("plan-ai");
      if (!aiLine) {
        aiLine = h("p", { id: "plan-ai", class: "plan-ai" });
        inv.before(aiLine);
      }
      if (p.ai) {
        const who = p.ai.provider + "/" + p.ai.model;
        const bits = [p.ai.reviewed ? "Reviewed by " + who : p.ai.suggested ? plural(p.ai.suggested, "flow") + " suggested by " + who : "Not reviewed by " + who + " (the built-in plan is shown)"];
        if (p.ai.reviewed && p.ai.suggested) bits.push(plural(p.ai.suggested, "flow") + " suggested");
        if (p.ai.remote) bits.push("remote endpoint");
        fill(aiLine, icon("sparkle"), h("span", { text: bits.join(" · ") + ". Advisory: the checks still decide pass or fail." }));
        aiLine.hidden = false;
      } else {
        fill(aiLine);
        aiLine.hidden = true;
      }
      const formAt = (s) => forms[s.formIndex || 0] || forms[0] || null;

      const chosen = selected ? new Set(selected) : null;
      const byId = new Map(p.scenarios.map((s) => [s.id, s]));
      const groups = p.groups && p.groups.length ? p.groups : [{ id: "all", label: "Scenarios", scenarioIds: p.scenarios.map((s) => s.id) }];
      const box = $("scenarios");
      fill(box);
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
          const suggested = isSuggested(s);
          if (suggested) tags.push(h("span", { class: "tag ai", text: "Suggested by AI" }));
          else if (s.ai) {
            tags.push(h("span", { class: "tag ai", text: "AI" }));
            if (s.ai.recommended) tags.push(h("span", { class: "tag ai rec", text: "Recommended" }));
          }
          const extra = [];
          if (s.ai && s.ai.rationale) extra.push(h("span", { class: "desc ai-why" }, h("span", { class: "visually-hidden", text: "AI rationale: " }), s.ai.rationale));
          if (suggested && s.flow && s.flow.length) {
            const form = formAt(s);
            extra.push(h("ol", { class: "flow-steps", "aria-label": "Steps of " + s.title }, s.flow.map((st) => h("li", { text: flowStepText(st, form) }))));
          }
          rows.append(h("li", { class: "scenario-row" + (suggested ? " suggested" : s.ai && s.ai.recommended ? " recommended" : "") }, cb, h("label", { for: id }, h("span", { class: "title", text: s.title }), tags, h("span", { class: "desc", text: s.description }), extra)));
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
      updateSignInHint();
      if (focus) $("plan-h").focus();
    }

    /**
     * For the plan's "Sign in as a test account…" hint: a button that plans the page again signed in as the first
     * account that is set up, else a link to Settings. Nothing for other warnings or a signed-in plan.
     */
    function signInAction(w, p) {
      if (p.account || !accounts || !/^Sign in as a test account/.test(w)) return null;
      const ready = ACCOUNT_SLOTS.find(slotReady);
      if (!ready) return h("a", { class: "warn-action", href: "#/settings", text: "Set up test accounts" });
      const again = h("button", { type: "button", class: "link-btn warn-action", text: "Plan again signed in as " + slotName(ready) });
      again.addEventListener("click", () => {
        signIn.value = ready;
        newState.signInAs = ready;
        plan(input.value.trim() || newState.url);
      });
      return again;
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
        // The server never sends a secret in an address back ("?t=[REDACTED:github-token]"): planning that would test
        // the wrong page, so ask for the real address instead.
        if (/\[REDACTED:[\w-]*\]/.test(url)) {
          newState.url = url;
          showError("This address had a secret in it (a token or key), which Run Hound hides. Enter the full address again to plan it.");
          input.focus();
          return;
        }
        // Plan as the account the run signed in as (or signed out, as it was).
        const ranAs = (entry && entry.account) || (st.report && st.report.plan ? reportAccountsOf(st.report).self : null);
        await accountsLoaded;
        if (my !== gen) return;
        if (ranAs && !slotReady(ranAs.id)) {
          newState.url = url;
          showError(accounts
            ? "This run was signed in as " + accountName(ranAs) + ", which isn't set up now. Set it up in Settings → Test accounts, or plan the page signed out."
            : "This run was signed in as " + accountName(ranAs) + ", but the test accounts could not be loaded. Reload the page to try again, or plan the page signed out.");
          input.focus();
          return;
        }
        if (accounts) {
          signIn.value = ranAs ? ranAs.id : "";
          newState.signInAs = signIn.value;
          updateSignInHint();
        }
        plan(url, ids.length ? ids : null);
      } catch (err) {
        if (my !== gen) return;
        showError("Could not load that run's plan: " + err.message);
      }
    }
  }

`;
