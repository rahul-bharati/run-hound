/**
 * Section of the inline client script: Settings: AI (0.3.0).
 * Concatenated in order with the others to form the body of String.raw in client.ts.
 */
export const SETTINGS_AI = String.raw`  // ---------- Settings: AI (0.3.0) ----------

  const AI_PRESETS = [
    { key: "ollama", label: "Ollama", provider: "ollama", baseUrl: "http://127.0.0.1:11434/v1" },
    { key: "lmstudio", label: "LM Studio", provider: "openai-compatible", baseUrl: "http://127.0.0.1:1234/v1" },
    { key: "openai-compatible", label: "Other OpenAI-compatible", provider: "openai-compatible", baseUrl: "" },
    { key: "bedrock", label: "Amazon Bedrock", provider: "bedrock", baseUrl: "" },
  ];
  const OTHER_MODEL = "__other__";
  const BEDROCK_MODEL_PLACEHOLDER = "anthropic.claude-3-5-haiku-20241022-v1:0";

  // Mirrors ai/config.ts isRemote and endpointHost, so the consent box can follow unsaved edits.
  const LOCAL_AI_NAMES = ["localhost", "host.docker.internal", "host.containers.internal"];
  function aiEndpointHost(provider, baseUrl, region) {
    if (provider === "bedrock" && !baseUrl) return "bedrock-runtime." + (region || "<region>") + ".amazonaws.com";
    try { return new URL(baseUrl).host; } catch (e) { return baseUrl; }
  }
  function isPrivateIp(host) {
    const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (v4) {
      const a = Number(v4[1]), b = Number(v4[2]);
      return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 0 && b === 0);
    }
    if (host.indexOf(":") < 0) return false;
    if (host === "::1") return true;
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
    if (mapped) return isPrivateIp(mapped[1]);
    return /^f[cd][0-9a-f]{0,2}:/.test(host) || /^fe[89ab][0-9a-f]?:/.test(host);
  }
  function aiIsRemote(provider, baseUrl) {
    if (provider === "bedrock") return true;
    let host;
    try { host = new URL(baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, ""); } catch (e) { return true; }
    return !(LOCAL_AI_NAMES.includes(host) || host.endsWith(".localhost") || isPrivateIp(host));
  }

  function presetOf(st) {
    if (st.provider === "bedrock") return "bedrock";
    if (st.provider === "ollama") return "ollama";
    return /:1234(\/|$)/.test(st.baseUrl || "") ? "lmstudio" : "openai-compatible";
  }
  function modelOptionText(m) {
    return m.id + (m.details ? " — " + m.details : "") + (m.suitable === false ? " (not usable: can't generate text)" : "");
  }
  /**
   * Fills the model dropdown from an AiModelList. "current" stays selected: when the server doesn't list it, it is kept
   * as the first option, marked "(not found on server)" once a list actually came back. "Other…" is always last.
   */
  function fillModelSelect(select, list, current) {
    const models = (list && list.models) || [];
    const opts = [];
    if (!current) opts.push(h("option", { value: "", text: models.length ? "Choose a model" : "No model chosen" }));
    else if (!models.some((m) => m.id === current)) opts.push(h("option", { value: current, text: current + (list && !list.error ? " (not found on server)" : "") }));
    for (const m of models) opts.push(h("option", { value: m.id, disabled: m.suitable === false && m.id !== current, "data-unsuitable": m.suitable === false ? "" : null, text: modelOptionText(m) }));
    opts.push(h("option", { value: OTHER_MODEL, text: "Other…" }));
    fill(select, ...opts);
    select.value = current || "";
  }

  function aiCard(my) {
    const card = h("section", { class: "card ai-card", id: "ai-card", "aria-labelledby": "ai-h" },
      h("h2", { id: "ai-h", class: "card-title" }, icon("sparkle"), "AI"),
      h("p", { class: "loading", text: "Loading…" }));
    api("/api/ai").then((st) => {
      if (my === gen) drawAi(card, st, my, "", "");
    }).catch((err) => {
      if (my !== gen) return;
      fill(card, card.firstChild, h("p", { class: "error", text: "Could not load the AI settings: " + err.message }));
    });
    return card;
  }

  function drawAi(card, st, my, message, notice) {
    const sources = st.sources || {};
    const locked = (k) => sources[k] === "env" || sources[k] === "flag";
    const lockNote = (k) => (locked(k) ? h("span", { class: "locked", text: "Set by environment" }) : null);
    let current = st.model || "";
    let otherMode = false;
    let removeKey = false;
    let removeKeys = false;
    let list = null;
    let seq = 0;
    let timer = null;

    const enabled = h("input", { type: "checkbox", role: "switch", id: "ai-enabled", disabled: locked("enabled") });
    enabled.checked = st.enabled === true;
    const preset = h("select", { id: "ai-provider", class: "input", disabled: locked("provider") }, AI_PRESETS.map((p) => h("option", { value: p.key, text: p.label })));
    preset.value = presetOf(st);
    const baseLabel = h("label", { class: "field-label", for: "ai-base-url", text: "Base URL" });
    const baseUrl = h("input", { id: "ai-base-url", class: "input", type: "url", spellcheck: "false", autocomplete: "off", placeholder: "http://127.0.0.1:11434/v1", disabled: locked("baseUrl") });
    baseUrl.value = st.baseUrl || "";
    const modelLabel = h("label", { class: "field-label", for: "ai-model", text: "Model" });
    const modelSelect = h("select", { id: "ai-model", class: "input", disabled: locked("model") });
    const refreshLabel = h("span", { text: "Refresh" });
    const refresh = h("button", { type: "button", class: "btn small", id: "ai-models-refresh", "aria-label": "Refresh the model list", disabled: locked("model") }, icon("reload"), refreshLabel);
    const modelRow = h("div", { class: "model-row" }, modelSelect, refresh);
    const modelOther = h("input", { id: "ai-model-other", class: "input", type: "text", spellcheck: "false", autocomplete: "off", disabled: locked("model") });
    const modelsMsg = h("p", { class: "field-hint", id: "ai-models-msg" });
    // For Bedrock, hasKey also counts access keys and a profile: only an API key of its own makes this field "Saved".
    const apiKeySet = st.provider === "bedrock" ? sources.apiKey === "file" || sources.apiKey === "env" : st.hasKey === true;
    const keyInput = h("input", { id: "ai-key", class: "input", type: "password", autocomplete: "new-password", spellcheck: "false", placeholder: apiKeySet ? "Saved" : "Not set", disabled: locked("apiKey") });
    keyInput.value = "";
    const keyNote = h("span", { class: "field-hint key-note" });
    const removeBtn = apiKeySet && !locked("apiKey") ? h("button", { type: "button", class: "link-btn", id: "ai-key-remove", text: "Remove key" }) : null;
    const secretProtectionNote = st.secretProtection
      ? h("span", {
          class: "field-hint",
          text:
            st.secretProtection === "os-keychain"
              ? "Saved keys are encrypted with your system keychain."
              : st.secretProtection === "run-hound"
                ? "Saved keys are encrypted by Run Hound on this computer (no system keychain is available)."
                : "Keys aren't saved here: set them with environment variables when you start the container.",
        })
      : null;
    const keyField = h("div", { class: "ai-field" },
      h("label", { class: "field-label", for: "ai-key", text: "API key" }), keyInput, lockNote("apiKey"), removeBtn, keyNote, secretProtectionNote,
      h("span", { class: "field-hint", text: "Stays on this machine; never shown again. Not needed for Ollama or LM Studio." }));
    const region = h("input", { id: "ai-region", class: "input", type: "text", spellcheck: "false", autocomplete: "off", placeholder: "us-east-1", disabled: locked("region") });
    region.value = st.region || "";
    const regionRow = h("div", { class: "ai-field" }, h("label", { class: "field-label", for: "ai-region", text: "Region" }), region, lockNote("region"));
    const awsProfile = h("input", { id: "ai-aws-profile", class: "input", type: "text", spellcheck: "false", autocomplete: "off", placeholder: "Profile name", disabled: locked("awsProfile"), "aria-describedby": "ai-aws-profile-hint" });
    awsProfile.value = st.awsProfile || "";
    const awsProfileRow = h("div", { class: "ai-field ai-aws-profile-field" },
      h("label", { class: "field-label", for: "ai-aws-profile", text: "AWS profile" }), awsProfile, lockNote("awsProfile"),
      h("span", { class: "field-hint", id: "ai-aws-profile-hint", text: "Uses ~/.aws on the machine running Run Hound: static keys, credential_process or SSO (run \u0060aws sso login\u0060 first). Only a named profile is read: type default to use your [default] profile." }));
    // Bedrock credentials (0.6.1): one method at a time, the first one the status says is set. A select, not radio
    // buttons: their labels would share words with the "API key" and "AWS profile" fields' labels.
    const authChoice = h("select", { id: "ai-aws-auth", class: "input", "aria-describedby": "ai-aws-auth-hint" },
      h("option", { value: "api-key", text: "Bedrock API key" }),
      h("option", { value: "access-keys", text: "Access keys" }),
      h("option", { value: "profile", text: "AWS profile" }));
    authChoice.value = sources.apiKey === "file" || sources.apiKey === "env" ? "api-key" : st.hasAwsKeys ? "access-keys" : st.awsProfile ? "profile" : "api-key";
    const authRow = h("div", { class: "ai-field ai-aws-auth-field" },
      h("label", { class: "field-label", for: "ai-aws-auth", text: "Credentials" }), authChoice,
      h("span", { class: "field-hint", id: "ai-aws-auth-hint", text: "One method is saved at a time: saving it removes the others saved in ai.json." }));
    // The access keys are write-only, like the API key and account passwords: never prefilled, never sent back.
    const awsKeyId = h("input", { id: "ai-aws-key-id", class: "input", type: "text", spellcheck: "false", autocomplete: "off", placeholder: st.hasAwsKeys ? "Saved" : "Not set", disabled: locked("awsKeys") });
    const awsSecret = h("input", { id: "ai-aws-secret", class: "input", type: "password", spellcheck: "false", autocomplete: "new-password", placeholder: st.hasAwsKeys ? "Saved" : "Not set", disabled: locked("awsKeys") });
    const awsToken = h("input", { id: "ai-aws-session-token", class: "input", type: "password", spellcheck: "false", autocomplete: "new-password", placeholder: st.hasAwsSessionToken ? "Saved" : "Not set", disabled: locked("awsKeys") });
    for (const input of [awsKeyId, awsSecret, awsToken]) input.value = "";
    const keysNote = h("span", { class: "field-hint aws-keys-note" });
    const removeKeysBtn = st.hasAwsKeys && !locked("awsKeys") ? h("button", { type: "button", class: "link-btn", id: "ai-aws-keys-remove", text: "Remove keys" }) : null;
    const awsKeyRows = [
      h("div", { class: "ai-field ai-aws-keys-field" },
        h("label", { class: "field-label", for: "ai-aws-key-id", text: "Access key ID" }), awsKeyId, lockNote("awsKeys")),
      h("div", { class: "ai-field ai-aws-keys-field" },
        h("label", { class: "field-label", for: "ai-aws-secret", text: "Secret access key" }), awsSecret, lockNote("awsKeys"), removeKeysBtn, keysNote,
        h("span", { class: "field-hint", text: "Stays on this machine in ai.json; never shown again." })),
      h("div", { class: "ai-field ai-aws-keys-field" },
        h("label", { class: "field-label", for: "ai-aws-session-token", text: "Session token (optional)" }), awsToken, lockNote("awsKeys")),
    ];
    // Before 0.6.1 an unnamed [default] profile was read on its own; say how to keep using it.
    const noCredentials = st.provider === "bedrock" && !st.hasKey && !st.awsProfile && st.problem === "Bedrock needs credentials: an API key, AWS access keys or an AWS profile";
    const migrationNote = noCredentials
      ? h("p", { class: "field-hint ai-aws-note", id: "ai-aws-note", text: "Run Hound reads ~/.aws only for a named profile. To keep using your [default] profile, choose AWS profile under Credentials and type default." })
      : null;
    const features = st.features || { review: true, suggest: true, explain: true };
    const feat = (key, id, label, desc) => {
      const cb = h("input", { type: "checkbox", id, disabled: locked("features") });
      cb.checked = features[key] !== false;
      return { cb, row: h("div", { class: "option" }, cb, h("label", { for: id }, label, h("span", { class: "desc", text: desc }))) };
    };
    const fReview = feat("review", "ai-f-review", "Review the plan", "Recommends scenarios and says why each matters on this page.");
    const fSuggest = feat("suggest", "ai-f-suggest", "Suggest flows", "Up to 5 extra flows built from the fields and buttons found. Never ticked by default.");
    const fExplain = feat("explain", "ai-f-explain", "Explain findings", "A plain-language summary and a prompt for your coding AI, beside the built-in one.");
    // The consent box names the host requests would go to right now and follows unsaved edits of the provider, base
    // URL and region. Saved consent counts for the host it was given for only (AiStatus.allowRemote is already that);
    // consent from env or a flag applies to any endpoint, so a locked box keeps its value.
    let consent = null;
    const consentSlot = h("div", { class: "ai-consent-slot" });
    const consentedHost = st.allowRemote === true ? st.host : null;
    const saveLabel = h("span", { text: "Save" });
    const save = h("button", { type: "button", class: "btn primary", id: "ai-save" }, saveLabel);
    const testLabel = h("span", { text: "Test connection" });
    const test = h("button", { type: "button", class: "btn", id: "ai-test" }, testLabel);
    const error = h("p", { class: "error", id: "ai-error" });
    const saved = h("p", { class: "saved", id: "ai-saved", text: message || "" });
    const noticeEl = notice ? h("p", { class: "warning ai-notice", id: "ai-notice", role: "status", text: notice }) : null;
    // Saved keys that could not be read, or (Docker) a key still saved in plain text.
    const secretNoticeEl = st.secretNotice ? h("p", { class: "warning", id: "ai-secret-notice", text: st.secretNotice }) : null;
    const testOut = h("p", { class: "field-hint", id: "ai-test-result" });

    const isBedrock = () => preset.value === "bedrock";
    const providerOf = () => (AI_PRESETS.find((p) => p.key === preset.value) || AI_PRESETS[0]).provider;
    const modelValue = () => (isBedrock() || otherMode ? modelOther.value.trim() : modelSelect.value === OTHER_MODEL ? "" : modelSelect.value);

    function syncModelUi() {
      const bed = isBedrock();
      modelRow.hidden = bed;
      modelOther.hidden = !(bed || otherMode);
      modelOther.placeholder = bed ? BEDROCK_MODEL_PLACEHOLDER : "Model id as the server names it";
      if (bed) { modelOther.removeAttribute("aria-label"); modelLabel.setAttribute("for", "ai-model-other"); }
      else { modelOther.setAttribute("aria-label", "Other model id"); modelLabel.setAttribute("for", "ai-model"); }
      regionRow.hidden = !bed;
      syncAuthUi();
      baseLabel.textContent = bed ? "Endpoint override (optional)" : "Base URL";
      baseUrl.placeholder = bed ? "https://bedrock-runtime.<region>.amazonaws.com" : "http://127.0.0.1:11434/v1";
      if (bed) { modelsMsg.textContent = ""; modelsMsg.className = "field-hint"; }
    }
    /** Bedrock shows the Credentials choice and only the chosen method's fields; other providers the API key alone. */
    function syncAuthUi() {
      const bed = isBedrock();
      const method = authChoice.value;
      authRow.hidden = !bed;
      keyField.hidden = bed && method !== "api-key";
      for (const row of awsKeyRows) row.hidden = !bed || method !== "access-keys";
      awsProfileRow.hidden = !bed || method !== "profile";
    }
    function drawModels() {
      fillModelSelect(modelSelect, list, otherMode ? "" : current);
      if (otherMode) modelSelect.value = OTHER_MODEL;
    }
    async function loadModels() {
      clearTimeout(timer);
      if (isBedrock()) return;
      const mine = ++seq;
      modelsMsg.className = "field-hint";
      modelsMsg.textContent = "Loading models…";
      refresh.disabled = true;
      let res;
      try {
        // A ticked (unsaved) consent box counts for listing models; unticked, the server uses the saved consent.
        const consented = consent && consent.checked ? "&allowRemote=1" : "";
        res = await api("/api/ai/models?provider=" + enc(providerOf()) + "&baseUrl=" + enc(baseUrl.value.trim()) + consented);
      } catch (err) {
        res = { models: [], error: "Could not list the models: " + err.message };
      }
      if (mine !== seq || my !== gen || !card.isConnected) return;
      refresh.disabled = locked("model");
      list = { models: Array.isArray(res.models) ? res.models : [], error: res.error || null };
      if (list.error) { modelsMsg.className = "error"; modelsMsg.textContent = list.error; }
      else { modelsMsg.className = "field-hint"; modelsMsg.textContent = list.models.length ? plural(list.models.length, "model") + " on this server." : "The server lists no models."; }
      drawModels();
    }
    const loadSoon = () => { clearTimeout(timer); timer = setTimeout(loadModels, 400); };

    function drawConsent() {
      const provider = providerOf();
      const url = baseUrl.value.trim();
      const host = aiEndpointHost(provider, url, isBedrock() ? region.value.trim() : st.region);
      const remote = aiIsRemote(provider, url) || (st.remote && provider === st.provider && host === st.host);
      // Bedrock without a region has no host to name yet (the status asks for the region first).
      const unknownHost = provider === "bedrock" && !url && !region.value.trim();
      if (!remote || unknownHost) {
        consent = null;
        consentSlot.dataset.host = "";
        fill(consentSlot);
        return;
      }
      if (consent && consentSlot.dataset.host === host) return; // same host: keep what the user ticked
      consent = h("input", { type: "checkbox", id: "ai-allow-remote", disabled: locked("allowRemote") });
      consent.checked = locked("allowRemote") ? st.allowRemote === true : host === consentedHost;
      // Ticking it lists the endpoint's models right away (before Save), so a model can be picked in one go.
      consent.addEventListener("change", loadModels);
      consentSlot.dataset.host = host;
      fill(consentSlot, h("div", { class: "option ai-consent" }, consent,
        h("label", { for: "ai-allow-remote" }, "Send redacted page structure (labels, field types, button names — never values, cookies or screenshots) to " + host,
          h("span", { class: "desc", text: "This endpoint is not on this machine or your network. Nothing is sent until you tick this and save." })),
        lockNote("allowRemote")));
    }

    enabled.addEventListener("change", () => { saved.textContent = ""; });
    preset.addEventListener("change", () => {
      const p = AI_PRESETS.find((x) => x.key === preset.value);
      const presetUrls = AI_PRESETS.map((x) => x.baseUrl).filter(Boolean);
      if (!locked("baseUrl")) {
        if (p.baseUrl) baseUrl.value = p.baseUrl;
        else if (presetUrls.includes(baseUrl.value.trim())) baseUrl.value = "";
      }
      if (isBedrock()) { otherMode = false; modelOther.value = current; }
      list = null;
      syncModelUi();
      drawModels();
      drawConsent();
      loadSoon();
    });
    baseUrl.addEventListener("input", () => { drawConsent(); loadSoon(); });
    region.addEventListener("input", drawConsent);
    authChoice.addEventListener("change", syncAuthUi);
    refresh.addEventListener("click", loadModels);
    modelSelect.addEventListener("change", () => {
      if (modelSelect.value === OTHER_MODEL) {
        otherMode = true;
        modelOther.value = current;
        syncModelUi();
        modelOther.focus();
      } else {
        otherMode = false;
        current = modelSelect.value;
        syncModelUi();
      }
    });
    modelOther.addEventListener("input", () => { current = modelOther.value.trim(); });
    if (removeBtn) {
      removeBtn.addEventListener("click", () => {
        removeKey = !removeKey;
        removeBtn.textContent = removeKey ? "Undo remove" : "Remove key";
        keyNote.textContent = removeKey ? "The saved key will be removed when you save." : "";
        keyInput.placeholder = removeKey ? "Will be removed" : "Saved";
      });
    }
    if (removeKeysBtn) {
      removeKeysBtn.addEventListener("click", () => {
        removeKeys = !removeKeys;
        removeKeysBtn.textContent = removeKeys ? "Undo remove" : "Remove keys";
        keysNote.textContent = removeKeys ? "The saved keys will be removed when you save." : "";
        awsKeyId.placeholder = awsSecret.placeholder = removeKeys ? "Will be removed" : "Saved";
        if (st.hasAwsSessionToken) awsToken.placeholder = removeKeys ? "Will be removed" : "Saved";
      });
    }

    save.addEventListener("click", async () => {
      error.textContent = "";
      saved.textContent = "";
      const patch = {};
      if (!locked("enabled")) patch.enabled = enabled.checked;
      if (!locked("provider")) patch.provider = providerOf();
      if (!locked("baseUrl")) patch.baseUrl = baseUrl.value.trim();
      if (!locked("model")) patch.model = modelValue();
      if (isBedrock()) {
        // The chosen method's values, and null for each other method's value saved in ai.json, so one method is saved
        // at a time. A locked (env) field is never sent. Half a pair goes as typed: the server says what is missing.
        const method = authChoice.value;
        if (!locked("apiKey")) {
          if (method === "api-key") {
            if (removeKey) patch.apiKey = null;
            else if (keyInput.value) patch.apiKey = keyInput.value;
          } else if (sources.apiKey === "file") patch.apiKey = null;
        }
        if (!locked("awsKeys")) {
          if (method === "access-keys") {
            const id = awsKeyId.value.trim();
            const secret = awsSecret.value.trim();
            const token = awsToken.value.trim();
            if (removeKeys) patch.awsAccessKeyId = null;
            else {
              if (id) patch.awsAccessKeyId = id;
              if (secret) patch.awsSecretAccessKey = secret;
              if (token) patch.awsSessionToken = token;
            }
          } else if (sources.awsKeys === "file") patch.awsAccessKeyId = null;
        }
        if (!locked("awsProfile")) {
          if (method === "profile") patch.awsProfile = awsProfile.value.trim() || null;
          else if (sources.awsProfile === "file") patch.awsProfile = null;
        }
        if (!locked("region")) patch.region = region.value.trim() || null;
      } else if (!locked("apiKey")) {
        if (removeKey) patch.apiKey = null;
        else if (keyInput.value) patch.apiKey = keyInput.value;
      }
      if (!locked("features")) patch.features = { review: fReview.cb.checked, suggest: fSuggest.cb.checked, explain: fExplain.cb.checked };
      if (consent && !locked("allowRemote")) patch.allowRemote = consent.checked;
      // The card is drawn again from the answer: hold the toggles still until then, so no click is lost to the redraw.
      const toggles = [removeBtn, removeKeysBtn].filter(Boolean);
      save.disabled = true;
      for (const b of toggles) b.disabled = true;
      saveLabel.textContent = "Saving…";
      try {
        const next = await api("/api/ai", patch, "PUT");
        if (my !== gen) return;
        drawAi(card, next, my, "Saved at " + hms(new Date().toISOString()) + ".", next.notice || "");
        announce(next.notice ? "AI settings saved. " + next.notice : "AI settings saved.");
        const again = document.getElementById("ai-save");
        if (again) again.focus();
      } catch (err) {
        if (my !== gen) return;
        save.disabled = false;
        for (const b of toggles) b.disabled = false;
        saveLabel.textContent = "Save";
        error.textContent = err.message;
      }
    });
    test.addEventListener("click", async () => {
      test.disabled = true;
      testLabel.textContent = "Testing…";
      testOut.className = "field-hint";
      testOut.textContent = "Sending a short request with the saved settings…";
      try {
        const r = await api("/api/ai/test", {});
        if (my !== gen) return;
        if (r.ok) { testOut.className = "ai-ok"; testOut.textContent = "Connected: " + r.model + " answered in " + formatDuration(r.ms) + "."; }
        else { testOut.className = "error"; testOut.textContent = r.error || "The test failed."; }
      } catch (err) {
        if (my !== gen) return;
        testOut.className = "error";
        testOut.textContent = err.message;
      }
      test.disabled = false;
      testLabel.textContent = "Test connection";
      announce(testOut.textContent);
    });

    fill(card, 
      h("h2", { id: "ai-h", class: "card-title" }, icon("sparkle"), "AI"),
      h("p", { class: "muted ai-intro", text: "Optional. A model reviews the plan, suggests extra flows and explains findings in plain words. It never decides pass or fail: the checks do." }),
      st.problem ? h("p", { class: "warning ai-problem", id: "ai-problem", text: st.problem }) : null,
      migrationNote,
      h("div", { class: "option ai-switch" }, enabled, h("label", { for: "ai-enabled" }, "Use AI", h("span", { class: "desc", text: "Off by default. Planning and runs work the same without it." })), lockNote("enabled")),
      h("div", { class: "ai-fields" },
        h("div", { class: "ai-field" }, h("label", { class: "field-label", for: "ai-provider", text: "Provider" }), preset, lockNote("provider")),
        h("div", { class: "ai-field" }, baseLabel, baseUrl, lockNote("baseUrl")),
        h("div", { class: "ai-field ai-model-field" }, modelLabel, modelRow, modelOther, lockNote("model"), modelsMsg),
        regionRow,
        authRow,
        keyField,
        ...awsKeyRows,
        awsProfileRow),
      h("fieldset", { class: "ai-features" }, h("legend", { class: "field-label", text: "What the model does" }), fReview.row, fSuggest.row, fExplain.row, lockNote("features")),
      consentSlot,
      h("div", { class: "ai-actions" }, save, test),
      error, saved, noticeEl, secretNoticeEl, testOut,
      st.file ? h("p", { class: "note" }, "Saved to ", h("code", { class: "mono", text: st.file })) : null);
    syncModelUi();
    drawConsent();
    if (isBedrock()) modelOther.value = current;
    drawModels();
    loadModels();
  }

`;
