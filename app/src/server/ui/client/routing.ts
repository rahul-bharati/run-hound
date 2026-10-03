/**
 * Section of the inline client script: routing.
 * Concatenated in order with the others to form the body of String.raw in client.ts.
 */
export const ROUTING = String.raw`  // ---------- routing ----------

  let gen = 0;
  let firstRender = true;

  function parseRoute() {
    const hash = location.hash;
    let m = /^#run=([\w-]+)$/.exec(hash);
    if (m) {
      history.replaceState(null, "", "#/runs/" + m[1]);
      return { name: "run", id: m[1], nav: "#/runs" };
    }
    if (hash === "" || hash === "#" || hash === "#/") return { name: "new", nav: "#/new" };
    m = /^#\/new(?:\?(.*))?$/.exec(hash);
    if (m) {
      const q = new URLSearchParams(m[1] || "");
      const from = q.get("from");
      return { name: "new", nav: "#/new", from: from && /^[\w-]+$/.test(from) ? from : null };
    }
    if (hash === "#/runs") return { name: "runs", nav: "#/runs" };
    m = /^#\/runs\/([\w-]+)$/.exec(hash);
    if (m) return { name: "run", id: m[1], nav: "#/runs" };
    if (hash === "#/settings") return { name: "settings", nav: "#/settings" };
    history.replaceState(null, "", "#/new");
    return { name: "new", nav: "#/new" };
  }

  function setNav(href) {
    for (const a of document.querySelectorAll("#main-nav a")) {
      if (a.getAttribute("href") === href) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
  }
  function setMenu(open) {
    sidebar.classList.toggle("open", open);
    menuButton.setAttribute("aria-expanded", String(open));
  }
  menuButton.addEventListener("click", () => setMenu(menuButton.getAttribute("aria-expanded") !== "true"));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menuButton.getAttribute("aria-expanded") === "true") {
      setMenu(false);
      menuButton.focus();
    }
  });
  document.addEventListener("click", (e) => {
    if (menuButton.getAttribute("aria-expanded") === "true" && !sidebar.contains(e.target)) setMenu(false);
    for (const d of document.querySelectorAll("details.download[open]")) if (!d.contains(e.target)) d.open = false;
  });

  function setTitle(t) { document.title = t ? t + " · Run Hound" : "Run Hound"; }

  /** After navigating (not on first load), move focus to the new view's heading so keyboard and screen reader users land there. */
  function focusHeading(my, initial) {
    if (initial || my !== gen) return;
    const h1 = view.querySelector("h1");
    if (!h1) return;
    h1.setAttribute("tabindex", "-1");
    h1.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  function render() {
    const r = parseRoute();
    const my = ++gen;
    const initial = firstRender;
    firstRender = false;
    setNav(r.nav);
    setMenu(false);
    fill(view);
    if (r.name === "new") viewNew(r, my, initial);
    else if (r.name === "runs") viewRuns(my, initial);
    else if (r.name === "run") viewRun(r.id, my, initial);
    else if (r.name === "settings") viewSettings(my, initial);
  }

`;
