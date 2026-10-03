/**
 * Section of the inline client script: Settings.
 * Concatenated in order with the others to form the body of String.raw in client.ts.
 */
export const SETTINGS = String.raw`  // ---------- Settings ----------

  function viewSettings(my, initial) {
    setTitle("Settings");
    const d = loadDefaults();
    const destructive = h("input", { type: "checkbox", id: "default-destructive" });
    destructive.checked = d.allowDestructive;
    const headed = h("input", { type: "checkbox", id: "default-headed", disabled: !CONFIG.canShowBrowser });
    headed.checked = d.headed;
    const saved = h("p", { class: "saved", text: "Saved in this browser only. Each plan starts with these, and you can still change them per run." });
    const save = () => {
      const ok = saveDefaults({ allowDestructive: destructive.checked, headed: headed.checked });
      saved.textContent = ok ? "Saved in this browser at " + hms(new Date().toISOString()) + "." : "This browser would not let Run Hound save settings (storage is blocked).";
    };
    destructive.addEventListener("change", save);
    headed.addEventListener("change", save);
    const info = h("dl", { class: "settings-list" },
      h("dt", { text: "Version" }), h("dd", {}, h("code", { text: CONFIG.version })),
      h("dt", { text: "Runs folder" }), h("dd", { class: "loading-cell", text: "Loading…" }));
    const help = h("ul", { class: "links" },
      h("li", {}, h("a", { class: "btn", href: "https://github.com/rahul-bharati/run-hound/blob/main/TESTING.md", target: "_blank", rel: "noopener" }, icon("file"), "TESTING.md", h("span", { class: "visually-hidden", text: " (opens in a new tab)" }))),
      h("li", {}, h("a", { class: "btn", href: "https://github.com/rahul-bharati/run-hound/issues/new/choose", target: "_blank", rel: "noopener" }, icon("external"), "Feedback form", h("span", { class: "visually-hidden", text: " (opens in a new tab)" }))));
    view.append(h("div", { class: "page" },
      h("header", { class: "page-head" }, h("h1", { text: "Settings" }), h("p", { text: "Defaults for new runs, and how this Run Hound server is set up." })),
      h("section", { class: "card", "aria-labelledby": "defaults-h" },
        h("h2", { id: "defaults-h", class: "card-title" }, "Defaults"),
        h("div", { class: "options flush" },
          h("div", { class: "option" }, destructive, h("label", { for: "default-destructive" }, "Allow destructive scenarios", h("span", { class: "desc", text: "They may change or delete data beyond creating test records. Leave off unless this is a throwaway environment." }))),
          h("div", { class: "option" }, headed, h("label", { for: "default-headed" }, "Show the browser window", h("span", { class: "desc", text: CONFIG.headedDesc })))),
        saved),
      accountsCard(my),
      aiCard(my),
      h("section", { class: "card", "aria-labelledby": "server-h" },
        h("h2", { id: "server-h", class: "card-title" }, "This server"),
        info),
      h("section", { class: "card", "aria-labelledby": "help-h" },
        h("h2", { id: "help-h", class: "card-title" }, "Help and feedback"),
        help)));
    focusHeading(my, initial);
    api("/api/settings").then((s) => {
      if (my !== gen) return;
      const list = (xs, none) => (xs && xs.length ? h("ul", { class: "plain-list" }, ...xs.map((x) => h("li", {}, h("code", { class: "mono", text: x })))) : h("span", { class: "dim", text: none }));
      fill(info, 
        h("dt", { text: "Version" }), h("dd", {}, h("code", { text: s.version })),
        h("dt", { text: "Runs folder" }), h("dd", {}, h("code", { text: s.runsDir })),
        h("dt", { text: "Allowed extra hosts" }), h("dd", {}, list(s.allowedHosts, "None. Only localhost and private network addresses (set RUNHOUND_ALLOWED_HOSTS to add hosts you own).")),
        h("dt", { text: "Accepted server host names" }), h("dd", {}, list(s.serverHosts, "Loopback names and addresses only (set RUNHOUND_SERVER_HOSTS to add names or addresses).")));
    }).catch((err) => {
      if (my !== gen) return;
      info.append(h("dt", { text: "Server settings" }), h("dd", { class: "error", text: "Could not load them: " + err.message }));
    });
  }

`;
