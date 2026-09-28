// The route registry (content/routes.ts): one entry per page, and the lists every navigation, the sitemap, llms.txt,
// the search index and the build guards derive from it. `pnpm test` (node:test, scripts/test-hooks.mjs).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, test } from "node:test";
import { aiBuiltPage } from "@/content/ai-built";
import { builtInChecks, categories } from "@/content/checks/data";
import { comparePage } from "@/content/compare";
import { faqGroups, faqPage } from "@/content/faq";
import { legalPages } from "@/content/legal";
import { openSourcePage } from "@/content/open-source";
import { footer, route, routes, type RouteEntry } from "@/content/routes";
import { checkRoutes } from "@/content/routes/checks";
import { docsRoutes } from "@/content/routes/docs";
import { legalRoutes } from "@/content/routes/legal";
import { pageRoutes } from "@/content/routes/pages";
import { productRoutes } from "@/content/routes/product";
import { projectRoutes } from "@/content/routes/project";
import { href } from "@/lib/nav";
import { sourceFiles } from "../../scripts/lib/build-output.mjs";

const siteDir = new URL("../../", import.meta.url).pathname;
const srcDir = join(siteDir, "src");
const all = routes as readonly RouteEntry[];
const indexable = all.filter((r) => r.indexable);

/**
 * Pages later work registers (the design's §5.3): D1 and D2 add docs pages to content/routes/docs.ts, each with a
 * place in the docs sidebar; C1 and C2 add a page per check to content/routes/checks.ts, each `check-<id>`. The tests
 * below stay exact about today's 13 pages and check the later ones by their shape, so registering one breaks nothing.
 */
const later = (r: RouteEntry) => r.parent === "docs" || r.parent === "checks";

/**
 * What a docs page's entry must be (D1 and D2 register them in content/routes/docs.ts): under the hub, in the sidebar,
 * at /docs/<slug>/, searchable as Docs, and named `docs-<slug>`. The footer's Docs column, the homepage's installUrl
 * (lib/structured-data.ts) and nav.test name the pages by those ids before they exist, and switch to them only when an
 * entry has that id: a page registered as "quick-start" would leave every one of those links on its fallback.
 */
function docsPageProblems(r: RouteEntry): string[] {
  const problems: string[] = [];
  if (r.parent !== "docs") problems.push(`${r.id}: under the docs hub (parent "docs")`);
  if (!r.docs) problems.push(`${r.id}: a place in the docs sidebar`);
  if (!/^\/docs\/[a-z0-9-]+\/$/.test(r.path)) problems.push(`${r.id}: the path is /docs/<slug>/, not ${r.path}`);
  if (r.search !== "Docs") problems.push(`${r.id}: searchable as Docs`);
  const id = `docs-${r.path.split("/")[2]}`;
  if (r.id !== id) problems.push(`${r.path}: a docs page's id is ${id} (the footer, installUrl and nav.test name it so), not ${r.id}`);
  return problems;
}

const today = indexable.filter((r) => !later(r));
const legalPaths = ["/privacy/", "/terms/", "/acceptable-use/", "/security/"];

/** The 13 pages the site has before the redesign adds any (brief §3.2, phase 1). */
const todaysPages = [
  "/",
  "/how-it-works/",
  "/checks/",
  "/demo/",
  "/docs/",
  "/open-source/",
  "/ai-built-apps/",
  "/faq/",
  "/compare/",
  "/privacy/",
  "/terms/",
  "/acceptable-use/",
  "/security/",
];

describe("the registry mirrors today's site", () => {
  test("today's 13 indexable pages, each once, and every other page is a docs or check page", () => {
    assert.deepEqual(today.map((r) => r.path).sort(), [...todaysPages].sort());
    assert.equal(new Set(indexable.map((r) => r.path)).size, indexable.length);
  });

  test("it is the route files together, one per owner: the flat pages, the docs (the hub, then docs pages) and the checks (the hub, then check pages)", () => {
    assert.deepEqual(
      all.map((r) => r.id),
      [...pageRoutes, ...productRoutes, ...projectRoutes, ...legalRoutes, ...docsRoutes, ...checkRoutes].map((r) => r.id),
    );
    // The flat pages, split by the node that changes them (the design's §5.4): the homepage and /_design/ (P1, X1),
    // How it works, Demo and AI-built apps (F2), Open source, FAQ and Compare (F1), and the legal pages (F3).
    assert.deepEqual(
      pageRoutes.map((r) => r.id),
      ["home", "design"],
    );
    assert.deepEqual(
      productRoutes.map((r) => r.id),
      ["how-it-works", "demo", "ai-built-apps"],
    );
    assert.deepEqual(
      projectRoutes.map((r) => r.id),
      ["open-source", "faq", "compare"],
    );
    assert.deepEqual(
      legalRoutes.map((r) => r.path),
      legalPaths,
    );
    const flat: readonly RouteEntry[] = [...pageRoutes, ...productRoutes, ...projectRoutes, ...legalRoutes];
    assert.ok(flat.every((r) => !later(r)), "the flat pages' files hold no docs or check page");
    const [docsHub, ...docsPages] = docsRoutes as readonly RouteEntry[];
    assert.equal(docsHub.path, "/docs/");
    for (const r of docsPages) assert.deepEqual(docsPageProblems(r), [], r.id);
    const [checksHub, ...checkPages] = checkRoutes as readonly RouteEntry[];
    assert.equal(checksHub.path, "/checks/");
    const builtIn = new Set(builtInChecks.map((c) => c.id));
    for (const r of checkPages) {
      const id = r.id.replace(/^check-/, "");
      assert.ok(builtIn.has(id), `${r.id}: a built-in check`);
      assert.equal(r.path, `/checks/${id}/`, r.id);
      assert.equal(r.parent, "checks", r.id);
      assert.equal(r.search, "Check", r.id);
    }
  });

  test("a docs page is named docs-<slug>: the rule catches a page registered under its bare slug", () => {
    const quickStart: RouteEntry = {
      id: "docs-quick-start",
      path: "/docs/quick-start/",
      title: "Quick start",
      description: "x".repeat(80),
      label: "Quick start",
      parent: "docs",
      docs: { group: "get-started", order: 1 },
      schema: { type: "WebPage" },
      source: "src/content/docs/quick-start.mdx",
      search: "Docs",
      indexable: true,
      anchors: [],
      lastmod: "release",
    };
    assert.deepEqual(docsPageProblems(quickStart), []);
    assert.deepEqual(docsPageProblems({ ...quickStart, id: "quick-start" }), [
      "/docs/quick-start/: a docs page's id is docs-quick-start (the footer, installUrl and nav.test name it so), not quick-start",
    ]);
    // Every docs page the footer names follows the rule, so each link switches to its page once D1 registers it.
    const docsColumn = footer.find((column) => column.id === "docs");
    for (const link of docsColumn?.links ?? []) {
      if ("to" in link) assert.match(link.to, /^docs-[a-z0-9-]+$/, link.label);
    }
  });

  // The design's 118 came from the registry prototype: 24 built-in checks and a /docs/quick-start/ page with #test-lab.
  // Release 0.6.0 has 26 built-in checks (+2), there is no quick-start page yet (-1), and #ai-flow is promised because
  // reports link ai-flow findings to it (+1): 120. llms-full.txt links each FAQ answer by its id (+12): 132. The
  // redesigned pages add the ones the new links point at (E1): the checks hub's three groups (§3.7, +3), Open source's
  // #license, #stability and "How to help today" as #contributing with its h2 #how-to-help (§3.8, +4) and the AI-built
  // page's #discovery (§3.11, +1): 140. Docs and check pages promise their own anchors on top of these.
  test("140 promised anchors on today's pages: the ids outside links point at (seo-ia §5.1, #ai-flow, the FAQ answers)", () => {
    const anchors = indexable.flatMap((r) => r.anchors.map((a) => `${r.path}#${a}`));
    assert.equal(new Set(anchors).size, anchors.length, "no anchor is listed twice");
    assert.equal(today.flatMap((r) => r.anchors).length, 140);
    const byPath = (path: string) => [...(all.find((r) => r.path === path)?.anchors ?? [])].sort();
    assert.deepEqual(
      byPath("/checks/"),
      [
        ...builtInChecks.map((c) => c.id),
        ...categories.flatMap((c) => c.checks.map((x) => x.id)),
        "catalog",
        "not-visible",
        "ai-flow",
        "group-accessibility",
        "group-features",
        "group-security",
      ].sort(),
    );
    assert.equal(builtInChecks.length, 26);
    assert.deepEqual(byPath("/docs/"), [
      "accounts",
      "ai",
      "ai-built",
      "checks",
      "feedback",
      "install",
      "kennel",
      "limitations",
      "overview",
      "problems",
      "quick-start",
      "report",
      "requirements",
      "safety",
      "your-app",
    ]);
    assert.deepEqual(byPath("/open-source/"), ["contributing", "how-to-help", "license", "roadmap", "stability"]);
    assert.deepEqual(byPath("/ai-built-apps/"), ["discovery"]);
    assert.deepEqual(byPath("/demo/"), ["fernway"]);
    assert.deepEqual(byPath("/privacy/"), ["cookies"]);
    // A literal list, not one derived from the FAQ data, so renaming or dropping an answer fails check-registry.
    assert.deepEqual(byPath("/faq/"), [
      "ai-pass-fail",
      "behind-a-login",
      "ci",
      "data",
      "is-it-free",
      "is-my-app-secure",
      "live-site",
      "lovable-bolt-v0",
      "requirements",
      "vs-axe-lighthouse",
      "vs-playwright",
      "what-is-run-hound",
    ]);
  });

  test("every promised FAQ id is an answer's id: llms-full.txt links each answer by it", () => {
    // llms-full.txt (app/llms-full.txt/route.ts) writes `${faqPage.path}#${item.id}` for every answer. check-registry
    // reads the built llms files: a #fragment their links name that the page lacks fails the build, and one the
    // registry doesn't promise is reported, so a new answer's id can be promised too.
    const answers = faqGroups.flatMap((group) => group.items.map((item) => item.id));
    for (const id of route("faq").anchors) assert.ok(answers.includes(id), `#${id} is promised, but no FAQ answer has that id`);
  });

  test("titles, descriptions and paths equal the pages' own (so moving a page onto the registry changes nothing)", () => {
    const own = [aiBuiltPage, faqPage, comparePage, openSourcePage, ...Object.values(legalPages)];
    for (const page of own) {
      const r = all.find((x) => x.path === page.path);
      assert.ok(r, `${page.path} is in the registry`);
      assert.equal(r.title, page.title, `${page.path} title`);
      assert.equal(r.description, page.description, `${page.path} description`);
      assert.equal(r.absoluteTitle ?? false, "absoluteTitle" in page ? page.absoluteTitle : false, `${page.path} absoluteTitle`);
    }
    // The checks page counts its checks from the data, like the page does.
    assert.match(route("checks").description, new RegExp(`^${builtInChecks.length} built-in accessibility`));
  });
});

describe("every entry is well formed", () => {
  test("ids and paths are unique; paths start and end with a slash, lower case, at most two levels", () => {
    assert.equal(new Set(all.map((r) => r.id)).size, all.length);
    assert.equal(new Set(all.map((r) => r.path)).size, all.length);
    for (const r of all) assert.match(r.path, /^\/(_?[a-z0-9-]+\/){0,2}$/, r.path);
  });

  test("titles and descriptions fit check-seo --strict", () => {
    for (const r of all) {
      const title = r.absoluteTitle ? r.title : `${r.title} · Run Hound`;
      assert.ok(title.length <= 60, `${r.id}: title is ${title.length} characters`);
      assert.ok(r.description.length >= 70 && r.description.length <= 160, `${r.id}: description is ${r.description.length}`);
    }
  });

  test("every parent exists and no trail loops", () => {
    for (const r of all) {
      if (r.parent === undefined) continue;
      assert.ok(all.some((x) => x.id === r.parent), `${r.id}: parent ${r.parent}`);
      assert.notEqual(r.parent, r.id);
    }
  });

  test("every indexable page's source file exists under site/ (the Docker context)", () => {
    for (const r of indexable) assert.ok(existsSync(join(siteDir, r.source)), `${r.id}: ${r.source}`);
  });

  test("internal routes are never indexable, searchable, in a nav or in llms.txt", () => {
    const internal = all.filter((r) => !r.indexable);
    assert.deepEqual(
      internal.map((r) => r.path),
      ["/_design/"],
    );
    for (const r of internal) {
      assert.equal(r.search, false, r.id);
      assert.equal(r.header, undefined, r.id);
      assert.equal(r.llms, undefined, r.id);
      assert.equal(r.docs, undefined, r.id);
      assert.deepEqual(r.anchors, [], r.id);
    }
    const footerTargets = footer.flatMap((c) => c.links).map((l) => ("to" in l ? l.to : ""));
    for (const r of internal) assert.ok(!footerTargets.includes(r.id), `${r.id} is in the footer`);
  });

  test("search: every indexable page except the 4 legal ones (9 of today's pages; 47 at release)", () => {
    for (const r of indexable) assert.equal(r.search === false, legalPaths.includes(r.path), r.id);
    assert.equal(indexable.filter((r) => r.search !== false).length, indexable.length - legalPaths.length);
    assert.equal(today.filter((r) => r.search !== false).length, 9);
  });

  test("the legal pages are dated by their own date, a docs page by the release or its own date, the rest by the release", () => {
    for (const r of indexable) {
      if (legalPaths.includes(r.path)) assert.equal(r.lastmod, "legal", r.id);
      else if (r.parent === "docs") assert.match(r.lastmod, /^(release|\d{4}-\d{2}-\d{2})$/, r.id);
      else assert.equal(r.lastmod, "release", r.id);
    }
  });
});

describe("links in the source use registry pages", () => {
  /** Files the site serves that are not pages. */
  const files = /^\/(llms\.txt|llms-full\.txt|sitemap\.xml|robots\.txt|manifest\.webmanifest|social-preview\.png|icon\.png|apple-icon\.png|favicon\.ico|brand\/[^/]+|pagefind\/.*|\.well-known\/security\.txt)$/;

  /** Internal link literals: href="/…", href: "/…", path: "/…", url: "/…", href={`/…`}, absoluteUrl("/…"). */
  const linkLiteral = /(?:\bhref|\bpath|\burl|absoluteUrl\(|Url\()\s*[=:(]?\s*\{?\s*["'`](\/[^"'`\s]*)["'`]/g;

  /** An MDX page's Markdown link to a page: [text](/…). */
  const markdownLink = /\]\((\/[^)\s]*)\)/g;

  test("every internal href literal in src/ resolves to a registry page or a served file", () => {
    const paths = new Set(all.map((r) => r.path));
    const offenders: string[] = [];
    let seen = 0;
    let markdownSeen = 0;
    for (const file of sourceFiles(srcDir, ["ts", "tsx", "mdx"])) {
      const text = readFileSync(file, "utf8");
      const literals = [...text.matchAll(linkLiteral)].map((m) => m[1]);
      if (file.endsWith(".mdx")) {
        const links = [...text.matchAll(markdownLink)].map((m) => m[1]);
        markdownSeen += links.length;
        literals.push(...links);
      }
      for (const literal of literals) {
        if (literal.startsWith("//")) continue;
        seen += 1;
        const path = literal.replace(/\$\{[^}]*\}.*$/, "").split(/[#?]/)[0];
        if (files.test(path)) continue;
        const withSlash = path.endsWith("/") ? path : `${path}/`;
        if (!paths.has(withSlash)) offenders.push(`${relative(srcDir, file)}: ${literal}`);
      }
    }
    // Code links pages with href(id) (lib/nav.ts), so quoted paths only ever fall (the ratchet below); the MDX pages'
    // Markdown links are counted too. 94 on 28 September 2026 (E1): 46 quoted, 48 Markdown.
    assert.ok(markdownSeen > 40, `found ${markdownSeen} Markdown links in the MDX pages; has the pattern stopped matching?`);
    assert.ok(seen > 90, `found ${seen} link literals; has the pattern stopped matching?`);
    assert.deepEqual(offenders, []);
  });

  test("the pattern above catches a link to a page that isn't registered", () => {
    const sample = `<Link href="/pricing/">Pricing</Link> <Link href={\`/checks/#\${id}\`}>x</Link>`;
    const found = [...sample.matchAll(linkLiteral)].map((m) => m[1]);
    assert.deepEqual(found, ["/pricing/", "/checks/#${id}"]);
    const mdx = "See [the pricing](/pricing/#plans) and [GitHub](https://github.com/).";
    assert.deepEqual([...mdx.matchAll(markdownLink)].map((m) => m[1]), ["/pricing/#plans"]);
  });

  /** The code without its comments: a doc comment's example path is not a link. Strings keep their "https://". */
  const withoutComments = (text: string) =>
    text
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/^\s*\/\*[\s\S]*?\*\//gm, "")
      .replace(/(^|\s)\/\/[^\n]*/g, "$1");

  /** The links to pages written as a path in a file (served files and the registry's own paths left out). */
  const pageLiterals = (text: string) =>
    [...withoutComments(text).matchAll(linkLiteral)]
      .map((m) => m[1])
      .filter((literal) => !literal.startsWith("//") && !files.test(literal.replace(/\$\{[^}]*\}.*$/, "").split(/[#?]/)[0]));

  /**
   * The files that link pages by a typed path on 28 September 2026 (G1), and how many such links each has. Code links a
   * page with href(id, hash) from lib/nav.ts, so a mistyped id fails `tsc`: these may only lose typed paths, and every
   * other file (new components, primitives and content modules) has none. content/routes/** is the registry itself.
   */
  const typedPathsToday: Record<string, number> = {
    "app/(legal)/acceptable-use/page.tsx": 2,
    "app/(legal)/privacy/page.tsx": 1,
    "app/(legal)/security/page.tsx": 1,
    "app/(legal)/terms/page.tsx": 2,
    "app/ai-built-apps/page.tsx": 7,
    "app/checks/page.tsx": 9,
    "app/compare/page.tsx": 3,
    "app/demo/page.tsx": 10,
    "app/docs/page.tsx": 9,
    "app/faq/page.tsx": 1,
    "app/how-it-works/page.tsx": 7,
    "app/llms-full.txt/route.ts": 1,
    "app/not-found.tsx": 2,
    "app/open-source/page.tsx": 3,
    "app/page.tsx": 10,
    "components/ai-built/data.ts": 2,
    "components/compare/data.ts": 2,
    "components/consent/consent.tsx": 1,
    "components/faq/data.ts": 22,
    "components/legal/pages.ts": 5,
    "components/logo.tsx": 1,
    "components/oss/open-source.ts": 2,
    "components/site-footer.tsx": 1,
    "lib/site.ts": 9,
    "lib/structured-data.ts": 1,
  };

  /**
   * The modules G3 moves into content/ (the design's §5.4 G3, a mechanical move): each keeps the allowance of the file
   * it came from, so the move changes no link.
   */
  const movedTo: Record<string, string> = {
    "content/faq.ts": "components/faq/data.ts",
    "content/legal.ts": "components/legal/pages.ts",
    "content/ai-built.ts": "components/ai-built/data.ts",
    "content/compare.ts": "components/compare/data.ts",
    "content/open-source.ts": "components/oss/open-source.ts",
  };
  /** How many typed paths a file may keep: its own count on 28 September 2026, or the count of the file it moved from. */
  const allowance = (name: string): number | undefined => typedPathsToday[movedTo[name] ?? name];

  test("a module G3 moves into content/ keeps the allowance of the file it came from", () => {
    assert.equal(allowance("content/faq.ts"), 22);
    assert.equal(allowance("content/legal.ts"), 5);
    assert.equal(allowance("content/ai-built.ts"), 2);
    assert.equal(allowance("content/compare.ts"), 2);
    assert.equal(allowance("content/open-source.ts"), 2);
    assert.equal(allowance("components/faq/data.ts"), 22);
    assert.equal(allowance("content/home.ts"), undefined, "a new module has none");
    for (const from of Object.values(movedTo)) assert.ok(from in typedPathsToday, from);
  });

  test("every internal href in src/ is a RouteId: typed paths only in today's files, and only ever fewer", () => {
    const now: Record<string, number> = {};
    for (const file of sourceFiles(srcDir, ["ts", "tsx", "mdx"])) {
      const name = relative(srcDir, file);
      if (name.startsWith("content/routes")) continue;
      const found = pageLiterals(readFileSync(file, "utf8"));
      if (found.length > 0) now[name] = found.length;
    }
    const newFiles = Object.keys(now).filter((name) => allowance(name) === undefined);
    assert.deepEqual(newFiles, [], "link pages with href(id, hash) from lib/nav.ts, not a typed path");
    for (const [name, count] of Object.entries(now)) {
      const allowed = allowance(name) ?? 0;
      assert.ok(count <= allowed, `${name}: ${count} typed paths, ${allowed} before; use href(id, hash)`);
    }
    const total = Object.values(now).reduce((sum, n) => sum + n, 0);
    const before = Object.values(typedPathsToday).reduce((sum, n) => sum + n, 0);
    assert.ok(total <= before, `${total} typed paths in src/, ${before} before`);
  });

  test("a mistyped id fails tsc (next build type-checks this file)", () => {
    // Each line below is a type error, and @ts-expect-error fails the build when it isn't: if RouteId ever widened to
    // string (a plain CheckPageSummary[] passed to checkPageRoutes() makes it `check-${string}`), a typo would compile.
    // @ts-expect-error a mistyped id is not a RouteId
    const typo = () => href("chekcs");
    // @ts-expect-error no such check page
    const noCheck = () => href("check-not-a-check");
    void typo;
    void noCheck;
    assert.equal(href("checks", "double-submit"), "/checks/#double-submit");
  });

  test("the ratchet sees a typed path in code, not in a comment or in a served file's link", () => {
    const code = [
      "/** Example: { name: \"Home\", path: \"/\" } */",
      "// see href=\"/docs/\"",
      "{/* <a href=\"/faq/\">FAQ</a> */}",
      "<a href=\"/llms.txt\">llms.txt</a>",
      "const github = \"https://github.com/x\"; // href=\"/nope/\"",
      "<Link href=\"/checks/\">Checks</Link>",
    ].join("\n");
    assert.deepEqual(pageLiterals(code), ["/checks/"]);
  });
});
