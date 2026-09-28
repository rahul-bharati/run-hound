// Unit tests for content/open-source.ts and the page it drives (app/open-source/page.tsx, DESIGN.md §3.8): the title,
// description and structured data; the sections in order with their ids; How to help today; the stability note; the
// maintainer block; and no contribution process yet (USER-DECISIONS.md 4). `pnpm test`.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement, type ReactElement } from "react";
// Before the page: the hook that lets node --test render .tsx (components/primitives/test-render.ts).
import { element, elements, html, textOf } from "@/components/primitives/test-render";

// A deployed address, with the trailing slash that every URL must drop. Set before lib/site.ts reads it.
process.env.NEXT_PUBLIC_SITE_URL = "https://run-hound.example/";
const { site } = await import("@/lib/site");
const { bugFormUrl, headerLinks, href } = await import("@/lib/nav");
const { route, routes } = await import("@/content/routes");
const {
  feedbackFormUrl,
  howToHelp,
  maintainer,
  openSourceJsonLd,
  openSourcePage,
  openSourceSections,
  roadmap,
  securityLine,
  stability,
} = await import("@/content/open-source");
// The page is compiled to CommonJS (test-render.ts), so Node's default import is its module.exports: the component is
// that object's own default.
const OpenSourcePage = ((await import("@/app/open-source/page")) as unknown as { default: { default: () => ReactElement } }).default.default;

const base = "https://run-hound.example";
const url = `${base}/open-source/`;
const words = (text: string) => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.:/_\-]*/gu) ?? []).length;
const sentences = (text: string) => text.split(/(?<=[.!?])\s+(?=\S)/);

/** Every object in a JSON value, depth first. */
function* objectsIn(value: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(value)) {
    for (const item of value) yield* objectsIn(item);
  } else if (value && typeof value === "object") {
    yield value as Record<string, unknown>;
    for (const item of Object.values(value)) yield* objectsIn(item);
  }
}

/** The page as a prerender has it (Server Components only, so the static markup is the whole page). */
const markup = html(createElement(OpenSourcePage));

/** Where an internal link lands: a registered page, and an anchor it promises or this page's own section. */
function lands(target: string): boolean {
  const [path, hash] = target.split("#");
  const page = routes.find((r) => r.path === path);
  if (!page) return false;
  if (!hash) return true;
  if (page.anchors.includes(hash)) return true;
  return path === openSourcePage.path && openSourceSections.some((s) => s.id === hash || s.headingId === hash);
}

describe("openSourcePage", () => {
  test("is the page the header links to, at its canonical path", () => {
    assert.equal(openSourcePage.path, "/open-source/");
    assert.ok(headerLinks().some((item) => item.href === openSourcePage.path));
  });

  test("has a descriptive title (weak-titles) that fits a search result, and a description that fits a snippet", () => {
    assert.equal(openSourcePage.title, "Open-source UI testing, MIT licensed");
    assert.ok(`${openSourcePage.title} · ${site.name}`.length <= 60);
    assert.ok(openSourcePage.description.length >= 70 && openSourcePage.description.length <= 155);
    assert.match(openSourcePage.description, /MIT license/);
    assert.match(openSourcePage.description, /AI-assisted UI testing for AI-built apps/);
  });
});

describe("openSourceJsonLd", () => {
  const data = openSourceJsonLd();
  const nodes = data["@graph"];
  const byType = (type: string) => nodes.filter((node) => node["@type"] === type);

  test("an AboutPage, its breadcrumb and the source code, in one graph", () => {
    assert.equal(data["@context"], "https://schema.org");
    assert.deepEqual(
      nodes.map((node) => node["@type"]),
      ["AboutPage", "BreadcrumbList", "SoftwareSourceCode"],
    );
  });

  test("the AboutPage is the canonical URL, names the page as the browser does and is about the source code", () => {
    const [page] = byType("AboutPage");
    assert.equal(page["@id"], `${url}#webpage`);
    assert.equal(page.url, url);
    assert.equal(page.name, `${openSourcePage.title} · ${site.name}`);
    assert.equal(page.description, openSourcePage.description);
    assert.deepEqual(page.isPartOf, { "@id": `${base}/#website` });
    assert.deepEqual(page.about, { "@id": `${base}/#software` });
    assert.deepEqual(page.mainEntity, { "@id": `${url}#source` });
    assert.deepEqual(page.breadcrumb, { "@id": `${url}#breadcrumb` });
    // The page shows no "Last updated" date.
    assert.equal(page.dateModified, undefined);
  });

  test("the breadcrumb is Home, then the page under its label in the nav registry", () => {
    const [breadcrumb] = byType("BreadcrumbList");
    assert.deepEqual(breadcrumb.itemListElement, [
      { "@type": "ListItem", position: 1, name: "Home", item: `${base}/` },
      { "@type": "ListItem", position: 2, name: route("open-source").label, item: url },
    ]);
    assert.equal(route("open-source").label, "Open source");
  });

  test("SoftwareSourceCode: the repository, the license and the app it builds (open-source-sourcecode)", () => {
    const [source] = byType("SoftwareSourceCode");
    assert.equal(source["@id"], `${url}#source`);
    assert.equal(source.codeRepository, site.github);
    assert.equal(source.license, site.licenseUrl);
    assert.deepEqual(source.author, { "@id": `${base}/#maintainer` });
    assert.deepEqual(source.targetProduct, { "@id": `${base}/#software` });
    // No page says which language it is written in, so the structured data doesn't either.
    assert.equal(source.programmingLanguage, undefined);
  });

  test("refers to the site, the maintainer and the app instead of repeating them, and carries no ratings", () => {
    for (const node of objectsIn(data)) {
      assert.ok(
        !["WebSite", "Person", "SoftwareApplication", "FAQPage", "AggregateRating", "Review"].includes(
          node["@type"] as string,
        ),
        `defines a ${node["@type"]}`,
      );
      assert.equal(node.aggregateRating, undefined);
      assert.equal(node.review, undefined);
    }
  });
});

describe("the sections (§3.8)", () => {
  test("in order, every existing id kept, #stability and #maintainer new", () => {
    assert.deepEqual(
      openSourceSections.map((s) => s.id),
      ["license", "open-core", "roadmap", "kennel", "stability", "maintainer", "contributing", "privacy"],
    );
  });

  test("How to help today is <section id=contributing> with its h2 id how-to-help; the others' h2 ids are their own", () => {
    const contributing = openSourceSections.find((s) => s.id === "contributing");
    assert.equal(contributing?.headingId, "how-to-help");
    assert.equal(contributing?.title, "How to help today");
    const headingIds = openSourceSections.map((s) => s.headingId ?? `${s.id}-heading`);
    assert.equal(new Set([...headingIds, ...openSourceSections.map((s) => s.id)]).size, headingIds.length * 2);
  });

  test("the copy rules (brand.md): each h2 at most 8 words, each intro at most 25, each sentence at most 25", () => {
    for (const s of openSourceSections) {
      assert.ok(words(s.title) <= 8, `${s.id}: "${s.title}"`);
      if (s.intro) assert.ok(words(s.intro) <= 25, `${s.id}: the intro has ${words(s.intro)} words`);
    }
    const texts = [
      ...openSourceSections.map((s) => s.intro ?? ""),
      ...stability.flatMap((item) => [item.title, item.text]),
      maintainer.why,
      ...maintainer.how,
      ...howToHelp.map((card) => card.text),
      securityLine.text,
    ];
    for (const text of texts) {
      for (const sentence of sentences(text)) assert.ok(words(sentence) <= 25, `${words(sentence)} words: ${sentence}`);
    }
  });

  test("the card rules (brand.md, §3.8): a card body at most 22 words; each How to help card one sentence", () => {
    for (const card of [...stability, ...howToHelp]) {
      assert.ok(words(card.text) <= 22, `${card.title}: the body has ${words(card.text)} words`);
    }
    for (const card of howToHelp) {
      assert.equal(sentences(card.text).length, 1, `${card.title}: "${card.text}"`);
    }
  });

  test("Kennel and Fernway are defined at first use (brand.md): the page names neither before #kennel", () => {
    const text = textOf(markup);
    const kennel = elements(markup, "section").find((s) => /\sid="kennel"/.test(s.attrs));
    assert.ok(kennel, "no #kennel section");
    const start = text.indexOf(textOf(kennel.inner));
    assert.ok(start > 0, "the #kennel section's text is not in the page");
    for (const name of ["Kennel", "Fernway"]) {
      assert.ok(text.indexOf(name) >= start, `${name} is named before #kennel, at text offset ${text.indexOf(name)}`);
    }
  });

  test("the rendered page has the sections in that order, each labelled by its h2, and one h1", () => {
    const sections = elements(markup, "section").filter((s) => /\sid="/.test(s.attrs));
    assert.deepEqual(
      sections.map((s) => /\sid="([^"]+)"/.exec(s.attrs)?.[1]),
      openSourceSections.map((s) => s.id),
    );
    for (const [i, s] of openSourceSections.entries()) {
      const headingId = s.headingId ?? `${s.id}-heading`;
      assert.match(sections[i].attrs, new RegExp(`aria-labelledby="${headingId}"`), s.id);
      const h2 = element(sections[i].inner, "h2");
      assert.match(h2?.attrs ?? "", new RegExp(`id="${headingId}"`), s.id);
      assert.equal(textOf(h2?.inner ?? ""), s.title, s.id);
    }
    assert.equal(elements(markup, "h1").length, 1);
    assert.equal(textOf(element(markup, "h1")?.inner ?? ""), "Open source, every check included");
  });

  test("a visible breadcrumb from the registry, like the BreadcrumbList", () => {
    const nav = element(markup, "nav", 'aria-label="Breadcrumb"');
    assert.ok(nav, "no breadcrumb");
    assert.deepEqual(
      elements(nav.inner, "li").map((li) => textOf(li.inner).replace("/", "").trim()),
      ["Home", "Open source"],
    );
  });

  test("the license section says MIT and links the LICENSE file", () => {
    const license = elements(markup, "section").find((s) => /\sid="license"/.test(s.attrs));
    assert.match(textOf(license?.inner ?? ""), /MIT/);
    assert.ok(license?.inner.includes(`href="${site.licenseUrl}"`), "no link to the LICENSE file");
  });

  test("the roadmap has V0 to V4 as stages, write-access and paywall-trust shipped in 0.6.0", () => {
    assert.deepEqual(
      roadmap.map((stage) => stage.stage),
      ["V0", "V1", "V2", "V3", "V4"],
    );
    const v2 = roadmap.find((stage) => stage.stage === "V2");
    assert.equal(v2?.status, "preview");
    assert.match(v2?.adds ?? "", /0\.6\.0 adds write access/);
    assert.match(v2?.adds ?? "", /paywall trust/);
  });
});

describe("stability (#stability, new)", () => {
  // The section's intro, then its three items.
  const intro = openSourceSections.find((s) => s.id === "stability")?.intro ?? "";
  const text = [intro, ...stability.map((item) => `${item.title} ${item.text}`)].join("\n");

  test("says a 0.x release may change behaviour, as the changelog does", () => {
    assert.match(text, /0\.x/);
    assert.match(text, /any release may change behaviour/);
    const changelog = readFileSync(new URL("../../../CHANGELOG.md", import.meta.url), "utf8");
    assert.match(changelog, /while the version is 0\.x, any release may change behaviour/);
  });

  test("names what may change (report.json, command-line flags, defaults), what won't (check ids) and what 1.0.0 brings", () => {
    assert.match(text, /report\.json/);
    assert.match(text, /flags/);
    assert.match(text, /defaults/);
    assert.match(text, /check ids/i);
    assert.match(text, /1\.0\.0/);
    assert.match(text, /Semantic Versioning/);
  });
});

describe("the maintainer block (#maintainer, new)", () => {
  test("the maintainer's name and GitHub, from lib/site.ts", () => {
    assert.equal(maintainer.name, site.maintainer.name);
    assert.equal(maintainer.github, site.maintainer.url);
    assert.match(maintainer.github, /^https:\/\/github\.com\/[a-z0-9-]+$/);
  });

  test("how it is built: contracts and failing tests first, planted-bug test apps in CI, the public decision log", () => {
    const how = maintainer.how.join("\n");
    assert.match(how, /failing tests first/);
    assert.match(how, /planted bugs/);
    assert.match(how, /\bCI\b/);
    assert.equal(maintainer.decisions, `${site.github}/blob/main/DECISIONS.md`);
  });

  test("no 'built with AI' statement, no employer and no personal site (decision 5, §5.10 Q1)", () => {
    const all = [maintainer.why, ...maintainer.how].join("\n");
    assert.doesNotMatch(all, /built with (AI|Claude)|Claude Code|co-authored|employer|works at/i);
    const section = elements(markup, "section").find((s) => /\sid="maintainer"/.test(s.attrs));
    assert.ok(section, "no #maintainer section");
    assert.doesNotMatch(section.inner, /rahulbharati\.com/);
    assert.ok(section.inner.includes(`href="${site.maintainer.url}"`), "no GitHub link");
  });
});

describe("How to help today (#how-to-help on #contributing)", () => {
  test("three cards: Try it, Report a bug, Send feedback", () => {
    assert.deepEqual(
      howToHelp.map((card) => card.title),
      ["Try it", "Report a bug", "Send feedback"],
    );
    for (const card of howToHelp) assert.ok(card.links.length >= 1 && card.links.length <= 2, card.title);
  });

  test("Try it links the quick start and the test lab, on this site", () => {
    const [tryIt] = howToHelp;
    assert.equal(tryIt.links.length, 2);
    for (const link of tryIt.links) assert.ok(lands(link.href), `${link.label}: ${link.href}`);
    assert.match(tryIt.links[0].label, /[Qq]uick start/);
    assert.match(tryIt.links[1].label, /test lab/);
  });

  test("Report a bug links the bug form, and says a wrong finding is a bug too", () => {
    const report = howToHelp[1];
    assert.deepEqual(
      report.links.map((link) => link.href),
      [bugFormUrl],
    );
    assert.match(report.text, /a finding you think is wrong is a bug too/i);
  });

  test("Send feedback links the feedback form: missed bugs, confusing messages, clean runs on well-built apps", () => {
    const feedback = howToHelp[2];
    assert.equal(feedbackFormUrl, `${site.github}/issues/new?template=feedback.yml`);
    assert.deepEqual(
      feedback.links.map((link) => link.href),
      [feedbackFormUrl],
    );
    assert.match(feedback.text, /missed/);
    assert.match(feedback.text, /confusing/);
    assert.match(feedback.text, /clean run/);
    const form = readFileSync(new URL("../../../.github/ISSUE_TEMPLATE/feedback.yml", import.meta.url), "utf8");
    assert.match(form, /^name: Feedback$/m);
  });

  test("then one line: a security problem follows the disclosure policy at /security/", () => {
    assert.match(securityLine.text, /security problem/);
    assert.equal(securityLine.link.href, href("security"));
    assert.equal(securityLine.link.label, "Follow the disclosure policy");
  });

  test("the rendered section: the three cards as h3s and every link", () => {
    const section = elements(markup, "section").find((s) => /\sid="contributing"/.test(s.attrs));
    assert.ok(section, "no #contributing section");
    assert.deepEqual(
      elements(section.inner, "h3").map((h) => textOf(h.inner)),
      howToHelp.map((card) => card.title),
    );
    for (const link of [...howToHelp.flatMap((card) => card.links), securityLine.link]) {
      assert.ok(section.inner.includes(`href="${link.href.replace(/&/g, "&amp;")}"`), `${link.label}: ${link.href}`);
    }
  });
});

describe("no contribution process yet (USER-DECISIONS.md 4)", () => {
  test("no Discussions, code of conduct, contributing guide, CLA or DCO, and no 'guidelines are coming'", () => {
    const folder = new URL("../components/oss/", import.meta.url);
    const sources = [
      readFileSync(new URL("./open-source.ts", import.meta.url), "utf8"),
      readFileSync(new URL("../app/open-source/page.tsx", import.meta.url), "utf8"),
      ...readdirSync(folder)
        .filter((name) => name.endsWith(".tsx"))
        .map((name) => readFileSync(new URL(name, folder), "utf8")),
      textOf(markup),
    ];
    const banned =
      /discussions|code of conduct|contributing guide|contribution guidelines|CONTRIBUTING\.md|Contributor License|Certificate of Origin|\bCLA\b|\bDCO\b|\/contribute\//i;
    for (const source of sources) assert.doesNotMatch(source, banned);
  });

  test("every internal link on the page lands on a registered page or a section of this one", () => {
    const hrefs = [...markup.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]);
    assert.ok(hrefs.length > 0);
    for (const target of hrefs) assert.ok(lands(target), target);
  });
});
