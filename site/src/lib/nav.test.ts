// lib/nav.ts: every navigation and page list, derived from the route registry (content/routes.ts). `pnpm test`.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

process.env.NEXT_PUBLIC_SITE_URL = "https://run-hound.example";
const { site } = await import("@/lib/site");
const { hasRoute, route, routes } = await import("@/content/routes");
const {
  breadcrumbTrail,
  bugFormUrl,
  docsSidebar,
  footerColumns,
  headerLinks,
  href,
  isCurrentHub,
  llmsLinks,
  prevNext,
  registryManifest,
  resolveTarget,
  searchableRoutes,
  sitemapEntries,
} = await import("@/lib/nav");

describe("header", () => {
  test("five hubs in order: Docs, Checks, Demo, AI-built apps, Open source", () => {
    assert.deepEqual(headerLinks(), [
      { href: "/docs/", label: "Docs" },
      { href: "/checks/", label: "Checks" },
      { href: "/demo/", label: "Demo" },
      { href: "/ai-built-apps/", label: "AI-built apps" },
      { href: "/open-source/", label: "Open source" },
    ]);
  });

  test("a hub is current on its own page and every page under it", () => {
    assert.equal(isCurrentHub("/docs/", "/docs/"), true);
    assert.equal(isCurrentHub("/docs/quick-start/", "/docs/"), true);
    assert.equal(isCurrentHub("/checks/double-submit/", "/checks/"), true);
    assert.equal(isCurrentHub("/checks/", "/docs/"), false);
    assert.equal(isCurrentHub("/", "/docs/"), false);
    // Next.js's usePathname() has no trailing slash.
    assert.equal(isCurrentHub("/docs", "/docs/"), true);
    assert.equal(isCurrentHub("/docs/quick-start", "/docs/"), true);
  });
});

describe("footer (§3.3): 22 links in four columns, in this order on every page", () => {
  const columns = footerColumns();

  test("columns", () => {
    assert.deepEqual(
      columns.map((c) => c.label),
      ["Product", "Docs", "Project", "Legal"],
    );
    assert.equal(columns.flatMap((c) => c.links).length, 22);
  });

  test("Product", () => {
    assert.deepEqual(columns[0].links, [
      { href: "/how-it-works/", label: "How it works" },
      { href: "/checks/", label: "Checks" },
      { href: "/demo/", label: "Demo" },
      { href: "/ai-built-apps/", label: "Testing AI-built apps" },
      { href: "/compare/", label: "How it compares" },
      { href: "/faq/", label: "FAQ" },
    ]);
  });

  test("Docs: today's /docs/ sections until the docs pages exist, each page once it is registered", () => {
    // D1 registers the docs pages (content/routes/docs.ts); each link switches to its page by itself.
    const page = (id: string, fallback: string) => (hasRoute(id) ? route(id as never).path : fallback);
    assert.deepEqual(columns[1].links, [
      { href: page("docs-quick-start", "/docs/#quick-start"), label: "Quick start" },
      { href: page("docs-your-app", "/docs/#your-app"), label: "Test your app" },
      { href: page("docs-signed-in-runs", "/docs/#accounts"), label: "Signed-in runs" },
      { href: page("docs-ai", "/docs/#ai"), label: "Optional AI" },
      { href: page("docs-cli", "/docs/#report"), label: "CLI and CI" },
      { href: page("docs-troubleshooting", "/docs/#problems"), label: "Troubleshooting" },
    ]);
    if (!routes.some((r) => r.docs)) assert.ok(columns[1].links.every((l) => l.href.startsWith("/docs/#")));
  });

  test("Project", () => {
    assert.deepEqual(columns[2].links, [
      { href: "/open-source/", label: "Open source" },
      { href: "/open-source/#roadmap", label: "Roadmap" },
      {
        // #how-to-help once the open-source page promises it (content/routes/project.ts), #contributing before.
        href: route("open-source").anchors.includes("how-to-help") ? "/open-source/#how-to-help" : "/open-source/#contributing",
        label: "How to help",
      },
      { href: site.changelog, label: "Changelog", external: true },
      { href: site.github, label: "GitHub", external: true },
      { href: bugFormUrl, label: "Report a bug", external: true },
    ]);
    assert.equal(bugFormUrl, `${site.github}/issues/new?template=bug.yml`);
  });

  test("Legal", () => {
    assert.deepEqual(columns[3].links, [
      { href: "/privacy/", label: "Privacy" },
      { href: "/terms/", label: "Terms" },
      { href: "/acceptable-use/", label: "Acceptable use" },
      { href: "/security/", label: "Security" },
    ]);
  });
});

describe("links to pages that come later", () => {
  const registry = [
    { id: "docs", path: "/docs/", anchors: ["quick-start"] },
    { id: "open-source", path: "/open-source/", anchors: ["contributing"] },
  ];

  test("a registered page wins; until then the fallback (a section of an existing page)", () => {
    const quickStart = { to: "docs-quick-start", fallback: { to: "docs", hash: "quick-start" } } as const;
    assert.equal(resolveTarget(quickStart, registry), "/docs/#quick-start");
    assert.equal(
      resolveTarget(quickStart, [...registry, { id: "docs-quick-start", path: "/docs/quick-start/", anchors: [] }]),
      "/docs/quick-start/",
    );
  });

  test("an anchor the page doesn't promise yet falls back too", () => {
    const howToHelp = { to: "open-source", hash: "how-to-help", fallback: { to: "open-source", hash: "contributing" } } as const;
    assert.equal(resolveTarget(howToHelp, registry), "/open-source/#contributing");
    assert.equal(
      resolveTarget(howToHelp, [{ id: "open-source", path: "/open-source/", anchors: ["contributing", "how-to-help"] }]),
      "/open-source/#how-to-help",
    );
  });

  test("a target with no page and no fallback is an error, not a dead link", () => {
    assert.throws(() => resolveTarget({ to: "nowhere" }, registry), /no route "nowhere"/);
  });

  test("href() builds a registry page's link", () => {
    assert.equal(href("docs"), "/docs/");
    assert.equal(href("checks", "double-submit"), "/checks/#double-submit");
    assert.equal(href("home"), "/");
  });
});

describe("breadcrumbs, docs sidebar and prev/next", () => {
  test("a top-level page: Home, then the page", () => {
    assert.deepEqual(breadcrumbTrail("home"), [{ name: "Home", path: "/" }]);
    assert.deepEqual(breadcrumbTrail("docs"), [
      { name: "Home", path: "/" },
      { name: "Docs", path: "/docs/" },
    ]);
    assert.deepEqual(breadcrumbTrail("ai-built-apps"), [
      { name: "Home", path: "/" },
      { name: "AI-built apps", path: "/ai-built-apps/" },
    ]);
  });

  test("the trails the pages render today", () => {
    const today: Record<string, string> = {
      "how-it-works": "How it works",
      checks: "Checks",
      demo: "Demo",
      docs: "Docs",
      "open-source": "Open source",
      "ai-built-apps": "AI-built apps",
      faq: "FAQ",
      compare: "Compare",
      privacy: "Privacy",
      terms: "Terms",
      "acceptable-use": "Acceptable use",
      security: "Security",
    };
    for (const [id, name] of Object.entries(today)) assert.equal(breadcrumbTrail(id as never).at(-1)?.name, name, id);
  });

  test("the sidebar holds exactly the routes with a docs slot (none yet at G1), and prev/next follows it", () => {
    const docsPages = routes.filter((r) => r.docs);
    const sidebar = docsSidebar();
    if (docsPages.length === 0) {
      assert.deepEqual(sidebar, []);
      assert.deepEqual(prevNext("docs"), {});
    }
    const order = sidebar.flatMap((g) => g.links.map((l) => l.href));
    assert.deepEqual([...order].sort(), docsPages.map((r) => r.path).sort());
    for (const [i, path] of order.entries()) {
      const r = routes.find((x) => x.path === path)!;
      assert.equal(prevNext(r.id as never).prev?.href, order[i - 1], `${path}: previous`);
      assert.equal(prevNext(r.id as never).next?.href, order[i + 1], `${path}: next`);
    }
  });
});

describe("sitemap, llms.txt, search and the scripts' manifest", () => {
  test("the sitemap lists every indexable page (today's 13, 51 at release) with its date and priority", () => {
    const entries = sitemapEntries();
    assert.deepEqual(
      entries.map((e) => e.path),
      routes.filter((r) => r.indexable).map((r) => r.path),
    );
    for (const path of ["/", "/how-it-works/", "/checks/", "/demo/", "/docs/", "/open-source/", "/ai-built-apps/", "/faq/", "/compare/", "/privacy/", "/terms/", "/acceptable-use/", "/security/"]) {
      assert.ok(entries.some((e) => e.path === path), path);
    }
    const byPath = Object.fromEntries(entries.map((e) => [e.path, e]));
    assert.deepEqual(byPath["/"], { path: "/", lastModified: site.releasedIso, priority: 1 });
    assert.equal(byPath["/security/"].lastModified, site.legalUpdatedIso);
    assert.equal(byPath["/security/"].priority, 0.4);
    assert.equal(byPath["/privacy/"].priority, 0.3);
    assert.equal(byPath["/faq/"].priority, 0.7);
    assert.equal(byPath["/docs/"].priority, 0.8);
    assert.ok(!entries.some((e) => e.path === "/_design/"));
  });

  test("llms.txt: the site's pages in the Site, Project and Optional lists, in their order", () => {
    // Docs and check pages that later work lists in llms.txt come in between; today's keep their order.
    const later = (path: string) => /^\/(docs|checks)\/[^/]+\/$/.test(path);
    assert.deepEqual(
      llmsLinks("Site")
        .map((l) => l.path)
        .filter((path) => !later(path)),
      ["/docs/", "/how-it-works/", "/checks/", "/ai-built-apps/", "/faq/", "/compare/", "/demo/"],
    );
    assert.deepEqual(
      llmsLinks("Project").map((l) => l.path),
      ["/open-source/"],
    );
    assert.deepEqual(
      llmsLinks("Optional").map((l) => [l.name, l.path]),
      [
        ["Security", "/security/"],
        ["Acceptable use", "/acceptable-use/"],
        ["Privacy", "/privacy/"],
        ["Terms of use", "/terms/"],
      ],
    );
  });

  test("llms.txt names and notes come from the registry's titles and descriptions, never a copy of them", () => {
    // A title or description changed in the registry changes llms.txt with it.
    for (const r of routes) {
      if (!r.llms) continue;
      assert.notEqual((r.llms as { note?: string }).note, r.description, `${r.id}: leave the note out to use the description`);
      assert.ok(["title", undefined].includes((r.llms as { name?: string }).name), `${r.id}: name "title", or none for the label`);
    }
    const byPath = (list: "Site" | "Project" | "Optional") => Object.fromEntries(llmsLinks(list).map((l) => [l.path, l]));
    const site = byPath("Site");
    const ai = routes.find((r) => r.id === "ai-built-apps")!;
    assert.deepEqual(site["/ai-built-apps/"], { name: ai.title, path: ai.path, note: ai.description });
    const compare = routes.find((r) => r.id === "compare")!;
    assert.equal(site["/compare/"].name, compare.title);
    assert.ok(site["/compare/"].note.startsWith(`${compare.description} Capabilities only, as of release `), site["/compare/"].note);
    const faq = routes.find((r) => r.id === "faq")!;
    assert.deepEqual(site["/faq/"], { name: faq.label, path: faq.path, note: faq.description });
    const terms = routes.find((r) => r.id === "terms")!;
    assert.deepEqual(byPath("Optional")["/terms/"], { name: terms.title, path: terms.path, note: terms.description });
  });

  test("search: every indexable page but the 4 legal ones (9 today, 47 at release), with its result group", () => {
    const searchable = searchableRoutes();
    assert.equal(searchable.length, routes.filter((r) => r.indexable).length - 4);
    assert.ok(searchable.every((r) => ["Docs", "Check", "FAQ", "Page"].includes(r.group)));
    assert.deepEqual(
      searchable.find((r) => r.path === "/faq/"),
      { path: "/faq/", group: "FAQ" },
    );
  });

  test("the manifest the build scripts read is plain data covering every route", () => {
    const manifest = registryManifest();
    assert.equal(manifest.routes.length, routes.length);
    const faq = manifest.routes.find((r) => r.path === "/faq/");
    assert.ok(faq);
    assert.equal(faq.title, "FAQ: UI testing for AI-built apps · Run Hound");
    assert.deepEqual(faq.trail, breadcrumbTrail("faq"));
    assert.equal(faq.indexable, true);
    assert.equal(faq.search, "FAQ");
    assert.deepEqual(faq.webPage, { type: "FAQPage", name: faq.title, dated: true });
    assert.deepEqual(faq.anchors, [...route("faq").anchors]);
    const design = manifest.routes.find((r) => r.path === "/_design/");
    assert.equal(design?.indexable, false);
    assert.equal(design?.search, false);
    assert.deepEqual(JSON.parse(JSON.stringify(manifest)), manifest);
  });
});

describe("dates", async () => {
  const { lastModified } = await import("@/lib/nav");
  test("a page is dated by the release, the legal pages' date, or its own ISO date (a docs page's lastmod)", () => {
    assert.equal(lastModified({ lastmod: "release" }), site.releasedIso);
    assert.equal(lastModified({ lastmod: "legal" }), site.legalUpdatedIso);
    assert.equal(lastModified({ lastmod: "2026-09-20" }), "2026-09-20");
  });
});
