import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BRAND } from "../../app/src/core/brand.js";
import { STARTUP_DETAILS_MAX, STARTUP_ERROR_PAGE, startupErrorQuery } from "../src/startup-error.js";
import { STARTUP_PROBLEM_TITLE } from "../src/startup-checks.js";

const page = readFileSync(new URL(`../static/${STARTUP_ERROR_PAGE}`, import.meta.url), "utf8");

describe("startupErrorQuery", () => {
  it("carries the title and the problems, one entry each, as JSON", () => {
    const query = startupErrorQuery("Run Hound can't start", ["First problem.", "Second\nproblem."]);
    expect(query).toEqual({ title: "Run Hound can't start", problems: JSON.stringify(["First problem.", "Second\nproblem."]) });
    expect(JSON.parse(query.problems!)).toEqual(["First problem.", "Second\nproblem."]);
  });

  it("survives characters that would break a URL or HTML when loadFile encodes it", () => {
    const nasty = `<img src=x onerror=alert(1)> & "quotes" 100% #hash ?q=1 é`;
    const query = startupErrorQuery("t", [nasty]);
    const decoded = new URLSearchParams(new URL(`file:///x.html?${new URLSearchParams(query)}`).search);
    expect(JSON.parse(decoded.get("problems")!)).toEqual([nasty]);
  });

  it("adds trimmed details when there are some, and cuts a very long one", () => {
    expect(startupErrorQuery("t", ["p"], "  stack\n  at x  \n")).toMatchObject({ details: "stack\n  at x" });
    expect(startupErrorQuery("t", ["p"], "   ")).not.toHaveProperty("details");
    expect(startupErrorQuery("t", ["p"])).not.toHaveProperty("details");
    const long = startupErrorQuery("t", ["p"], "x".repeat(STARTUP_DETAILS_MAX + 500));
    expect(long.details).toHaveLength(STARTUP_DETAILS_MAX + 1);
    expect(long.details?.endsWith("…")).toBe(true);
  });

  it("is titled like the existing start-up problem title", () => {
    expect(STARTUP_PROBLEM_TITLE).toBe("Run Hound can't start");
  });
});

describe("static/startup-error.html", () => {
  it("uses the Run Hound palette: every colour it names is a BRAND value", () => {
    const declared = new Map([...page.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1]!, m[2]!.toUpperCase()]));
    const brand: Record<string, string> = {
      bg: BRAND.bg, "bg-deep": BRAND.bgDeep, surface: BRAND.surface, "surface-3": BRAND.surface3, line: BRAND.line, "line-soft": BRAND.lineSoft, "line-strong": BRAND.lineStrong,
      fg: BRAND.fg, muted: BRAND.muted, accent: BRAND.accent, "accent-strong": BRAND.accentStrong, "accent-ink": BRAND.accentInk,
    };
    expect([...declared.keys()].sort()).toEqual(Object.keys(brand).sort());
    for (const [name, hex] of declared) expect(hex, name).toBe(brand[name]!.toUpperCase());
    // Colours appear only through the tokens: no stray hex outside the :root block.
    expect(page.replace(/:root \{[\s\S]*?\}/, "").match(/#[0-9A-Fa-f]{6}\b/g)).toBeNull();
  });

  it("has the 36 px drag strip, the title, the Quit Run Hound button and a restrictive CSP", () => {
    expect(page).toContain('class="desktop-titlebar"');
    expect(page).toMatch(/\.desktop-titlebar \{[^}]*height:36px;[^}]*-webkit-app-region:drag/);
    expect(page).toContain("<h1 id=\"title\">Run Hound can't start</h1>");
    expect(page).toContain('<button id="quit" type="button">Quit Run Hound</button>');
    expect(page).toMatch(/Content-Security-Policy" content="default-src 'none';/);
  });

  it("writes the messages with textContent only, never as HTML", () => {
    const script = page.slice(page.indexOf("<script>"), page.indexOf("</script>"));
    expect(script).toContain(".textContent = ");
    expect(script).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
  });
});
