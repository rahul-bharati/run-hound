// The other primitives of DESIGN.md §2.5, the page sprite (§2.9) and the line hound (§2.6), rendered to HTML.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement, isValidElement, type ReactElement } from "react";
import { bugFormUrl } from "@/lib/nav";
import { sourceFiles } from "../../../scripts/lib/build-output.mjs";
import { element, elements, html, textOf } from "./test-render";

const { ButtonLink } = await import("./button-link");
const { ArrowLink, TextLink } = await import("./links");
const { NavLink, prefetchProp } = await import("./nav-link");
const { IntentLink } = await import("./intent-link");
const { Pill } = await import("./pill");
const { Tag } = await import("./tag");
const { Card, IconTile } = await import("./card");
const { Tick, tickPath } = await import("./tick");
const { Container, Band, SectionHeading } = await import("./layout");
const { Figure } = await import("./figure");
const { Callout } = await import("./callout");
const { StepTrail } = await import("./step-trail");
const { FactsList } = await import("./facts-list");
const { PrevNext } = await import("./prev-next");
const { ReportLine, bugReportUrl } = await import("./report-line");
const { Sprite, SpriteIcon } = await import("../sprite");
const { LineHound, houndStrokes } = await import("../hound/line-hound");
const { Laptop } = await import("lucide-react");

const h = createElement;

describe("ButtonLink", () => {
  test("primary: accent fill, an arrow drawn by CSS, exempt from the accent budget (lab brand audit)", () => {
    const markup = html(h(ButtonLink, { href: "/docs/", children: "Try it locally" }));
    const link = element(markup, "a")!;
    assert.match(link.attrs, /href="\/docs\/"/);
    assert.match(link.attrs, /class="btn btn-primary has-arrow"/);
    assert.match(link.attrs, /data-accent-exempt=""/);
    assert.equal(textOf(link.inner), "Try it locally");
  });

  test("secondary: an outline, not exempt (it isn't accent)", () => {
    const link = element(html(h(ButtonLink, { href: "https://github.com/rahul-bharati/run-hound", variant: "secondary", children: "View on GitHub" })), "a")!;
    assert.match(link.attrs, /class="btn btn-secondary"/);
    assert.doesNotMatch(link.attrs, /data-accent-exempt/);
  });

  test("header size is 44 px (btn-sm); the default 48 px", () => {
    const link = element(html(h(ButtonLink, { href: "/docs/", size: "header", children: "Try it locally" })), "a")!;
    assert.match(link.attrs, /btn-sm/);
  });

  test("a short label on phones keeps the full label as the accessible name, which contains the visible one (2.5.3)", () => {
    const markup = html(h(ButtonLink, { href: "https://github.com/x", variant: "secondary", icon: "github", shortLabel: "GitHub", children: "View on GitHub" }));
    const link = element(markup, "a")!;
    assert.match(link.attrs, /aria-label="View on GitHub"/);
    assert.equal(textOf(element(markup, "span", 'class="sm:hidden"')?.inner ?? ""), "GitHub");
    assert.equal(textOf(element(markup, "span", 'class="max-sm:hidden"')?.inner ?? ""), "View on GitHub");
    assert.ok("View on GitHub".includes("GitHub"));
    assert.match(element(markup, "svg")?.inner ?? "", /<use href="#github"/);
  });

  test("/_design/ can show hover, focus and active at rest", () => {
    const link = element(html(h(ButtonLink, { href: "/docs/", demoState: "hover", children: "Try it locally" })), "a")!;
    assert.match(link.attrs, /data-demo-state="hover"/);
  });
});

describe("links", () => {
  test("TextLink: accent text, underlined at rest (a link in a paragraph can't rely on colour alone, axe link-in-text-block)", () => {
    const link = element(html(h(TextLink, { href: "/faq/", children: "the FAQ" })), "a")!;
    assert.match(link.attrs, /class="text-link"/);
    assert.match(link.attrs, /href="\/faq\/"/);
  });

  test("ArrowLink: an arrow drawn by CSS after the text", () => {
    const link = element(html(h(ArrowLink, { href: "/checks/", children: "See all 26 checks" })), "a")!;
    assert.match(link.attrs, /class="arrow-link has-arrow"/);
    assert.equal(textOf(link.inner), "See all 26 checks");
  });

  test("external: a plain <a>, ending in ↗ (drawn by CSS) and saying where it opens to screen readers", () => {
    const markup = html(h(ArrowLink, { href: "https://github.com/rahul-bharati/run-hound/blob/main/docs/research.md", opens: "GitHub", children: "The research" }));
    const link = element(markup, "a")!;
    assert.match(link.attrs, /has-ext/);
    assert.equal(textOf(element(link.inner, "span", 'class="sr-only"')?.inner ?? ""), " (opens GitHub)");
  });
});

describe("NavLink: the prefetch policy (brief §8.2)", () => {
  test("viewport is Next's default, none never prefetches, intent waits for a hover or focus", () => {
    assert.equal(prefetchProp("viewport"), null);
    assert.equal(prefetchProp("none"), false);
    const viewport = NavLink({ href: "/docs/", children: "Docs" }) as ReactElement<{ prefetch?: unknown }>;
    assert.equal(viewport.props.prefetch, null);
    const none = NavLink({ href: "/privacy/", prefetch: "none", children: "Privacy" }) as ReactElement<{ prefetch?: unknown }>;
    assert.equal(none.props.prefetch, false);
    const intent = NavLink({ href: "/docs/", prefetch: "intent", children: "Docs" }) as ReactElement;
    assert.ok(isValidElement(intent));
    assert.equal(intent.type, IntentLink);
  });

  test("IntentLink renders a plain link before the reader shows intent", () => {
    const link = element(html(h(IntentLink, { href: "/docs/", children: "Docs" })), "a")!;
    assert.match(link.attrs, /href="\/docs\/"/);
  });

  test("renders an <a> with its class", () => {
    assert.match(html(h(NavLink, { href: "/faq/", className: "footer-link", children: "FAQ" })), /<a class="footer-link" href="\/faq\/">FAQ<\/a>/);
  });
});

describe("Pill, Tag, Card, IconTile", () => {
  test("Pill: a link with an arrow drawn by CSS", () => {
    const link = element(html(h(Pill, { href: "/checks/", children: "New in 0.6.0: paywall and data-change checks" })), "a")!;
    assert.match(link.attrs, /class="pill has-arrow"/);
  });

  test("Pill: its text in its own span, so the hover underline (§4.3) runs under the words and not the arrow; /_design/ shows the hover", () => {
    const link = element(html(h(Pill, { href: "/checks/", demoState: "hover", children: "New in 0.6.0" })), "a")!;
    assert.match(link.attrs, /data-demo-state="hover"/);
    assert.equal(textOf(element(link.inner, "span", 'class="pill-text"')?.inner ?? ""), "New in 0.6.0");
    assert.doesNotMatch(element(html(h(Pill, { href: "/checks/", children: "x" })), "a")!.attrs, /data-demo-state/);
  });

  test("Tag: a short mono label", () => {
    assert.match(html(h(Tag, { children: "Preview" })), /^<span class="tag">Preview<\/span>$/);
  });

  test("Card: surface card, as any element; interactive cards get the hover class", () => {
    assert.match(html(h(Card, { as: "li", children: "x" })), /^<li class="card">x<\/li>$/);
    assert.match(html(h(Card, { interactive: true, children: "x" })), /^<div class="card card-hover">x<\/div>$/);
  });

  test("Card: an id, so a link can land on it and it rings once (:target, §3.4: every old /docs/#id sits on a hub card)", () => {
    assert.match(html(h(Card, { as: "li", id: "quick-start", children: "x" })), /^<li id="quick-start" class="card">x<\/li>$/);
  });

  test("IconTile: a sprite icon in a surface-2 tile, hidden from screen readers", () => {
    const markup = html(h(IconTile, { icon: "local" }));
    assert.match(markup, /^<span class="icon-tile" aria-hidden="true">/);
    assert.match(markup, /<use href="#icon-local"/);
  });
});

describe("Tick", () => {
  test("pass (accent) and bullet (dim) reference the sprite's one tick", () => {
    const pass = element(html(h(Tick, null)), "svg")!;
    assert.match(pass.attrs, /class="tick tick-pass"/);
    assert.match(pass.inner, /^<use href="#tick"><\/use>$/);
    const bullet = element(html(h(Tick, { tone: "bullet" })), "svg")!;
    assert.match(bullet.attrs, /tick-bullet/);
  });

  test("a tick that draws in (DrawSVG can't draw a <use>) is a real path, marked for the motion code", () => {
    const drawn = element(html(h(Tick, { draw: true })), "svg")!;
    assert.match(drawn.inner, new RegExp(`<path data-part="tick" d="${tickPath}"`));
  });
});

describe("layout: Container, Band, SectionHeading", () => {
  test("Container is the page column", () => {
    assert.equal(html(h(Container, { children: "x" })), '<div class="container-page">x</div>');
  });

  test("Band: a section with its id, the tone, and the aria-hidden index \"02 ── 07\"", () => {
    const markup = html(h(Band, { id: "why", index: { n: 2, total: 7 }, tone: "band", children: h(SectionHeading, { title: "AI builds fast.", intro: "Intro." }) }));
    const section = element(markup, "section")!;
    assert.match(section.attrs, /id="why"/);
    assert.match(section.attrs, /class="band band-tinted"/);
    const index = element(markup, "p", 'class="band-index"')!;
    assert.match(index.attrs, /aria-hidden="true"/);
    assert.equal(textOf(index.inner), "0207");
    const heading = element(markup, "h2")!;
    assert.equal(textOf(heading.inner), "AI builds fast.");
    assert.equal(textOf(element(markup, "p", 'class="section-intro"')?.inner ?? ""), "Intro.");
  });

  test("a band on the page background has no tone class", () => {
    assert.match(html(h(Band, { id: "start", children: "x" })), /^<section id="start" class="band">/);
  });
});

describe("Figure", () => {
  test("only the media wrapper may carry data-motion=reveal; the caption never moves", () => {
    const markup = html(h(Figure, { caption: "Two identical saves, 0.2 ms apart, both accepted.", reveal: true, children: h("img", { alt: "", src: "/x.png" }) }));
    const media = element(markup, "div", 'class="figure-media"')!;
    assert.match(media.attrs, /data-motion="reveal"/);
    const caption = element(markup, "figcaption")!;
    assert.doesNotMatch(caption.attrs, /data-motion/);
    assert.equal(textOf(caption.inner), "Two identical saves, 0.2 ms apart, both accepted.");
    assert.equal((markup.match(/data-motion/g) ?? []).length, 1);
  });

  test("figures are left out of the search index (§3.16: data-pagefind-ignore)", () => {
    const figure = element(html(h(Figure, { caption: "A caption.", children: "media" })), "figure")!;
    assert.match(figure.attrs, /data-pagefind-ignore=""/);
  });

  test("no reveal by default", () => {
    assert.doesNotMatch(html(h(Figure, { caption: "A caption.", children: "media" })), /data-motion/);
  });
});

describe("Callout, StepTrail, FactsList, PrevNext", () => {
  test("Callout: a note (not a landmark), note or warn rule", () => {
    const note = element(html(h(Callout, { title: "Podman", children: "Use podman." })), "div")!;
    assert.match(note.attrs, /role="note"/);
    assert.match(note.attrs, /data-tone="note"/);
    assert.match(html(h(Callout, { tone: "warn", children: "Careful." })), /data-tone="warn"/);
  });

  test("StepTrail: an ordered list of rings; the last ring can be fail, the current one accent (a strong accent object: not exempt)", () => {
    const steps = [{ label: "Fill the form" }, { label: "Double-click Book" }, { label: "Decide", note: "Two saves: a finding." }];
    const markup = html(h(StepTrail, { steps, marked: { index: 2, tone: "fail" } }));
    const items = elements(markup, "li");
    assert.equal(items.length, 3);
    assert.match(items[2].inner, /class="step-ring" data-tone="fail"/);
    assert.equal(textOf(element(items[2].inner, "span", 'class="step-note"')?.inner ?? ""), "Two saves: a finding.");
    const toc = html(h(StepTrail, { steps: [{ label: "What you need", href: "#need" }, { label: "Start", href: "#start" }], marked: { index: 0, tone: "accent", current: "location" } }));
    const first = elements(toc, "li")[0];
    assert.match(first.inner, /aria-current="location"/);
    assert.match(first.inner, /class="step-ring" data-tone="accent"/);
    // §2.3's exempt list is closed (the primary button, link text, focus rings, the h1 and closing h2 key words, a
    // product figure's status marks): a navigation marker counts against the accent budget like any filled shape.
    assert.doesNotMatch(toc, /data-accent-exempt/);
  });

  test('StepTrail with a marker (the docs "On this page", §3.5): a hidden marker beside the list, which the docs shell moves', () => {
    const steps = [{ label: "What you need", href: "#need" }, { label: "Start", href: "#start" }, { label: "Open the UI", href: "#open" }];
    const markup = html(h(StepTrail, { steps, marker: true, marked: { index: 1, tone: "accent", current: "location" } }));
    const wrap = element(markup, "div", 'class="step-trail-wrap"');
    assert.ok(wrap, "no .step-trail-wrap");
    assert.doesNotMatch(wrap.attrs, /data-ready/);
    // The marker comes first and is decorative; the list is unchanged, so without JavaScript the marked ring is filled.
    assert.match(wrap.inner, /^<span class="step-marker" aria-hidden="true"><\/span><ol class="step-trail"/);
    const items = elements(wrap.inner, "li");
    assert.match(items[1].inner, /class="step-ring" data-tone="accent"/);
    assert.match(items[1].inner, /aria-current="location"/);
    // Only down the page: a row has no marker (the marker moves along the column).
    assert.doesNotMatch(html(h(StepTrail, { steps, marker: true, orientation: "row" })), /step-marker|step-trail-wrap/);
    // Without the prop, the trail is the bare list.
    assert.match(html(h(StepTrail, { steps })), /^<ol class="step-trail"/);
  });

  test("FactsList: a dl of mono keys and values", () => {
    const markup = html(h(FactsList, { items: [{ term: "Check id", detail: "double-submit" }, { term: "Group", detail: "Features" }] }));
    assert.match(markup, /^<dl class="facts-list">/);
    assert.deepEqual(elements(markup, "dt").map((d) => textOf(d.inner)), ["Check id", "Group"]);
    assert.deepEqual(elements(markup, "dd").map((d) => textOf(d.inner)), ["double-submit", "Features"]);
  });

  test("PrevNext: two cards, Previous and Next; nothing when there's neither", () => {
    const markup = html(h(PrevNext, { prev: { href: "/docs/", label: "Docs" }, next: { href: "/faq/", label: "FAQ" } }));
    const links = elements(markup, "a");
    assert.equal(links.length, 2);
    assert.match(textOf(links[0].inner), /^Previous\s*Docs$/);
    assert.match(textOf(links[1].inner), /^Next\s*FAQ$/);
    assert.equal(html(h(PrevNext, {})), "");
  });
});

describe("ReportLine", () => {
  test("links the bug form with the page path in the title and nothing else (decision 4: no Edit this page)", () => {
    const url = bugReportUrl("/docs/quick-start/");
    assert.equal(url, `${bugFormUrl}&title=${encodeURIComponent("/docs/quick-start/")}`);
    const parsed = new URL(url);
    assert.deepEqual([...parsed.searchParams.keys()], ["template", "title"]);
    const markup = html(h(ReportLine, { path: "/docs/quick-start/" }));
    assert.equal(textOf(markup), "Something wrong or unclear on this page? Report it on GitHub.");
    assert.match(markup, new RegExp(`href="${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/&/g, "&amp;")}"`));
    assert.doesNotMatch(markup, /Edit this page/);
  });
});

describe("Sprite and the line hound", () => {
  test("one hidden sprite: the tick always; the GitHub mark, the hound and lucide icons when asked", () => {
    const markup = html(h(Sprite, { github: true, hound: true, icons: { local: Laptop } }));
    const svg = element(markup, "svg")!;
    assert.match(svg.attrs, /aria-hidden="true"/);
    assert.match(svg.attrs, /class="sprite"/);
    for (const id of ["tick", "github", "line-hound", "icon-local"]) assert.match(markup, new RegExp(`<symbol id="${id}"`), id);
    assert.doesNotMatch(html(h(Sprite, {})), /id="github"|id="line-hound"/);
  });

  test("SpriteIcon uses a symbol by its id", () => {
    const markup = html(h(SpriteIcon, { name: "icon-local" }));
    assert.match(markup, /^<svg[^>]*aria-hidden="true"[^>]*><use href="#icon-local"><\/use><\/svg>$/);
    assert.match(markup, /width="20" height="20"/);
  });

  test("the line hound: 8 round-capped strokes, one in accent (the brow), as one symbol", () => {
    assert.equal(houndStrokes.lines.length + 1, 8);
    const markup = html(h(Sprite, { hound: true }));
    const symbol = element(markup, "symbol", 'id="line-hound"')!;
    assert.equal(elements(symbol.inner, "path").length, 8);
    assert.equal(elements(symbol.inner, "path", 'class="line-hound-brow"').length, 1);
  });

  test("LineHound: aria-hidden, 64 or 120 px wide, a head group that the 404 turns; motion parts only when asked", () => {
    const resting = html(h(LineHound, { size: 64 }));
    const svg = element(resting, "svg")!;
    assert.match(svg.attrs, /aria-hidden="true"/);
    assert.match(svg.attrs, /width="64"/);
    assert.match(svg.inner, /<g class="line-hound-head"><use href="#line-hound"><\/use><\/g>/);
    assert.doesNotMatch(resting, /data-part|data-beat/);
    const walking = html(h(LineHound, { size: 120, parts: true }));
    assert.match(element(walking, "svg")!.attrs, /data-part="hound" data-beat="late"/);
    assert.match(walking, /<g class="line-hound-head" data-part="head" data-beat="late">/);
  });
});

describe("primitive sources", () => {
  const dir = new URL("./", import.meta.url).pathname;
  const files = [
    ...sourceFiles(dir).filter((f) => f.endsWith(".tsx")),
    new URL("../sprite.tsx", import.meta.url).pathname,
    new URL("../hound/line-hound.tsx", import.meta.url).pathname,
  ];

  test("no inline style objects (§2.9 rule 6) and no arbitrary Tailwind values", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      assert.doesNotMatch(text, /style=\{\{/, file);
      assert.doesNotMatch(text, /[a-z:-]+-\[[^\] "]+\]/, file);
    }
  });

  test("spacing utilities stay on the scale: 4, 8, 12, 16, 24, 32, 40, 48, 64, 80 px (and the 44 / 36 px targets)", () => {
    const steps = new Set(["0", "px", "1", "2", "3", "4", "6", "8", "10", "12", "16", "20", "target", "target-row"]);
    const spacing = /(?<![\w-])-?(?:[a-z]+:)*(?:p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y|inset|inset-x|inset-y|top|right|bottom|left|scroll-mt|scroll-pt)-([\w.-]+)/g;
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const classes of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        for (const [, step] of (classes[1] ?? classes[2]).matchAll(spacing)) {
          assert.ok(steps.has(step), `${file}: spacing step "${step}" is off the scale`);
        }
      }
    }
  });
});
