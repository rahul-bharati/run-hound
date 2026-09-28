# Maintainer decisions for the site redesign (2026-09-27; they override BRIEF.md where they differ)

1. **Ships in 0.6.0**, in the same branch, PR and release as the 0.6.0 code (write-access, paywall-trust, two-step and
   sessionStorage sign-in).
2. **Motion: richer, with ScrollTrigger.** Keep the brief's GSAP hero run (plays once, skippable, replay). Add
   scroll-linked motion graphics: the How it works steps and a pipeline diagram drawn as you scroll (ScrollTrigger +
   DrawSVG, both free since GSAP 3.13), check cards and the evidence "stamp" animating in, below-the-fold figure
   reveals, and the animated 404 hound; CSS micro-interactions everywhere else. Keep every guard from the brief: GSAP
   and its plugins load only after the load event plus idle and only when prefers-reduced-motion is no-preference and
   Save-Data is off; transform and opacity (and SVG stroke) only; triggers play once and are killed afterwards (no
   lasting scroll-time loop); no scroll-jacking, pinning of text, parallax or animated text; CLS stays 0 and the h1
   stays the LCP; every fact stays visible, server-rendered text.
3. **Scope: everything in the brief**: the quick fixes, the refactor (route registry, facts and content modules, build
   guards for copy, links, anchors and budgets, /_design/), the homepage, header and footer, motion, the docs split into
   MDX pages, site search (Pagefind if it works under the CSP), and the 26 per-check pages /checks/<id>/. Because the
   brief gates check pages on reports linking to them, 0.6.0 also makes each finding in the report (HTML, Markdown) and
   the web UI link to its check page.
4. **No contributions yet.** No CONTRIBUTING.md, code of conduct, DCO/CLA, Discussions or contributing page, and no
   /contribute/ alias. The open-source page gets "How to help today" (try it, report bugs, send feedback). A short root
   SECURITY.md that only points to the existing disclosure policy is fine (it fixes GitHub showing docs/security.md).
5. **Defaults for questions not asked:** no new analytics or tracking in 0.6.0 (Cloudflare Web Analytics stays as it
   is); no "built with AI" or employer statement; no light theme or localisation; Cloudflare dashboard changes stay with
   the maintainer.
