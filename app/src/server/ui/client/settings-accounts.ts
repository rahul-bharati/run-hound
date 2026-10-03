/**
 * Section of the inline client script: Settings: test accounts (0.4.0).
 * Concatenated in order with the others to form the body of String.raw in client.ts.
 */
export const SETTINGS_ACCOUNTS = String.raw`  // ---------- Settings: test accounts (0.4.0) ----------

  /**
   * Two cards (Account A and B: label, sign-in page URL, username, a write-only password), the "must not see each
   * other's data" setting and what the access checks do. The page never holds a saved password: GET /api/accounts
   * only says whether one is saved, and a typed one is cleared from the field once it is saved.
   */
  function accountsCard(my) {
    const card = h("section", { class: "card accounts-card", id: "accounts-card", "aria-labelledby": "accounts-h" },
      h("h2", { id: "accounts-h", class: "card-title", text: "Test accounts" }),
      h("p", { class: "loading", text: "Loading…" }));
    api("/api/accounts").then((st) => {
      if (my !== gen) return;
      if (!st || !st.accounts) throw new Error("The server sent no test accounts.");
      drawAccounts(card, st, my);
    }).catch((err) => {
      if (my !== gen) return;
      fill(card, card.firstChild, h("p", { class: "error", text: "Could not load the test accounts: " + err.message }));
    });
    return card;
  }

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
    fill(card,
      h("h2", { id: "accounts-h", class: "card-title", text: "Test accounts" }),
      h("p", { class: "muted acct-intro", text: "Two accounts on your app, so Run Hound can test pages behind a sign-in: choose one under New Run → Sign in as. Run Hound signs in with them in its own browser and never shows a saved password again." }),
      h("p", { class: "acct-note" },
        h("b", { text: "Access checks: " }),
        "signed in as Account A, Run Hound checks that Account B, and a visitor who isn't signed in, can't read Account A's data. ",
        h("b", { text: "Write-side checks" }),
        " (unticked by default): ", h("code", { class: "mono", text: "write-access" }),
        " checks that they can't change or delete it either, ", h("code", { class: "mono", text: "csrf" }),
        " that a page on another site can't change it, and ", h("code", { class: "mono", text: "paywall-trust" }),
        " that Account A can't get a paid plan without paying. They change Account A's data (only test records Run Hound creates in it, or its plan) and put it back. Use accounts you own, made for testing: never a real customer's. Runs create test records in Account A."),
      h("div", { class: "acct-grid" }, slots),
      h("div", { class: "option acct-isolated" }, isolated,
        h("label", { for: "acct-isolated" }, "A and B must not see each other's data",
          h("span", { class: "desc", text: "Tick when they are different users, not teammates in one workspace. Run Hound only checks that Account B can't read or change Account A's data when this is ticked." })),
        lockedIsolated ? h("span", { class: "locked", text: "Set by environment" }) : null),
      isolatedMsg,
      st.file ? h("p", { class: "note" }, "Saved to ", h("code", { class: "mono", text: st.file }), ", readable only by you.") : null);
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
      const label = field("label", "Label", "text", { placeholder: defaultAccountLabel(id), maxlength: "60" }, "How plans and reports name this account.");
      label.input.value = typeof s.label === "string" ? s.label : "";
      const loginUrl = field("loginUrl", "Sign-in page URL", "url", { placeholder: "http://localhost:5173/login" }, null);
      loginUrl.input.value = s.loginUrl || "";
      const username = field("username", "Username", "text", { autocomplete: "off", placeholder: "you@example.test" }, "What the sign-in form's email or username field takes.");
      username.input.value = s.username || "";

      // The password is write-only: the field starts empty, and a typed one is sent once, on Save.
      const password = h("input", { id: pre + "password", class: "input", type: "password", autocomplete: "new-password", spellcheck: "false", disabled: locked("password"),
        placeholder: hasPassword ? "Saved: type a new one to replace it" : "Not set", "aria-describedby": pre + "password-state" });
      password.value = "";
      const pwState = h("span", { class: "field-hint pw-state", id: pre + "password-state" });
      const originNote = h("span", { class: "field-hint warn-note", id: pre + "origin-note" });
      const setPwState = () => {
        pwState.textContent = locked("password") ? "" : removePassword ? "The saved password will be removed when you save." : hasPassword ? "Password saved" : "No password yet";
      };
      setPwState();
      let remove = null;
      if (hasPassword && !locked("password")) {
        const removeText = h("span", { text: "Remove" });
        remove = h("button", { type: "button", class: "link-btn", id: pre + "password-remove" }, removeText, h("span", { class: "visually-hidden", text: " the saved password of " + name }));
        remove.addEventListener("click", () => {
          removePassword = !removePassword;
          removeText.textContent = removePassword ? "Undo remove" : "Remove";
          password.placeholder = removePassword ? "Will be removed" : "Saved: type a new one to replace it";
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

      const saveText = h("span", { text: "Save" });
      const save = h("button", { type: "button", class: "btn primary small", id: pre + "save" }, saveText, h("span", { class: "visually-hidden", text: " " + name }));
      const testText = h("span", { text: "Test sign-in" });
      const test = h("button", { type: "button", class: "btn small", id: pre + "test" }, testText, h("span", { class: "visually-hidden", text: " as " + name }));
      const error = h("p", { class: "error", id: pre + "error" });
      const saved = h("p", { class: "saved", id: pre + "saved", text: message || "" });
      const testOut = h("p", { class: "field-hint acct-test", id: pre + "test-result" });

      save.addEventListener("click", async () => {
        error.textContent = "";
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
          error.textContent = err.message;
        }
      });
      test.addEventListener("click", async () => {
        test.disabled = true;
        testText.textContent = "Signing in…";
        testOut.className = "field-hint acct-test";
        testOut.textContent = "Signing in with the saved details. This can take a few seconds.";
        try {
          const r = await api("/api/accounts/test", { id });
          if (my !== gen) return;
          testOut.className = r.ok ? "acct-ok acct-test" : "error acct-test";
          testOut.textContent = r.message || (r.ok ? "Signed in." : "Could not sign in.");
        } catch (err) {
          if (my !== gen) return;
          testOut.className = "error acct-test";
          testOut.textContent = err.message;
        }
        test.disabled = false;
        testText.textContent = "Test sign-in";
        announce(testOut.textContent);
      });

      const custom = name !== defaultAccountLabel(id);
      fill(fs,
        h("legend", {}, name, custom ? h("span", { class: "slot", text: " · " + defaultAccountLabel(id) }) : null),
        s.problem ? h("p", { class: "warning acct-problem", id: pre + "problem", text: s.problem }) : null,
        label.row, loginUrl.row, username.row,
        h("div", { class: "acct-field" },
          h("label", { class: "field-label", for: pre + "password", text: "Password" }), password, lockNote("password"),
          h("span", { class: "pw-line" }, pwState, remove), originNote),
        h("div", { class: "acct-actions" }, save, test),
        error, saved, testOut);
    };
    draw(initial, "");
    return fs;
  }

`;
