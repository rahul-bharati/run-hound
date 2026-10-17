/**
 * Section of the inline client script: the desktop's first-launch onboarding (O1, docs/onboarding-spec.md), the shared
 * model picker, and the start-up check that opens it. Concatenated in order with the others to form the body of
 * String.raw in client.ts, so it shares their scope (h, fill, api, AI_PRESETS, aiIsRemote, aiEndpointHost, …).
 */
export const ONBOARDING = String.raw`  // ---------- Onboarding (O1) ----------

  /**
   * First launch: the desktop's engine says whether to show the setup (GET /api/onboarding exists only there). Only the bare
   * address is redirected; a deep link such as #/settings opens as asked. Any failure opens the app as before.
   */
  async function startUp() {
    const bare = location.hash === "" || location.hash === "#" || location.hash === "#/";
    if (onDesktop && bare) {
      try {
        const state = await api("/api/onboarding");
        if (state && state.show === true) history.replaceState(null, "", "#/welcome");
      } catch (e) { /* no first-launch check: the app opens on New run */ }
    }
    render();
  }

  const OB_STEPS = 5;
  const KEY_GUIDES = CONFIG.keyGuides;
  const OB_CLOUD = [
    { key: "anthropic", title: "Anthropic (Claude)", text: "Claude models, from the Claude Console." },
    { key: "openai", title: "OpenAI", text: "GPT models, from the OpenAI Platform." },
    { key: "gemini", title: "Google Gemini", text: "Gemini models, from Google AI Studio." },
    { key: "bedrock", title: "Amazon Bedrock", text: "Models in your AWS account, with an API key or an AWS profile." },
  ];
  const OB_LOCAL_SERVERS = [["ollama", "Ollama"], ["lmstudio", "LM Studio"], ["openai-compatible", "Another OpenAI-compatible server"]];
  const obPreset = (ob) => AI_PRESETS.find((p) => p.key === (ob.choice === "local" ? ob.server : ob.choice)) || null;

  /**
   * A model field: a select filled from a model list with the recommended one chosen by the caller, "Other…" for an ID not
   * in the list, and a plain text field when the server can't list its models (text: true). value() is the model ID.
   */
  function modelPicker(id, label, hint) {
    const labelEl = h("label", { class: "field-label", for: id, text: label });
    const select = h("select", { id, class: "input" });
    const other = h("input", { id: id + "-other", class: "input", type: "text", spellcheck: "false", autocomplete: "off", "aria-label": label + " ID", placeholder: "Model ID as the provider names it" });
    const hintEl = hint ? h("span", { class: "field-hint", id: id + "-hint", text: hint }) : null;
    const el = h("div", { class: "ai-field model-picker" }, labelEl, select, other, hintEl);
    let textOnly = false;
    let otherMode = false;
    function show() {
      select.hidden = textOnly;
      other.hidden = !(textOnly || otherMode);
      labelEl.setAttribute("for", textOnly ? id + "-other" : id);
      if (textOnly) other.removeAttribute("aria-label");
      else other.setAttribute("aria-label", label + " ID");
      if (hintEl) (textOnly ? other : select).setAttribute("aria-describedby", id + "-hint");
    }
    select.addEventListener("change", () => {
      otherMode = select.value === OTHER_MODEL;
      show();
      if (otherMode) other.focus();
      el.dispatchEvent(new Event("pick", { bubbles: true }));
    });
    other.addEventListener("input", () => el.dispatchEvent(new Event("pick", { bubbles: true })));
    return {
      el,
      select,
      other,
      /** Fills the options from a list ({models}) and selects "current" (kept as an option even when the server doesn't list it). */
      fill(list, current) {
        const models = ((list && list.models) || []).filter((m) => m.suitable !== false);
        textOnly = false;
        otherMode = false;
        const opts = [];
        if (!current) opts.push(h("option", { value: "", text: "Choose a model" }));
        else if (!models.some((m) => m.id === current)) opts.push(h("option", { value: current, text: current + (list && !list.error ? " (not found on server)" : "") }));
        for (const m of models) opts.push(h("option", { value: m.id, text: modelOptionText(m) }));
        opts.push(h("option", { value: OTHER_MODEL, text: "Other…" }));
        fill(select, ...opts);
        select.value = current || "";
        other.value = "";
        show();
      },
      /** A text field for the model ID, for a server that can't list its models. */
      text(current) {
        textOnly = true;
        otherMode = false;
        other.value = current || "";
        show();
      },
      value() { return textOnly || otherMode ? other.value.trim() : select.value === OTHER_MODEL ? "" : select.value; },
      disable(on) { select.disabled = on; other.disabled = on; },
      focus() { (textOnly || otherMode ? other : select).focus(); },
    };
  }

  function viewWelcome(my) {
    setTitle("Welcome");
    const ob = {
      step: 1,
      choice: "",
      server: "ollama",
      key: "",
      showKey: false,
      baseUrl: "",
      region: "",
      awsMethod: "api-key",
      awsProfile: "",
      consent: false,
      model: "",
      needModel: false,
      tested: false,
      testedFor: "",
      testNote: null,
      busy: false,
      saved: false,
      list: null,
      main: "",
      helper: "",
      same: false,
      picked: false,
      outcome: null,
      status: null,
      known: null,
    };
    // What is already set up (a run of the setup again): a provider's saved key may stay empty here.
    api("/api/ai").then((st) => { if (my === gen) ob.known = st; }).catch(() => {});

    const root = h("div", { class: "page ob" });
    view.append(root);

    const go = (step) => { ob.step = step; draw(true); };
    const skip = () => { ob.outcome = "skipped"; go(5); };
    const busy = (on, buttons) => { ob.busy = on; for (const b of buttons) if (b) b.disabled = on; root.setAttribute("aria-busy", String(on)); };

    /** A screen: "Step n of 5", the heading, then the body and the row of actions. */
    function screen(n, title, intro, body, actions) {
      return [
        h("p", { class: "ob-step", text: "Step " + n + " of " + OB_STEPS }),
        h("h1", { id: "ob-h", tabindex: "-1", text: title }),
        intro ? h("p", { class: "ob-intro", text: intro }) : null,
        body,
        h("div", { class: "ob-actions" }, actions),
      ];
    }
    const backBtn = (to) => h("button", { type: "button", class: "btn", id: "ob-back", onclick: () => go(to) }, "Back");
    const skipLink = () => h("button", { type: "button", class: "link-btn ob-skip", id: "ob-skip", onclick: skip, text: "Skip setup" });

    function draw(focus) {
      if (my !== gen) return;
      const parts = [screen1, screen2, screen3, screen4, screen5][ob.step - 1]();
      fill(root, parts);
      if (focus) {
        const heading = document.getElementById("ob-h");
        window.scrollTo(0, 0);
        if (heading) heading.focus({ preventScroll: true });
      }
    }

    // ----- 1. Welcome -----
    function screen1() {
      const setUp = h("button", { type: "button", class: "btn primary", id: "ob-start", onclick: () => go(2), text: "Set up AI" });
      const later = h("button", { type: "button", class: "btn", id: "ob-skip", onclick: skip, text: "Skip for now" });
      return screen(1, "Welcome to Run Hound", null,
        h("ul", { class: "ob-points" },
          h("li", { text: "It tests a page of an app on this computer in a real browser." }),
          h("li", { text: "Every finding comes from a built-in check, with evidence and a Playwright test. The checks are plain code and need no AI." }),
          h("li", { text: "AI is optional. With your own key it reviews the plan, suggests extra flows, explains findings and, as an agent, investigates a goal you give it." })),
        [setUp, later]);
    }

    // ----- 2. Provider -----
    function screen2() {
      const next = h("button", { type: "button", class: "btn primary", id: "ob-next", onclick: () => go(3), text: "Continue" });
      next.disabled = ob.choice === "";
      const card = (value, title, text) => {
        const input = h("input", { type: "radio", name: "ob-provider", id: "ob-p-" + value, value });
        input.checked = ob.choice === value;
        input.addEventListener("change", () => {
          if (ob.choice !== value) { ob.choice = value; ob.key = ""; ob.tested = false; ob.testNote = null; ob.baseUrl = ""; ob.needModel = false; ob.model = ""; ob.consent = false; }
          next.disabled = false;
        });
        return h("label", { class: "radio-card", for: "ob-p-" + value }, input, h("span", { class: "radio-card-text" }, h("span", { class: "radio-card-title", text: title }), h("span", { class: "radio-card-desc", text: text })));
      };
      const group = h("fieldset", { class: "radio-cards" },
        h("legend", { class: "field-label", text: "Which AI provider do you want to use?" }),
        OB_CLOUD.map((p) => card(p.key, p.title, p.text)),
        card("local", "A model on this computer", "Ollama, LM Studio or another OpenAI-compatible server."),
        h("p", { class: "field-hint", id: "ob-local-note", text: "The agent needs one of the four cloud providers. A model on this computer reviews the plan, suggests flows and explains findings." }));
      return screen(2, "Choose your AI provider", "Run Hound uses a key or a model of your own. Nothing is chosen for you.", group, [backBtn(1), next, skipLink()]);
    }

    // ----- 3. Key -----
    const obSignature = () => JSON.stringify([ob.choice, ob.server, ob.key, ob.baseUrl, ob.region, ob.awsMethod, ob.awsProfile, ob.consent, ob.model]);
    const obHost = () => {
      const p = obPreset(ob);
      return p ? aiEndpointHost(p.provider, p.provider === "bedrock" ? "" : ob.baseUrl.trim() || p.baseUrl, ob.region.trim()) : "";
    };
    const obRemote = () => { const p = obPreset(ob); return Boolean(p) && aiIsRemote(p.provider, ob.baseUrl.trim() || p.baseUrl); };
    const obSavedKey = () => { const p = obPreset(ob); return Boolean(p && ob.known && (ob.known.savedKeys || []).includes(p.provider)); };

    /** The connection settings as the Settings API takes them. The key is sent only when typed; a saved one stays. */
    function connectionPatch() {
      const p = obPreset(ob);
      const patch = { provider: p.provider };
      if (!AI_FIXED_ENDPOINTS[p.provider] && p.provider !== "bedrock") patch.baseUrl = ob.baseUrl.trim() || p.baseUrl;
      if (p.provider === "bedrock") {
        patch.region = ob.region.trim() || null;
        if (ob.awsMethod === "profile") { patch.awsProfile = ob.awsProfile.trim() || null; patch.apiKey = null; }
        else { patch.awsProfile = null; if (ob.key) patch.apiKey = ob.key; }
      } else if (ob.key) patch.apiKey = ob.key;
      if (obRemote()) patch.allowRemote = ob.consent;
      if (ob.model.trim()) patch.model = ob.model.trim();
      return patch;
    }
    /** What is missing before the connection can be saved, in words, or "". */
    function connectionProblem() {
      const p = obPreset(ob);
      const label = AI_PROVIDER_LABELS[p.provider];
      if (p.provider === "bedrock") {
        if (!ob.region.trim()) return "Enter the AWS Region, such as us-east-1.";
        if (ob.awsMethod === "profile" ? !ob.awsProfile.trim() : !ob.key && !obSavedKey()) return ob.awsMethod === "profile" ? "Enter the name of an AWS profile." : "Paste your Bedrock API key.";
        if (!ob.model.trim()) return "Enter a model ID or inference profile your account can use.";
      } else if (AI_FIXED_ENDPOINTS[p.provider] && !ob.key && !obSavedKey()) return "Paste your " + label + " API key.";
      else if (!AI_FIXED_ENDPOINTS[p.provider] && !ob.baseUrl.trim() && !p.baseUrl) return "Enter the address of your server.";
      if (obRemote() && !ob.consent) return "Tick the box to allow sending redacted page structure to " + obHost() + ".";
      return "";
    }

    function screen3() {
      const p = obPreset(ob);
      const local = ob.choice === "local";
      const bedrock = p.provider === "bedrock";
      const guide = KEY_GUIDES[local ? "local" : ob.choice];
      const host = obHost();
      if (!ob.baseUrl && !AI_FIXED_ENDPOINTS[p.provider]) ob.baseUrl = p.baseUrl;
      const label = local ? "your local server" : AI_PROVIDER_LABELS[p.provider];

      const keyUrl = CONFIG.keyUrls[p.provider];
      const guideBox = h("section", { class: "card ob-guide", "aria-labelledby": "ob-guide-h" },
        h("h2", { id: "ob-guide-h", class: "card-title" }, icon("key"), local ? "Start your local server" : "Get your " + AI_PROVIDER_LABELS[p.provider] + " API key"),
        h("ol", { class: "ob-steps" }, guide.steps.map((s) => h("li", { text: s }))),
        guide.note ? h("p", { class: "field-hint", text: guide.note }) : null,
        keyUrl && guide.button ? h("p", { class: "ob-open" }, h("a", { class: "btn", href: keyUrl, target: "_blank", rel: "noopener noreferrer" }, icon("external"), guide.button, h("span", { class: "visually-hidden", text: " (opens in your browser)" }))) : null,
        local
          ? h("p", { class: "field-hint", text: "Run Hound talks to it on this computer, so nothing leaves it." })
          : h("p", { class: "ob-private", text: "Keep this key private. Run Hound keeps it encrypted on this computer and sends it only to " + host + "." }));

      const error = h("p", { class: "error", id: "ob-error", role: "alert" });
      const result = noticeBox("info", "", { id: "ob-test-result", role: "status" });
      const set = (kind, text) => setNotice(result, kind, text);
      if (ob.testNote) set(ob.testNote.kind, ob.testNote.text);

      const changed = () => {
        if (ob.tested && ob.testedFor !== obSignature()) { ob.tested = false; set("info", ""); ob.testNote = null; }
        next.disabled = !ob.tested || ob.busy;
      };
      const field = (id, text, input, hintText) => h("div", { class: "ai-field" }, h("label", { class: "field-label", for: id, text }), input, hintText ? h("span", { class: "field-hint", id: id + "-hint", text: hintText }) : null);

      const fields = [];
      if (local) {
        const server = h("select", { id: "ob-server", class: "input" }, OB_LOCAL_SERVERS.map((s) => h("option", { value: s[0], text: s[1] })));
        server.value = ob.server;
        server.addEventListener("change", () => { ob.server = server.value; ob.baseUrl = (obPreset(ob) || {}).baseUrl || ""; baseUrl.value = ob.baseUrl; changed(); });
        fields.push(field("ob-server", "Which server?", server));
      }
      let baseUrl;
      if (!AI_FIXED_ENDPOINTS[p.provider] && !bedrock) {
        baseUrl = h("input", { id: "ob-base-url", class: "input", type: "url", spellcheck: "false", autocomplete: "off", placeholder: "http://127.0.0.1:11434/v1" });
        baseUrl.value = ob.baseUrl;
        baseUrl.addEventListener("input", () => { ob.baseUrl = baseUrl.value; renderConsent(); changed(); });
        fields.push(field("ob-base-url", "Address of the server", baseUrl, "Filled in for you. Change it if your server listens elsewhere."));
      }
      if (bedrock) {
        const region = h("input", { id: "ob-region", class: "input", type: "text", spellcheck: "false", autocomplete: "off", placeholder: "us-east-1" });
        region.value = ob.region;
        region.addEventListener("input", () => { ob.region = region.value; renderConsent(); refreshHost(); changed(); });
        fields.push(field("ob-region", "AWS Region", region));
        const method = h("select", { id: "ob-aws-method", class: "input" }, h("option", { value: "api-key", text: "Bedrock API key" }), h("option", { value: "profile", text: "AWS profile on this computer" }));
        method.value = ob.awsMethod;
        method.addEventListener("change", () => { ob.awsMethod = method.value; syncAuth(); changed(); });
        fields.push(field("ob-aws-method", "Sign in with", method));
      }
      // The key: a password field with Show / Hide. Pasting is allowed. Empty keeps a key saved before.
      const key = h("input", { id: "ob-key", class: "input", type: "password", autocomplete: "new-password", spellcheck: "false", placeholder: obSavedKey() ? "Saved" : local ? "Not needed unless your server asks" : "Paste your key" });
      key.value = ob.key;
      const toggle = h("button", { type: "button", class: "btn pw-toggle", id: "ob-key-toggle", "aria-controls": "ob-key", text: "Show" });
      toggle.addEventListener("click", () => {
        ob.showKey = !ob.showKey;
        key.type = ob.showKey ? "text" : "password";
        toggle.textContent = ob.showKey ? "Hide" : "Show";
      });
      key.addEventListener("input", () => { ob.key = key.value; changed(); });
      const keyField = h("div", { class: "ai-field", id: "ob-key-field" },
        h("label", { class: "field-label", for: "ob-key", text: local ? "API key (optional)" : bedrock ? "Bedrock API key" : "API key" }),
        h("div", { class: "pw-row" }, key, toggle));
      const profile = h("input", { id: "ob-aws-profile", class: "input", type: "text", spellcheck: "false", autocomplete: "off", placeholder: "Profile name" });
      profile.value = ob.awsProfile;
      profile.addEventListener("input", () => { ob.awsProfile = profile.value; changed(); });
      const profileField = field("ob-aws-profile", "AWS profile", profile, "Run Hound reads ~/.aws on this computer for this profile only.");
      function syncAuth() { keyField.hidden = bedrock && ob.awsMethod === "profile"; profileField.hidden = !bedrock || ob.awsMethod !== "profile"; }
      fields.push(keyField, profileField);
      if (bedrock) {
        const model = h("input", { id: "ob-model", class: "input", type: "text", spellcheck: "false", autocomplete: "off", placeholder: "A model ID or inference profile your account can use" });
        model.value = ob.model;
        model.addEventListener("input", () => { ob.model = model.value; changed(); });
        fields.push(field("ob-model", "Model to test with", model, "Bedrock can't list models here. This one is saved as your main model, and you can change it on the next step."));
      } else if (ob.needModel) {
        const model = h("input", { id: "ob-model", class: "input", type: "text", spellcheck: "false", autocomplete: "off", placeholder: "Model ID as the server names it" });
        model.value = ob.model;
        model.addEventListener("input", () => { ob.model = model.value; changed(); });
        fields.push(field("ob-model", "Model to test with", model, "The server didn't list its models. Enter the ID of one to test with."));
      }

      // The consent box names the host and must be ticked to continue, for any endpoint that is not on this computer.
      const consentSlot = h("div", { class: "ai-consent-slot" });
      function renderConsent() {
        // Bedrock has no host to name until its Region is typed.
        const host = obRemote() && !(bedrock && !ob.region.trim()) ? obHost() : "";
        if (host === "") {
          if (consentSlot.dataset.host) ob.consent = false;
          delete consentSlot.dataset.host;
          fill(consentSlot);
          return;
        }
        if (consentSlot.firstChild && consentSlot.dataset.host === host) return;
        // Consent names a host: another host needs a tick of its own.
        if (consentSlot.dataset.host) ob.consent = false;
        const box = h("input", { type: "checkbox", id: "ob-consent" });
        box.checked = ob.consent;
        box.addEventListener("change", () => { ob.consent = box.checked; changed(); });
        consentSlot.dataset.host = host;
        fill(consentSlot, h("div", { class: "option ai-consent" }, box,
          h("label", { for: "ob-consent" }, "Send redacted page structure (labels, field types, button names — never values, cookies or screenshots) to " + host,
            h("span", { class: "desc", text: "This endpoint is not on this computer or your network. Nothing is sent until you tick this." }))));
      }
      function refreshHost() { const el = document.querySelector(".ob-private"); if (el && !local) el.textContent = "Keep this key private. Run Hound keeps it encrypted on this computer and sends it only to " + obHost() + "."; }

      const test = h("button", { type: "button", class: "btn", id: "ob-test", text: "Test connection" });
      const withoutTest = h("button", { type: "button", class: "btn", id: "ob-save-untested", text: "Save without testing" });
      const next = h("button", { type: "button", class: "btn primary", id: "ob-next", text: "Next" });
      next.disabled = !ob.tested;

      // The key is saved encrypted on the engine's side; the page keeps no copy of it once it is saved.
      async function save() {
        const st = await api("/api/ai", connectionPatch(), "PUT");
        ob.status = st;
        ob.known = st;
        ob.saved = true;
        ob.key = "";
        return st;
      }
      test.addEventListener("click", async () => {
        error.textContent = "";
        const missing = connectionProblem();
        if (missing) { error.textContent = missing; return; }
        busy(true, [test, withoutTest, next]);
        test.textContent = "Testing…";
        set("info", "Sending a short request…");
        let redraw = false;
        try {
          await save();
          let model = ob.model.trim();
          if (!model) {
            // The connection test needs a model: take the recommended main one from the provider's list. A list that fails
            // (a refused key, nothing answering) is the answer the user needs.
            const list = await api("/api/ai/models");
            ob.list = list;
            model = list.recommended && list.recommended.main ? list.recommended.main : "";
            if (!model) {
              if (list.error) throw new Error(list.error);
              ob.needModel = true;
              ob.testNote = null;
              redraw = true;
            } else ob.status = await api("/api/ai", { model }, "PUT");
          }
          if (!redraw) {
            const r = await api("/api/ai/test", {});
            if (my !== gen) return;
            if (r.ok) {
              ob.tested = true;
              ob.testedFor = obSignature();
              ob.testNote = { kind: "ok", text: "Connected: " + r.model + " answered in " + formatDuration(r.ms) + "." };
            } else {
              ob.tested = false;
              ob.testNote = { kind: "err", text: (r.error || "The test failed.") + " You can fix the key and test again, or save it without testing." };
            }
          }
        } catch (err) {
          if (my !== gen) return;
          ob.tested = false;
          ob.testNote = { kind: "err", text: err.message + " You can fix it and test again, or save without testing." };
        }
        if (my !== gen) return;
        busy(false, [test, withoutTest, next]);
        if (redraw) {
          draw(false);
          const again = document.getElementById("ob-model");
          if (again) again.focus();
          return;
        }
        test.textContent = "Test connection";
        next.disabled = !ob.tested;
        set(ob.testNote.kind, ob.testNote.text);
        announce(ob.testNote.text);
      });
      withoutTest.addEventListener("click", async () => {
        error.textContent = "";
        const missing = connectionProblem();
        if (missing) { error.textContent = missing; return; }
        busy(true, [test, withoutTest, next]);
        try {
          await save();
          if (my !== gen) return;
          go(4);
        } catch (err) {
          if (my !== gen) return;
          error.textContent = err.message;
          busy(false, [test, withoutTest, next]);
          next.disabled = !ob.tested;
        }
      });
      next.addEventListener("click", async () => {
        if (!ob.tested) return;
        error.textContent = "";
        busy(true, [test, withoutTest, next]);
        try {
          await save();
          if (my !== gen) return;
          go(4);
        } catch (err) {
          if (my !== gen) return;
          error.textContent = err.message;
          busy(false, [test, withoutTest, next]);
        }
      });

      syncAuth();
      renderConsent();
      const actions = [backBtn(2), test, withoutTest, next, skipLink()];
      return screen(3, local ? "Connect your local model" : "Add your " + label + " key",
        local ? "Run Hound will use the server on this computer. No key is needed unless your server asks for one." : "Paste a key from your " + label + " account. It is saved encrypted on this computer.",
        [guideBox, h("div", { class: "ai-fields ob-fields" }, fields), consentSlot, error, result],
        actions);
    }

    // ----- 4. Models -----
    function screen4() {
      const p = obPreset(ob);
      const local = ob.choice === "local";
      const main = modelPicker("ob-main", local ? "Model" : "Main model", local ? "Reviews the plan, suggests extra flows and explains findings." : "Investigates as the agent and drafts testing briefs.");
      const helper = modelPicker("ob-helper", "Helper model", "Reviews the plan, suggests extra flows and explains findings.");
      const sameBox = h("input", { type: "checkbox", id: "ob-same" });
      sameBox.checked = ob.same;
      const sameRow = h("div", { class: "option" }, sameBox, h("label", { for: "ob-same" }, "Use the main model for everything", h("span", { class: "desc", text: "The helper is the main model. Simpler, but every run costs more." })));
      const cost = h("p", { class: "field-hint", id: "ob-cost", text: "The main model answers once for every step the agent takes; the helper answers a few times per run. A cheaper helper keeps the cost down." });
      const msg = h("p", { class: "field-hint", id: "ob-models-msg", role: "status", text: "Loading models…" });
      const error = h("p", { class: "error", id: "ob-error", role: "alert" });
      const next = h("button", { type: "button", class: "btn primary", id: "ob-next", text: "Finish setup" });
      next.disabled = true;
      const refresh = h("button", { type: "button", class: "btn small", id: "ob-models-refresh", text: "Refresh the list" });

      const sync = () => {
        helper.el.hidden = local;
        sameRow.hidden = local;
        helper.disable(ob.same);
        helper.el.classList.toggle("is-off", ob.same);
        cost.hidden = local;
      };
      const read = () => { ob.main = main.value(); ob.helper = helper.value(); next.disabled = ob.main === ""; };
      const picked = () => { ob.picked = true; read(); };
      main.el.addEventListener("pick", picked);
      helper.el.addEventListener("pick", picked);
      sameBox.addEventListener("change", () => { ob.same = sameBox.checked; sync(); });
      sync();

      async function load() {
        refresh.disabled = true;
        msg.className = "field-hint";
        msg.textContent = "Loading models…";
        let list;
        try { list = await api("/api/ai/models"); } catch (err) { list = { models: [], error: "Could not list the models: " + err.message }; }
        if (my !== gen || ob.step !== 4) return;
        ob.list = list;
        refresh.disabled = false;
        const usable = (list.models || []).filter((m) => m.suitable !== false);
        if (usable.length === 0) {
          // Bedrock, or a server without a model list: the model IDs are typed.
          main.text(ob.main || (ob.status && ob.status.model) || "");
          helper.text(ob.helper || (ob.status && ob.status.helperModel) || "");
          msg.className = list.error ? "error" : "field-hint";
          msg.textContent = list.error || (p.provider === "bedrock" ? "Bedrock's models aren't listed here. Type the ID of a model or inference profile your account can use." : "The server lists no models. Type the ID of one.");
        } else {
          const rec = list.recommended || {};
          const mainId = ob.picked ? ob.main : rec.main || usable[0].id;
          const helperId = ob.picked ? ob.helper : rec.helper || usable[0].id;
          main.fill(list, mainId);
          helper.fill(list, helperId);
          msg.className = "field-hint";
          msg.textContent = plural(usable.length, "model") + " available. " + (ob.picked || !rec.main ? "" : "The recommended ones are chosen; pick others if you prefer.");
        }
        read();
      }
      refresh.addEventListener("click", load);

      next.addEventListener("click", async () => {
        error.textContent = "";
        const m = main.value();
        if (!m) { error.textContent = "Choose a model."; return; }
        const h2 = local || ob.same ? "" : helper.value();
        busy(true, [next, refresh, document.getElementById("ob-back")]);
        next.textContent = "Saving…";
        try {
          const st = await api("/api/ai", { model: m, helperModel: h2 === m ? "" : h2, enabled: true }, "PUT");
          if (my !== gen) return;
          ob.status = st;
          if (st.problem) throw new Error(st.problem);
          ob.outcome = "configured";
          go(5);
        } catch (err) {
          if (my !== gen) return;
          error.textContent = err.message;
          busy(false, [next, refresh, document.getElementById("ob-back")]);
          next.textContent = "Finish setup";
        }
      });
      setTimeout(load, 0);
      return screen(4, local ? "Choose your model" : "Choose your models", local ? "Pick the model Run Hound should use on this computer." : "Run Hound uses a stronger model for the agent and a cheaper one for the rest.",
        [main.el, local ? null : sameRow, local ? null : helper.el, local ? null : cost, h("div", { class: "ob-refresh" }, refresh), msg, error],
        [backBtn(3), next, skipLink()]);
    }

    // ----- 5. Ready -----
    function screen5() {
      const configured = ob.outcome === "configured";
      const st = ob.status || {};
      const finish = async (to) => {
        busy(true, [primary, secondary]);
        try { await api("/api/onboarding", { outcome: configured ? "configured" : "skipped" }); } catch (e) { /* it may show again next time */ }
        location.hash = to;
      };
      const primary = h("button", { type: "button", class: "btn primary", id: "ob-finish", onclick: () => finish("#/new"), text: "Test my app" });
      const secondary = h("button", { type: "button", class: "btn", id: "ob-settings", onclick: () => finish("#/settings"), text: "Open Settings" });
      let body;
      if (configured) {
        const protection = st.secretProtection === "os-keychain" ? "encrypted with this computer's keychain" : st.secretProtection === "run-hound" ? "encrypted by Run Hound" : "kept";
        const helperName = st.helperModel && st.helperModel !== st.model ? st.helperModel : "";
        body = [
          h("dl", { class: "ob-summary" },
            h("dt", { text: "Provider" }), h("dd", { text: AI_PROVIDER_LABELS[st.provider] || st.provider || "" }),
            h("dt", { text: ob.choice === "local" ? "Model" : "Main model" }), h("dd", {}, h("code", { text: st.model || "" })),
            ob.choice === "local" ? null : h("dt", { text: "Helper model" }),
            ob.choice === "local" ? null : h("dd", {}, helperName ? h("code", { text: helperName }) : "Same as the main model")),
          h("p", { id: "ob-kept", text: "Your key is " + protection + " in Run Hound's own folder, and only Run Hound opens it. Remove it any time in Settings → AI, or with Delete all keys and data. Uninstalling Run Hound on Windows deletes it; on macOS and Linux, use Delete all keys and data before you remove the app." }),
        ];
      } else {
        body = [
          h("p", { id: "ob-later", text: "You can add a key later in Settings → AI. Run Hound's checks work without AI." }),
          ob.saved ? h("p", { class: "field-hint", id: "ob-kept-off", text: "The key you entered was kept with AI off. Remove it in Settings → AI if you don't want it saved." }) : null,
        ];
      }
      return screen(5, configured ? "AI is set up" : "You're ready to test", null, body, [primary, secondary]);
    }

    draw(true);
  }

`;
