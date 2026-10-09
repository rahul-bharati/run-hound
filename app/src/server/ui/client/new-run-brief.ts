/**
 * Section of the inline client script: New Run, "Describe what to test" and the brief editor (A2, a preview).
 * Concatenated in order with the others to form the body of String.raw in client.ts. Called by viewNew only when
 * CONFIG.agent is true; the markup it wires is rendered into the New run template only then (brief-template.ts).
 */
export const NEW_RUN_BRIEF = String.raw`  // ---------- New Run: describe what to test (A2, preview) ----------

  /** What a brief expectation's source is called. The server decides the source; the page only shows it. */
  const BRIEF_SOURCE_TAG = { supplied: "You said", inferred: "Assumed" };
  const BRIEF_PERMISSION_ANSWER = { yes: "Yes, it may change existing records", no: "No" };

  /**
   * Wires the "Describe what to test" form and the editor card. ctx: my (the render generation), $ (getElementById),
   * input (the page's URL field), signIn (its "Sign in as" select), accountsLoaded (a promise), accountChoiceName(id)
   * ("Account A", or "Alex (Account A)" when the account has a label), accountReady(id) and accountsKnown().
   */
  function setupBrief(ctx) {
    const $ = ctx.$;
    const L = CONFIG.briefLimits;
    const live = () => ctx.my === gen;
    const goalEl = $("brief-goal");
    const ticketEl = $("brief-ticket");
    const featureEl = $("brief-feature");
    const draftButton = $("brief-draft-button");
    const progress = $("brief-progress");
    const draftError = $("brief-error");
    const card = $("brief-editor");
    const heading = $("brief-editor-h");
    const stateTag = $("brief-state");
    const body = $("brief-body");
    const editError = $("brief-edit-error");
    const editStatus = $("brief-edit-status");
    const saveButton = $("brief-save");
    const approveButton = $("brief-approve");
    let draft = null; // the BriefDraft as the server last sent it
    let refs = null; // the editor's controls, to read what was changed
    let busy = false;
    let ids = 0;
    const uid = (p) => "brief-" + p + "-" + (++ids);
    const briefUrl = () => "/api/briefs/" + enc(draft.id);

    // ----- the form -----

    for (const [el, key] of [[goalEl, "goal"], [ticketEl, "ticket"], [featureEl, "feature"]]) {
      el.value = newState.briefText[key] || "";
      el.addEventListener("input", () => {
        newState.briefText[key] = el.value;
        if (el === goalEl) goalEl.removeAttribute("aria-invalid");
      });
    }

    function showDraftError(err) {
      if (err.status === 409) fill(draftError, err.message + " ", h("a", { href: "#/settings", text: "Open Settings" }));
      else draftError.textContent = err.message;
    }

    $("brief-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (busy) return;
      draftError.textContent = "";
      const goal = goalEl.value.trim();
      const url = ctx.input.value.trim();
      if (!goal) {
        goalEl.setAttribute("aria-invalid", "true");
        draftError.textContent = "Describe what to test.";
        goalEl.focus();
        return;
      }
      if (!url) {
        draftError.textContent = "Enter the Page URL above first: the brief is for that page.";
        ctx.input.focus();
        return;
      }
      busy = true;
      draftButton.disabled = true;
      draftButton.classList.add("busy");
      draftButton.textContent = "Drafting…";
      progress.textContent = "Asking the model to draft the brief. A small local model can take a minute or more.";
      try {
        await ctx.accountsLoaded;
        const request = { goal, url };
        const ticket = ticketEl.value.trim();
        if (ticket) request.ticketContext = ticket;
        const feature = featureEl.value.trim();
        if (feature) request.feature = feature;
        if (ctx.signIn.value) request.signInAs = ctx.signIn.value;
        const next = await api("/api/briefs", request);
        newState.brief = next;
        if (!live()) return;
        busy = false;
        show(next);
        heading.focus();
      } catch (err) {
        if (live()) showDraftError(err);
      } finally {
        busy = false;
        if (live()) {
          progress.textContent = "";
          draftButton.disabled = false;
          draftButton.classList.remove("busy");
          draftButton.textContent = "Draft a brief";
          refreshButtons();
        }
      }
    });

    // ----- the editor -----

    const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    const dataKey = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));

    function setStatus(text) { editStatus.textContent = text; }
    function clearErrors() {
      editError.textContent = "";
      for (const el of body.querySelectorAll(".q-error")) el.textContent = "";
    }

    /** Draws a draft the server sent: the state tag, then the body; the buttons follow. */
    function show(next) {
      draft = next;
      newState.brief = next;
      const approved = Boolean(next.hash && next.brief.approval);
      card.hidden = false;
      stateTag.textContent = approved ? "Approved" : "Not approved";
      stateTag.className = "tag" + (approved ? " new" : "");
      drawBody();
      refreshButtons();
    }

    /** Edit rows keep their controls here, so collectEdit can read them. */
    function relabel(rows, noun) {
      rows.forEach((row, i) => {
        row.input.setAttribute("aria-label", noun + " " + (i + 1));
        row.remove.setAttribute("aria-label", "Remove " + noun.toLowerCase() + " " + (i + 1));
      });
    }

    function drawBody() {
      const b = draft.brief;
      const approved = Boolean(draft.hash && b.approval);
      refs = { exps: [], areas: [], data: [] };

      // ---- approval, warnings, questions
      const top = [];
      if (approved) {
        top.push(h("div", { class: "brief-approved", id: "brief-approved", tabindex: "-1" },
          h("p", { class: "ok" }, ring("pass", { silent: true }), h("b", { text: "Approved" }), " at ", h("time", { datetime: b.approval.at, text: hms(b.approval.at) })),
          h("p", { class: "muted" }, "Hash ", h("code", { class: "mono", title: draft.hash, text: draft.hash.slice(0, 12) })),
          h("p", { class: "muted", text: "Agent runs arrive in a later version. This brief is kept until Run Hound restarts." })));
      }
      if (draft.warnings.length) {
        top.push(h("div", { class: "warning", id: "brief-warnings" }, draft.warnings.map((w) => h("p", { text: w }))));
      }
      const open = draft.questions.filter((q) => !q.settled);
      const done = draft.questions.filter((q) => q.settled);
      if (open.length || done.length) {
        top.push(h("div", { class: "brief-questions", id: "brief-questions" },
          open.length ? h("h3", { class: "brief-h", text: open.length === 1 ? "A question first" : "Questions first" }) : null,
          open.map(questionBlock),
          done.length ? h("ul", { class: "q-done", "aria-label": "Answered questions" }, done.map((q) => h("li", {},
            h("span", { class: "q-done-text", text: q.text }), " ",
            h("span", { class: "q-done-answer", text: q.answer === null ? "Skipped" : answerLabel(q, q.answer) }),
          ))) : null));
      }

      // ---- goal, start page
      refs.goal = h("textarea", { class: "input prose", id: "brief-goal-edit", rows: "3", maxlength: L.goalChars });
      refs.goal.value = b.goal;
      refs.start = h("input", { class: "input", id: "brief-start", type: "text", spellcheck: "false", autocomplete: "off", placeholder: "/", "aria-describedby": "brief-start-origin brief-start-hint" });
      refs.start.value = b.target.startPath;
      const goalField = h("div", { class: "brief-field" }, h("label", { class: "field-label", for: "brief-goal-edit", text: "Goal" }), refs.goal);
      const startField = h("div", { class: "brief-field" },
        h("label", { class: "field-label", for: "brief-start", text: "Start page" }),
        h("div", { class: "path-row" }, h("span", { class: "path-origin mono", id: "brief-start-origin", text: b.target.origin }), refs.start),
        h("p", { class: "field-hint", id: "brief-start-hint", text: "A path on this site, like /app/settings." }));

      // ---- areas to stay in
      const areaList = h("ul", { class: "brief-list", id: "brief-areas" });
      const addArea = addRow("area", "Add an area", "/app", "Add area", (value) => { areaRow(value); relabel(refs.areas, "Area"); }, 2048);
      refs.areaAdd = addArea.input;
      function areaRow(value) {
        const row = { input: h("input", { class: "input", type: "text", spellcheck: "false", autocomplete: "off" }), remove: h("button", { type: "button", class: "btn small", text: "Remove" }) };
        row.input.value = value;
        row.li = h("li", { class: "brief-row" }, row.input, row.remove);
        row.remove.addEventListener("click", () => {
          refs.areas.splice(refs.areas.indexOf(row), 1);
          row.li.remove();
          relabel(refs.areas, "Area");
          announce("Area removed");
          addArea.input.focus();
          refreshButtons();
        });
        refs.areas.push(row);
        areaList.append(row.li);
      }
      for (const p of b.scopePaths) areaRow(p);
      relabel(refs.areas, "Area");
      const areasField = h("div", { class: "brief-field", role: "group", "aria-labelledby": "brief-areas-h" },
        h("h3", { class: "field-label", id: "brief-areas-h", text: "Areas to stay in" }),
        areaList,
        addArea.row,
        h("p", { class: "field-hint", text: "Paths the agent stays within. Leave empty to allow the whole site." }));

      // ---- expectations
      const expList = h("ul", { class: "brief-list", id: "brief-expectations" });
      const addExp = addRow("exp", "Add an expectation", "What should be true", "Add expectation", (value) => { expRow(value, null); relabel(refs.exps, "Expectation"); }, L.expectationChars);
      refs.expAdd = addExp.input;
      function expRow(text, source) {
        const row = {
          orig: source === null ? null : text,
          source,
          input: h("textarea", { class: "input prose", rows: "2", maxlength: L.expectationChars }),
          tag: h("span", { class: "tag", id: uid("source") }),
          remove: h("button", { type: "button", class: "btn small", text: "Remove" }),
        };
        row.input.value = text;
        row.input.setAttribute("aria-describedby", row.tag.id);
        // The tag is the server's word for the text as it was sent; reworded text shows as edited until it is saved.
        const paint = () => {
          const unchanged = row.orig !== null && row.input.value.trim() === row.orig;
          row.tag.className = "tag " + (unchanged ? "src-" + row.source : "src-edited");
          row.tag.textContent = unchanged ? BRIEF_SOURCE_TAG[row.source] || row.source : row.orig === null ? "New" : "Edited";
        };
        paint();
        row.input.addEventListener("input", paint);
        row.li = h("li", { class: "brief-exp" }, h("div", { class: "exp-meta" }, row.tag), row.input, row.remove);
        row.remove.addEventListener("click", () => {
          refs.exps.splice(refs.exps.indexOf(row), 1);
          row.li.remove();
          relabel(refs.exps, "Expectation");
          announce("Expectation removed");
          addExp.input.focus();
          refreshButtons();
        });
        refs.exps.push(row);
        expList.append(row.li);
      }
      for (const e of b.expectations) expRow(e.text, e.source);
      relabel(refs.exps, "Expectation");
      const expectField = h("div", { class: "brief-field", role: "group", "aria-labelledby": "brief-exps-h" },
        h("h3", { class: "field-label", id: "brief-exps-h", text: "Expectations" }),
        h("p", { class: "field-hint brief-lead", text: "What should be true when it works. “You said” is yours; “Assumed” is the model’s guess, so reword or remove what is wrong." }),
        expList,
        addExp.row);

      // ---- account
      refs.account = h("select", { class: "input", id: "brief-account" });
      for (const id of ACCOUNT_SLOTS) {
        const unusable = ctx.accountsKnown() && !ctx.accountReady(id) && b.account !== id;
        refs.account.append(h("option", { value: id, disabled: unusable, text: unusable ? ctx.accountChoiceName(id) + " · Set it up in Settings" : ctx.accountChoiceName(id) }));
      }
      refs.account.append(h("option", { value: "", text: "Signed out" }));
      refs.account.value = b.account || "";
      const accountField = h("div", { class: "brief-field" },
        h("label", { class: "field-label", for: "brief-account", text: "Account" }), refs.account,
        h("p", { class: "field-hint", text: "Who the agent signs in as. Test accounts are set up in Settings." }));

      // ---- test data
      const dataList = h("ul", { class: "brief-list", id: "brief-data" });
      function dataRow(name, value) {
        const row = {
          name: h("input", { class: "input", type: "text", maxlength: L.dataNameChars, placeholder: "Name", autocomplete: "off", spellcheck: "false" }),
          input: h("input", { class: "input", type: "text", maxlength: L.dataValueChars, placeholder: "Value", autocomplete: "off", spellcheck: "false" }),
          remove: h("button", { type: "button", class: "btn small", text: "Remove" }),
        };
        row.name.value = name;
        row.input.value = value;
        row.li = h("li", { class: "brief-row data-row" }, row.name, row.input, row.remove);
        row.remove.addEventListener("click", () => {
          refs.data.splice(refs.data.indexOf(row), 1);
          row.li.remove();
          relabelData();
          announce("Test value removed");
          addData.focus();
          refreshButtons();
        });
        refs.data.push(row);
        dataList.append(row.li);
        relabelData();
        return row;
      }
      function relabelData() {
        refs.data.forEach((row, i) => {
          row.name.setAttribute("aria-label", "Test value " + (i + 1) + " name");
          row.input.setAttribute("aria-label", "Test value " + (i + 1) + " value");
          row.remove.setAttribute("aria-label", "Remove test value " + (i + 1));
        });
      }
      for (const name of Object.keys(b.testData)) dataRow(name, b.testData[name]);
      const addData = h("button", { type: "button", class: "btn small", id: "brief-data-add", text: "Add test value" });
      addData.addEventListener("click", () => {
        dataRow("", "").name.focus();
        refreshButtons();
      });
      const dataField = h("div", { class: "brief-field", role: "group", "aria-labelledby": "brief-data-h" },
        h("h3", { class: "field-label", id: "brief-data-h", text: "Test data" }),
        h("p", { class: "field-hint brief-lead", text: "Values the agent may type, by name. Never a password: saved test accounts hold those." }),
        dataList,
        h("div", { class: "brief-add" }, addData));

      // ---- permissions
      refs.allowMod = h("input", { type: "checkbox", id: "brief-allow-mod" });
      refs.allowMod.checked = b.mutationPermissions.modifyExisting === true;
      const fixedOption = (id, label, desc) => h("div", { class: "option" },
        h("input", { type: "checkbox", id, checked: true, disabled: true }),
        h("label", { for: id }, label, h("span", { class: "desc", text: desc })));
      const permsField = h("fieldset", { class: "brief-field brief-perms" },
        h("legend", { class: "field-label", text: "What the agent may do" }),
        h("div", { class: "options flush" },
          fixedOption("brief-perm-read", "Look around and read pages", "Always allowed."),
          fixedOption("brief-perm-create", "Create test data", "Always allowed, in the app under test only."),
          h("div", { class: "option" }, refs.allowMod,
            h("label", { for: "brief-allow-mod" }, "Change records that existed before the run", h("span", { class: "desc", text: "Off unless you turn it on. Test records the run creates are always fair game." })))),
        h("p", { class: "field-hint", text: "Deleting records, changing passwords and writing to other sites are never allowed." }));

      fill(body, top, goalField, startField, areasField, expectField, accountField, dataField, permsField);
    }

    /** An "add" row: a labelled input and an Add button; Enter in the input adds too. Text left in it counts as pending when saving. */
    function addRow(key, label, placeholder, buttonText, add, max) {
      const inputEl = h("input", { class: "input", type: "text", id: uid(key + "-add"), maxlength: max, placeholder, autocomplete: "off", spellcheck: key === "area" ? "false" : "true", "aria-label": label });
      const button = h("button", { type: "button", class: "btn small", text: buttonText });
      const run = () => {
        const value = inputEl.value.trim();
        if (!value) { inputEl.focus(); return; }
        add(value);
        inputEl.value = "";
        inputEl.focus();
        announce("Added");
        refreshButtons();
      };
      button.addEventListener("click", run);
      inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); run(); }
      });
      return { input: inputEl, row: h("div", { class: "brief-add" }, inputEl, button) };
    }

    // ----- questions -----

    function answerLabel(q, value) {
      if (q.kind === "account") return value === "signed-out" ? "Signed out" : ctx.accountChoiceName(value);
      if (q.kind === "permission") return BRIEF_PERMISSION_ANSWER[value] || value;
      return value;
    }

    function questionBlock(q) {
      const textId = uid("qtext");
      const err = h("p", { class: "error q-error", role: "alert" });
      let value = null;
      const answer = h("button", { type: "button", class: "btn small primary", text: "Answer", disabled: true, "aria-describedby": textId });
      const skip = h("button", { type: "button", class: "btn small", text: "Skip", "aria-describedby": textId });
      let prompt;
      let control;
      if (q.options && q.options.length) {
        prompt = h("p", { class: "q-text", id: textId, text: q.text });
        const buttons = q.options.map((opt) => {
          const unusable = q.kind === "account" && opt !== "signed-out" && ctx.accountsKnown() && !ctx.accountReady(opt);
          const text = answerLabel(q, opt);
          const b = h("button", { type: "button", class: "btn small option-btn", "aria-pressed": "false", disabled: unusable, text: unusable ? text + " · not set up" : text });
          b.addEventListener("click", () => {
            value = opt;
            for (const x of buttons) x.setAttribute("aria-pressed", String(x === b));
            answer.disabled = false;
          });
          return b;
        });
        control = h("div", { class: "q-options" }, buttons);
      } else {
        const inputId = uid("qin");
        const kindHint = q.kind === "test-data" && q.dataName ? "Sets the test value “" + q.dataName + "”." : q.kind === "start-path" || q.kind === "scope" ? "A path on the site, like /app/settings." : q.kind === "expectation" ? "Becomes an expectation, in your words." : "";
        const maxlength = q.kind === "expectation" ? L.expectationChars : q.kind === "test-data" ? L.dataValueChars : null;
        const inputEl = h("input", { class: "input", type: "text", id: inputId, maxlength, autocomplete: "off", "aria-describedby": kindHint ? inputId + "-hint" : null });
        prompt = h("label", { class: "q-text", id: textId, for: inputId, text: q.text });
        inputEl.addEventListener("input", () => {
          value = inputEl.value.trim();
          answer.disabled = value === "";
        });
        inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (!answer.disabled) answer.click();
          }
        });
        control = h("div", { class: "q-input" }, inputEl, kindHint ? h("p", { class: "field-hint", id: inputId + "-hint", text: kindHint }) : null);
      }
      const block = h("div", { class: "brief-q", role: "group", tabindex: "-1", "aria-labelledby": textId, "data-question-id": q.id, "data-kind": q.kind }, prompt, control, h("div", { class: "q-actions" }, answer, skip), err);
      answer.addEventListener("click", () => submitAnswers({ [q.id]: value }, err));
      skip.addEventListener("click", () => submitAnswers({ [q.id]: null }, err));
      return block;
    }

    // ----- reading and saving -----

    /** What changed against the draft, as a BriefEdit; {} when nothing did. Text left in an "add" input counts as added. */
    function collectEdit() {
      const b = draft.brief;
      const edit = {};
      const goal = refs.goal.value.trim();
      if (goal !== b.goal) edit.goal = goal;
      const start = refs.start.value.trim();
      if (start !== b.target.startPath) edit.startPath = start;
      const areas = refs.areas.map((r) => r.input.value.trim()).filter(Boolean);
      if (refs.areaAdd.value.trim()) areas.push(refs.areaAdd.value.trim());
      if (!sameList(areas, b.scopePaths)) edit.scopePaths = areas;
      const exps = refs.exps.map((r) => r.input.value.trim()).filter(Boolean);
      if (refs.expAdd.value.trim()) exps.push(refs.expAdd.value.trim());
      if (!sameList(exps, b.expectations.map((e) => e.text))) edit.expectations = exps;
      const account = refs.account.value || null;
      if (account !== b.account) edit.account = account;
      const data = {};
      for (const r of refs.data) {
        const name = r.name.value.trim();
        if (name) data[name] = r.input.value.trim();
      }
      if (dataKey(data) !== dataKey(b.testData)) edit.testData = data;
      if (refs.allowMod.checked !== (b.mutationPermissions.modifyExisting === true)) edit.allowModification = refs.allowMod.checked;
      return edit;
    }

    function refreshButtons() {
      if (!draft || !refs) return;
      const dirty = Object.keys(collectEdit()).length > 0;
      const approved = Boolean(draft.hash && draft.brief.approval);
      saveButton.disabled = busy || !dirty;
      approveButton.disabled = busy || (approved && !dirty);
      approveButton.textContent = approved && !dirty ? "Approved" : "Approve brief";
    }
    body.addEventListener("input", refreshButtons);
    body.addEventListener("change", refreshButtons);
    approveButton.addEventListener("click", () => approve());
    saveButton.addEventListener("click", () => saveChanges());

    const said = (text) => text + " at " + hms(new Date().toISOString()) + ".";

    async function saveChanges() {
      if (busy || !draft) return;
      const edit = collectEdit();
      if (Object.keys(edit).length === 0) return;
      const wasApproved = Boolean(draft.hash);
      busy = true;
      clearErrors();
      refreshButtons();
      setStatus("Saving…");
      try {
        const next = await api(briefUrl(), edit, "PUT");
        newState.brief = next;
        busy = false;
        if (!live()) return;
        show(next);
        setStatus(said("Saved") + (wasApproved ? " The approval was cleared: approve the brief again." : ""));
        approveButton.focus();
      } catch (err) {
        busy = false;
        if (!live()) return;
        setStatus("");
        editError.textContent = err.message;
        refreshButtons();
      }
    }

    /** Answers or skips a question; edits not saved yet go in the same request, so the redraw doesn't lose them. */
    async function submitAnswers(answers, errEl) {
      if (busy || !draft) return;
      const edit = collectEdit();
      edit.answers = answers;
      busy = true;
      clearErrors();
      refreshButtons();
      setStatus("Saving…");
      try {
        const next = await api(briefUrl(), edit, "PUT");
        newState.brief = next;
        busy = false;
        if (!live()) return;
        show(next);
        setStatus(said("Saved"));
        const nextQuestion = body.querySelector(".brief-q");
        (nextQuestion || refs.goal).focus();
      } catch (err) {
        busy = false;
        if (!live()) return;
        setStatus("");
        errEl.textContent = err.message;
        refreshButtons();
      }
    }

    /** Saves what is pending, then approves; a failed approval still shows what was saved. */
    async function approve() {
      if (busy || !draft) return;
      const edit = collectEdit();
      let current = draft;
      let saved = false;
      busy = true;
      clearErrors();
      refreshButtons();
      setStatus("Approving…");
      try {
        if (Object.keys(edit).length > 0) {
          current = await api(briefUrl(), edit, "PUT");
          saved = true;
        }
        const approved = await api(briefUrl() + "/approve", {});
        newState.brief = approved;
        busy = false;
        if (!live()) return;
        show(approved);
        setStatus("");
        $("brief-approved").focus();
      } catch (err) {
        busy = false;
        if (!live()) return;
        if (saved) {
          newState.brief = current;
          show(current);
        }
        setStatus(saved ? said("Your changes were saved") + " The brief is not approved." : "");
        editError.textContent = err.message;
        refreshButtons();
      }
    }

    // A draft kept from before (going to Runs and back) comes back once the accounts are known, so their names are right.
    if (newState.brief) {
      ctx.accountsLoaded.then(() => {
        if (live() && !draft) show(newState.brief);
      });
    }
  }

`;
