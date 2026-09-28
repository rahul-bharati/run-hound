// Unit tests for content/faq.ts and the page it drives (app/faq/page.tsx, DESIGN.md §3.9): the questions, the answers
// and the FAQPage structured data; "At a glance" first; every answer visible (no accordions), each answer's first
// sentence the short answer, then links to the details. `pnpm test`.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement, type ReactElement } from "react";
// Before the page: the hook that lets node --test render .tsx (components/primitives/test-render.ts).
import { element, elements, html, textOf } from "@/components/primitives/test-render";

// A deployed address, with the trailing slash that every URL must drop. Set before lib/site.ts reads it.
process.env.NEXT_PUBLIC_SITE_URL = "https://run-hound.example/";
const { site } = await import("@/lib/site");
const { routes } = await import("@/content/routes");
const { resolveTarget } = await import("@/lib/nav");
const { openSourceSections } = await import("@/content/open-source");
const { answerText, faqAtAGlance, faqGroups, faqItems, faqJsonLd, faqPage, plainText } = await import("@/content/faq");
// The page is compiled to CommonJS (test-render.ts), so Node's default import is its module.exports: the component is
// that object's own default.
const FaqPage = ((await import("@/app/faq/page")) as unknown as { default: { default: () => ReactElement } }).default.default;

const base = "https://run-hound.example";
const words = (text: string) => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.:/_\-]*/gu) ?? []).length;
const sentences = (text: string) => plainText(text).split(/(?<=[.!?])\s+(?=\S)/);
const markup = html(createElement(FaqPage));

/**
 * Where an internal link lands: a registered page, and an anchor that page promises (the registry) or, on the
 * open-source page, one of its sections (content/open-source.ts; check-registry checks the built page either way).
 */
function lands(target: string): boolean {
  const [path, hash] = target.split("#");
  const page = routes.find((r) => r.path === path);
  if (!page) return false;
  if (!hash || page.anchors.includes(hash)) return true;
  return path === "/open-source/" && openSourceSections.some((s) => s.id === hash || s.headingId === hash);
}

describe("faq", () => {
  test("has 8 to 12 questions with unique ids, in the groups' order", () => {
    assert.ok(faqItems.length >= 8 && faqItems.length <= 12, `${faqItems.length} questions`);
    const ids = [...faqGroups.map((group) => group.id), ...faqItems.map((item) => item.id)];
    assert.equal(new Set(ids).size, ids.length, "ids (groups and questions) are unique on the page");
    for (const item of faqItems) assert.match(item.id, /^[a-z0-9-]+$/);
  });

  test("every question ends with a question mark and every answer has a link to the details", () => {
    for (const item of faqItems) {
      assert.ok(item.q.endsWith("?"), item.q);
      assert.ok(item.a.length > 0 && item.links.length > 0, item.id);
      for (const link of item.links) {
        // Internal paths end with "/" (trailingSlash), optionally followed by an anchor; sources are https.
        assert.match(link.href, /^(\/([a-z0-9-]+\/)*(#[a-z0-9-]+)?|https:\/\/.+)$/, link.href);
      }
    }
  });

  test("every internal link lands on a registered page and an anchor it has", () => {
    for (const item of faqItems) {
      for (const link of item.links) if (link.href.startsWith("/")) assert.ok(lands(link.href), `${item.id}: ${link.href}`);
    }
  });

  test("answers balance their code marks, and the plain text drops them", () => {
    for (const item of faqItems) {
      for (const paragraph of item.a) assert.equal((paragraph.match(/`/g) ?? []).length % 2, 0, paragraph);
      assert.ok(!answerText(item).includes("`"), item.id);
    }
    assert.equal(plainText("open `http://localhost:4000` now"), "open http://localhost:4000 now");
  });

  test("each answer's first sentence is the short answer, and no sentence runs over 25 words (brand.md)", () => {
    for (const item of faqItems) {
      const [first] = sentences(item.a[0]);
      assert.ok(words(first) <= 25, `${item.id}: the first sentence has ${words(first)} words`);
      for (const paragraph of item.a) {
        for (const sentence of sentences(paragraph)) {
          assert.ok(words(sentence) <= 25, `${item.id}: ${words(sentence)} words: ${sentence}`);
        }
      }
    }
  });

  test('"Is my vibe-coded app secure?" keeps its anchor, #is-my-app-secure (brand.md: vibe-coded in this question)', () => {
    const item = faqItems.find((x) => x.id === "is-my-app-secure");
    assert.equal(item?.q, "Is my vibe-coded app secure?");
    assert.ok(!faqItems.some((x) => /AI-generated app secure/.test(x.q)));
  });

  test("the description fits a search snippet", () => {
    assert.ok(faqPage.description.length <= 155, `${faqPage.description.length} characters`);
  });

  test("the structured data is one FAQPage with the visible questions and answers, and its breadcrumb", () => {
    const data = faqJsonLd();
    assert.equal(data["@context"], "https://schema.org");
    const [page, breadcrumb, ...rest] = data["@graph"];
    assert.equal(rest.length, 0);
    assert.equal(page["@type"], "FAQPage");
    assert.equal(page["@id"], `${base}/faq/#webpage`);
    assert.equal(page.url, `${base}/faq/`);
    assert.equal(page.name, "FAQ: UI testing for AI-built apps · Run Hound");
    assert.equal(page.description, faqPage.description);
    assert.equal(page.dateModified, site.releasedIso);
    assert.deepEqual(
      page.mainEntity,
      faqItems.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: answerText(item) },
      })),
    );
    assert.equal(breadcrumb["@type"], "BreadcrumbList");
    assert.deepEqual(
      (breadcrumb.itemListElement as { name: string; item: string }[]).map(({ name, item }) => [name, item]),
      [
        ["Home", `${base}/`],
        ["FAQ", `${base}/faq/`],
      ],
    );
  });
});

describe("At a glance (moved from the homepage)", () => {
  test("6 to 8 facts: the license, the price, where it runs, what it needs, the AI and the release", () => {
    assert.ok(faqAtAGlance.length >= 6 && faqAtAGlance.length <= 8, `${faqAtAGlance.length} facts`);
    const terms = faqAtAGlance.map((fact) => fact.term);
    for (const term of ["License", "Price", "Runs on", "Needs", "AI", "Release"]) assert.ok(terms.includes(term), term);
    assert.equal(new Set(terms).size, terms.length);
  });

  test("each fact is short and links to its proof", () => {
    for (const fact of faqAtAGlance) {
      assert.ok(words(fact.text) <= 25, `${fact.term}: ${words(fact.text)} words`);
      assert.ok(fact.link.label.length > 0, fact.term);
      if (fact.link.href.startsWith("/")) assert.ok(lands(fact.link.href), `${fact.term}: ${fact.link.href}`);
      else assert.match(fact.link.href, /^https:\/\//, fact.term);
    }
  });

  test("'Runs on' links its proof: the install page, which names the platforms and the architectures", () => {
    const runsOn = faqAtAGlance.find((fact) => fact.term === "Runs on");
    assert.match(runsOn?.text ?? "", /Windows/);
    assert.match(runsOn?.text ?? "", /arm64/);
    assert.equal(runsOn?.link.href, resolveTarget({ to: "docs-install", fallback: { to: "docs", hash: "install" } }));
    const install = readFileSync(new URL("./docs/install.mdx", import.meta.url), "utf8");
    assert.match(install, /Windows/);
    assert.match(install, /arm64/);
  });

  test("the release is lib/site.ts's, and AI is off by default", () => {
    const release = faqAtAGlance.find((fact) => fact.term === "Release");
    assert.match(release?.text ?? "", new RegExp(`^${site.version.replace(/\./g, "\\.")}, ${site.released}`));
    assert.equal(release?.link.href, site.changelog);
    assert.match(faqAtAGlance.find((fact) => fact.term === "AI")?.text ?? "", /off by default/);
    assert.match(faqAtAGlance.find((fact) => fact.term === "License")?.text ?? "", new RegExp(site.license));
  });
});

describe("the rendered page", () => {
  test("one h1, then At a glance before the first group of questions", () => {
    assert.equal(elements(markup, "h1").length, 1);
    const glance = markup.indexOf('id="at-a-glance"');
    assert.ok(glance > 0, "no #at-a-glance");
    for (const group of faqGroups) assert.ok(markup.indexOf(`id="${group.id}"`) > glance, group.id);
    assert.ok(markup.indexOf("<h1") < glance);
    // The facts panel is a description list, and every fact's link is in it.
    const glanceSection = elements(markup, "section").find((s) => /\sid="at-a-glance"/.test(s.attrs));
    const list = element(glanceSection?.inner ?? "", "dl");
    assert.ok(list, "At a glance is not a <dl>");
    assert.deepEqual(
      elements(list.inner, "dt").map((dt) => textOf(dt.inner)),
      faqAtAGlance.map((fact) => fact.term),
    );
    for (const fact of faqAtAGlance) assert.ok(list.inner.includes(`href="${fact.link.href}"`), fact.term);
  });

  test("every answer is visible: no <details>, no hidden panels, each question an h3 in its group's section", () => {
    assert.doesNotMatch(markup, /<details|<summary|\shidden(=|\s|>)|aria-expanded/);
    const folder = new URL("../components/faq/", import.meta.url);
    const sources = [
      readFileSync(new URL("../app/faq/page.tsx", import.meta.url), "utf8"),
      ...readdirSync(folder)
        .filter((name) => name.endsWith(".tsx"))
        .map((name) => readFileSync(new URL(name, folder), "utf8")),
    ];
    for (const source of sources) assert.doesNotMatch(source, /<details|<summary/);
    for (const group of faqGroups) {
      const section = elements(markup, "section").find((s) => new RegExp(`\\sid="${group.id}"`).test(s.attrs));
      assert.ok(section, `no section #${group.id}`);
      assert.equal(textOf(element(section.inner, "h2")?.inner ?? ""), group.title);
      for (const item of group.items) {
        const article = element(section.inner, "article", `id="${item.id}"`);
        assert.ok(article, `no #${item.id} in #${group.id}`);
        assert.equal(textOf(element(article.inner, "h3")?.inner ?? ""), item.q);
        assert.equal(textOf(article.inner).replace(/\s+/g, " ").includes(plainText(item.a[0]).split(":")[0]), true, item.id);
        for (const link of item.links) assert.ok(article.inner.includes(`href="${link.href}"`), `${item.id}: ${link.href}`);
      }
    }
  });

  test("a visible breadcrumb equal to the BreadcrumbList", () => {
    const nav = element(markup, "nav", 'aria-label="Breadcrumb"');
    assert.deepEqual(
      elements(nav?.inner ?? "", "li").map((li) => textOf(li.inner).replace("/", "").trim()),
      ["Home", "FAQ"],
    );
  });

  test("the page's JSON-LD is the FAQPage, once", () => {
    const blocks = [...markup.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.equal(blocks.length, 1);
    assert.match(blocks[0], /"@type":"FAQPage"/);
  });
});
