/**
 * Section of the inline client script: the desktop app's one-time notices.
 * Concatenated in order with the others to form the body of String.raw in client.ts.
 */
export const DESKTOP_NOTICES = String.raw`  // ---------- desktop notices ----------

  /**
   * Desktop app only. window.runHoundDesktop is the preload's bridge (desktop/src/preload.ts); a browser has none, and
   * then nothing here runs. The app's main process queues messages for the user (today: the one-time import of the
   * command line's settings) instead of opening a native message box. This takes them once, when the page loads, and
   * shows each as a dismissible banner at the top of the main view, announced through the live region. Text only: a
   * message is never put in as HTML. A bridge that fails, or sends anything but the shape below, shows nothing.
   */
  function desktopNotices() {
    const bridge = window.runHoundDesktop;
    if (!bridge || !bridge.notices || typeof bridge.notices.take !== "function") return;
    let answer;
    try { answer = Promise.resolve(bridge.notices.take()); } catch (e) { return; }
    answer.then((list) => {
      if (!Array.isArray(list)) return;
      const notices = list
        .filter((n) => n && (n.type === "info" || n.type === "warning") && typeof n.message === "string" && n.message !== "")
        .slice(0, 5);
      if (notices.length === 0 || document.getElementById("desktop-notices")) return;
      const box = h("div", { id: "desktop-notices", class: "desktop-notices", role: "group", "aria-label": "Notices" });
      const detailOf = (n) => (typeof n.detail === "string" && n.detail !== "" ? n.detail : "");
      for (const n of notices) {
        const warning = n.type === "warning";
        const label = warning ? "Warning" : "Notice";
        const row = h("div", { class: "desktop-notice" + (warning ? " is-warning" : ""), "data-type": n.type },
          h("div", { class: "desktop-notice-text" },
            h("span", { class: "desktop-notice-label", text: label }),
            h("p", { text: n.message }),
            detailOf(n) ? h("p", { class: "desktop-notice-detail", text: detailOf(n) }) : null),
          h("button", { type: "button", class: "desktop-notice-dismiss", "aria-label": "Dismiss this notice", text: "Dismiss", onclick: () => {
            const hadFocus = row.contains(document.activeElement);
            row.remove();
            if (!box.querySelector(".desktop-notice")) { box.remove(); observer.disconnect(); }
            if (hadFocus) view.focus({ preventScroll: true });
          } }));
        box.append(row);
      }
      // Every route draws into #view and clears it first, so put the banner back at the top after each draw until it is dismissed.
      const observer = new MutationObserver(() => { if (box.parentNode !== view && box.firstChild) view.prepend(box); });
      observer.observe(view, { childList: true });
      view.prepend(box);
      announce(notices.map((n) => (n.type === "warning" ? "Warning: " : "") + n.message + (detailOf(n) ? " " + detailOf(n) : "")).join(" "));
    }).catch(() => {});
  }
  desktopNotices();

`;
