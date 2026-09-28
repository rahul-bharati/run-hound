# Run Hound site redesign: research brief

Written 2026-09-27 for the maintainer and whoever builds the redesign. It turns the research in this folder into one set
of decisions: what to build, in what order, and what is still open.

- **Site:** `<redesign worktree>/site` (branch `site/redesign` at `f6534e1`, release 0.5.0,
  Next.js 16.3.5, React 19.2.8, Tailwind CSS 4.3.3). Live at https://run-hound.rahulbharati.com/ (release 0.5.0 when
  measured). The 0.6.0 working tree (`<repository>`, branch `feat/0.6.0`) already changes three site
  files: `checks/data.ts`, `faq/data.ts` and `lib/site.ts` (version 0.6.0, 26 checks; `git status --short site/`).
- **Inputs:** 12 reports in this folder, all written 2026-09-27: `inventory.md`, `oss-homepages.md`, `readability.md`,
  `navigation.md`, `seo-ia.md`, `trust-contribution.md`, `motion-design.md`, `gsap-engineering.md`, then the follow-ups
  `accessibility.md`, `content-architecture.md`, `measurement.md` and `followup-reconcile-homepage-spec.md` (with its
  one-page `reconciled-spec.md`). `followup-a11y-nav-motion.md`, `followup-content-architecture.md` and
  `followup-measurement-budgets.md` are byte-identical copies of the three follow-ups (same md5). The critic's 20
  contradictions are settled in Appendix A.
- **Citations:** `report.md:line` points into this folder; `path:line` without a report name points into the site
  worktree unless it says otherwise. Every number below was measured on 2026-09-27 by the script the cited report names,
  in Chromium only (Playwright 1.63), in lab conditions. External sources and their dates are in Appendix B.
- **Nothing in either repository was changed.**

---

## 0. Decisions at a glance

| # | Topic | Decision | Deciding evidence |
|---|---|---|---|
| 1 | Homepage length | 8 blocks (hero + 7 h2 bands), **≤ 750 words in `<main>`** as a build failure; ≤ 7 desktop and ≤ 10 phone screens as targets | Today 3,885 words by this method, 21.1 / 33.7 screens; the prototype is 749 words, 6.0 / 11.0 screens (followup-reconcile-homepage-spec.md:35-37, 238-253) |
| 2 | Hero | Text left; right, the server-rendered finished run (Kennel's double-submit finding) that a lazy GSAP island plays once. Static frame as fallback | h1 stays the LCP at 764-776 ms; a screenshot hero pushes LCP to 1,484-1,856 ms (followup-reconcile-homepage-spec.md:119-144) |
| 3 | Header | `Docs · Checks · Demo · AI-built apps · Open source`, then Search (phase 2), `v0.6.0` chip, GitHub, **Try it locally** | Demo and Open source are hidden on desktop today (`site-header.tsx:11`); the full bar needs 1,120 px, so a compact form from 1024 to 1279 px (followup-reconcile-homepage-spec.md:355-367) |
| 4 | Primary CTA | Keep the label "Try it locally", point it **on the site**: `/docs/#quick-start` now, `/docs/quick-start/` in phase 2 | It opens an 8,850-word `TESTING.md` on GitHub today (navigation.md:26-28) |
| 5 | Facts vs tabs | Every sentence is visible by default; one tablist on the homepage, and it switches pictures only; hidden words count against the budget | Bing: AI systems may skip hidden content (seo-ia.md:137); 600 hidden words today, 0 in the prototype (followup-reconcile-homepage-spec.md:418-422) |
| 6 | "Why now" statistics | Stay, as the first band under the hero, cut from 126 to 48 words; first band to cut if words must go | Problem-first stories work best for early products (oss-homepages.md:338); sourced statistics help answer engines (seo-ia.md:248) |
| 7 | Docs | Split one 8,047-word page into a hub plus 11 pages in phase 2, as MDX in `site/` | inventory.md:46-47; content-architecture.md:30-34, 225-240; slugs settled in followup-reconcile-homepage-spec.md:434-454 |
| 8 | URLs | No page URL changes in phases 1-3; old `/docs/#anchor` ids live on as cards on the docs hub; the only server redirect is `/contribute/` → `/open-source/contributing/` (308) | Fragments never reach the server (navigation.md:640-642); Google site-move rules (seo-ia.md:214-219) |
| 9 | Footer | A 4-column doormat of about 23 links, 2 columns on phones, target ≤ 800 px tall (1,412 px today) | URL count grows 13 → 24 → 51, past NN/g's 25-page sitemap-footer limit (followup-reconcile-homepage-spec.md:497-512) |
| 10 | Motion | One narrative moment (the hero run, about 4 s, plays once); everything else is CSS micro-interaction; text is never animated | 16 of 32 peer first viewports are still, GSAP ships on 2 of 32 (oss-homepages.md:33-39); a11y tests in accessibility.md:54-68 |
| 11 | GSAP loading | Only `gsap` core + `@gsap/react`, only in `src/motion/`, only after `load` plus idle, only when motion is allowed and Save-Data is off. No ScrollTrigger, no SplitText | Static import costs +47.8 KB gzip initial JS (gsap-engineering.md:19); `next/dynamic` alone still delays the phone load event by 183 ms (measurement.md:669-692); ScrollTrigger keeps a 64/s rAF loop (gsap-engineering.md:22) |
| 12 | Reduced motion | Keep the global 0.01 ms rule, add token collapse on top; GSAP is never downloaded under reduce; drop `html { scroll-behavior: smooth }` | accessibility.md:491-529 |
| 13 | Evidence GIFs | Re-encode both with `ffmpeg -loop -1` **now** (play once, rest on the proof frame) | They loop forever, a WCAG 2.2.2 Level A failure; 10 frame changes in 14 s become 2 (followup-reconcile-homepage-spec.md:516-532) |
| 14 | Breadcrumbs | Keep BreadcrumbList on flat pages without a visible trail; show a visible trail on every nested page; the build checks they match | Five test files and `check-seo.mjs` depend on it (followup-reconcile-homepage-spec.md:470-493) |
| 15 | Check pages | 26 `/checks/<id>/` pages in phase 3, only once reports link each finding to them; never for the 73 catalog entries | Scaled-content policy (seo-ia.md:164-174); 0.6.0 has 26 checks (followup-reconcile-homepage-spec.md:497-499) |
| 16 | Contributing | `/open-source/contributing/`, live only after the contribution checklist holds; until then "How to help today" | followup-reconcile-homepage-spec.md:464-468; trust-contribution.md:287 |
| 17 | Content and code | One route registry, one facts module, one content folder; build guards for copy, links, anchors, budgets | 9 page lists in 5 files today (content-architecture.md:77-82); copy spread over 10 files for the homepage alone (inventory.md:183-195) |
| 18 | Measurement | Cloudflare Web Analytics is already live; record a baseline and verify Search Console and Bing **before** launch | measurement.md:28-53, 307-337 |
| 19 | Order | Fix the cheap failures now → release 0.6.0 → redesign phase 1 (homepage, header, footer, motion) before inviting alpha testers → docs split → check pages → contributions | followup-reconcile-homepage-spec.md:605-661 |

---

## 1. What readers told us, and what the measurements show

### 1.1 The feedback

Relayed by the maintainer: readers find the site "way too long to read", the homepage feels far too long, and they
want it cleaner and easier to navigate. That is one relayed source; no analytics shows reading behaviour yet (GA is not
configured live, and Cloudflare Web Analytics has no scroll or click events, measurement.md:36-38). Traffic is tiny:
3 GitHub views from 1 unique visitor in the 14 days to 2026-09-23, 3 stars, 31 image downloads (measurement.md:220-232).
The measurements below support the feedback strongly.

### 1.2 The homepage against peers

| Measure | Run Hound today | Peers | Source |
|---|---|---|---|
| Height, 1440×900 / 390×844 | **21.1 / 33.7 screens** (19,015 / 28,410 px) | Median 7.6 / 9.8 (31 OSS and devtool homepages); Playwright 3.3 / 6.1 | inventory.md:25-31; oss-homepages.md:118-124 |
| Words in `<main>` | **3,273 visible, 3,885 with hidden tab panels** (the chosen method) | Median 455, 75th percentile 810 (17 sites, same method) | readability.md:68-69; followup-reconcile-homepage-spec.md:275-277, 307-308 |
| Reading time at 238 wpm | 13.8 minutes | NN/g: people read about 20% of the words on a page | readability.md:77; inventory.md:29-31 |
| Sections | 13 h2, 41 h3, 4 tab widgets with 17 tabs, 23 images (15 inside tabs) | Median 5 h2 | inventory.md:28-29; oss-homepages.md:125 |
| Hero subhead | 91 words, 7 lines on desktop, 12 on a phone | Median 18 words | oss-homepages.md:18-24 |
| First viewport | 176 words (desktop), 130 (phone); no product visible; CTA top at 641 / 696 px | Median 104 / 67 words; most show the product | readability.md:70-73; oss-homepages.md:128-129 |
| Where the length comes from | Three release-stamped bands ("NEW IN 0.5.0", "NEW IN 0.4.0", "SINCE 0.3.0"): 7.9 desktop screens, 1,436 words | Release news is a one-line pill on 9 of 30 peers, never a section | oss-homepages.md:25, 151 |
| Order | The basic loop (plan, approve, run, report) starts 7.3 screens down; the problem statement is band 10 of 13, 17.1 screens down; trust starts about 13 screens down (20 on a phone) | 81% of viewing time falls in the first three screens (NN/g) | readability.md:97; oss-homepages.md:338; trust-contribution.md:14 |

Six reports counted Run Hound's words six ways (3,273 to 3,442) against six peer medians (455 to 1,233). The difference
is scope (`<main>` or the whole body) and sample (docs-first OSS sites or commercial product sites); only the 455 median
uses the method this brief adopts (followup-reconcile-homepage-spec.md:282-308).

### 1.3 Why it reads as long

1. **Volume.** 7.2 times the peer median in words (readability.md:344-346).
2. **Release-notes order.** Newest, preview-only features come first; the basic loop comes 7.3 screens later
   (readability.md:347-351).
3. **Repetition.** "Test accounts / signed-in runs" appears 78 times across 11 pages; 24.6% of How it works also appears
   elsewhere; the 279-word get-started block is on two pages verbatim; 65 sentences of 7+ words repeat word for word
   (inventory.md:37-43, 404-434).
4. **Insider terms.** "V2" 10 times, Kennel and Fernway 9 times, version numbers in eyebrows (readability.md:154-170).
5. **Typography.** Line lengths up to 115 characters, 17 text sizes, 29 uppercase mono labels, two long centred
   paragraphs (readability.md:172-184).
6. **Not the problem:** sentence difficulty. The page scores Flesch-Kincaid grade 7.3 and the check labels are already
   plain (readability.md:21, 369). Cut the amount; keep the voice.

### 1.4 The rest of the site

- **Docs** are one URL of 8,047 words, 37.4 desktop and 59.1 phone screens, with 14 code blocks and no copy buttons
  (inventory.md:46-47). **Checks** is 17.4 / 36.4 screens with 81 h3s and no table of contents (navigation.md:20-21).
- **Navigation hides half the site on desktop.** The header shows How it works, Checks and Docs, plus GitHub, Changelog
  and the CTA (`site-header.tsx:11`, inventory.md:314). Demo, Open source, FAQ, Compare and AI-built apps are
  footer-only. `/open-source/`, where contributing lives, is linked from one page's content (inventory.md:360).
- **The phone footer is 1,412 px** (1.7 screens) on every page (inventory.md:58).
- **Accessibility:** axe-core found 0 violations in 28 scans, but the phone menu doesn't close on Escape, 4 of 8 menu
  links are unreachable at 400% zoom, the homepage overflows at 320 px (+12 px from nowrap tab labels), the two evidence
  GIFs loop forever next to text (WCAG 2.2.2, Level A), and smooth scrolling leaves focused elements off-screen while
  they scroll into view (accessibility.md:18-35, 72-74, 305-311).
- **Performance is fine and must stay fine:** lab LCP 0.77-0.89 s locally, CLS 0; initial JS 149.8-152.2 KB gzip, almost
  all framework (measurement.md:584-622). The homepage HTML is 398 KB raw because the RSC payload roughly doubles the
  copy (inventory.md:68-70).
- **Trust gaps:** no `SECURITY.md`, so GitHub shows the product-safety page `docs/security.md` as the security policy;
  community profile 57%; OpenSSF Scorecard 4.7/10; no GitHub Releases; secret scanning, push protection and Dependabot
  off; no ruleset on `main`; Discussions off (trust-contribution.md:15-18, 146-160). The issue forms still say 0.5.0
  after the version bump (`.github/ISSUE_TEMPLATE/bug.yml:15-16`, `feedback.yml:2, 45-46`, `config.yml:5` in the 0.6.0
  tree, checked today).
- **GEO:** Cloudflare answers GPTBot, ClaudeBot, PerplexityBot and CCBot with 403 although `robots.txt` allows them; the
  README doesn't link the site; 45 deep links in `llms-full.txt` are fragments, which Google doesn't treat as pages
  (seo-ia.md:19, 104-110).
- **Analytics exists:** Cloudflare injects Web Analytics at the edge (only for `Accept: text/html`, which is why a
  plain curl missed it). It gives page views, paths, referrers and field LCP/INP/CLS, but no events and 6 months of
  retention. Bot Fight Mode adds an inline script that the hash CSP blocks, so every page logs one CSP error
  (measurement.md:28-44, 143-199).

### 1.5 What works and stays

Counts derived from data, `site.ts` as the facts module, tested data modules, 629 comment lines, only 5 client
components (inventory.md:616-621); per-page CSP by hash, strict SEO guard, JSON-LD on every page, `llms.txt`, warmed
images, `display: optional` fonts, skip link, 44 px targets, accessible tabs and copy button (inventory.md:625-647).

---

## 2. Principles for the new site

| # | Principle | Evidence |
|---|---|---|
| P1 | **The homepage is a pitch and a router, not a summary.** It answers what, for whom, why believe it and what next, then sends each topic one level down. Two levels of disclosure, never three. | 11 of 14 homepage blocks restate other pages (inventory.md:32-36); NN/g: 57% of viewing time above the fold, 74% in two screens, 81% in three; more than 2 disclosure levels "typically have low usability" (readability.md:210-214, 240-244) |
| P2 | **Budgets are enforced by the build, not by taste.** Words, sentence length, tablists and bytes fail CI when exceeded. | Six lenses produced six word counts and four budgets until one method was fixed (followup-reconcile-homepage-spec.md:261-317); the SEO guard already works this way (inventory.md:631) |
| P3 | **Proof, not adjectives.** Lead with the real run, the real finding and its evidence. No invented numbers, no star counter, no logos, no testimonials until they are real and linked. | brand.md:50, 59; NN/g: low social-proof numbers make people dismiss a product (oss-homepages.md:251); about 6M suspected fake GitHub stars, a liability after two months (trust-contribution.md:36); FTC rule on fake social proof (trust-contribution.md:37) |
| P4 | **Every fact is server-rendered, visible text.** Tabs and accordions hold pictures, never the only copy of a sentence. | Google won't click to load content; the major AI crawlers don't run JavaScript; Bing: don't hide answers in tabs (seo-ia.md:135-141) |
| P5 | **Motion shows the product working or confirms an action. Text never waits for it.** One story per page, under 5 seconds, played once. | NN/g: animate for feedback and state, 100-400 ms, avoid scroll-triggered text (readability.md:334-338); opacity-0 elements are not LCP candidates (inventory.md:637); WCAG 2.2.2; peers use GSAP-class motion for one demonstrative thing (oss-homepages.md:390) |
| P6 | **Nothing is hidden on desktop, and the main journey stays on the site.** Every hub is one click from the header; the CTA lands on an on-site quick start. | NN/g: hidden desktop navigation used in 27% of cases against 48-50% for visible (navigation.md:299-302); CTA leaves for an 8,850-word GitHub file (navigation.md:26-28) |
| P7 | **One source per fact, derived everywhere.** A page list, a command, a principle or a release number is written once. | 4 install-command definitions, principles 3 vs 4 items, "can't see" 5 vs 4, 117 hard-coded release numbers (inventory.md:436-446, 612-613) |
| P8 | **Trust comes from things a visitor can verify.** Licence, a findable security policy, dated releases, a named maintainer, honest limits, reproducible demos. | Google: trust "is most important", who/how/why; OpenSSF's evaluation guide; NN/g upfront disclosure (trust-contribution.md:30-40) |
| P9 | **Move, don't delete; keep every URL and anchor.** | 13 URLs in the live sitemap, 45 fragment URLs in `llms-full.txt`, the GitHub homepage field points at `/` (seo-ia.md:110, 378-384) |
| P10 | **Accessibility is measured on every change, and Run Hound tests its own site.** | axe 0 violations but four real failures found by prototypes and by Run Hound itself (accessibility.md:18-35, 75-81) |
| P11 | **Performance stays at the framework floor.** Page-specific JS ≤ 5 KB; motion is lazy and never on the critical path. | Initial JS floor 149.8 KB; the site's own code adds 0-2.5 KB (measurement.md:606-611) |
| P12 | **Calm is part of the brand.** The quietest peers (Playwright 3.3 screens, Biome 7.6) are docs-first OSS projects. | motion-design.md:689-691; brand.md:50 |

---

## 3. Information architecture

### 3.1 Header

| Width | Layout | Notes |
|---|---|---|
| ≥ 1280 px | `[Logo] Docs · Checks · Demo · AI-built apps · Open source   [Search Ctrl K] [v0.6.0] [GitHub] [Try it locally]` | Fits with 16 px to spare (`data/spec-header-fit.txt`). Search arrives with phase 2. The chip links the changelog and replaces the "Changelog" text link. `aria-current` on the active item ("Docs" for every `/docs/*`). |
| 1024-1279 px | Same items: Search as a 44 px icon button, no chip, GitHub as a labelled 44 px icon, 20 px between labels | Computed need about 870 of 880 px at 1024 (followup-reconcile-homepage-spec.md:363-367). Never hide a content item. |
| < 1024 px | Logo, search icon (phase 2), Menu | Menu is a `<button aria-expanded aria-controls>` panel: the 5 items, then GitHub, Changelog, CTA. Escape closes it and returns focus; focus leaving closes it; `max-height: calc(100dvh - header)` with `overflow-y: auto` (accessibility.md:285-298, 324-326). |

Fixes that come with it (accessibility.md:701-724): the new header overflows at 320 px by 8 px (hide the wordmark or
shrink gaps below about 360 px); nothing in the translucent bar may use `text-dim` (the "Ctrl K" hint measured 3.83:1);
the Search button's accessible name comes from its visible text ("Search Ctrl K"), with
`aria-keyshortcuts="Control+K Meta+K"`; no "/" shortcut (WCAG 2.1.4); the chip gets `min-h-6`. The bar turns opaque on
scroll (border and background, 200 ms).

How it works leaves the header for AI-built apps, the page for the main non-brand search intent ("vibe coded app
security", "is lovable secure", seo-ia.md:259-262). It stays one click from the homepage ("How it works in detail →"),
the footer and the docs hub. **Confirm with the tree test** (§9, D4).

### 3.2 Page map

| Phase | Adds | Indexable URLs |
|---|---|---|
| 1: homepage, header, footer, motion | Nothing. Every URL and `#id` keeps working. | 13 |
| 2: docs split, search | `/docs/` hub + `quick-start`, `install`, `test-lab`, `your-app`, `signed-in-runs`, `ai`, `report`, `cli`, `safety`, `troubleshooting`, `limitations` | 24 |
| 3: reference | `/checks/<id>/` for the 26 built-in checks (once reports link to them), `/docs/glossary/` | 51 |
| 4: community | `/open-source/contributing/` (+ `/contribute/` 308); at most 3 `/compare/<tool>/` pages with first-hand material | 52-55 |

```
/                          Home: pitch and router (≤ 750 words)
/docs/                     Docs hub: ~150 words + cards; every old #id sits on a card     [header]
  quick-start/  install/  test-lab/  your-app/                                            Get started
  signed-in-runs/  ai/                                                                    Guides
  report/  cli/  safety/  limitations/                                                    Reference
  troubleshooting/                                                                        Help
  glossary/                (phase 3, Run Hound's own terms only)
/checks/                   Checks hub, canonical reference; cards keep id="<check-id>"    [header]
  <check-id>/              phase 3, 26 pages, ids as in reports and the CLI
/demo/                     Real findings with evidence                                    [header]
/ai-built-apps/            Search landing page for Lovable, Bolt and v0 apps; #discovery  [header]
/open-source/              Licence, open core, roadmap, test apps and scoring, maintainer,
                           stability note, how to help, privacy promise                  [header]
  contributing/            phase 4
/how-it-works/  /compare/  /faq/                                                          [footer]
/privacy/  /terms/  /acceptable-use/  /security/                                          [footer]
/sitemap.xml  /robots.txt  /llms.txt  /llms-full.txt  /.well-known/security.txt (new)
```

URL rules (seo-ia.md:386-391): lower case, at most two levels, trailing slash, stable ids rather than keyword slugs, no
versions or stage names. One canonical page per topic: "Apps from AI builders" lives only at `/ai-built-apps/`, the check
list only at `/checks/`.

### 3.3 Redirects and moved anchors

No page URL moves in phases 1 to 3, so there are no redirects to add until phase 4. Fragments can't be redirected, so
each old docs id stays as an `id` on the matching card of the docs hub, and every internal link is updated in the same
change (25 of them, navigation.md:645-662). `check-registry.mjs` fails the build if a promised anchor disappears
(content-architecture.md:154-169).

| Old | New | How | Phase |
|---|---|---|---|
| `/docs/#overview` | `/docs/` | hub intro | 2 |
| `/docs/#quick-start` | `/docs/quick-start/` | hub card; JSON-LD `installUrl` updated (seo-ia.md:401) | 2 |
| `/docs/#requirements` | `/docs/install/#requirements` | hub card | 2 |
| `/docs/#install` | `/docs/install/#from-source` (119 words, too thin for a page) | hub card | 2 |
| `/docs/#kennel` | `/docs/test-lab/` | hub card | 2 |
| `/docs/#your-app` | `/docs/your-app/` (one section per OS for `host.docker.internal`) | hub card | 2 |
| `/docs/#accounts` | `/docs/signed-in-runs/`; the access, mass-assignment, CSRF, write-access and paywall-trust explanations move to `/checks/` | hub card | 2 |
| `/docs/#ai-built` | `/ai-built-apps/#discovery` (no `/docs/discovery/`) | hub card | 2 |
| `/docs/#ai`, `#report`, `#safety`, `#limitations` | `/docs/ai/`, `/docs/report/` (with `#playwright-test`), `/docs/safety/`, `/docs/limitations/` | hub cards | 2 |
| `/docs/#problems`, `#feedback` | `/docs/troubleshooting/`, `/docs/troubleshooting/#feedback` (an h2 uses "host.docker.internal not working") | hub cards | 2 |
| `/docs/#checks` | `/checks/` | hub card | 2 |
| `/checks/#<id>` (26), `#catalog`, `#not-visible`, catalog ids | unchanged; in phase 3 each card also links `/checks/<id>/`; ItemList URLs move to the spokes | ids stay | 3 |
| Homepage `#start` | kept on the Start band | id | 1 |
| Homepage `#signed-in`, `#ai-built-apps`, `#see-it-run`, `#ai`, `#tools`, `#at-a-glance` | Keep each as an id on its replacement (signed-in card, AI-built band, How it works band, "AI is optional" item); drop `#tools` and `#at-a-glance` | ids | 1 |
| `/contribute/` | `/open-source/contributing/` | `redirects()`, `permanent: true` (308 in Next 16.3.5, seo-ia.md:221-224) | 4 |

The homepage section ids are linked from nowhere else in the site source (grep of `site/src` today; only `#start`,
from the hero). Any page removed later gets a 308 straight to its final URL, kept at least a year, never to `/`
(seo-ia.md:393-405).

### 3.4 Footer

A doormat, built from the route registry, about 23 links (followup-reconcile-homepage-spec.md:758-766):

| Product | Docs | Project | Legal |
|---|---|---|---|
| How it works | Quick start | Open source | Privacy |
| Checks | Test your app | Roadmap | Terms |
| Demo | Signed-in runs | How to help (→ Contributing once open) | Acceptable use |
| Testing AI-built apps | Optional AI | Changelog ↗ | Security |
| How it compares | CLI and CI | GitHub ↗ | Cookie settings |
| FAQ | Troubleshooting | Security policy ↗ | |

- In phase 1 the Docs column points at the current anchors ("CLI and CI" at `/docs/#report`, where exit codes live).
- Brand block: one sentence and the release line. Two columns on phones, never collapsed (NN/g, navigation.md:323-327).
  Target ≤ 800 px on a phone.
- Footer links use `prefetch={false}` (measurement.md:771-778). The help links keep the same order on every page
  (WCAG 3.2.6, accessibility.md:475-485).

### 3.5 Docs

- **Groups** (Diátaxis by need, no empty sections, navigation.md:363-371): Get started (quick-start, install, test-lab,
  your-app) · Guides (signed-in-runs, ai) · Reference (report, cli, safety, limitations, and a link out to `/checks/`) ·
  Help (troubleshooting). `/docs/cli/` ships in phase 2 because its content already exists (`docs/usage.md`, 579 words,
  followup-reconcile-homepage-spec.md:449). Median page about 450 words; no page over about 1,000.
- **Layout** (navigation.md:596-618; fixes from accessibility.md:701-724): ≥ 1280 px sidebar, content at 65-75ch,
  sticky "On this page"; 1024-1279 px sidebar plus an inline "On this page"; < 1024 px a 48 px docs bar with "Docs menu"
  and "On this page" disclosures anchored full width to the bar. Top: visible breadcrumb and "For release 0.6.0 · Edit
  this page on GitHub". Bottom: previous/next.
- **Two sticky bars need `scroll-padding-top` of header + docs bar + 16 px (136 px).** At today's 88 px, Shift+Tab hid
  focused links entirely (WCAG 2.4.11). Make both bars `position: static` when `max-height: 30rem` (400% zoom). Apply
  the anchor offset once: today `scroll-padding-top` and `scroll-margin-top` stack to 184 px (content-architecture.md:364-366).
- **Search** (phase 2): Pagefind 1.5.2 through its Node API at the end of `pnpm build`, into `public/pagefind`
  (navigation.md:666-714). Use a custom native `<dialog>`, not Pagefind's Component UI: the Component UI's result count is
  not announced in Chromium because its live region sits outside the modal, and it is 45× larger (accessibility.md:252-283;
  measurement.md:660-667). Ship the 0.9 KB dialog with the page, load Pagefind on open; first results 0.79 s after the
  last keystroke (measurement.md:644-667). `data-pagefind-body` on `<main>`; legal pages excluded.
- **Source:** MDX in `site/src/content/docs/` (§8.1). The repo guides `docs/install.md`, `usage.md`,
  `signed-in-runs.md` and `ai.md` become pointers to the site pages (content-architecture.md:325-343).

### 3.6 Breadcrumbs

BreadcrumbList stays on every inner page (removing it breaks `check-seo.mjs:16, 241-243, 263` and five tests). Flat
pages show no visible trail; docs pages, check pages and Contributing show one (`nav aria-label="Breadcrumb"`, current
item not a link, one line on phones), rendered from the same registry, and the build checks they match
(followup-reconcile-homepage-spec.md:470-493). Change `open-source.test.ts:66` to "its label in the nav registry",
because How it works leaves the header.

---

## 4. The homepage

### 4.1 Sections in order

Measured on the prototype with hero C2 and the 0.6.0 data (`data/spec-skeleton.json`;
followup-reconcile-homepage-spec.md:238-253, 724-745). Budgets are warnings per section; the page total is the hard gate.

| # | Heading | Purpose | Content | Words: budget / measured | Visual and motion | Height 1440 / 390 px |
|---|---|---|---|---|---|---|
| 0 | h1 "Find the bugs your AI forgot to test." | Say what it is, for whom, and what to do next in 5 seconds; show the product | Pill "0.6.0: write-side checks · ready for alpha testers →" (links `TESTING.md#for-alpha-testers`, which exists at `TESTING.md:7` in the 0.6.0 tree); 31-word subhead ("Run Hound is open-source, AI-assisted UI testing for apps built with Lovable, Bolt or v0. It tests a page in a real browser on your machine, with evidence for every finding."); **Try it locally →** / View on GitHub; the run command on one scrolling line with Copy; "Then open localhost:4000. Docker or Podman. Other ways to start"; proof strip of 4 linked facts: 26 checks, all open source · Runs on your machine · AI off by default · A Playwright test per finding | 115 / 114 | Right: the **hero run** window (§5.3), caption ≤ 15 words in sentence case. Copy micro-interaction | 816 / 1,569 (target about 1,350 with a compact phone window) |
| 1 | "AI builds fast. It ships holes too." | The problem, with sources | 45% (Veracode 2025), 95.9% (WebAIM Million 2026), 2,000+ (Escape.tech 2025), each linked; "The research behind these numbers →" | 50 / 48 | 3 static stat cards; no number tickers | 450 / 698 |
| 2 | "How it works: nothing runs until you approve" | The product loop and the safety promise | 4 visible steps (Plan, Approve, Run, Report), a bold title and one sentence each; "How it works in detail →" / "See real findings →" | 105 / 104 | One picture tablist (plan, approve, live run, the play-once double-submit recording); CSS crossfade; never auto-advances | 775 / 1,068 |
| 3 | "26 checks: accessibility, features and security" | Breadth, in plain outcomes | 3 group cards: count, one-line question, 4 example checks, "and N more"; Security shows "Another account can't read or change your data" and "A paid plan needs a real payment" (signed in); "See all 26 checks →" | 125 / 125 | Cards, hover border colour only | 779 / 1,351 |
| 4 | "Works on Lovable, Bolt and v0 apps." | The audience's stack and the newest capability | 23-word intro; 4 cards: Custom widgets · Forms in dialogs · Signed-in runs (Preview; email-first sign-in included) · Kept honest by Fernway; "Test a Lovable, Bolt or v0 app →" | 130 / 129 | Static cards | 643 / 1,056 |
| 5 | "Runs on your machine. Real checks decide." | Trust and safety | Local by default · Guard rails (checks that change data start unticked and put back what they change) · AI is optional · No evidence, no finding; link to safety | 105 / 102 | Static | 528 / 880 |
| 6 | "Free and open source. Start with one command." (`#start`) | Convert, and open the project | The run command; 3 lines (`host.docker.internal`, the test lab, the CLI in CI); Source on GitHub · Report a bug · Changelog · How to help; facts line: MIT · Docker or Podman · amd64 and arm64 · release and date | 105 / 101 | Command block with Copy and a next-step line | 599 / 742 |
| 7 | "Your AI said it's done. Let's check." | Close | One line and the two buttons | 30 / 26 | Button press states | 328 / 408 |
| | **`<main>` total** | | 7 h2, 11 h3, 1 tablist, 0 hidden words | **≤ 750 (fail) / 749** | One JS moment (the hero run) | 4,918 / 7,772 |

The prototype's AI-built h2 had 9 words; the 7-word version above respects the h2 budget. The headings read in order
carry the pitch on their own (NN/g's layer-cake pattern, readability.md:375-409), and the order matches both Evil
Martians' devtool pattern and GitHub's README checklist: what it does, why it matters, how to start, where to get help.

### 4.2 Total length

| | Desktop 1440×900 | Phone 390×844 |
|---|---|---|
| Today (same scripts as the prototype) | 21.2 screens | 33.8 screens |
| Prototype (unchanged footer) | **6.0** (5,413 px) | **11.0** (9,257 px) |
| Target | **≤ 7** | **≤ 10** |
| With the compact phone hero (about 1,350 px) and the ≤ 800 px footer | about 6.0 | **about 10.0 (computed, not measured)** |

The phone target is tight. If the built page lands above 10, cut words from band 1 first, then tighten section padding
(prototype `py-14 sm:py-20`). Measure with `scripts/spec-skeleton-measure.mjs` (reduced motion, one scroll pass).

### 4.3 Budgets the build enforces (`scripts/check-copy.mjs`)

- **Fail:** more than 750 words in `<main>` of the prerendered `index.html`, counting text in `[hidden]` panels, excluding
  `<script>`, `<style>`, `<svg>`, `aria-hidden` and `.sr-only`, with the regex `[\p{L}\p{N}][\p{L}\p{N}'’.:/_\-]*`. No
  browser needed; it agrees with the browser within 0.3% (followup-reconcile-homepage-spec.md:261-280).
- **Warn:** an h2 over 8 words; a section intro over 25 words; a sentence over 25 words; more than one tablist; any words
  in hidden panels. Per-section budgets are a `node:test` over `content/home.ts`, so sections can trade words while the
  page can't grow.
- The hero run's drawn text is `aria-hidden` with a visually hidden list beside it, so it counts like text in a
  screenshot: not at all.

### 4.4 What leaves the homepage, and where it goes

Signed-in details and the secrets box → `/docs/#accounts`, then `/docs/signed-in-runs/`; the AI section, providers and
"what is sent" → `/docs/#ai`; web UI, CLI and the safety gate → How it works and `/docs/#report`; "At a glance" → the top
of `/faq/` (facts stay in JSON-LD and `llms.txt`); 2 of the 5 evidence frames → `/demo/`; the test-lab command →
`/docs/#kennel`; version history → the changelog (readability.md:678-691; navigation.md:530-540). Those pages are long
too (`/docs/` 8,047 words), so they need the phase 2 split before they are good destinations.

### 4.5 Copy rules (add to `docs/brand.md` under Voice)

- Headings are statements, not questions, with the key noun or number in the first two words; h2 ≤ 8 words.
- Section intro ≤ 25 words; card title ≤ 5 words, body ≤ 22; sentences ≤ 20 words, never over 25; captions sentence case,
  ≤ 15 words; uppercase only for eyebrows of ≤ 3 words (readability.md:427-435, 719-726).
- Define Kennel and Fernway at first use, at most once each on the homepage.
- **Where stages and releases appear:** a plain "Preview" tag on the homepage and in page heroes; no "NEW IN 0.5.0" or
  "SINCE 0.3.0" labels; the release appears once in the pill and once in the footer; stage names (V0-V4) where the roadmap
  is explained, named as brand.md:54 says (followup-reconcile-homepage-spec.md:541-551).
- **"Vibe-coded" is a secondary term:** once in the first paragraph of `/ai-built-apps/`, in one of its h2s, in the FAQ
  question "Is my vibe-coded app secure?" and in quotes of sources; never in an h1, a title, the definition or the hero
  (followup-reconcile-homepage-spec.md:553-565).
- The same brand.md edit must move `write-access` and `paywall-trust` from "planned" to shipped: brand.md:54 still
  lists both as planned in the 0.6.0 tree, which ships them (`CHANGELOG.md:5-12` in `<repository>`).

---

## 5. The motion system

### 5.1 Rules (proposed "Motion" section for brand.md, followup-reconcile-homepage-spec.md:567-603)

1. **Purpose first.** Each animation orients, shows cause and effect, shows a run happening or gives feedback. One that
   can't name its purpose ships static (motion-design.md:278-288).
2. **Text never waits.** Headings, paragraphs and calls to action are visible at first paint; never faded, blurred,
   split or typed in. On gsap.com the heading was unreadable for over 3 s; on Linear it was still blurred at 1.5 s
   (motion-design.md:168-170).
3. **One story per page, played once**, under 5 seconds, then it rests on the finished state with Replay. Only really
   live status may keep moving (the running ring, the Live dot).
4. **Scroll triggers, never drives.** No scroll-jacking, pinning, parallax, smooth-scroll library or scrubbed text.
5. **Small and fast.** Only `transform` and `opacity`. Rises of 8-16 px; scale 0.96-1.04 (the evidence stamp's one
   landing from 1.15 is the exception).
6. **Frequent or keyboard-driven actions don't move things.** Arrow keys switch tabs at once; hover on repeated cards
   changes colour only.
7. **Interruptible.** Any click, key or scroll away skips to the end.
8. **Accent rules apply to motion:** one accent-coloured thing moves at a time; running = accent ring, pass = accent,
   fail and high = `fail` (brand.md:28-29).
9. **The finished state is the default** for no JavaScript, crawlers, screenshot tools and reduced motion.
10. **Real numbers only.** Nothing counts up on the homepage.

brand.md:3 makes one brand cover the site, the local web UI and reports, so the section applies to all three; the local
UI already follows it (running ring, 150 ms switches, reduced motion turns everything off, `app/src/server/ui/styles.ts`,
followup-reconcile-homepage-spec.md:569-571).

### 5.2 Tokens

CSS is the single source; the durations below are the peers' consensus (100-300 ms, ease-out; motion-design.md:25-27,
145-148) and NN/g's ranges.

```css
/* site/src/styles/tokens.css, in @theme */
--transition-duration-micro: 120ms;   /* press, hover colour, tick           */
--transition-duration-short: 180ms;   /* copy state, tab panel, exits        */
--transition-duration-medium: 280ms;  /* card and finding entrances          */
--transition-duration-long: 450ms;    /* the largest moves                   */
--ease-enter: cubic-bezier(0.22, 1, 0.36, 1);
--ease-exit:  cubic-bezier(0.3, 0, 0.8, 0.15);
--ease-move:  cubic-bezier(0.2, 0, 0, 1);
--ease-stamp: cubic-bezier(0.34, 1.56, 0.64, 1);  /* the evidence stamp only */
/* :root */ --motion-rise-sm: 8px; --motion-rise-md: 16px; --motion-nudge: 2px; --motion-stagger: 40ms; --motion-scan: 900ms;
@media (prefers-reduced-motion: reduce) { :root { --motion-rise-sm: 0; --motion-rise-md: 0; --motion-nudge: 0; --motion-stagger: 0ms; --motion-scan: 0ms; } }
```

`src/motion/tokens.ts` reads these with `getComputedStyle` (with fallbacks), and a test fails if a name it reads is
missing from the CSS. That replaces motion-design's mirrored copy plus drift test with no second copy of the numbers
(content-architecture.md:410-413). Tailwind 4.3.3 turns them into `duration-short`, `ease-move` and so on. Progress bars
are linear. Staggers stop at 6 items.

### 5.3 The named moments

| Moment | Where | How | Timing | Reduced motion / no JS |
|---|---|---|---|---|
| **Hero run**: sniff, plan and approve, run, report, EVIDENCE stamp | Homepage hero | Built from real Kennel data: `http://localhost:3160/book`, 9 fields, 3 buttons, 20 scenarios, two `POST /api/bookings` 201s 0.2 ms apart, "Saved copy 1" and "2", HIGH finding, a Playwright test chip (motion-design.md:374-395). Server renders the finished frame; the GSAP island plays it (§5.5). | 3.95 s measured, once (accessibility.md:398-404); phones start when the window is half visible | The finished frame; GSAP never downloaded |
| Copy command | Hero, Start band, docs code blocks | Label → "Copied", `$` turns accent, a next-step line ("Paste it in a terminal, then open localhost:4000") that stays; polite live region. **Add a failure state**: "Couldn't copy: select the command and press Ctrl+C" (today it swallows the error, accessibility.md:655-659) | 120 ms, reset 180 ms | Colour and text only |
| Picture tabs | How it works band | CSS crossfade with `@starting-style` and `transition-behavior: allow-discrete`; indicator slides on click; arrow keys switch instantly; never auto-advance | 180 ms in, 120 ms out | Instant |
| Evidence recordings | How it works (Report tab), `/demo/` | GIFs re-encoded to play once; rest on the proof frame | 2 frame changes, the last at about 2 s | The existing still `<source>` |
| Buttons, links, cards | Everywhere | Primary fill 120 ms, `:active` scale 0.97, arrow nudge 2 px; card border colour on hover only; a deep-linked check card rings once (600 ms) | 100-120 ms | Colour only |
| Header | Everywhere | Border and background appear after 8 px of scroll | 200 ms | Instant |
| Docs "On this page" marker | Docs (phase 2) | CSS transform | 180 ms; instant from the keyboard | Instant |
| 404 | Not found | The hound sniffing along a dotted trail, once | < 2 s | Static drawing |
| Figure reveal (could, not phase 1) | Below-the-fold figures only | IntersectionObserver + GSAP core, opacity and an 8-16 px rise, only for items below the viewport | 280 ms, once | None |

Not on the site: scroll-jacking, pinning, parallax, ScrollTrigger, text that fades, splits or types in, number
tickers, marquees, autoplay video, star counters, 3D (followup-reconcile-homepage-spec.md:796-799;
motion-design.md:531-544). Route-level `<ViewTransition>` is left out for now: it adds 79 ms to every soft navigation on
a throttled CPU and still runs under reduced motion unless it isn't rendered (measurement.md:694-716).

### 5.4 Reduced motion, no JavaScript, print and forced colours

- **Keep** the global rule that shortens CSS animations and transitions to 0.01 ms (`globals.css:76-85`) as a safety net
  for future contributions; it changed nothing measurable today (accessibility.md:491-506). Add the token collapse on top.
  So under reduce, fades are removed too; the brand.md wording "colour and opacity changes of 180 ms or less may stay"
  should say "may be removed" to match.
- **GSAP is not downloaded** under `prefers-reduced-motion: reduce` or Save-Data (proven: `window.gsapVersions`
  undefined, gsap-engineering.md:381; accessibility.md:406-416). The hero shows its finished frame and no Replay button.
  motion-design's "Step through" control under reduce is dropped: nothing in the reconciled spec needs it.
- **Drop `html { scroll-behavior: smooth }`** (`globals.css:48-52`). Chromium animates focus scrolling too: 28 of 70 Tab
  stops were off-screen at the moment of focus (accessibility.md:508-529). Smooth jumps, if wanted, go on single links
  through `scrollIntoView`, gated on no-preference.
- **Print:** `@media print { [data-motion] * { opacity: 1 !important; transform: none !important; } }`.
- **Forced colours (hero run):** in Chromium the progress bar disappears, the mint ticks stay at 1.58:1 on white and the
  current step is marked by colour only. Add `svg * { stroke: CanvasText }`, `[data-progress] { background: Highlight;
  forced-color-adjust: none }`, underline `[aria-current]`, borders on both panes, `aria-current="step"` on the rail
  (accessibility.md:436-457).
- **No global motion toggle.** 2.3.3 is AAA, the OS setting satisfies it, and each autoplaying piece has its own control
  (accessibility.md:406-416).

### 5.5 GSAP integration recipe

Versions checked against the installed packages (AGENTS.md): `gsap@3.15.0` (2026-04-13) and `@gsap/react@2.1.2`, no peer
warnings with React 19.2.8 (gsap-engineering.md:31-37). The parts below were each built and measured in a prototype
(reconcile C2, accessibility P6, measurement `hero2`); **the combination has not been measured as one build**, so measure
it first (§9, R2).

1. **One folder owns every GSAP import:** `site/src/motion/`. A lint or `check-budgets.mjs` guard fails if any initial
   chunk contains `gsap` (measurement.md:845-847). Never import `gsap/all` (125.9 KB gzip), never ScrollTrigger (its
   rAF loop runs 64 times a second even with zero triggers, gsap-engineering.md:124-128), never SplitText (text is never
   animated). Add `gsap/Flip` only if check filters ship.
2. **Server-rendered finished frame.** `HeroRunFrame` is a Server Component with a fixed aspect ratio (CLS 0). The
   animated internals are `aria-hidden`; a `<figure>` with a sentence-case caption and a visually hidden ordered list
   carries the meaning. The mock "Book" button is a `<span>` (accessibility.md:430-434).
3. **Load gate.** A tiny client wrapper reads `useMotionAllowed()` (`useSyncExternalStore` on
   `(prefers-reduced-motion: no-preference)` and not Save-Data; server snapshot `false`, gsap-engineering.md:177-205).
   Only then, after the `load` event plus `requestIdleCallback` (2 s timeout), it mounts
   `dynamic(() => import("@/motion/hero-run-timeline"), { ssr: false })`. With `next/dynamic` alone the chunk arrived
   before `load` on the phone profile and delayed it by 181-183 ms; after load plus idle the cost was 20 ms
   (measurement.md:679-692). On phones the timeline also waits for the window to be half visible.
4. **CSS hold, scoped.** Only the hero's `aria-hidden` late beats are held, and only when scripting is on and motion is
   allowed, with a fallback that reveals them if the script never runs:

   ```css
   @media (scripting: enabled) and (prefers-reduced-motion: no-preference) {
     .hero-run:not([data-ready]) [data-beat="late"] { opacity: 0; animation: hero-run-fallback 0s 2.5s forwards; }
   }
   @keyframes hero-run-fallback { to { opacity: 1; } }
   ```

   Without the hold, the finished run flashed and then blanked at hydration on every desktop load
   (followup-reconcile-homepage-spec.md:165-176). No inline script is added, so the CSP hashes are unaffected.
5. **Guard.** Before building the timeline, read the late beats' opacity. If the fallback already revealed them, jump to
   `progress(1)` and show Replay instead of hiding and replaying. With the guard: 0 flicker in 18 throttled runs, CLS ≤
   0.001, LCP unchanged (accessibility.md:531-571). Everywhere else there is **no hidden state in the server HTML**
   (gsap-engineering.md:138-140).
6. **Timeline.** `useGSAP(fn, { scope: root })`, everything inside
   `gsap.matchMedia().add("(prefers-reduced-motion: no-preference)", …)` so it reverts if the setting changes mid-visit;
   `contextSafe` for skip and Replay; labels per beat; `transform` and `opacity` only (never `autoAlpha` on content);
   `IntersectionObserver` at 0.5 to play, and `progress(1)` if the reader scrolls away early; any pointer or key inside
   skips to the end; a 44 px Replay button rendered after hydration (motion-design.md:598-648). The storyboard is data in
   `content/hero-run.ts`, built from the same data as the screenshots' alt texts so the Kennel facts can't drift.
7. **CSP:** no change. GSAP is bundled from npm (`'self'`), uses no `eval`, and writes styles through the CSSOM, which
   the current `style-src` allows; never load it from a CDN (gsap-engineering.md:390-396).
8. **Licence:** GSAP is under Webflow's no-charge Standard License, not an OSI licence, and Webflow can change it
   (gsap-engineering.md:44-49). It is a dependency of the site only. Say so in the site README and CONTRIBUTING; keeping
   it in `src/motion/` keeps a swap to Motion (MIT) or the Web Animations API to one folder.
9. **Optional figure reveals (later):** one lazy runtime keyed on `data-motion="reveal"`, applied only to `figure`,
   `picture` and `[data-illus]`, hiding only items **below** the viewport, with a `focusin` handler and the print override.
   Revealing every section child hid 89% of the homepage text and 52 headings until scrolled (accessibility.md:573-601).
   Phase 1 doesn't need it.

Cost measured: +2.0 KB initial JS on `/`, a 27.6 KB gzip lazy chunk, LCP and CLS unchanged (measurement.md:679-687).

### 5.6 Motion tests (CI)

A Playwright "motion contract" against the built site (motion-design.md:665-677; gsap-engineering.md:431-444):
under `reducedMotion: "reduce"`, `window.gsapVersions` is undefined and every `[data-beat]` is at opacity 1; the `<h1>`
has opacity 1 at `DOMContentLoaded` in both modes; no element in the first viewport ever gets inline `opacity: 0`; no
infinite animations at rest; nothing at opacity 0 after a fast scroll to the end; CLS 0 while the hero runs; the hero
and recordings stop within 5 s; no `transition-all` in `src/`. Visual snapshots run with reduced motion; mid-animation
tests use `clock.runFor()`, because `animations: "disabled"` and `clock.fastForward()` leave GSAP tweens unfinished.

---

## 6. Trust and contribution

### 6.1 On the site

| What | Where | Status |
|---|---|---|
| Proof strip: 26 checks all open source, runs on your machine, AI off by default, a Playwright test per finding, each linked to its proof | Hero, last row | Phase 1 |
| Facts line: MIT · Docker or Podman · amd64 and arm64 · release and date | Start band | Phase 1 |
| "How to help today" (feedback form, false-positive reports, planted-bug ideas, Discussions), replacing "Contribution guidelines are coming" (`open-source/page.tsx:267`) | `/open-source/#contributing` | Phase 1 |
| **Maintainer block** "Who makes Run Hound": name, avatar, GitHub and personal site, why it exists, and how it is built: with Claude Code as a pair, contracts and failing tests first, scored against planted-bug fixtures in CI, every decision in the public log. 86 of 104 commits on the branch are AI co-authored (trust-contribution.md:21, 268) | `/open-source/` | Phase 1 |
| Stability note: 0.x, any release may change behaviour, what may change (report.json, CLI flags), what 1.0.0 will guarantee | `/open-source/#stability`, linked from the facts line | Phase 1 |
| Security page: keep the disclosure policy; add "Verify what you run" (`gh attestation verify`, SBOM, Scorecard) **only after** attestations ship; "Past advisories: none yet" | `/security/` | After 6.2 C |
| `/.well-known/security.txt` (RFC 9116) with `Contact`, `Policy`, `Expires` < 1 year; the build fails when `Expires` is under 30 days away | `public/.well-known/` | Phase 1 |
| Contributing page: quick start with good first issues, ways to help, codebase map (`app/src/checks`, `engine`, `fixtures`), first PR, community, AI policy; links CONTRIBUTING.md and the code of conduct, which stay canonical | `/open-source/contributing/` | Phase 4 |
| "Edit this page on GitHub" on docs pages | Docs | Once CONTRIBUTING.md and the ruleset exist |
| Footer Project column: Open source, Roadmap, How to help / Contributing, Changelog, GitHub, Security policy | Footer | Phase 1 |

**Social-proof rules** (trust-contribution.md:273-279, 291-298): no star counter while the number is small (3 today;
the 3 of 15 peers that show one have 18.5K+); a plain "Star on GitHub" link is fine; no "trusted by" logos, user counts or
testimonials until they are real, and then each links to its public source; no `aggregateRating` or `review` in JSON-LD
(already enforced, `check-seo.mjs:47-48`); no Scorecard badge until it is worth showing; never claim signed images before
verification passes.

### 6.2 In the repository

| | Before inviting alpha testers | Before announcing contributions |
|---|---|---|
| A. Files | `.github/SECURITY.md` (so GitHub stops showing `docs/security.md`); issue forms without a hard-coded version, `blank_issues_enabled: false`, contact links for security and questions | `CONTRIBUTING.md` (what we want now, set-up, tests, how a check is built, decision-log rule, **DCO**, **AI-use policy** with an `Assisted-by:` trailer and a human who can explain the change, review-time target); `CODE_OF_CONDUCT.md` (Contributor Covenant 3.0, monitored contact); PR template; `SUPPORT.md` and a short `GOVERNANCE.md` (should) |
| B. Settings | Secret scanning, push protection, Dependabot alerts and updates on; Discussions on (Q&A, Ideas, Announcements, Show and tell); the `/security/` contact address confirmed as monitored (`site.ts:80-82` calls it a placeholder) | Ruleset on `main` (PRs required, CI required, no force push); labels (`status: accepted`, `status: needs triage`, `area: *`); 5-10 real good first issues, each with files, test steps and a mentor; topics |
| C. Releases | GitHub Releases for v0.3.0 to v0.6.0 with the changelog notes; dates on every CHANGELOG heading (in the 0.6.0 tree only 0.6.0 has one: `CHANGELOG.md:5, 51, 68, 86`) | Attest the images (`actions/attest`), add an SBOM, pin actions by SHA and images by digest, `dependabot.yml`, CodeQL, the Scorecard action, the OpenSSF Best Practices badge (should in both columns) |
| D. Site | Redesign phase 1 live; GIFs play once; Cloudflare AI-crawler 403 resolved one way or the other | `/open-source/contributing/` live; maintainer block live |
| E. Links | README links the site near the top with the same one-sentence definition as `site.description`, the GitHub description and `llms.txt` | A CI step that checks every `blob/main/<path>` link on the site exists in the repo (the site's Docker context can't see repo files) |

Evidence: trust-contribution.md:212-289; split by audience in followup-reconcile-homepage-spec.md:645-661.
Research behind the contributor items: newcomers' top barriers are finding a way to start and getting a response
(Steinmacher et al.); good first issues need a description, support and limited scope (Tan et al., FSE 2020); 118 of
1,000 popular repositories have AI policies, 51% require disclosure (Hora and Robbes, 2026) (trust-contribution.md:91-117).

---

## 7. SEO and GEO

### 7.1 Keep

- Per-page metadata through `pageMetadata` (title ≤ 60 characters, description 70-160, self canonical with trailing slash),
  one `@graph` of JSON-LD per page with resolvable `@id`s (the homepage's `#website`, `#maintainer`, `#software`), FAQPage
  only on `/faq/`, no ratings (inventory.md:629-631).
- `check-seo.mjs --strict` in `pnpm build`: exactly one h1, sitemap parity, canonical and JSON-LD checks.
- Per-page CSP by hash; no inline script at run time; GSAP and Pagefind from `'self'` (inventory.md:632).
- `robots.txt` allowing all and 11 named AI agents; `sitemap.xml`; `llms.txt` and `llms-full.txt` (cheap; Google ignores
  them, seo-ia.md:244); security headers; trailing slash; image pipeline and warming (server-render images so they're
  warmed); `display: optional` fonts.
- Every URL and `#id` in seo-ia.md:378-384.
- The version line `const version = "x.y.z";` on line 3 of `lib/site.ts` (the release workflow greps it,
  content-architecture.md:184-198).

### 7.2 Add

| What | Why | Phase |
|---|---|---|
| **Fix the Cloudflare 403** for GPTBot, ClaudeBot, PerplexityBot and CCBot, or make the edge match `robots.txt` on purpose. PerplexityBot is a search crawler | The biggest GEO blocker; more than any page-structure work (seo-ia.md:19, 104-108) | Now |
| README links the site; one definition everywhere; Search Console (Domain property by DNS) and Bing (import) verified, sitemap submitted, IndexNow on deploy | Brand collision in autocomplete ("run hounds", "hound run farm"); Search Console collects only from the day the property is added (seo-ia.md:20, 447-448; measurement.md:307-337) | Now, before launch |
| Docs spokes, each with its own title, description, h1, visible breadcrumb, TechArticle, "Updated for 0.x.y · date", answer-first opening paragraph | One URL per intent; long-tail task queries ("access localhost from docker container", "host.docker.internal not working", "generate playwright tests with ai") (seo-ia.md:195-199, 253-279) | 2 |
| Route registry feeding nav, breadcrumbs (visible and JSON-LD), sitemap, `llms.txt` and the guards; per-page `lastmod` | Drift risk grows with 40 new URLs (seo-ia.md:456-467) | 1-2 |
| `check-registry.mjs`: internal links resolve, every `#fragment` exists (118 anchors), no orphans, no redirect chains, breadcrumb parity, source files exist | Built and passing on a prototype (content-architecture.md:154-169, 443) | 1 |
| `/checks/<id>/` spokes with the seo-ia.md §4.2 template: own description (8 of today's `line` texts exceed 160 characters), facts block, how it's tested, evidence from Kennel or Fernway, a Playwright excerpt, how to fix with OWASP/WCAG/CWE links, limits, related, visible date | ESLint, Biome, ZAP and axe-core pattern; real reader once reports link "learn more" there (seo-ia.md:168-174, 354-370) | 3 |
| `/docs/glossary/` with Run Hound's own terms only (golden path, advisory, test records, target gate…) | Generic terms restate OWASP and MDN, which is commodity content (seo-ia.md:189-193) | 3 |
| At most 3 `/compare/<tool>/` spokes (Playwright, axe-core, security scanners), capability-level and sourced | Maker self-reviews carry a conflict of interest (seo-ia.md:176-187) | 4 |
| `sameAs` in the Person node for `rahulbharati.com` and a visible maintainer block | Google's "who" (seo-ia.md:229-238) | 1 (if the maintainer agrees) |
| Pagefind search across docs, checks and FAQ | 16 of 16 peer docs pages have search (navigation.md:268) | 2 |
| hreflang, locale prefixes | Reserve only: one locale constant, `content/ui.ts`, no top-level slug shaped like a language code (content-architecture.md:612-625) | Later |

### 7.3 Don't

Pages for the 73 planned catalog entries, per-framework or per-builder copies, "Top N alternatives" pages, a word count
target (Google has none, seo-ia.md:126-131), facts only inside images or animations, and text that appears only after a
click or a GSAP timeline.

### 7.4 Measure (no consent needed for these)

Before launch, record: Cloudflare Web Analytics for the full 6 months and the last 30 days (visits, paths, referrers,
LCP/INP/CLS p75 with top elements); a daily GitHub traffic snapshot workflow (the API keeps 14 days); GHCR downloads
(measurement.md:220-304). Compare 4 weeks before and 4 weeks after in counts, not rates, and treat the five-second and
tree tests as the main evidence until traffic grows (measurement.md:345-368, 506-552). CTA clicks and copies need an event
source: a first-party, identifier-free counter with an opt-out (§9, D10).

---

## 8. The refactor

### 8.1 Module layout (content-architecture.md:89-123, built and tested in `arch-build/a-mdx`)

```
site/src/
  lib/site.ts             FACTS: version (line 3, unchanged), dates, URLs, contacts, trust URLs. Values, no sentences.
  content/                EVERY WORD A CONTRIBUTOR EDITS. Plain .ts and .md/.mdx; no JSX, no classNames.
    routes.ts             The route registry: id, path, title, description, label, parent, header/footer/docs slots,
                          schema, source (for "Edit this page"), search, anchors
    home.ts               Homepage sections { h2, intro, items[], links: { to: RouteId, hash? }[] }
    commands.ts           Every shell command once (4 definitions today)
    claims.ts             Principles, "what a browser can't see", the AI data-flow sentence: one list each
    trust.ts              Proof-strip and facts-line items
    hero-run.ts           The storyboard (real Kennel values)
    ui.ts                 Interface strings ("On this page", "Edit this page", "Menu"…)
    checks.ts faq.ts compare.ts ai-built.ts open-source.ts legal.ts   (moved from components/*/data.ts)
    docs/<slug>.mdx|.md   One file per docs page
  lib/                    DERIVATIONS: nav.ts (headerLinks, footerLinks, docsSidebar, prevNext, breadcrumbTrail,
                          editUrl, sitemapRoutes, llmsLinks), metadata.ts, structured-data.ts, image-sizes.ts,
                          llms.ts, docs-text.ts, storage-keys.ts, count.ts
  styles/tokens.css       Three layers: brand palette → semantic roles (--rh-*) → Tailwind via @theme inline;
                          type scale (7 steps), radii, shadows, layout numbers, motion tokens
  motion/                 use-motion-allowed.ts, after-load-idle.ts, tokens.ts, hero-run-timeline.tsx,
                          (later) runtime.tsx + effects/reveal.ts. The only place GSAP is imported.
  components/primitives/  Container, Section, Card, IconTile, TextLink, ArrowLink, Caption, Eyebrow, ButtonLink,
                          CodeBlock (with copy), Command, Figure, Callout, Breadcrumbs, FactStrip, NavLink
  components/…            Feature components: hero-run/, docs-shell, finding, search-dialog…
  app/**/page.tsx         Thin: metadata from the registry, then one view (10-30 lines)
scripts/                  csp.mjs, check-seo.mjs, check-registry.mjs, check-copy.mjs, check-budgets.mjs,
                          pagefind.mjs, og-image.mjs, warm-images.mjs
```

What this buys, measured on the prototype: adding a docs page touched two files (a registry entry and the Markdown), and
the sidebar, footer, prev/next, sitemap, `llms.txt`, `llms-full.txt`, breadcrumbs and JSON-LD all followed
(content-architecture.md:200-205). Moving colours into roles changed no pixels on 15 pages at 2 viewports
(content-architecture.md:383-389).

**Docs as MDX with `@next/mdx` 16.3.5** added 0 B of client JS and passed `csp.mjs` and `check-seo --strict`
(content-architecture.md:225-240). Its gotchas, from the installed docs and the prototype: remark and rehype plugins must
be named as strings under Turbopack (a local plugin by absolute path works); no frontmatter (the registry holds titles);
`{` must be escaped as `\{` in `.mdx`; a bare `<port>` in a `.md` file is silently dropped (content-architecture.md:249-273).

### 8.2 Guards and budgets

| Guard | Stops | Where |
|---|---|---|
| `check-seo.mjs --strict` (exists) | Metadata, h1, canonical, JSON-LD and sitemap errors | `pnpm build` |
| `check-registry.mjs` | Pages missing from the registry, broken links and fragments, lost anchors, breadcrumb drift, missing sources | `pnpm build` |
| `check-copy.mjs` | Homepage over 750 words; warnings for headings, intros, sentences, tablists, hidden words | `pnpm build` |
| `check-budgets.mjs` + `site/budgets.json` | Per-route initial JS (gzip, modern only, no `noModule`), shared JS ≤ 153,000 B, HTML raw/gzip, RSC page segment, preloaded fonts ≤ 130,000 B; any initial chunk containing `gsap` or `ScrollTrigger`; Pagefind Component UI; extra third-party script origins | `pnpm build`, last (measurement.md:790-872) |
| `routes.test.ts`, `version-line.test.ts`, `boundaries.test.ts` (a `"use client"` file importing the registry added 3,954 B to every page), `content.test.ts` (MDX tags, no h1, no bare `<word>`), `storage-keys.test.ts` (every browser key is in the privacy table), `tokens.test.ts`, motion-effects test | Drift in code review | `pnpm test` |
| eslint-plugin-tailwindcss 4.4.0: arbitrary values (138 today) as warnings, errors after migration | Magic numbers | `pnpm lint` |
| Playwright lab job (non-blocking for 2 weeks): lab LCP ≤ 1,200 ms, CLS ≤ 0.01, 0 CSP violations, prefetch budget, GSAP absent under reduce; plus the motion contract, axe on every route, and Run Hound's own `reflow-320` and `focus-visible` on the built site (41 s locally) | Regressions a byte count can't see | CI `site-lab` (accessibility.md:667-697) |

**One JS definition** for every budget: initial JS = gzip -9 of the first-party `<script src>` files a modern browser
runs, excluding `noModule`, read from `.next/`. Today 149,760-152,232 B per route. The earlier 191.8 KB included the
39.5 KB polyfill modern browsers skip, and "about 520 KB" was decoded bytes on the live site including Cloudflare's beacon
(measurement.md:558-579). Key per-route budgets: home ≤ 158,000 B initial JS (≤ 5,000 page-specific) and ≤ 35,000 B lazy
after load; docs pages ≤ 156,000; lab LCP ≤ 1,000 ms; first-viewport prefetches ≤ 10 requests / 120 KB.

**Prefetch policy** in one `NavLink` (`prefetch: "viewport" | "intent" | "none"`): header default; docs sidebar, hub
grids and related lists on hover (Next's documented pattern); footer and legal `prefetch={false}`. At 50 pages a docs
sidebar with viewport prefetch made 32 requests (205 KB) in the first viewport; hover made 9 (102 KB) for 68 ms more per
click (measurement.md:718-778).

### 8.3 Conventions for contributors

1. **Words live in `src/content/`.** Pages and components hold no prose. A new sentence on the homepage needs a cut
   elsewhere (the 750-word gate).
2. **Link by `RouteId`, never by a raw internal href.** A mistyped id fails `tsc`; a missing `#hash` fails the build.
3. **A new page is one registry entry plus one page or MDX file.** Nav, footer, sitemap, breadcrumbs, JSON-LD and
   `llms.txt` follow automatically.
4. **A new check is one data entry** with its plain homepage label (`plain`), `since`, group and, in phase 3, its page
   fields. Counts are derived; never type a count or the current release (only `site.version`; history lives in `since`).
5. **Styles use tokens.** No arbitrary Tailwind values, no `transition-all`, no `text-dim` in translucent bars, one
   anchor-offset token.
6. **Client components receive data as props.** They never import `content/*` or `lib/nav`.
7. **Motion lives in `src/motion/`,** passes the purpose test, animates only `transform` and `opacity`, never animates
   text, and has a reduced-motion state. GSAP is not open source: never copy its code elsewhere.
8. **Every new browser-storage key** is added to `storage-keys.ts` and the privacy table in the same PR.
9. **MDX:** escape `\{`; pin heading ids with `\{#id\}`; only registered components; no h1.
10. **Voice:** brand.md plus the copy rules in §4.5.
11. **Primitives are shown on `/_design/`** (noindex, not in the registry), which CI snapshots under reduced motion.
    No Storybook: it added 67.6 MB and rendered without the site's fonts (content-architecture.md:446-469).
12. **Every PR:** `pnpm lint`, `pnpm test`, `pnpm build` green; DCO sign-off; AI disclosure; a decision-log entry if
    behaviour changes.

### 8.4 Order of work (reconciled)

content-architecture.md:661-703 puts the homepage after the docs split; the phase plan needs it first, before alpha
testers. The order below keeps its "guards first, same URLs at every step" rule and moves the homepage forward:

1. **Now (no redesign needed):** re-encode the GIFs to play once; point the CTA at `/docs/#quick-start`; fix Escape and
   the 400% zoom menu; wrap the tab labels at 320 px; drop the global smooth scroll; `.github/SECURITY.md`;
   version-agnostic issue forms; GitHub security features; Search Console and Bing; export Cloudflare analytics; start
   the traffic snapshot; decide on the Cloudflare 403 and Bot Fight Mode.
2. **Release 0.6.0** with its three site files, publish GitHub Releases with dates, and **rebase `site/redesign` on it**
   (the only overlap is the two data files, followup-reconcile-homepage-spec.md:626-639).
3. **Guards, no visible change:** `routes.ts` mirroring the 13 pages and 118 anchors, the tests, `check-registry.mjs`,
   `check-budgets.mjs` with today's values plus 5% as a ratchet, visual baselines.
4. **Derive** header, footer, sitemap and `llms` lists from the registry; metadata and breadcrumbs from the registry
   (JSON-LD diff must be empty).
5. **Content modules:** `commands.ts`, `claims.ts`, `plain` labels in `checks.ts`, `trust.ts`; tokens and primitives.
6. **Phase 1:** `content/home.ts`, the new homepage, header and footer, `check-copy.mjs`, the hero run, the brand.md
   edits. Five-second test, then invite alpha testers.
7. **Phase 2:** `app/docs/[slug]`, one MDX page at a time, the hub with the old ids, Pagefind, docs breadcrumbs, repo
   guides reduced to pointers.
8. **Phase 3:** check pages once reports link to them; glossary. **Phase 4:** Contributing, after the §6.2 checklist.

---

## 9. Risks and open decisions

### 9.1 Decisions for the maintainer, each with a recommended answer

| # | Decision | Recommended answer | Why |
|---|---|---|---|
| D1 | GSAP (Webflow's no-charge licence, revocable) or Motion (MIT) / WAAPI | **GSAP, as asked**, confined to `src/motion/`, with the licence noted in the site README and CONTRIBUTING | One timeline needs labels, skip, replay and matchMedia revert; the folder keeps a swap cheap (motion-design.md:565-578; gsap-engineering.md:44-49) |
| D2 | Hero: the animated run (C2) or a static finding frame (B layout) | **C2 with the guard**; fall back to the static frame if five people watching it once don't read it as "it found a real bug" | Text stays the LCP; the product is in the first viewport; 0 flicker with hold and guard (followup-reconcile-homepage-spec.md:186-222; accessibility.md:531-571) |
| D3 | Does the hound ride the scan line? | **No at launch.** Try it on `/_design/` later | brand.md:46 ("never put it on a busy background") and "Calm"; unproven (motion-design.md:700) |
| D4 | How it works or AI-built apps in the header | **AI-built apps**, confirmed by the tree test (navigation.md §9 tasks, 5-8 people) | Search intent evidence (seo-ia.md:259-262); How it works is the most duplicated page (inventory.md:408) |
| D5 | CTA label | **Keep "Try it locally"**; include "Get started" in the five-second test | Specific label, the brand's differentiator; the problem was the target (followup-reconcile-homepage-spec.md:369-375) |
| D6 | "Contribute" in the header when contributions open | **No.** Open source hub, footer, README and `/contribute/` alias | Keep ≤ 5 header items (`routes.test.ts`); peers put contributing one level down (trust-contribution.md:74) |
| D7 | Docs source | **MDX in `site/`**, repo guides become pointers | Pinned anchors, components, same toolchain; repo Markdown lacked h2s and sent 11 links to GitHub (content-architecture.md:325-343) |
| D8 | Will reports link findings to `/checks/<id>/`? | **Yes, in the next app release**; it is the trigger for phase 3 | Gives the pages real readers and keeps them clear of scaled-content policy (seo-ia.md:370) |
| D9 | Cloudflare: AI crawlers, Bot Fight Mode, Speed Brain, email obfuscation | **Allow the four blocked crawlers** (robots.txt already invites them); turn Bot Fight Mode off or document the one expected CSP error in `site/README.md:46-47`; turn Speed Brain (503 prefetches) and email obfuscation off | seo-ia.md:104-108, 478; measurement.md:188-214 |
| D10 | Click measurement | **A first-party, identifier-free counter with an opt-out** (7 fixed events, no query text, daily totals, 25 months), with the privacy text in measurement.md:446-490; keep GA off. A legal judgement for the maintainer, not advice | Fits CNIL (2025-07) and ICO (2026-04) exemptions with an opt-out; EU-wide still in scope of Art. 5(3) (measurement.md:370-401) |
| D11 | Cloudflare Web Analytics mode | **"Enable" for everyone**, disclosed on the privacy page | Excluding the EU and UK loses much of the audience; same residual-risk position as D10 (measurement.md:392-399) |
| D12 | DCO or CLA | **DCO**, confirmed with counsel | MIT inbound=outbound; Node.js moved to DCO; a CLA "may be perceived as unfriendly" (trust-contribution.md:109, 222) |
| D13 | PR policy and channel | **Accepted-issue first** (`status: accepted`), **GitHub Discussions only**, first response within 3 business days | Protects a solo maintainer's review time (Ghostty model); one channel can be moderated well (trust-contribution.md:216-224, 297) |
| D14 | Say the project is built with AI? | **Yes**, in the maintainer block and the AI policy | Google asks for "how" disclosure; 86 of 104 commits are AI co-authored; on-brand for a tool that tests AI-built apps (trust-contribution.md:21) |
| D15 | Mention the employer | **State it is an independent personal project**, name no employer (maintainer's call) | Scorecard already lists the organisation; clarity avoids implied endorsement (trust-contribution.md:309) |
| D16 | Attestations and SBOM with 0.6.0 | **Yes if it fits the release**; otherwise 0.6.1. Say nothing about signing until `gh attestation verify` passes | trust-contribution.md:246-247, 269 |
| D17 | On-site `/changelog/` | **Not now.** The chip links GitHub Releases once they exist | Avoids another generated page; releases are the canonical feed (navigation.md:802) |
| D18 | Drop Bricolage's `opsz` axis (−35.6 KB preloaded font on every first visit) | **Compare display headings on `/_design/`; drop it if the difference is invisible at 40-80 px** | measurement.md:780-788 |
| D19 | Light theme; localisation | **Neither now.** Ship the token layers (pixel-neutral) and reserve i18n | A light theme needs a second accent (mint on white is 1.46:1) and moves the local UI and reports too (content-architecture.md:506-535) |
| D20 | Home HTML budget | **Start at 135,000 B raw / 25,000 B gzip**, then ratchet down | measurement.md's 120,000 B raw is below the prototype's measured 128,912 B (followup-reconcile-homepage-spec.md:143); gzip 23,286 B passes |
| D21 | `/_design/` in production and visual baselines | **Ship it noindex; keep baselines as CI artefacts**, not committed PNGs (32 MB for all pages) | content-architecture.md:707-722 |

### 9.2 Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | **Only Chromium was tested.** The play-once GIF (`-loop -1`), Pagefind under the CSP, `@media (scripting)`, `@starting-style` and forced colours are unverified in Firefox and Safari | Test both before launch; if Pagefind falls back to main-thread WASM, add `'wasm-unsafe-eval'` (navigation.md:692-694) |
| R2 | The load-plus-idle gate and the 2.5 s CSS fallback were measured separately. Together, on a slow device the island may arrive after the fallback, so the run rests on its end state without playing | That is the intended degraded state (the guard). Measure the combined build on the throttled desktop and phone profiles; if the run rarely plays on mid-range desktops, raise the fallback to 3 s |
| R3 | The phone target (≤ 10 screens) depends on two unbuilt changes and is computed at about 10.0 | Measure; cut band 1 or padding first (§4.2) |
| R4 | The storyboard drifts from the real Kennel run | Build it from the same data as the screenshot alt texts, with a test (followup-reconcile-homepage-spec.md:217) |
| R5 | Inner pages are long too (`/docs/` 8,047 words), so "moved one level down" lands readers on another wall until phase 2 | Keep phase 2 close behind phase 1; the docs hub cards carry the old ids |
| R6 | Traffic is too small for rates | Counts over 4 weeks before and after; five-second and tree tests as the main evidence (measurement.md:248-249, 367-368) |
| R7 | Contributions announced before the repo is ready create unanswerable PRs | The §6.2 checklist gates `/open-source/contributing/`; mis-scoped good first issues fail half the time (trust-contribution.md:99) |
| R8 | AI-generated security reports flood a security tool | SECURITY.md requires a reproduction; no bounty (trust-contribution.md:115-117, 214) |
| R9 | brand.md and the 0.6.0 facts disagree (write-access and paywall-trust still "planned" at brand.md:54); issue forms say 0.5.0 | Fix in the brand.md edit and the "now" list; `version-line.test.ts` lists stray release literals (content-architecture.md:189-195) |
| R10 | Link prefetch grows with sidebars and hubs | `NavLink` prefetch policy and the first-viewport prefetch budget (§8.2) |
| R11 | GSAP licence changes | One-folder swap; Motion's `animate` + `inView` is 22.3 KB gzip (motion-design.md:560-562) |

### 9.3 Questions only people can answer

1. **Five-second test** on today's first screen and the C2 hero, at 1440×900 and 390×844, 5-8 developers who build with AI
   builders; pass when 4 of 5 say what it does, name a next step and say it's free (readability.md:752-759).
2. **Tree test** of the phase 2 tree with the 8 tasks in navigation.md:770-779; pass at 80% success and 60% directness per
   task.
3. **Five people watch the hero run once:** do they read it as a real bug found, and is it calm or busy?
4. Run all three as one 25-minute session, recruited for $0 from GitHub and builder communities (measurement.md:506-552).

---

## Appendix A. The critic's contradictions, settled

| # | Contradiction | Settled as | Evidence |
|---|---|---|---|
| 1 | Hero motion above the fold: no hidden state (gsap-engineering) vs a CSS hold (motion-design) | Hold **only** the hero's `aria-hidden` late beats, with the 2.5 s fallback and the replay guard; no hidden state anywhere else; text is never held | accessibility.md:531-571; followup-reconcile-homepage-spec.md:165-222 |
| 2 | Desktop LCP misstated | Today: the decorative hound mark on desktop (904-940 ms), the subhead on phones. With C2: the h1 (764-780 ms) and the subhead (748-768 ms); a screenshot or crop hero would make an image the LCP at 1,484-1,856 ms. Measured on all proposed heroes | followup-reconcile-homepage-spec.md:119-158 |
| 3 | Scroll reveals of everything vs illustrations only | Illustrations only, below the viewport only, never text; not needed in phase 1 | accessibility.md:573-601 |
| 4 | Loading GSAP: root MotionLayer vs static island | A `next/dynamic` island mounted after `load` + idle, only when motion is allowed; one `src/motion/` folder; the declarative runtime waits until figure reveals are wanted | measurement.md:669-692; gsap-engineering.md:329-341 |
| 5 | Reduced motion: keep the 0.01 ms rule vs token collapse and "Step through" | Keep the rule, add tokens; GSAP never downloaded; "Step through" dropped | accessibility.md:491-506 |
| 6 | Smooth scrolling | Drop it: it animates focus scrolling (28 of 70 Tab stops off-screen) | accessibility.md:508-529 |
| 7 | The current header described two ways | Desktop today: How it works, Checks, Docs + GitHub + Changelog + CTA (`site-header.tsx:11`, checked). oss-homepages.md:306 counted GitHub and Changelog as links; seo-ia.md:89 listed `mainNav`, not what renders | inventory.md:314; navigation.md:134-137 |
| 8 | Proposed header items | `Docs · Checks · Demo · AI-built apps · Open source` + Search + chip + GitHub + "Try it locally"; no Contribute item | followup-reconcile-homepage-spec.md:326-388; §9 D4, D6 |
| 9 | Docs slugs and destinations | Hub + 11 pages incl. `/docs/cli/`; `install` holds requirements and from-source; `test-lab`, `your-app`, `report`; `#ai-built` → `/ai-built-apps/#discovery`. Supersedes content-architecture.md:712-718 | followup-reconcile-homepage-spec.md:434-454 |
| 10 | Contributor entry URL | `/open-source/contributing/` with `/contribute/` 308 | followup-reconcile-homepage-spec.md:456-468 |
| 11 | BreadcrumbList on flat pages | Keep JSON-LD, no visible trail on flat pages, visible on nested pages, parity checked | followup-reconcile-homepage-spec.md:470-493 |
| 12 | "Why now" statistics and the slot under the hero | Proof strip is the hero's last row; the statistics stay as band 1 in 48 words, shared with `/ai-built-apps/` and the FAQ | followup-reconcile-homepage-spec.md:390-410 |
| 13 | Tabs holding text | Text visible; tabs switch pictures only; hidden words count | followup-reconcile-homepage-spec.md:412-422 |
| 14 | Budgets, medians and word counts | One static method in `<main>` incl. hidden panels; fail over 750; today 3,885; peers 455 median, 810 upper quartile by the same method; ≤ 7 / ≤ 10 screens | followup-reconcile-homepage-spec.md:261-317 |
| 15 | Three JS baselines | One definition: gzip of first-party modern `<script src>`, no `noModule`, from the build (149.8-152.2 KB today); per-route budgets replace the "+2 KB" guard | measurement.md:558-579 |
| 16 | Hero layout and command | Split layout with the run window on the right; the command on one scrolling line, no install tabs | followup-reconcile-homepage-spec.md:84-112, 733 |
| 17 | Site size and the footer | 13 → 24 → 51 → 52-55 URLs; 26 checks in 0.6.0; a doormat footer, not a sitemap | followup-reconcile-homepage-spec.md:495-512 |
| 18 | Brand: stage names, "vibe-coded", motion section | "Preview" tag on the homepage, stages where the roadmap is explained; "vibe-coded" secondary, never in h1, title or hero; a Motion section in brand.md for site, UI and reports | followup-reconcile-homepage-spec.md:536-603 |
| 19 | Whether the live site was measured | It was (oss-homepages, seo-ia, trust-contribution, measurement); the local build matches it (21.1 / 33.7 screens) | seo-ia.md:5; measurement.md:624-640 |
| 20 | Analytics described as absent; GIF loop | Cloudflare Web Analytics is live (edge-injected); baseline plan in §7.4. GIFs re-encoded to play once now; readability's "GIF plus 2 stills" becomes the play-once GIF in the picture tabs | measurement.md:28-53; followup-reconcile-homepage-spec.md:514-532 |

Contradictions this brief found and settled on top of the critic's list:

- **Migration order vs phases:** content-architecture.md:689-695 builds the docs split before the homepage; the phase
  plan needs the homepage first. Settled in §8.4.
- **Home HTML budget vs prototype:** 120,000 B raw proposed, 128,912 B measured. Settled in §9 D20.
- **Brand wording vs the kept global rule:** "fades of 180 ms or less may stay" (followup-reconcile-homepage-spec.md:597-599)
  vs keeping the 0.01 ms rule that removes them. Settled in §5.4.
- **Motion tokens mirrored in TS vs read from CSS:** read from CSS (content-architecture.md:410-413). Settled in §5.2.
- **brand.md:54 lists 0.6.0's shipped checks as planned.** §4.5 and R9.

---

## Appendix B. External sources and how current they are (as of 2026-09-27)

Each was read by the report cited; dates are what the source shows.

| Source | Date / currency | Used for |
|---|---|---|
| NN/g, Scrolling and Attention | 2018-04-15; still NN/g's current study | 57% / 74% / 81% of viewing time in the first 1 / 2 / 3 screens |
| NN/g, Homepage Design: 5 Fundamental Principles | 2024-03-15 | Concise tagline, examples above the fold, minimise motion, no scroll-triggered text |
| NN/g, How Little Do Users Read? / How Users Read on the Web / How People Read Online | 2008 / 1997 / 2020 | 20-28% of words read; people scan (reconfirmed 2020) |
| NN/g, Progressive Disclosure | 2006, canonical | No more than 2 levels |
| NN/g, Tabs Used Right | 2024, reviewed 2026-09-02 | Non-default tabs are often ignored |
| NN/g, Hamburger Menus and Hidden Navigation | 2016-06-26 | Hidden desktop nav used 27% vs 48-50% |
| NN/g, Menu Design Checklist; Breadcrumbs; Footers; Tree Testing | 2024-06-07; 2018, reviewed 2026-09-01; 2019-02-24; 2023, reviewed 2026-08-19 | Header, breadcrumb, footer and validation rules |
| NN/g, Animation Duration; Animation Purpose; Scrolljacking 101 | 2020-02-09; 2020-01-12; 2023-08-06 | 100-400 ms, purposes, no scroll-jacking |
| Evil Martians, We studied 100 dev tool landing pages | 2025-07-08 (industry, not peer-reviewed) | Two CTAs, problem-first stories, "no salesy BS" |
| Google Search Central: helpful content; SEO starter guide; mobile-first indexing; lazy-loading | updated 2025-12-10 | No word-count target; don't hide primary content behind interaction |
| Google, Optimizing for generative AI features | updated 2026-07-10 | No ideal page length; scaled-content warning; llms.txt ignored |
| Google, Spam policies | updated 2026-08-28 | Scaled content and doorways |
| Google, Breadcrumb structured data; general structured-data guidelines | 2026-09-08; 2026-07-10 | Breadcrumb decision |
| Google, Site moves with URL changes; Redirects | 2026-08-20; 2026-04-14 | 308, ≥ 1 year, never to `/` |
| Microsoft Advertising, Optimizing content for AI search answers | 2025-10-08 | Don't hide answers in tabs |
| Vercel + MERJ, The rise of the AI crawler | 2024-12-17 (nearly 2 years old; re-check) | Major AI crawlers don't run JavaScript |
| GEO paper (KDD 2024) | v3 2024-06-28 | Citations and statistics raise visibility |
| web.dev: LCP; CLS; INP; animations guide | 2025-09-04; 2023-04-12; 2025-09-02; 2020-10-06 | Opacity-0 not an LCP candidate; transform/opacity only |
| W3C WCAG 2.2 Understanding: 2.2.2, 2.4.11, 1.4.10, 2.1.4, 4.1.3, 2.5.8, 1.4.11 | updated between 2025-09 and 2026-08 | Accessibility criteria in §3 and §5 |
| WAI-ARIA APG: Disclosure Navigation; Dialog (Modal) | 2026-01-20; undated living | Menu and search dialog behaviour |
| GSAP Standard License; GSAP 3.13 blog; gsap.matchMedia and React docs | effective 2025-04-30, modified 2025-05-30; 2025-04-29; living v3.15 docs | Licence and API |
| npm: gsap 3.15.0, @gsap/react 2.1.2, Pagefind 1.5.2, @next/mdx 16.3.5, eslint-plugin-tailwindcss 4.4.0 | queried 2026-09-27 | Versions |
| Next.js 16.3.5 bundled docs (`node_modules/next/dist/docs/`) | ships with the installed version | `next/dynamic`, redirects, MDX, prefetching, view transitions |
| Cloudflare Web Analytics, RUM beacon, JavaScript Detections, Speed Brain docs | updated 2026-04 to 2026-08 | Analytics and edge side effects |
| CNIL audience-measurement page and grid; ICO storage and access guidance; EDPB Guidelines 2/2023 | 2025-07; 2026-04-29; 2024-10-07 | Counter exemption |
| GitHub Docs (community profiles, labels, SECURITY.md, attestations, Discussions) | living, read 2026-09-27 | Repository items |
| Open Source Guides | living, undated | Launch files, response time, governance |
| OpenSSF Concise Guide; Scorecard v5.5.0 | 2025-04-23; released 2026-04-23, run 2026-09-27 | Trust signals, score 4.7 |
| He et al., Six Million (Suspected) Fake Stars, ICSE 2026 | arXiv v2 2025-09-06 | Stars as a weak signal |
| Hora and Robbes, AI Policy, Disclosure, and Human in the Loop | arXiv 2026-05-15, revised 2026-07-13 | AI contribution policies |
| Tan, Zhou and Sun, good first issues (FSE 2020); Steinmacher et al. (2014/2015) | foundational | Contributor barriers |
| FTC rule on fake reviews and testimonials | in force 2024-10-21 | Social-proof rules |
| Live sites (32 homepages, 16 docs pages, 20 theme checks) | measured 2026-09-27 | Peer benchmarks |
