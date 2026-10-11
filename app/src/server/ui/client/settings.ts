/**
 * Section of the inline client script: Settings.
 * Concatenated in order with the others to form the body of String.raw in client.ts.
 */
export const SETTINGS = String.raw`  // ---------- Settings ----------

  // The page's cards in order, each reachable from the section nav at the top: [card id, name].
  const SETTINGS_SECTIONS = [
    ["ai-card", "AI model"],
    ["accounts-card", "Test accounts"],
    ["keys-card", "Keys and passwords"],
    ["defaults-card", "Run defaults"],
    ["about-card", "About"],
  ];

  /**
   * Moves to a card on this page: scrolls it into view and puts focus on its heading, for keyboard and screen reader
   * users too. Plain #anchors can't do this: the hash is the route.
   */
  function jumpTo(cardId) {
    const card = document.getElementById(cardId);
    if (!card) return;
    card.scrollIntoView({ block: "start" });
    const heading = card.querySelector("h2");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
  }
  /** A link to a card of this page (href is the route itself: a click jumps, nothing is navigated). */
  function jumpLink(cardId, label, attrs) {
    const a = h("a", Object.assign({ href: "#/settings" }, attrs || {}), label);
    a.addEventListener("click", (e) => { e.preventDefault(); jumpTo(cardId); });
    return a;
  }

  /**
   * What the cards learn from the server that other cards show too: the AI and accounts statuses (how secrets are kept,
   * where the settings folder is). A card reports its status when it is drawn; the cards that show it follow.
   */
  function settingsKnown() {
    const k = { ai: null, accounts: null, loaded: { ai: false, accounts: false }, subs: [] };
    k.report = (kind, st) => {
      k[kind] = st || null;
      k.loaded[kind] = true;
      for (const f of k.subs) f(k);
    };
    k.on = (f) => { k.subs.push(f); f(k); };
    k.ready = () => Boolean(k.ai || k.accounts) || (k.loaded.ai && k.loaded.accounts);
    k.protection = () => (k.ai && k.ai.secretProtection) || (k.accounts && k.accounts.secretProtection) || null;
    /** The settings folder: where ai.json, accounts.json and the encrypted secrets are kept ("" until a status says). */
    k.folder = () => {
      const file = (k.ai && k.ai.file) || (k.accounts && k.accounts.file) || "";
      return file.replace(/[\\/][^\\/]*$/, "");
    };
    return k;
  }

  function viewSettings(my, initial) {
    setTitle("Settings");
    const known = settingsKnown();
    const d = loadDefaults();
    const destructive = h("input", { type: "checkbox", id: "default-destructive" });
    destructive.checked = d.allowDestructive;
    const headed = h("input", { type: "checkbox", id: "default-headed", disabled: !CONFIG.canShowBrowser });
    headed.checked = d.headed;
    const saved = h("p", { class: "saved", text: (onDesktop ? "Saved on this computer." : "Saved in this browser only.") + " Each plan starts with these, and you can still change them per run." });
    const save = () => {
      const ok = saveDefaults({ allowDestructive: destructive.checked, headed: headed.checked });
      saved.textContent = ok ? (onDesktop ? "Saved at " : "Saved in this browser at ") + hms(new Date().toISOString()) + "." : (onDesktop ? "Run Hound could not save these settings." : "This browser would not let Run Hound save settings (storage is blocked).");
    };
    destructive.addEventListener("change", save);
    headed.addEventListener("change", save);

    const nav = h("nav", { class: "settings-nav", "aria-label": "On this page" },
      h("ul", {}, SETTINGS_SECTIONS.map((s) => h("li", {}, jumpLink(s[0], s[1])))));

    const defaultsCard = h("section", { class: "card", id: "defaults-card", "aria-labelledby": "defaults-h" },
      h("h2", { id: "defaults-h", class: "card-title" }, icon("sliders"), "Run defaults"),
      h("div", { class: "options flush" },
        h("div", { class: "option" }, destructive, h("label", { for: "default-destructive" }, "Allow destructive scenarios", h("span", { class: "desc", text: "They may change or delete data beyond creating test records. Leave off unless this is a throwaway environment." }))),
        h("div", { class: "option" }, headed, h("label", { for: "default-headed" }, "Show the browser window", h("span", { class: "desc", text: CONFIG.headedDesc })))),
      saved);

    view.append(h("div", { class: "page settings-page" },
      h("header", { class: "page-head" }, h("h1", { text: "Settings" }), h("p", { text: onDesktop ? "Your AI model, test accounts and run defaults, and how Run Hound is set up on this computer." : "Your AI model, test accounts and run defaults, and how this Run Hound server is set up." })),
      nav,
      aiCard(my, known),
      accountsCard(my, known),
      keysCard(known),
      defaultsCard,
      aboutCard(my, known)));
    focusHeading(my, initial);
  }

  // ---------- Settings: keys and passwords ----------

  /**
   * The one place that says how API keys and test-account passwords are kept, from the status's secretProtection
   * ("os-keychain", "run-hound" or "environment"). The AI and accounts cards only point here.
   */
  function keysCard(known) {
    const body = h("div", { class: "keys-body" }, h("p", { class: "loading", text: "Loading…" }));
    const card = h("section", { class: "card keys-card", id: "keys-card", "aria-labelledby": "keys-h" },
      h("h2", { id: "keys-h", class: "card-title" }, icon("key"), "Keys and passwords"),
      body);
    known.on((k) => { if (k.ready()) drawKeys(body, k); });
    return card;
  }

  function drawKeys(body, k) {
    const protection = k.protection();
    const folder = k.folder();
    const machine = onDesktop ? "this computer" : "this machine";
    const what = "Your API keys and test-account passwords";
    const never = " They are never shown again after you save them.";
    let state;
    let lead;
    if (protection === "os-keychain") {
      state = chip("ok", "Encrypted with your system keychain");
      lead = what + " are encrypted with your system keychain. They are stored only on " + machine + "." + never;
    } else if (protection === "run-hound") {
      state = chip("ok", "Encrypted by Run Hound");
      lead = what + " are encrypted by Run Hound on " + machine + ", and only your user account can read them. No system keychain was available." + never;
    } else if (protection === "environment") {
      state = chip("", "Not saved here");
      lead = "API keys and test-account passwords aren't saved here: set them with environment variables when you start the container.";
    } else {
      state = chip("", "Kept on " + machine);
      lead = what + " are kept on " + machine + "." + never;
    }
    // The desktop app asks the OS for its keychain the first time a key or password is needed; say what to expect.
    const platform = document.documentElement.dataset.platform;
    const platformNote = !onDesktop || protection !== "os-keychain" ? ""
      : platform === "darwin" ? "The first time Run Hound needs them, macOS may ask whether Run Hound can use your keychain. Choose Always Allow."
      : platform === "linux" ? "Your system may ask you to unlock your keyring the first time Run Hound needs them."
      : "";
    fill(body,
      h("p", { class: "keys-state" }, state),
      h("p", { class: "keys-lead", id: "keys-lead", text: lead }),
      platformNote ? noticeBox("info", platformNote, { id: "keys-platform-note" }) : null,
      protection === "environment" ? null : h("p", { class: "muted keys-more", text: "To change one, type a new value in its field. To delete one, choose Remove next to it." }),
      protection === "environment" || !folder ? null : h("p", { class: "note keys-where" }, "Encrypted files are kept in ", h("code", { class: "mono", text: folder }), "."));
  }

  // ---------- Settings: about ----------

  function aboutCard(my, known) {
    const info = h("dl", { class: "settings-list" });
    let settings = null;
    let failed = "";
    const list = (xs, none) => (xs && xs.length ? h("ul", { class: "plain-list" }, ...xs.map((x) => h("li", {}, h("code", { class: "mono", text: x })))) : h("span", { class: "dim", text: none }));
    const draw = () => {
      const folder = known.folder();
      fill(info,
        h("dt", { text: "Version" }), h("dd", {}, h("code", { text: settings ? settings.version : CONFIG.version })),
        h("dt", { text: "Runs folder" }), settings ? h("dd", {}, h("code", { text: settings.runsDir })) : h("dd", { class: "loading-cell", text: "Loading…" }),
        folder ? h("dt", { text: "Settings folder" }) : null, folder ? h("dd", {}, h("code", { text: folder })) : null,
        settings ? h("dt", { text: "Allowed extra hosts" }) : null,
        settings ? h("dd", {}, list(settings.allowedHosts, onDesktop ? "None. Run Hound tests this computer (localhost) and private network addresses." : "None. Only localhost and private network addresses (set RUNHOUND_ALLOWED_HOSTS to add hosts you own).")) : null,
        // The desktop's engine answers on this computer only, behind a per-launch token: nothing to configure.
        settings && !onDesktop ? h("dt", { text: "Accepted server host names" }) : null,
        settings && !onDesktop ? h("dd", {}, list(settings.serverHosts, "Loopback names and addresses only (set RUNHOUND_SERVER_HOSTS to add names or addresses).")) : null,
        failed ? h("dt", { text: "Server settings" }) : null,
        failed ? h("dd", { class: "error", text: "Could not load them: " + failed }) : null);
    };
    draw();
    known.on(draw);
    api("/api/settings").then((s) => {
      if (my !== gen) return;
      settings = s;
      draw();
    }).catch((err) => {
      if (my !== gen) return;
      failed = err.message;
      draw();
    });
    const newTab = h("span", { class: "visually-hidden", text: " (opens in a new tab)" });
    const help = h("ul", { class: "links" },
      h("li", {}, h("a", { class: "btn", href: "https://github.com/rahul-bharati/run-hound/blob/main/TESTING.md", target: "_blank", rel: "noopener" }, icon("file"), "Testing guide", newTab.cloneNode(true))),
      h("li", {}, h("a", { class: "btn", href: "https://github.com/rahul-bharati/run-hound/issues/new/choose", target: "_blank", rel: "noopener" }, icon("external"), "Send feedback", newTab.cloneNode(true))));
    return h("section", { class: "card", id: "about-card", "aria-labelledby": "about-h" },
      h("h2", { id: "about-h", class: "card-title" }, icon("info"), "About"),
      info,
      h("div", { class: "about-help" }, h("p", { class: "muted", text: "Need help, or found a problem? Both open on GitHub." }), help));
  }

`;
