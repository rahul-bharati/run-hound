/**
 * Section of the inline client script: the desktop app's update notice.
 * Concatenated in order with the others to form the body of String.raw in client.ts.
 */
export const DESKTOP_UPDATE = String.raw`  // ---------- desktop update notice ----------

  /**
   * Desktop app only. window.runHoundDesktop is the preload's bridge (desktop/src/preload.ts); a browser has none, and
   * then nothing here runs. The app's main process checks GitHub Releases once per launch, and when a newer release
   * exists this adds a small dismissible notice to the sidebar with a link to its download page. The app never installs
   * an update. A failed check (offline, rate limited, anything unexpected) shows nothing, and the UI works as before.
   */
  function desktopUpdateNotice() {
    const bridge = window.runHoundDesktop;
    if (!bridge || !bridge.version || typeof bridge.version.check !== "function") return;
    const DISMISSED_KEY = "run-hound.update-dismissed";
    const read = () => { try { return sessionStorage.getItem(DISMISSED_KEY); } catch (e) { return null; } };
    const remember = (v) => { try { sessionStorage.setItem(DISMISSED_KEY, v); } catch (e) { /* dismissed for this page load only */ } };
    let answer;
    try { answer = Promise.resolve(bridge.version.check()); } catch (e) { return; }
    answer.then((r) => {
      // Only the shape the main process sends, and only a link to a release page on GitHub: anything else shows nothing.
      if (!r || r.newer !== true) return;
      if (typeof r.latest !== "string" || !/^\d+\.\d+\.\d+[\w.+-]*$/.test(r.latest)) return;
      if (typeof r.url !== "string" || !r.url.startsWith("https://github.com/")) return;
      if (read() === r.latest || document.getElementById("desktop-update")) return;
      const note = h("div", { id: "desktop-update", class: "update-note" },
        h("p", { text: "Run Hound " + r.latest + " is available." }),
        h("div", { class: "update-actions" },
          h("a", { href: r.url, target: "_blank", rel: "noopener noreferrer", text: "Download" }),
          h("button", { type: "button", class: "update-dismiss", "aria-label": "Dismiss the update notice", text: "Dismiss", onclick: () => {
            remember(r.latest);
            const hadFocus = note.contains(document.activeElement);
            note.remove();
            if (hadFocus) view.focus({ preventScroll: true });
          } })));
      sidebar.insertBefore(note, sidebar.querySelector(".side-foot"));
      announce("Run Hound " + r.latest + " is available.");
    }).catch(() => {});
  }
  desktopUpdateNotice();

`;
