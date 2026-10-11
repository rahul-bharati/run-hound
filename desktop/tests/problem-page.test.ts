import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BRAND } from "../../app/src/core/brand.js";
import { STARTUP_DETAILS_MAX } from "../src/startup-error.js";
import { PROBLEM_ACTIONS, PROBLEM_PAGE, isProblemPageUrl, problemAction, problemQuery } from "../src/problem-page.js";

const page = readFileSync(new URL(`../static/${PROBLEM_PAGE}`, import.meta.url), "utf8");
const script = page.slice(page.indexOf("<script>"), page.indexOf("</script>"));

describe("problemQuery", () => {
  it("carries the title, the paragraphs as JSON, the details and the buttons in order", () => {
    const query = problemQuery({ title: "This page didn't load", paragraphs: ["First.", "Second\nline."], details: "Error: X (-102)\nPage: /" }, ["retry", "quit"]);
    expect(query).toEqual({
      title: "This page didn't load",
      problems: JSON.stringify(["First.", "Second\nline."]),
      details: "Error: X (-102)\nPage: /",
      actions: "retry,quit",
    });
  });

  it("leaves the details out when there are none, and cuts a very long stack like the start-up window does", () => {
    expect(problemQuery({ title: "t", paragraphs: ["p"] }, ["dismiss"])).not.toHaveProperty("details");
    const long = problemQuery({ title: "t", paragraphs: ["p"], details: "x".repeat(STARTUP_DETAILS_MAX + 100) }, ["dismiss"]);
    expect(long.details).toHaveLength(STARTUP_DETAILS_MAX + 1);
  });

  it("survives characters that would break a URL or HTML when loadFile encodes it", () => {
    const nasty = `<img src=x onerror=alert(1)> & "quotes" 100% #hash ?q=1 é`;
    const query = problemQuery({ title: nasty, paragraphs: [nasty], details: nasty }, ["reload"]);
    const decoded = new URLSearchParams(new URL(`file:///x/${PROBLEM_PAGE}?${new URLSearchParams(query)}`).search);
    expect([decoded.get("title"), JSON.parse(decoded.get("problems")!), decoded.get("details")]).toEqual([nasty, [nasty], nasty]);
  });
});

describe("what a button press on the problem page asks for", () => {
  const url = (hash: string, base = `file:///opt/Run%20Hound/resources/app.asar/dist/${PROBLEM_PAGE}?title=x&actions=retry`): string => `${base}${hash}`;

  it("is the action in the page's new address, when that button was offered", () => {
    expect(problemAction(url("#retry-1"), ["retry", "quit"])).toBe("retry");
    expect(problemAction(url("#quit-12"), ["retry", "quit"])).toBe("quit");
    expect(problemAction(url("#dismiss-3"), ["dismiss", "quit"])).toBe("dismiss");
    expect(problemAction(url("#reload-1"), ["reload"])).toBe("reload");
  });

  it("is nothing for a button that wasn't offered, so a child window can't be made to quit the app", () => {
    expect(problemAction(url("#quit-1"), ["retry"])).toBeNull();
    expect(problemAction(url("#dismiss-1"), ["retry", "quit"])).toBeNull();
    expect(problemAction(url("#retry-1"), [])).toBeNull();
  });

  it("is nothing for any other address: no action, no counter, junk after it, another page or scheme", () => {
    const offered = [...PROBLEM_ACTIONS];
    for (const hash of ["", "#", "#retry", "#retry-", "#retry-x", "#retry-1x", "#retry-1234567", "#RETRY-1", "#retry-1#quit-1", "#/retry-1", "#__proto__-1"]) {
      expect(problemAction(url(hash), offered), hash).toBeNull();
    }
    expect(problemAction("file:///opt/dist/startup-error.html#quit-1", offered)).toBeNull();
    expect(problemAction("http://127.0.0.1:5000/problem.html#quit-1", offered)).toBeNull();
    expect(problemAction("https://example.com/dist/problem.html#quit-1", offered)).toBeNull();
    expect(problemAction("not a url", offered)).toBeNull();
    expect(problemAction("", offered)).toBeNull();
  });

  it("knows the problem page's own address, with or without a query or fragment", () => {
    expect(isProblemPageUrl(`file:///home/me/run-hound/desktop/dist/${PROBLEM_PAGE}`)).toBe(true);
    expect(isProblemPageUrl(`file:///C:/Users/me/AppData/Local/Programs/run-hound-desktop/resources/app.asar/dist/${PROBLEM_PAGE}?a=b#c-1`)).toBe(true);
    expect(isProblemPageUrl("file:///home/me/dist/startup-error.html")).toBe(false);
    expect(isProblemPageUrl("http://127.0.0.1:1/problem.html")).toBe(false);
    expect(isProblemPageUrl("garbage")).toBe(false);
  });
});

describe("static/problem.html", () => {
  it("uses the Run Hound palette: every colour it names is a BRAND value", () => {
    const declared = new Map([...page.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1]!, m[2]!.toUpperCase()]));
    const brand: Record<string, string> = {
      bg: BRAND.bg, "bg-deep": BRAND.bgDeep, surface: BRAND.surface, "surface-3": BRAND.surface3, line: BRAND.line, "line-soft": BRAND.lineSoft, "line-strong": BRAND.lineStrong,
      fg: BRAND.fg, muted: BRAND.muted, accent: BRAND.accent, "accent-strong": BRAND.accentStrong, "accent-ink": BRAND.accentInk,
    };
    expect([...declared.keys()].sort()).toEqual(Object.keys(brand).sort());
    for (const [name, hex] of declared) expect(hex, name).toBe(brand[name]!.toUpperCase());
    expect(page.replace(/:root \{[\s\S]*?\}/, "").match(/#[0-9A-Fa-f]{6}\b/g)).toBeNull();
  });

  it("has the 36 px drag strip, set here as the child windows' stylesheet sets it, and a restrictive policy", () => {
    expect(page).toContain('class="desktop-titlebar"');
    expect(page).toMatch(/\.desktop-titlebar \{[^}]*position:fixed;[^}]*height:36px;[^}]*-webkit-app-region:drag/);
    expect(page).toMatch(/body \{[^}]*padding-top:36px;/);
    expect(page).toMatch(/Content-Security-Policy" content="default-src 'none'; [^"]*base-uri 'none'; form-action 'none'"/);
    expect(page).not.toMatch(/https?:\/\//);
  });

  it("writes the messages and the button labels with textContent only, never as HTML", () => {
    expect(script).toContain(".textContent = ");
    expect(script).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
  });

  it("labels exactly the actions the main process understands, and presses a button by changing its own address", () => {
    const labels = /var LABELS = \{([^}]*)\}/.exec(script)?.[1] ?? "";
    expect([...labels.matchAll(/(\w+):\s*"([^"]+)"/g)].map((m) => [m[1], m[2]])).toEqual([
      ["dismiss", "Keep using Run Hound"],
      ["quit", "Quit Run Hound"],
      ["retry", "Try again"],
      ["reload", "Reload"],
    ]);
    expect([...labels.matchAll(/(\w+):\s*"/g)].map((m) => m[1])).toEqual([...PROBLEM_ACTIONS]);
    expect(script).toContain('location.hash = id + "-" + presses');
    expect(script).not.toMatch(/ipcRenderer|require\(|window\.runHoundDesktop/);
  });
});
