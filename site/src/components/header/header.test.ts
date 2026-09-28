// The site header (DESIGN.md §3.2): the data the Server Component hands the client parts, the current hub, the phone
// menu's items and when it closes, and the first render as the prerendered HTML has it. The built site is tested in the
// lab (scripts/lab/specs/header.spec.mjs). `pnpm test`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { element, elements, html, textOf } from "../primitives/test-render";

process.env.NEXT_PUBLIC_SITE_URL = "https://run-hound.example";
const { site } = await import("@/lib/site");
const nav = await import("@/lib/nav");
const { hasRoute, routes } = await import("@/content/routes");
const { headerProps } = await import("./header-data");
const { isCurrentHub } = await import("./current-hub");
const { leavesHeader, menuItems } = await import("./menu");
const { HeaderClient } = await import("./header-client");

const props = headerProps();

describe("the data the header's client parts get (plain props, ES2)", () => {
  test("the five hubs of the registry, in order", () => {
    assert.deepEqual(props.links, nav.headerLinks());
    assert.deepEqual(
      props.links.map((link) => link.label),
      ["Docs", "Checks", "Demo", "AI-built apps", "Open source"],
    );
  });

  test("Try it locally goes to the quick start: its own page once registered, its /docs/ section until then (V1)", () => {
    assert.equal(props.cta.label, site.cta);
    assert.equal(props.cta.href, hasRoute("docs-quick-start") ? "/docs/quick-start/" : "/docs/#quick-start");
    assert.equal(
      props.cta.href,
      nav.resolveTarget({ to: "docs-quick-start", fallback: { to: "docs", hash: "quick-start" } }),
    );
  });

  test("home, docs, the release, the changelog and GitHub come from the registry and lib/site.ts", () => {
    assert.equal(props.home, nav.href("home"));
    assert.equal(props.docs, nav.href("docs"));
    assert.equal(props.version, site.version);
    assert.equal(props.changelog, site.changelog);
    assert.equal(props.github, site.github);
  });

  test("the props are plain data (they cross to the client as JSON)", () => {
    assert.deepEqual(JSON.parse(JSON.stringify(props)), props);
  });
});

describe("the current hub", () => {
  test("the client's copy agrees with lib/nav.ts on every registry page, with and without the trailing slash", () => {
    for (const r of routes) {
      for (const hub of props.links) {
        for (const pathname of [r.path, r.path === "/" ? "/" : r.path.replace(/\/$/, "")]) {
          assert.equal(isCurrentHub(pathname, hub.href), nav.isCurrentHub(pathname, hub.href), `${pathname} × ${hub.href}`);
        }
      }
    }
  });

  test('"Docs" on every /docs/* page, "Checks" on every /checks/* page, nothing on the homepage', () => {
    assert.equal(isCurrentHub("/docs/quick-start", "/docs/"), true);
    assert.equal(isCurrentHub("/docs/", "/docs/"), true);
    assert.equal(isCurrentHub("/checks/double-submit/", "/checks/"), true);
    assert.equal(isCurrentHub("/checks", "/checks/"), true);
    assert.equal(isCurrentHub("/", "/docs/"), false);
    assert.equal(isCurrentHub("/docsx/", "/docs/"), false);
    assert.equal(isCurrentHub(null, "/docs/"), false);
  });
});

describe("the phone menu", () => {
  test("8 items: the 5 hubs, GitHub, the changelog with the release, then Try it locally", () => {
    const items = menuItems(props);
    assert.deepEqual(
      items.map((item) => item.label),
      ["Docs", "Checks", "Demo", "AI-built apps", "Open source", "GitHub", `Changelog · v${site.version}`, site.cta],
    );
    assert.deepEqual(
      items.map((item) => item.kind),
      ["hub", "hub", "hub", "hub", "hub", "external", "external", "cta"],
    );
    assert.equal(items[5].href, site.github);
    assert.equal(items[6].href, site.changelog);
    assert.equal(items[7].href, props.cta.href);
  });

  test("focus leaving the header closes it; focus moving inside it does not (E1)", () => {
    const inside = { id: "inside" };
    const header = { contains: (node: unknown) => node === inside };
    assert.equal(leavesHeader(header, inside), false);
    assert.equal(leavesHeader(header, { id: "outside" }), true);
    // Focus going nowhere (a click on the page, the window losing focus) is leaving too.
    assert.equal(leavesHeader(header, null), true);
  });

  test("one focusout handler, on <header>, never on the panel (the E1 bug)", () => {
    const source = readFileSync(new URL("./header-client.tsx", import.meta.url), "utf8");
    assert.equal((source.match(/onBlur=/g) ?? []).length, 1, "exactly one onBlur (React's focusout)");
    assert.match(source, /<header[^>]*\bonBlur=/, "the handler sits on <header>");
    assert.doesNotMatch(source, /addEventListener\(\s*["']focusout["']/);
  });

  test("Menu keeps its name while open: aria-expanded carries the state (APG disclosure)", () => {
    const source = readFileSync(new URL("./header-client.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(source, /["']Close["']/, "no \"Close\" label that contradicts aria-expanded");
  });

  test("the menu's call to action is the ButtonLink primitive, rendered by the server part and passed in", () => {
    const client = readFileSync(new URL("./header-client.tsx", import.meta.url), "utf8");
    const server = readFileSync(new URL("../site-header.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(client, /btn-primary|data-accent-exempt/, "the client doesn't rebuild the button by hand");
    assert.match(client, /\{menuAction\}/);
    assert.match(server, /menuAction=\{\s*<ButtonLink\b/);
  });

  test("a press outside is judged by the header's own ref, not by the layout's DOM shape", () => {
    const source = readFileSync(new URL("./header-client.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(source, /closest\(\s*["']body > header["']\s*\)/);
    assert.match(source, /headerRef\.current\?\.contains\(/);
  });
});

describe("the first render (the prerendered HTML)", () => {
  const markup = html(
    createElement(HeaderClient, {
      ...props,
      brand: createElement("span", null, "Run Hound"),
      action: createElement("a", { href: props.cta.href, className: "btn btn-primary btn-sm has-arrow" }, props.cta.label),
      menuAction: createElement("a", { href: props.cta.href, className: "btn btn-primary has-arrow w-full" }, props.cta.label),
    }),
  );
  const header = element(markup, "header")!;

  test("a <header> with no heading (the page's first heading is its h1, G-T3)", () => {
    assert.ok(header, "renders a <header>");
    assert.doesNotMatch(header.outer, /<h[1-6][\s>]/);
    assert.doesNotMatch(header.outer, /<dialog[\s>]/, "the search dialog loads on first open, not with the page");
  });

  test("the main navigation: the five hubs in order, none current without a path", () => {
    const main = element(header.outer, "nav", 'aria-label="Main"')!;
    const links = elements(main.inner, "a");
    assert.deepEqual(
      links.map((link) => [/href="([^"]*)"/.exec(link.attrs)?.[1], textOf(link.inner)]),
      props.links.map((link) => [link.href, link.label]),
    );
    assert.doesNotMatch(main.inner, /aria-current/);
  });

  test('Search: a server-rendered button named "Search Ctrl K", with its shortcuts and no "/" key', () => {
    const trigger = element(header.outer, "button", "data-search-trigger")!;
    assert.ok(trigger, "the trigger is in the HTML");
    assert.match(trigger.attrs, /aria-keyshortcuts="Control\+K Meta\+K"/);
    assert.doesNotMatch(trigger.attrs, /aria-label=/, "the visible text is the name (WCAG 2.5.3)");
    assert.equal(textOf(trigger.inner).replace(/\s+/g, " ").trim(), "Search Ctrl K");
  });

  test("the release chip links the changelog, and says so to screen readers", () => {
    const chip = elements(header.outer, "a").find((a) => a.attrs.includes(`href="${site.changelog}"`))!;
    assert.ok(chip);
    assert.equal(textOf(chip.inner).replace(/\s+/g, " ").trim(), `v${site.version} changelog`);
    assert.match(chip.inner, /class="sr-only"[^>]*> changelog</);
  });

  test("GitHub, and the call to action", () => {
    const github = elements(header.outer, "a").find((a) => a.attrs.includes(`href="${site.github}"`))!;
    assert.equal(textOf(github.inner).trim(), "GitHub");
    assert.match(header.outer, new RegExp(`href="${props.cta.href.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}"[^>]*>${site.cta}<`));
  });

  test("Menu: a disclosure button; the panel is rendered only while open", () => {
    const menu = elements(header.outer, "button").find((b) => b.attrs.includes("aria-controls"))!;
    assert.match(menu.attrs, /aria-expanded="false"/);
    assert.match(menu.attrs, /aria-controls="site-menu"/);
    assert.equal(textOf(menu.inner).trim(), "Menu");
    assert.doesNotMatch(markup, /id="site-menu"/);
  });

  test("nothing in the bar is dim (3.83:1 in the translucent header), and no inline style", () => {
    assert.doesNotMatch(header.outer, /\btext-dim\b/);
    assert.doesNotMatch(header.outer, /\sstyle="/);
  });
});
