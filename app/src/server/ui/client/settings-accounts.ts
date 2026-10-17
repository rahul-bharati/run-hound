/**
 * Section of the inline client script: Settings: test accounts (0.4.0).
 * Concatenated in order with the others to form the body of String.raw in client.ts.
 */
export const SETTINGS_ACCOUNTS = String.raw`  // ---------- Settings: test accounts (0.4.0) ----------

  /**
   * Two cards (Account A and B: status, sign-in page URL, username, a write-only password and an optional name), the
   * "must not see each other's data" setting and what the access checks do. The page never holds a saved password:
   * GET /api/accounts only says whether one is saved, and a typed one is cleared from the field once it is saved. How
   * passwords are kept is said once, in the Keys and passwords card.
   */
  function accountsCard(my, known) {
    const card = h("section", { class: "card accounts-card", id: "accounts-card", "aria-labelledby": "accounts-h" },
      h("h2", { id: "accounts-h", class: "card-title" }, icon("users"), "Test accounts"),
      h("p", { class: "loading", text: "Loading…" }));
    api("/api/accounts").then((st) => {
      if (my !== gen) return;
      if (!st || !st.accounts) throw new Error("The server sent no test accounts.");
      known.report("accounts", st);
      drawAccounts(card, st, my);
    }).catch((err) => {
      if (my !== gen) return;
      known.report("accounts", null);
      fill(card, card.firstChild, h("p", { class: "error", text: "Could not load the test accounts: " + err.message }));
    });
    return card;
  }

  /** What an account still lacks, in the words the status chip uses; empty when the account has all three. */
  function accountNeeds(s) {
    const need = [];
    if (!s.loginUrl) need.push("a sign-in page");
    if (!s.username) need.push("a username");
    if (!s.hasPassword) need.push("a password");
    return need;
  }
  /** "a", "a and b", "a, b and c". */
  const joinNeeds = (xs) => (xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1]);

  function drawAccounts(card, st, my) {
    const lockedIsolated = st.isolatedSource === "env";
    const isolated = h("input", { type: "checkbox", id: "acct-isolated", disabled: lockedIsolated });
    isolated.checked = st.isolated !== false;
    const isolatedMsg = h("p", { class: "saved", id: "acct-isolated-msg" });
    isolated.addEventListener("change", async () => {
      const want = isolated.checked;
      isolated.disabled = true;
      isolatedMsg.className = "saved";
      isolatedMsg.textContent = "Saving…";
      try {
        const next = await api("/api/accounts", { isolated: want }, "PUT");
        if (my !== gen) return;
        isolated.checked = next.isolated !== false;
        isolatedMsg.textContent = "Saved at " + hms(new Date().toISOString()) + ".";
      } catch (err) {
        if (my !== gen) return;
        isolated.checked = !want;
        isolatedMsg.className = "error";
        isolatedMsg.textContent = err.message;
      }
      isolated.disabled = false;
    });
    const slots = ACCOUNT_SLOTS.map((id) => accountSlot(id, st.accounts[id] || { id, label: defaultAccountLabel(id) }, my));
    const code = (t) => h("code", { class: "mono", text: t });
    fill(card,
      h("h2", { id: "accounts-h", class: "card-title" }, icon("users"), "Test accounts"),
      h("p", { class: "muted acct-intro", text: "Test accounts let Run Hound check pages behind a sign-in. It signs in with them in its own browser: choose one under New Run → Sign in as. Use accounts made for testing, never a real customer's." }),
      h("details", { class: "more acct-more", id: "acct-more" },
        h("summary", {}, icon("chevronRight"), h("span", { text: "What Run Hound does with two accounts" })),
        h("ul", { class: "more-body" },
          h("li", {}, h("b", { text: "Access checks: " }), "signed in as Account A, Run Hound checks that Account B, and a visitor who isn't signed in, can't read Account A's data."),
          h("li", {}, h("b", { text: "Write-side checks" }), " (off by default): ", code("write-access"), " checks that they can't change or delete it either, ", code("csrf"), " that a page on another site can't change it, and ", code("paywall-trust"), " that Account A can't get a paid plan without paying."),
          h("li", {}, "The write-side checks change Account A's data (only test records Run Hound creates in it, or its plan) and put it back."),
          h("li", {}, "Runs create test records in Account A, so use accounts you own."))),
      h("div", { class: "acct-grid" }, slots),
      h("div", { class: "option acct-isolated" }, isolated,
        h("label", { for: "acct-isolated" }, "A and B must not see each other's data",
          h("span", { class: "desc", text: "Tick this if they are different users, not teammates in one workspace: Run Hound then checks that Account B can't read or change Account A's data." })),
        lockedIsolated ? h("span", { class: "locked", text: "Set by environment" }) : null),
      isolatedMsg);
  }

  /** One account's card: a fieldset named by the account's label. Save and Test sign-in act on this account only. */
  function accountSlot(id, initial, my) {
    const fs = h("fieldset", { class: "acct", id: "acct-" + id });
    const pre = "acct-" + id + "-";
    const draw = (s, message) => {
      const sources = s.sources || {};
      const locked = (k) => sources[k] === "env";
      const lockNote = (k) => (locked(k) ? h("span", { class: "locked", text: "Set by environment" }) : null);
      const name = accountName({ id, label: s.label });
      const hasPassword = s.hasPassword === true;
      let removePassword = false;

      const field = (key, label, type, attrs, hint) => {
        const input = h("input", Object.assign({ id: pre + key, class: "input", type, spellcheck: "false", autocomplete: "off", disabled: locked(key) }, attrs));
        const hintEl = hint ? h("span", { class: "field-hint", id: pre + key + "-hint", text: hint }) : null;
        if (hintEl) input.setAttribute("aria-describedby", hintEl.id);
        return { input, row: h("div", { class: "acct-field" }, h("label", { class: "field-label", for: pre + key, text: label }), input, lockNote(key), hintEl) };
      };
      const loginUrl = field("loginUrl", "Sign-in page URL", "url", { placeholder: "http://localhost:5173/login" }, "The page with your app's sign-in form.");
      loginUrl.input.value = s.loginUrl || "";
      const username = field("username", "Username (or email)", "text", { autocomplete: "off", placeholder: "you@example.test" }, "What the sign-in form's email or username field takes.");
      username.input.value = s.username || "";
      const label = field("label", "Name in plans and reports (optional)", "text", { placeholder: defaultAccountLabel(id), maxlength: "60" }, "Plans and reports call this account by this name, never by its username.");
      label.input.value = typeof s.label === "string" ? s.label : "";

      // The password is write-only: the field starts empty, and a typed one is sent once, on Save. The toggle shows
      // only what is being typed; a saved password is never sent to the page.
      const password = h("input", { id: pre + "password", class: "input", type: "password", autocomplete: "new-password", spellcheck: "false", disabled: locked("password"),
        placeholder: hasPassword ? "Saved" : "Not set", "aria-describedby": pre + "password-state" });
      password.value = "";
      let shown = false;
      const toggleIcon = h("span", { class: "pw-ic" }, icon("eye"));
      const toggleText = h("span", { text: "Show" });
      const toggle = locked("password") ? null : h("button", { type: "button", class: "btn small pw-toggle", id: pre + "password-toggle" }, toggleIcon, toggleText, h("span", { class: "visually-hidden", text: " password for " + name }));
      if (toggle) {
        toggle.addEventListener("click", () => {
          shown = !shown;
          password.type = shown ? "text" : "password";
          toggleText.textContent = shown ? "Hide" : "Show";
          fill(toggleIcon, icon(shown ? "eyeOff" : "eye"));
        });
      }
      const pwState = h("span", { class: "field-hint pw-state", id: pre + "password-state" });
      const originNote = h("span", { class: "field-hint warn-note", id: pre + "origin-note" });
      const setPwState = () => {
        pwState.textContent = locked("password") ? "" : removePassword ? "The saved password will be removed when you save." : hasPassword ? "Password saved. Type a new one to replace it." : "No password yet";
      };
      setPwState();
      let remove = null;
      if (hasPassword && !locked("password")) {
        const removeText = h("span", { text: "Remove" });
        remove = h("button", { type: "button", class: "link-btn", id: pre + "password-remove" }, removeText, h("span", { class: "visually-hidden", text: " the saved password of " + name }));
        remove.addEventListener("click", () => {
          removePassword = !removePassword;
          removeText.textContent = removePassword ? "Undo remove" : "Remove";
          password.placeholder = removePassword ? "Will be removed" : "Saved";
          setPwState();
        });
      }
      // A saved password is only sent to the sign-in page's origin it was saved for: warn before a new origin drops it.
      const originOf = (u) => { try { return new URL(u).origin; } catch (e) { return null; } };
      const savedOrigin = originOf(s.loginUrl || "");
      const checkOrigin = () => {
        const moved = hasPassword && !removePassword && !password.value && savedOrigin !== null && originOf(loginUrl.input.value.trim()) !== savedOrigin;
        originNote.textContent = moved ? "A different site's sign-in page: the saved password is only sent where it was saved, so saving this removes it. Type the password again to keep one." : "";
      };
      loginUrl.input.addEventListener("input", checkOrigin);
      password.addEventListener("input", checkOrigin);
      // Test sign-in uses what is saved: say so when the form holds something that isn't.
      const unsaved = () =>
        (!locked("loginUrl") && loginUrl.input.value.trim() !== (s.loginUrl || "")) ||
        (!locked("username") && username.input.value.trim() !== (s.username || "")) ||
        password.value !== "" ||
        removePassword;

      const saveText = h("span", { text: "Save" });
      const save = h("button", { type: "button", class: "btn primary small", id: pre + "save" }, saveText, h("span", { class: "visually-hidden", text: " " + name }));
      const testText = h("span", { text: "Test sign-in" });
      const test = h("button", { type: "button", class: "btn small", id: pre + "test" }, testText, h("span", { class: "visually-hidden", text: " as " + name }));
      const error = h("div", { class: "notice", id: pre + "error", role: "alert" });
      const saved = h("p", { class: "saved", id: pre + "saved", text: message || "" });
      const testOut = h("div", { class: "notice acct-test", id: pre + "test-result" });

      save.addEventListener("click", async () => {
        setNotice(error, "err", "");
        saved.textContent = "";
        const patch = {};
        if (!locked("label")) patch.label = label.input.value.trim();
        if (!locked("loginUrl")) patch.loginUrl = loginUrl.input.value.trim();
        if (!locked("username")) patch.username = username.input.value.trim();
        if (!locked("password")) {
          if (password.value) patch.password = password.value;
          else if (removePassword) patch.password = "";
        }
        save.disabled = true;
        saveText.textContent = "Saving…";
        try {
          const next = await api("/api/accounts", { accounts: { [id]: patch } }, "PUT");
          if (my !== gen) return;
          password.value = "";
          draw((next.accounts && next.accounts[id]) || s, "Saved at " + hms(new Date().toISOString()) + ".");
          announce(accountName({ id, label: next.accounts && next.accounts[id] ? next.accounts[id].label : name }) + " saved.");
          const again = document.getElementById(pre + "save");
          if (again) again.focus();
        } catch (err) {
          if (my !== gen) return;
          save.disabled = false;
          saveText.textContent = "Save";
          setNotice(error, "err", err.message);
        }
      });
      test.addEventListener("click", async () => {
        test.disabled = true;
        testText.textContent = "Signing in…";
        setNotice(testOut, "info", "Signing in with the saved details. This can take a few seconds." + (unsaved() ? " What you have typed since you last saved isn't used." : ""));
        try {
          const r = await api("/api/accounts/test", { id });
          if (my !== gen) return;
          setNotice(testOut, r.ok ? "ok" : "err", r.message || (r.ok ? "Signed in." : "Could not sign in."));
        } catch (err) {
          if (my !== gen) return;
          setNotice(testOut, "err", err.message);
        }
        test.disabled = false;
        testText.textContent = "Test sign-in";
        announce(testOut.textContent);
      });

      // What this account lacks, as a chip: Ready (saved and complete), Not set up, or what is missing.
      const need = accountNeeds(s);
      const state = s.ready === true ? chip("ok", "Ready", { id: pre + "status" })
        : need.length === 3 ? chip("", "Not set up", { id: pre + "status" })
        : need.length > 0 ? chip("warn", "Needs " + joinNeeds(need), { id: pre + "status" })
        : chip("warn", "Needs attention", { id: pre + "status" });
      const stateHint = s.ready === true ? "Saved. Choose Test sign-in to check that it works."
        : need.length === 3 ? "Fill these in, then choose Save."
        : "Add what is missing, then choose Save.";
      const custom = name !== defaultAccountLabel(id);
      fill(fs,
        h("legend", {}, name, custom ? h("span", { class: "slot", text: " · " + defaultAccountLabel(id) }) : null),
        h("div", { class: "acct-status" }, state, h("span", { class: "field-hint", text: stateHint })),
        s.problem ? noticeBox("warn", s.problem, { id: pre + "problem", class: "acct-problem" }) : null,
        loginUrl.row, username.row,
        h("div", { class: "acct-field" },
          h("label", { class: "field-label", for: pre + "password", text: "Password" }),
          h("div", { class: "pw-row" }, password, toggle),
          lockNote("password"),
          h("span", { class: "pw-line" }, pwState, remove), originNote),
        label.row,
        h("div", { class: "acct-actions" }, save, test),
        error, saved, testOut);
    };
    draw(initial, "");
    return fs;
  }

`;
