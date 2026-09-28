# Site project brief

The Run Hound website (`site/`) is built from this brief. It is the result of the redesign research of 2026-09-27 and the
maintainer's decisions; **the research is closed**. Build from these documents. A question they don't answer goes to the
maintainer, not to a new round of research. Changes to the brief are decisions: record them in
[DECISIONS.md](../../DECISIONS.md) and edit the brief in the same change.

| Document | What it is |
|---|---|
| [maintainer-decisions.md](maintainer-decisions.md) | The maintainer's decisions (2026-09-27). They win over the other two where they differ. |
| [design.md](design.md) | The approved design ("Evidence first", with grafts): visual system, page templates, motion, and the build contract with its budgets and gates (§5.2). |
| [research-brief.md](research-brief.md) | The research brief the design is built on: measurements of the old site, principles, information architecture, homepage, motion, trust, SEO/GEO, refactor, risks. |

How the site is verified: the build guards in `site/scripts/` run on every `pnpm build`, and the Playwright lab
(`site/scripts/lab/`) runs the budgets and gates of design.md §5.2 once, at the end of a piece of work, not between steps.

The research lens reports, the prototypes and the judges' notes the brief cites (`<research scratch folder>/…`) were
working files and are not in the repository; the brief and the design keep everything that was decided from them.
