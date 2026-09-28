// The 404 (DESIGN.md §3.13, §4.3; node F3): its copy and links, the bug-report link that carries only the path, and
// the drawing the motion code moves (src/motion/dom-contract.ts, "trail-404"), rendered to HTML as the prerendered
// page has it. The lab checks the built page (scripts/lab/specs/404-legal.spec.mjs). `pnpm test`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { element, elements, html, textOf } from "@/components/primitives/test-render";
import "./test-css";
import { bugFormUrl, href } from "@/lib/nav";
import { domContract } from "@/motion/dom-contract";
import { trail404Storyboard } from "@/motion/trail-404-storyboard";

// .tsx modules load after test-render's hook (a static import would be loaded before it is registered).
const { houndBox, houndStrokes } = await import("@/components/hound/line-hound");
const { bugReportUrl } = await import("@/components/primitives/report-line");
const { notFoundCopy, notFoundMetadata } = await import("./copy");
const { reportHref } = await import("./report-href");
const { TrailFigure, headRest, compactPath } = await import("./trail-figure");
const { ReportBrokenLink } = await import("./report-link");
const { NotFoundBody } = await import("./not-found-body");
const { MotionGate } = await import("@/motion/motion-gate");
const { ButtonLink } = await import("@/components/primitives/button-link");
const { TextLink } = await import("@/components/primitives/links");
const page = await import("../../app/not-found");
// A .tsx loads as CommonJS (test-render.ts): importing it, `default` is module.exports, whose own `default` is the page.
const NotFound = (page.default as unknown as { default: () => ReactElement }).default;

const markup = html(createElement(NotFound));
const main = textOf(markup);

/** Every element in a React tree (function components called, as the server renders them). */
function* walk(node: ReactNode): Generator<ReactElement> {
  if (Array.isArray(node)) for (const child of node) yield* walk(child);
  else if (isValidElement(node)) {
    yield node;
    const props = node.props as { children?: ReactNode };
    const type = node.type as unknown;
    // Only the page's own server components are expanded; client components and primitives stay as elements.
    if (typeof type === "function" && ([TrailFigure, NotFoundBody] as unknown[]).includes(type)) yield* walk((type as (p: unknown) => ReactNode)(node.props));
    yield* walk(props.children);
  }
}

describe("404 copy and links (§3.13)", () => {
  test('the h1 is "The trail goes cold here.", with "goes cold here." in accent and exempt from the accent budget', () => {
    const h1s = elements(markup, "h1");
    assert.equal(h1s.length, 1);
    assert.equal(textOf(h1s[0].inner), "The trail goes cold here.");
    const accent = element(h1s[0].inner, "span", "data-accent-exempt");
    assert.ok(accent, "the key words are a span marked data-accent-exempt");
    assert.match(accent.attrs, /text-accent/);
    assert.equal(textOf(accent.inner), "goes cold here.");
    assert.equal(`${notFoundCopy.title.lead}${notFoundCopy.title.accent}`, "The trail goes cold here.");
  });

  test("says the page doesn't exist or has moved, with Home (primary) and Docs (secondary)", () => {
    assert.ok(main.includes("This page doesn’t exist or has moved.") || main.includes("This page doesn't exist or has moved."));
    const links = elements(markup, "a").map((a) => ({ href: /href="([^"]*)"/.exec(a.attrs)?.[1], cls: /class="([^"]*)"/.exec(a.attrs)?.[1] ?? "", text: textOf(a.inner) }));
    const home = links.find((l) => l.href === href("home"));
    const docs = links.find((l) => l.href === href("docs"));
    assert.ok(home, "a link to the homepage");
    assert.ok(docs, "a link to the docs");
    assert.match(home.cls, /btn-primary/);
    assert.match(docs.cls, /btn-secondary/);
    assert.equal(home.text, notFoundCopy.home);
    assert.equal(docs.text, notFoundCopy.docs);
  });

  test('the buttons say "Home" and "Docs", as §3.13 names them', () => {
    assert.equal(notFoundCopy.home, "Home");
    assert.equal(notFoundCopy.docs, "Docs");
  });

  test("the buttons and the report link are the primitives' markup: ButtonLink primary and secondary, TextLink off the site", () => {
    // not-found-body.tsx and report-link.tsx write that markup out (the primitives' code would ride in every page's
    // chunk); this keeps them from drifting apart. The accent audit reads data-accent-exempt on the primary.
    const links = elements(markup, "a");
    const byHref = (to: string) => links.find((a) => /href="([^"]*)"/.exec(a.attrs)?.[1] === to)?.outer;
    type Button = Parameters<typeof ButtonLink>[0];
    type Text = Parameters<typeof TextLink>[0];
    const primary = element(html(createElement(ButtonLink, { href: href("home") } as Button, notFoundCopy.home)), "a")!;
    const secondary = element(html(createElement(ButtonLink, { href: href("docs"), variant: "secondary" } as Button, notFoundCopy.docs)), "a")!;
    const report = element(html(createElement(TextLink, { href: bugFormUrl, opens: "GitHub" } as Text, notFoundCopy.report.link)), "a")!;
    assert.equal(byHref(href("home")), primary.outer);
    assert.match(primary.attrs, /data-accent-exempt=""/);
    assert.equal(byHref(href("docs")), secondary.outer);
    assert.equal(element(element(markup, "p", 'class="report-line')!.inner, "a")!.outer, report.outer);
  });

  test("no loud label: no \"?\" in the drawing, no \"NOT FOUND\" label; the only label is a dim mono 404", () => {
    assert.doesNotMatch(markup, /NOT FOUND/i);
    const figure = element(markup, "div", 'data-motion="trail-404"')!;
    assert.doesNotMatch(textOf(figure.inner), /\?/);
    assert.equal(textOf(figure.inner).trim(), "");
    const label = element(markup, "p", "text-dim")!;
    assert.equal(textOf(label.inner), "404");
    assert.match(label.attrs, /font-mono/);
    assert.doesNotMatch(label.attrs, /accent/);
  });

  test('"Followed a broken link here? Tell us on GitHub", to the bug form', () => {
    assert.equal(`${notFoundCopy.report.question} ${notFoundCopy.report.link}`, "Followed a broken link here? Tell us on GitHub");
    const line = element(markup, "p", 'class="report-line')!;
    assert.ok(line, "the report line");
    assert.equal(textOf(line.inner).replace(/\s+/g, " ").trim(), `${notFoundCopy.report.question} ${notFoundCopy.report.link} (opens GitHub)`);
    const link = element(line.inner, "a")!;
    // Server-rendered (and without JavaScript): the form itself; the path is known only in the browser.
    assert.match(link.attrs, new RegExp(`href="${bugFormUrl.replaceAll("?", "\\?").replaceAll("&", "&amp;")}"`));
  });

  test("metadata: its title and description; no canonical, no robots of its own (Next.js adds noindex), no social card", () => {
    assert.deepEqual(page.metadata, { title: notFoundMetadata.title, description: notFoundMetadata.description, openGraph: null, twitter: null });
    assert.ok(notFoundMetadata.description.length >= 70 && notFoundMetadata.description.length <= 160);
  });

  test("the page mounts the 404's motion island", () => {
    const tree = [...walk(NotFound())];
    // The gate, fetched at hydration only where the 404 renders (it renders nothing on the server anyway), and not
    // through next/dynamic, whose Suspense reveal React throttles to 300 ms (a Save-Data hold is released at hydration).
    const gates = tree.filter((el) => "islands" in (el.props as object));
    assert.equal(gates.length, 1);
    assert.deepEqual((gates[0].props as { islands: string[] }).islands, ["trail-404"]);
    const body = readFileSync(new URL("./not-found-body.tsx", import.meta.url), "utf8");
    assert.match(body, /import\("@\/motion\/motion-gate"\)\.then\(\(mod\) =>/);
    // A failed chunk load (offline, a deploy skew) is caught: the CSS hold's 3 s fallback shows the drawing.
    assert.match(body, /\}\)\s*\.catch\(\(\) => \{/);
    assert.match(body, /function LazyMotionGate\(/, "named apart from the motion code's MotionGate");
    assert.doesNotMatch(body, /from "next\/dynamic"|import \{[^}]*\bMotionGate\b[^}]*\} from "@\/motion\/motion-gate"/);
    assert.equal(typeof MotionGate, "function");
    assert.equal(html(gates[0]), "", "nothing on the server");
  });

  test("every page carries only one client reference and three strings for it (the root layout's not-found boundary)", () => {
    const tree = NotFound();
    assert.equal(tree.type, NotFoundBody);
    assert.deepEqual(tree.props, { home: href("home"), docs: href("docs"), formUrl: bugFormUrl });
    assert.match(readFileSync(new URL("./not-found-body.tsx", import.meta.url), "utf8"), /^"use client";/);
  });

  test("no stylesheet of its own: Next.js puts this tree in every page's payload, so a CSS import would be preloaded on every page", () => {
    for (const file of ["app/not-found.tsx", "components/not-found/not-found-body.tsx", "components/not-found/trail-figure.tsx", "components/not-found/report-link.tsx"]) {
      assert.doesNotMatch(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), /import\s+["'][^"']+\.css["']/, file);
    }
  });
});

describe("the bug-report link carries only the path", () => {
  test("the bug form with the page's path as the issue title, and nothing else", () => {
    const url = new URL(reportHref(bugFormUrl, "/docs/old-page/"));
    assert.deepEqual([...url.searchParams.keys()], ["template", "title"]);
    assert.equal(url.searchParams.get("template"), "bug.yml");
    assert.equal(url.searchParams.get("title"), "/docs/old-page/");
    assert.equal(url.hash, "");
    // The same link as every page's ReportLine (primitives/report-line.tsx).
    assert.equal(reportHref(bugFormUrl, "/docs/old-page/"), bugReportUrl("/docs/old-page/"));
  });

  test("a query or a hash never reaches it: only the pathname is read", () => {
    const at = new URL("https://run-hound.example/private/?token=abc123&email=a%40b.c#section");
    const url = new URL(reportHref(bugFormUrl, at.pathname));
    assert.equal(url.searchParams.get("title"), "/private/");
    assert.doesNotMatch(url.href, /token|abc123|email|section/);
  });

  test("without a path (the server, or no JavaScript) it is the bug form itself", () => {
    assert.equal(reportHref(bugFormUrl, null), bugFormUrl);
    const link = element(html(createElement(ReportBrokenLink, { formUrl: bugFormUrl } as { formUrl: string; children: string }, "L")), "a")!;
    assert.match(link.attrs, /class="text-link has-ext"/);
    assert.equal(/href="([^"]*)"/.exec(link.attrs)?.[1].replaceAll("&amp;", "&"), bugFormUrl);
  });
});

describe("the drawing (§3.13, §4.3; the DOM contract's trail-404)", () => {
  const figureMarkup = html(createElement(TrailFigure));
  const root = element(figureMarkup, "div", 'data-motion="trail-404"')!;

  test("one aria-hidden root with data-motion=\"trail-404\"", () => {
    assert.ok(root);
    assert.match(root.attrs, /aria-hidden="true"/);
  });

  test("exactly the contract's parts, each held until the island is ready (data-beat=\"late\")", () => {
    const contract = domContract["trail-404"];
    for (const [part, count] of Object.entries(contract.parts)) {
      const found = [...root.inner.matchAll(new RegExp(`<[a-z]+[^>]*data-part="${part}"[^>]*>`, "g"))];
      assert.equal(found.length, count, `data-part="${part}"`);
      if (contract.held.includes(part)) for (const [tag] of found) assert.match(tag, /data-beat="late"/, `${part} is held`);
    }
    // Every part the storyboard moves is rendered.
    for (const step of trail404Storyboard.steps) assert.match(root.inner, new RegExp(`data-part="${step.part}"`));
  });

  test("the trail is a dim stroke DrawSVG can draw (a <line>, not in a <mask>), made dotted by a static mask", () => {
    const trail = /<line[^>]*data-part="trail"[^>]*>/.exec(root.inner)?.[0];
    assert.ok(trail, "the trail is a <line>");
    assert.match(trail, /class="stroke-dim /);
    assert.match(trail, /mask="url\(#trail-404-dots\)"/);
    const mask = element(root.inner, "mask", 'id="trail-404-dots"')!;
    assert.ok(mask, "the dots mask");
    assert.match(mask.attrs, /mask-type="alpha"/, "masks by alpha, so forced colours keep the dots");
    assert.doesNotMatch(mask.inner, /data-part/, "nothing the motion code measures is inside the mask (it has no box)");
    assert.doesNotMatch(root.inner, /accent/, "nothing in the drawing but the hound's own brow is accent");
  });

  test("the hound: the line hound's strokes, drawn once, 120 px wide, resting at the trail's end with its head turned -6° round the neck", () => {
    const hound = /<svg[^>]*data-part="hound"[^>]*>/.exec(root.inner)?.[0];
    assert.ok(hound);
    assert.match(hound, /class="line-hound /);
    assert.match(hound, /width="120"/);
    assert.match(hound, new RegExp(`viewBox="0 0 ${houndBox.width} ${houndBox.height}"`));
    const head = element(root.inner, "g", 'data-part="head"')!;
    // The mark's geometry (houndStrokes), the brow last and in accent by its class; each path once in the page.
    const paths = [...head.inner.matchAll(/<path( class="([^"]*)")? d="([^"]*)"/g)].map((m) => ({ cls: m[2] ?? "", d: m[3] }));
    // The fg strokes are one path of subpaths, each stroke's own M…; the brow its own path.
    assert.deepEqual(
      paths.map((p) => p.d),
      [houndStrokes.lines.map(compactPath).join(""), compactPath(houndStrokes.brow)],
    );
    assert.equal(paths[0].d.split("M").length - 1, houndStrokes.lines.length, "one subpath per stroke");
    assert.deepEqual(paths.map((p) => p.cls), ["", "line-hound-brow"]);
    for (const p of paths) assert.equal(markup.split(p.d).length - 1, 1, "each stroke is in the page once");
    // Compacting changes no number: the same coordinates in the same order.
    for (const d of [...houndStrokes.lines, houndStrokes.brow]) assert.deepEqual(compactPath(d).match(/-?\d+(\.\d+)?|[A-Za-z]/g), d.match(/-?\d+(\.\d+)?|[A-Za-z]/g));
    // The storyboard's last beat and neck: the server's frame is the timeline's end.
    const last = trail404Storyboard.steps.filter((s) => s.part === "head").at(-1)!;
    assert.equal(headRest.angle, last.to.rotation);
    assert.deepEqual(headRest.origin, last.svgOrigin);
    const [x, y] = headRest.origin.map((f, i) => Math.round(f * (i === 0 ? houndBox.width : houndBox.height) * 1000) / 1000);
    assert.match(head.attrs, new RegExp(`transform="rotate\\(${headRest.angle} ${x} ${y}\\)"`));
    assert.match(head.attrs, /class="origin-top-left"/, "transform-origin 0 0: the attribute's centre is the only one");
  });
});
