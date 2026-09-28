// The docs (DESIGN.md §3.4, §3.5; node D1): a hub at /docs/ and one MDX page per task in src/content/docs/<slug>.mdx,
// registered in content/routes/docs.ts. What the MDX may hold (no h1, pinned ids, only registered components, no bare
// <word> that MDX would read as JSX), what every page opens with (the answer in at most 50 words), how long it may be
// (at most 1,000 words, §5.2), and the hub that keeps every old /docs/#id on a card. `pnpm test` (node:test,
// scripts/test-hooks.mjs).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { commands } from "@/content/commands";
import { docsHub } from "@/content/docs/hub";
import { docsGroups, routes, type RouteEntry } from "@/content/routes";
import { docsRoutes } from "@/content/routes/docs";
import { docHeadings, docLinks, docMarkdown, docMinutes, docOpening, docPlainText, docSentences, docTags, readingMinutes, shellBlocks, wordCount } from "@/lib/docs-text";
import { resolveTarget } from "@/lib/nav";
import { site } from "@/lib/site";

const siteDir = new URL("../../", import.meta.url).pathname;
const docsDir = join(siteDir, "src", "content", "docs");
const read = (file: string) => readFileSync(join(siteDir, file), "utf8");

type DocsPage = RouteEntry & { docs: { group: string; order: number } };
const [hub, ...pages] = docsRoutes as readonly RouteEntry[] as [RouteEntry, ...DocsPage[]];
const slugOf = (r: RouteEntry) => r.path.split("/")[2];
const mdxOf = (r: RouteEntry) => read(r.source);

/** The 11 pages of §3.5, in sidebar order within their groups. Later pages (D2's glossary) may join them. */
const designed: { slug: string; group: string }[] = [
  { slug: "quick-start", group: "get-started" },
  { slug: "install", group: "get-started" },
  { slug: "test-lab", group: "get-started" },
  { slug: "your-app", group: "get-started" },
  { slug: "signed-in-runs", group: "guides" },
  { slug: "ai", group: "guides" },
  { slug: "report", group: "reference" },
  { slug: "cli", group: "reference" },
  { slug: "safety", group: "reference" },
  { slug: "limitations", group: "reference" },
  { slug: "troubleshooting", group: "help" },
];

/** The components mdx-components.tsx registers, and the HTML a table needs: nothing else may appear as a tag. */
const registered = ["Shell", "Callout", "TableRegion"];
const html = ["table", "caption", "thead", "tbody", "tr", "th", "td", "br"];

describe("the docs pages in the registry", () => {
  test("the hub, then the 11 pages of §3.5 in their groups and order", () => {
    assert.equal(hub.path, "/docs/");
    const bySlug = new Map(pages.map((r) => [slugOf(r), r]));
    for (const { slug, group } of designed) {
      const page = bySlug.get(slug);
      assert.ok(page, `/docs/${slug}/ is registered`);
      assert.equal(page.docs.group, group, slug);
    }
    const order = (group: string) =>
      pages
        .filter((r) => r.docs.group === group && designed.some((d) => d.slug === slugOf(r)))
        .sort((a, b) => a.docs.order - b.docs.order)
        .map(slugOf);
    for (const group of ["get-started", "guides", "reference", "help"]) {
      assert.deepEqual(order(group), designed.filter((d) => d.group === group).map((d) => d.slug), group);
    }
  });

  test("each page renders its own MDX file, and every MDX file in content/docs/ is a registered page", () => {
    for (const r of pages) {
      assert.equal(r.source, `src/content/docs/${slugOf(r)}.mdx`, r.id);
      assert.ok(existsSync(join(siteDir, r.source)), `${r.source} exists`);
    }
    const files = readdirSync(docsDir).filter((f) => f.endsWith(".mdx"));
    assert.deepEqual(files.sort(), pages.map((r) => `${slugOf(r)}.mdx`).sort());
  });

  test("each page is a dated WebPage with a TechArticle whose headline is its h1; the hub is a WebPage alone (§3.4)", () => {
    for (const r of pages) {
      assert.equal(r.schema.type, "WebPage", r.id);
      assert.equal(r.schema.dated, true, `${r.id}: its meta line shows the date`);
      assert.ok(r.schema.article?.headline, `${r.id}: a headline`);
      assert.equal(r.search, "Docs", r.id);
      assert.equal(r.indexable, true, r.id);
    }
    assert.equal(hub.schema.article, undefined, "the hub has no TechArticle");
  });

  test("the Quick start is the CTA's page: /docs/quick-start/, h1 \"Quick start\"", () => {
    const quick = pages.find((r) => r.id === "docs-quick-start");
    assert.equal(quick?.path, "/docs/quick-start/");
    assert.equal(quick?.schema.article?.headline, "Quick start");
  });
});

describe("what the MDX may hold (§3.5)", () => {
  test("no h1: the page renders it from the registry", () => {
    for (const r of pages) {
      const mdx = mdxOf(r);
      assert.deepEqual(docHeadings(mdx).filter((h) => h.depth === 1), [], r.id);
      assert.doesNotMatch(mdx, /<h1\b/, r.id);
    }
  });

  test("every h2 has a pinned id (\\{#id\\}), unique on its page", () => {
    for (const r of pages) {
      const headings = docHeadings(mdxOf(r));
      const h2 = headings.filter((h) => h.depth === 2);
      assert.ok(h2.length >= 2, `${r.id}: at least two sections`);
      for (const h of h2) assert.match(h.id ?? "", /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${r.id}: "${h.text}" has a pinned id`);
      const ids = headings.flatMap((h) => (h.id ? [h.id] : []));
      assert.equal(new Set(ids).size, ids.length, `${r.id}: ids are unique`);
    }
  });

  test("every promised anchor is a pinned id on its page", () => {
    for (const r of pages) {
      const ids = docHeadings(mdxOf(r)).flatMap((h) => (h.id ? [h.id] : []));
      for (const anchor of r.anchors) assert.ok(ids.includes(anchor), `${r.path}#${anchor} is pinned`);
    }
  });

  test("the anchors §3.4 and §3.5 promise: #requirements and #from-source on Install, #feedback on Troubleshooting, #playwright-test on Reading the report", () => {
    const anchorsOf = (id: string) => routes.find((r) => r.id === id)?.anchors ?? [];
    assert.ok(anchorsOf("docs-install").includes("requirements"));
    assert.ok(anchorsOf("docs-install").includes("from-source"));
    assert.ok(anchorsOf("docs-troubleshooting").includes("feedback"));
    assert.ok(anchorsOf("docs-report").includes("playwright-test"));
    const troubleshooting = docHeadings(mdxOf(pages.find((r) => r.id === "docs-troubleshooting")!));
    assert.ok(troubleshooting.some((h) => h.depth === 2 && h.text === "host.docker.internal not working"));
  });

  test("no bare <word>: every tag outside code is a registered component or a table's HTML", () => {
    for (const r of pages) {
      const unknown = docTags(mdxOf(r)).filter((tag) => !registered.includes(tag) && !html.includes(tag));
      assert.deepEqual(unknown, [], `${r.id}: write a placeholder as code (\`<port>\`), or register the component`);
    }
  });

  test("the tag finder sees a bare <port> and leaves code alone", () => {
    assert.deepEqual(docTags("Enter http://localhost:<port>/ here."), ["port"]);
    assert.deepEqual(docTags("Enter `http://localhost:<port>/` here.\n\n```sh\n$ curl <url>\n```\n"), []);
    assert.deepEqual(docTags('<Shell block="run" label="Start" />\n\n<Callout title="x">\nText\n</Callout>'), ["Shell", "Callout"]);
  });

  test("no \"Edit this page\": the docs end with \"Report it on GitHub\" (decision 4)", () => {
    const shellDir = join(siteDir, "src", "components", "docs-shell");
    const files = [
      ...pages.map((r) => r.source),
      "src/app/docs/page.tsx",
      "src/app/docs/[slug]/page.tsx",
      "src/content/docs/hub.ts",
      ...readdirSync(shellDir).map((f) => `src/components/docs-shell/${f}`),
    ];
    for (const file of files) assert.doesNotMatch(read(file), /edit this page/i, file);
    // Every docs page renders in the shell, which ends with Previous and Next, then the report line.
    assert.match(read("src/app/docs/[slug]/page.tsx"), /<DocsShell\b/);
    assert.match(read("src/components/docs-shell/docs-shell.tsx"), /<PrevNext\b[\s\S]*<ReportLine\b/);
  });

  test("each Shell names a block of content/commands.ts, and each fenced block has a label and a command to copy", () => {
    for (const r of pages) {
      const mdx = mdxOf(r);
      for (const name of shellBlocks(mdx)) assert.ok(name in commands.blocks, `${r.id}: commands.blocks.${name}`);
      for (const fence of mdx.matchAll(/^```(\w*)([^\n]*)\n([\s\S]*?)^```$/gm)) {
        assert.match(fence[2], /label="[^"]+"/, `${r.id}: a fenced block has label="…": ${fence[0].slice(0, 60)}`);
        assert.match(fence[3], /^\$ \S/m, `${r.id}: a fenced block has a "$ " command line to copy`);
      }
    }
  });
});

describe("the MDX stays in the subset lib/docs-text.ts reads (it reads the MDX without compiling it)", () => {
  /** Lines outside fenced blocks, each with its line number. */
  const prose = (mdx: string) => {
    let inFence = false;
    return mdx.split("\n").flatMap((line, i) => {
      if (/^```/.test(line)) {
        inFence = !inFence;
        return [];
      }
      return inFence ? [] : [{ line, n: i + 1 }];
    });
  };

  test("no blockquote, image or nested list, and no heading inside a Callout: each would render but read differently", () => {
    for (const r of pages) {
      const found: string[] = [];
      let inCallout = false;
      for (const { line, n } of prose(mdxOf(r))) {
        if (/^<Callout\b/.test(line)) inCallout = true;
        if (/^<\/Callout>/.test(line)) inCallout = false;
        if (/^\s*>/.test(line)) found.push(`${n}: a blockquote`);
        if (/!\[/.test(line)) found.push(`${n}: an image`);
        if (/^\s+([-*+]|\d+\.)\s/.test(line)) found.push(`${n}: an indented list item`);
        if (inCallout && /^#{1,6}\s/.test(line)) found.push(`${n}: a heading inside a Callout`);
      }
      assert.deepEqual(found, [], r.id);
    }
  });

  test("the subset check sees each of them", () => {
    const sample = "> quote\n\n![x](/a.png)\n\n- a\n  - b\n\n<Callout>\n## Inside\n</Callout>\n\n```sh label=\"x\"\n> not prose\n```";
    const lines = prose(sample).map((l) => l.line);
    assert.ok(lines.includes("> quote") && lines.includes("  - b") && lines.includes("## Inside"));
    assert.ok(!lines.includes("> not prose"), "a fenced block is left alone");
  });
});

describe("what every page says (§3.5, §5.2)", () => {
  test("an answer-first opening: the page starts with a paragraph of at most 50 words", () => {
    for (const r of pages) {
      const opening = docOpening(mdxOf(r));
      const words = wordCount(opening);
      assert.ok(words >= 12, `${r.id}: an opening (${words} words): "${opening}"`);
      assert.ok(words <= 50, `${r.id}: the opening has ${words} words (at most 50): "${opening}"`);
    }
  });

  test("at most 1,000 words a page, with a warning over 900 (§5.2; the prose, commands and output left out)", (t) => {
    const counts: Record<string, number> = {};
    for (const r of pages) counts[r.id] = wordCount(docPlainText(mdxOf(r)));
    for (const [id, words] of Object.entries(counts)) {
      if (words > 900) t.diagnostic(`${id}: ${words} words (warning at 900)`);
      assert.ok(words <= 1000, `${id}: ${words} words`);
      assert.ok(words >= 150, `${id}: ${words} words is too thin for a page`);
    }
  });

  test("sentences of at most 25 words (docs/brand.md: at most 20, never more than 25)", () => {
    const long: string[] = [];
    for (const r of pages) {
      for (const sentence of docSentences(mdxOf(r))) {
        const words = wordCount(sentence);
        if (words > 25) long.push(`${r.id} (${words}): ${sentence}`);
      }
    }
    assert.deepEqual(long, []);
  });

  test("Quick start follows §3.5: what you need, four numbered steps, the test lab, next steps", () => {
    const quick = mdxOf(pages.find((r) => r.id === "docs-quick-start")!);
    assert.deepEqual(
      docHeadings(quick)
        .filter((h) => h.depth === 2)
        .map((h) => h.text),
      ["What you need", "1. Start Run Hound", "2. Open the web UI", "3. Enter your page", "4. Approve and run", "No app handy? Try the test lab", "Next steps"],
    );
    assert.deepEqual(shellBlocks(quick).slice(0, 1), ["run"], "step 1 is the three-line run block with its real output");
    assert.ok(commands.blocks.run.output && commands.blocks.run.output.length > 0);
    assert.match(docOpening(quick), /Docker or Podman/);
    assert.match(docPlainText(quick), /Public sites are refused/);
    assert.match(docPlainText(quick), /host\.docker\.internal/);
  });

  test("internal links go to registered pages, and a #hash on a docs page to a pinned id there", () => {
    const pinned = new Map(pages.map((r) => [r.path, new Set(docHeadings(mdxOf(r)).flatMap((h) => (h.id ? [h.id] : [])))]));
    for (const r of pages) {
      for (const link of docLinks(mdxOf(r)).filter((l) => l.startsWith("/"))) {
        const [path, hash] = link.split("#");
        const target = routes.find((x) => x.path === path);
        assert.ok(target, `${r.id}: ${link} is a registered page`);
        if (!hash) continue;
        const ids = pinned.get(path);
        assert.ok(ids ? ids.has(hash) : target.anchors.includes(hash), `${r.id}: ${link} lands on an id the page promises`);
      }
    }
  });

  test("task pages (Get started) show \"About N minutes\" from the word count at 200 wpm", () => {
    assert.equal(readingMinutes(1), 1);
    assert.equal(readingMinutes(200), 1);
    assert.equal(readingMinutes(201), 2);
    assert.equal(readingMinutes(950), 5);
    for (const slug of ["install", "test-lab", "your-app"]) {
      const mdx = mdxOf(pages.find((r) => slugOf(r) === slug)!);
      assert.equal(docMinutes(slug, mdx), readingMinutes(wordCount(docPlainText(mdx))), slug);
    }
  });

  test("the Quick start says \"About 5 minutes\", as §3.5 gives it: the time to do it, a 260 MB pull included", () => {
    assert.equal(docMinutes("quick-start", mdxOf(pages.find((r) => r.id === "docs-quick-start")!)), 5);
  });

  test("nothing of the one-page docs is lost: every terminal block of content/commands.ts is shown on a page", () => {
    const shown = new Set(pages.flatMap((r) => shellBlocks(mdxOf(r))));
    assert.deepEqual(Object.keys(commands.blocks).filter((name) => !shown.has(name)), []);
  });

  test("The test lab keeps Kennel from source (the old #kennel's two terminals), which ai.mdx's localhost:5310 relies on", () => {
    const lab = mdxOf(pages.find((r) => r.id === "docs-test-lab")!);
    assert.ok(docHeadings(lab).some((h) => h.depth === 2 && h.id === "from-source"));
    assert.match(lab, /^\$ KENNEL_BUGS=all PORT=5310 ANALYTICS_PORT=5311 pnpm kennel$/m);
    assert.match(lab, /^\$ pnpm serve --port 4310$/m);
    assert.match(lab, /KENNEL_BUGS=none/);
    assert.ok(docLinks(mdxOf(pages.find((r) => r.id === "docs-ai")!)).includes("/docs/test-lab/#from-source"));
  });

  test("a session in sessionStorage carries over to a run (0.6.0), and one the app throws away doesn't (Known limitations)", () => {
    const text = docPlainText(mdxOf(pages.find((r) => r.id === "docs-limitations")!));
    assert.match(text, /cookies, localStorage, IndexedDB or sessionStorage carries over/);
    assert.match(text, /throws away when a page loads doesn't/);
  });

  test("Known limitations carries TESTING.md's 0.6.0 limits: A's email, deep-links' success pages, the live view (verify-060)", () => {
    const text = docPlainText(mdxOf(pages.find((r) => r.id === "docs-limitations")!));
    assert.match(text, /axe-states and pii-leak save a test address over it/);
    assert.match(text, /deep-links opens the app's own success pages/);
    assert.match(text, /live view of a signed-in run isn't masked/);
    assert.ok(docLinks(mdxOf(pages.find((r) => r.id === "docs-limitations")!)).includes("/docs/safety/#what-it-changes"));
  });
});

describe("the text of the MDX (lib/docs-text.ts)", () => {
  const sample = [
    "Run Hound runs `docker` on your machine. See [Install](/docs/install/#requirements).",
    "",
    "## What you need \\{#what-you-need\\}",
    "",
    "- Docker or Podman",
    "- **1 GB** free",
    "",
    '<Shell block="run" label="Start Run Hound" />',
    "",
    '```sh label="Kennel"',
    "$ pnpm kennel",
    "Kennel listening",
    "```",
    "",
    '<Callout title="Podman">',
    "The same with `podman`.",
    "</Callout>",
  ].join("\n");

  test("headings keep their text and pinned id; the opening is the first paragraph", () => {
    assert.deepEqual(docHeadings(sample), [{ depth: 2, text: "What you need", id: "what-you-need" }]);
    assert.equal(docOpening(sample), "Run Hound runs docker on your machine. See Install.");
  });

  test("the plain text leaves out code blocks and Shell blocks, and keeps what a Callout says", () => {
    const text = docPlainText(sample);
    assert.match(text, /What you need/);
    assert.match(text, /The same with podman/);
    assert.doesNotMatch(text, /pnpm kennel|Kennel listening|docker pull/);
    assert.doesNotMatch(text, /\{#|\\\{|<Shell|<Callout|\*\*/);
  });

  test("the Markdown for llms-full.txt resolves Shell blocks from commands.ts, drops ids and prompts, and makes links absolute", () => {
    const md = docMarkdown(sample, { absolute: (path) => `https://example.test${path}` });
    assert.match(md, /^## What you need$/m);
    assert.doesNotMatch(md, /\{#/);
    assert.ok(md.includes(commands.blocks.run.commands[0]), "the run block's first command");
    assert.match(md, /^pnpm kennel$/m, "a fenced block's commands without the prompt");
    assert.match(md, /\[Install\]\(https:\/\/example\.test\/docs\/install\/#requirements\)/);
    assert.match(md, /^> The same with `podman`\.$/m, "a Callout as a quote");
    assert.doesNotMatch(md, /<Shell|<Callout|label=/);
  });

  test("sentences: split at . ! ? before a space, a table cell and a list item each on their own; code left out", () => {
    assert.deepEqual(docSentences("One two. `run` plans a page. Three!\n\n- An item. Another\n\n```sh label=\"x\"\n$ a. b\n```"), [
      "One two.",
      "run plans a page.",
      "Three!",
      "An item.",
      "Another",
    ]);
    assert.deepEqual(docSentences('<TableRegion label="t">\n<table><tbody><tr><th>Disk</th><td>About 1 GB. Or more</td></tr></tbody></table>\n</TableRegion>'), [
      "Disk",
      "About 1 GB.",
      "Or more",
    ]);
  });

  test("words are counted with the brief's regex", () => {
    assert.equal(wordCount("Run Hound's 26 checks: localhost:4000, host.docker.internal."), 6);
  });
});

describe("the remark plugin that pins ids and passes a fence's label (next.config.ts)", async () => {
  const { default: remarkDocs } = await import("@/components/docs-shell/remark-docs.mjs");
  const run = (tree: object) => {
    remarkDocs()(tree);
    return tree;
  };

  test("a heading's trailing {#id} becomes its id and leaves its text", () => {
    const heading = {
      type: "heading",
      depth: 2,
      children: [{ type: "inlineCode", value: "host.docker.internal" }, { type: "text", value: " not working {#host-docker-internal}" }],
    };
    run({ type: "root", children: [heading] });
    assert.deepEqual(heading, {
      type: "heading",
      depth: 2,
      children: [{ type: "inlineCode", value: "host.docker.internal" }, { type: "text", value: " not working" }],
      data: { hProperties: { id: "host-docker-internal" } },
    });
  });

  test("a heading without one is left alone, and so is an id that isn't kebab-case", () => {
    const plainHeading = { type: "heading", depth: 2, children: [{ type: "text", value: "Next steps" }] };
    const odd = { type: "heading", depth: 2, children: [{ type: "text", value: "Odd {#Not_Kebab}" }] };
    run({ type: "root", children: [plainHeading, odd] });
    assert.equal("data" in plainHeading, false);
    assert.equal("data" in odd, false);
  });

  test("an <InlineTocSlot /> goes right after the opening paragraph, for the inline \"On this page\"", () => {
    const opening = { type: "paragraph", children: [{ type: "text", value: "The answer." }] };
    const heading = { type: "heading", depth: 2, children: [{ type: "text", value: "Next {#next}" }] };
    const tree = run({ type: "root", children: [opening, heading] }) as { children: { type: string; name?: string }[] };
    assert.deepEqual(
      tree.children.map((node) => node.name ?? node.type),
      ["paragraph", "InlineTocSlot", "heading"],
    );
  });

  test("a fence's label reaches the code element as data-label", () => {
    const code = { type: "code", lang: "sh", meta: 'label="Start Kennel"', value: "$ pnpm kennel" };
    run({ type: "root", children: [code] });
    assert.deepEqual((code as { data?: unknown }).data, { hProperties: { "data-label": "Start Kennel" } });
  });
});

describe("the hub keeps every old /docs/#id on a card (§3.4)", () => {
  const cards = docsHub.groups.flatMap((g) => g.cards);

  test("each old id is a card's id, and #overview the intro", () => {
    assert.deepEqual([...cards.map((c) => c.id), "overview"].sort(), [...hub.anchors].sort());
  });

  test("each card lands where §3.4 says", () => {
    const where = Object.fromEntries(cards.filter((c) => c.id !== "ai-built").map((c) => [c.id, resolveTarget(c)]));
    assert.deepEqual(where, {
      "quick-start": "/docs/quick-start/",
      requirements: "/docs/install/#requirements",
      install: "/docs/install/#from-source",
      kennel: "/docs/test-lab/",
      "your-app": "/docs/your-app/",
      accounts: "/docs/signed-in-runs/",
      ai: "/docs/ai/",
      report: "/docs/report/",
      checks: "/checks/",
      safety: "/docs/safety/",
      limitations: "/docs/limitations/",
      problems: "/docs/troubleshooting/",
      feedback: "/docs/troubleshooting/#feedback",
    });
  });

  test(
    "the ai-built card lands on /ai-built-apps/#discovery (§3.4; needs F2's `discovery` anchor in content/routes/product.ts)",
    { todo: !routes.find((r) => r.id === "ai-built-apps")?.anchors.includes("discovery") },
    () => {
      assert.equal(resolveTarget(cards.find((c) => c.id === "ai-built")!), "/ai-built-apps/#discovery");
    },
  );

  test("four groups, in the sidebar's order; a card title of at most 5 words and one sentence of at most 22", () => {
    assert.deepEqual(
      docsHub.groups.map((g) => g.id),
      ["get-started", "guides", "reference", "help"],
    );
    for (const card of cards) {
      assert.ok(wordCount(card.title) <= 5, card.title);
      assert.ok(wordCount(card.text) <= 22, `${card.id}: ${wordCount(card.text)} words`);
      assert.equal(card.text.split(/[.!?](?:\s|$)/).filter((s) => s.trim()).length, 1, `${card.id}: one sentence`);
    }
  });

  test("a docs page that keeps no old id (the CLI, the glossary) has a card sentence of its own, by the same rules", () => {
    const linked = new Set<string>(cards.map((c) => c.to));
    const unlinked = pages.filter((p) => !linked.has(p.id)).map((p) => p.id);
    assert.deepEqual(docsHub.pageCards.map((c) => c.to).sort(), [...unlinked].sort(), "one card sentence per page with no old id");
    for (const card of docsHub.pageCards) {
      assert.ok(wordCount(card.text) <= 22, `${card.to}: ${wordCount(card.text)} words`);
      assert.equal(card.text.split(/[.!?](?:\s|$)/).filter((s) => s.trim()).length, 1, `${card.to}: one sentence`);
    }
  });

  test("the hub page shows those sentences, never a page's meta description", () => {
    const hubComponent = read("src/components/docs-shell/hub.tsx");
    assert.match(hubComponent, /docsHub\.pageCards/);
    assert.doesNotMatch(hubComponent, /text: r\.description/);
  });

  test("an intro of about 60 words, and at most 170 words outside the cards (h1, meta line, intro, group labels)", () => {
    const intro = wordCount(docsHub.intro);
    assert.ok(intro >= 40 && intro <= 75, `${intro} words`);
    const meta = `For release ${site.version} · Updated ${site.released}`;
    const labels = docsHub.groups.map((g) => docsGroups.find((x) => x.id === g.id)?.label ?? g.id).join(" ");
    const outside = wordCount([docsHub.h1, meta, docsHub.intro, labels].join(" "));
    assert.ok(outside <= 170, `${outside} words outside the cards`);
    assert.doesNotMatch(docsHub.intro, new RegExp(site.version.replaceAll(".", "\\.")), "the release comes from lib/site.ts");
  });
});

describe("llms-full.txt reads the docs from the MDX (§5.4 D1)", () => {
  test("the route builds the docs sections with docMarkdown, not a copy of their text", () => {
    const route = read("src/app/llms-full.txt/route.ts");
    assert.match(route, /from "@\/lib\/docs-text"/);
    assert.match(route, /docMarkdown\(/);
    for (const gone of ["function getStarted", "function signedIn", "function optionalAi", "function safety", "function limitations"]) {
      assert.ok(!route.includes(gone), `${gone} is replaced by the MDX text`);
    }
  });
});
