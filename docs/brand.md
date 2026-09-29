# Run Hound brand

One brand across the marketing site (`site/`), the local web UI (`app/src/server/ui/`, served by `app/src/server/app.ts`), reports (`report.html`) and evidence frames. Consistency is the rule: same palette, type, logo, voice and motion everywhere.

## Palette ("Hound")

Blue-green near-black with a mint accent, taken from the logo.

| Token | Hex | Use |
|---|---|---|
| `bg` | `#0A1014` | Page background |
| `bg-deep` | `#070B0E` | Sidebars, deepest wells |
| `surface` | `#10171C` | Cards, panels |
| `surface-2` | `#141D23` | Raised rows, inputs |
| `surface-3` | `#19242B` | Selected/active rows |
| `line` | `#1E2A31` | Borders |
| `line-soft` | `#172127` | Dividers |
| `line-strong` | `#2A3841` | Emphasised borders, secondary buttons |
| `fg` | `#E9EFEC` | Primary text |
| `muted` | `#A7B4B0` | Secondary text |
| `dim` | `#82918D` | Labels, captions (lowest text contrast allowed on `bg`: about 5.7:1) |
| `accent` | `#5EE6A3` | Primary buttons, links, highlights, progress, pass |
| `accent-strong` | `#7DEDB6` | Hover on accent |
| `accent-ink` | `#04150D` | Text on accent fills |
| `fail` | `#FF6B6B` | Failures, critical/high severity |
| `warn` | `#F5B642` | Medium severity, warnings |

- **Accent sparingly:** it marks the one thing to do or the one thing that changed. One primary action per view, the key word in a headline, active states, progress.
- **The accent budget.** In any viewport-sized window of any page of the site at rest, there is at most **one strong accent object** outside the exempt uses. "Strong" means a filled shape, an accent stroke of 2 px or more, or accent display text. Exempt: the primary button, link text, focus rings, the key words of the h1 and of the homepage's closing h2, the markers that show where the reader is in navigation (the header's active underline, the current page's rule in the docs sidebar, the filled current ring of a docs page's "On this page" trail), and the status marks inside a product figure (the run window's progress bar and ticks), which follow the status rules below. On the site, the Playwright lab counts the rest inside `<main>`: it skips links, buttons and anything inside an element marked `data-accent-exempt`, so an exempt mark that is not a link or a button carries that attribute. The local web UI and reports are the product itself and sit outside the budget: their status marks and checked controls follow the status rules.
- What the budget means in practice: a tick used as a bullet (the proof strip, a facts line) is `dim`, not accent, because it marks no result; accent ticks mark a pass or a check (the run window's plan rows, the ticks beside the examples in the homepage's checks band); icons are `muted`; cards have no accent top bars; a decorative outline that draws in settles to `line-strong`.
- Status: pass = accent, fail = `fail`, running = accent outline ring, queued = `dim`.
- Severity: critical/high = `fail`, medium = `warn`, low = `dim`.
- Evidence frames keep their own highlight tones (fail red, pass green, info), since they sit on screenshots of other people's apps.

## Type

- **Display:** Bricolage Grotesque, extra bold, tight tracking (headlines, big numbers).
- **Body:** Geist.
- **Mono:** Geist Mono (labels with wide tracking, URLs, code, timings). Mono labels are in uppercase only when they have at most 3 words. Reports don't follow this everywhere yet: in `app/src/engine/report.ts`, `.finding dt` puts a finding's evidence fact labels (such as "Fields showing an error") in capitals at any length, and `.ai-explain .ai-head` does the same to the AI explanation's heading with the model's name.
- The local UI and reports can't load web fonts offline; they use the same stack with system fallbacks (`ui-sans-serif, system-ui` and `ui-monospace`).

## Logo

- `site/public/brand/hound-mark-light.png`: light strokes with the mint highlight, for dark backgrounds (default).
- `site/public/brand/hound-mark-dark.png`: navy strokes, for light backgrounds.
- `site/public/brand/hound-mark-light-160.png`: small light mark for the app UI and reports (embed as a data URI).
- `site/src/app/icon.png` (512) and `apple-icon.png` (180): the mark on a `#0A1014` rounded square.
- Source: `site/assets/hound-logo.png`. Wordmark: "Run Hound" in the display face next to the mark.
- **The mark is the logo.** Never recolour it, never animate it and never put it on a busy background. On the site it sits in the header, the footer's brand block, the favicons and the social image, never in the homepage hero.
- **The line hound** is an illustration, not the logo: the mark's geometry traced as 8 uniform, round-capped strokes, in `fg` with the one brow stroke in `accent`, as the mark has it. It is `aria-hidden` and appears **at most once per page**: resting and static above the homepage's closing heading (64 px, from 640 px wide), or walking the trail on the 404 page. Never beside a docs h1 or a check page's eyebrow, never on a figure, never in the hero, never repeated down a page. On the site it is one `<symbol>` per page (`site/src/components/hound/line-hound.tsx`).

## Voice

Calm, specific, evidence first. Show proof, not adjectives.

- **Lead with AI-assisted positioning:** Run Hound is AI-assisted UI testing for AI-built apps.
- **AI features are shipped and optional (0.3.0):** plan review (a model recommends and ranks each scenario with a reason), AI-suggested flows (built only from discovered fields and buttons, checked deterministically, unticked by default, findings advisory) and AI explanations (advisory, beside the built-in text), with "Bring your own model" (Ollama, LM Studio, llama.cpp, vLLM, any OpenAI-compatible endpoint, Amazon Bedrock). Always say they are **off by default** and **never decide pass or fail**; don't label them "coming soon".
- **Shipped vs planned.** Shipped: V0 (one form) in 0.1.0; V1 (the whole page) in 0.2.0, with optional AI in 0.3.0 and modern widgets and forms in dialogs in 0.4.0; and the **V2 preview**: in 0.4.0 test accounts and signed-in runs, the access check (`access-control`: can another account or a signed-out visitor read your data), mass assignment (`mass-assignment`) and deep links (`deep-links`); in 0.5.0 the CSRF check (`csrf`); in 0.6.0 two more write-side checks, `write-access` (can another account or a signed-out visitor change or delete your data) and `paywall-trust` (can an account get a paid plan without paying), with two-step sign-in and sessions kept in sessionStorage. Call V2 a "preview", not done. Keep "planned" labels only for what isn't built: multi-page feature runs, the other two paywall probes (a checkout replayed with a changed price or plan, and the APIs only paid accounts use), rate limits, file upload, prompt injection, whole-app testing (V3), live staging sites (V4), vision, editing scenarios and a hosted runner. V0 to V4 are stages, not versions, so copy says "V2 preview" or "the V2 stage", never "version 2" or "Run Hound V2" as if it were a release. 1.0.0 is the release that completes V4, and 0.9.9, right before it, is the `npx run-hound` release.
- **Say what discovery covers, not "every form".** Run Hound finds up to 5 forms per page (native fields and the common widget libraries: Radix/shadcn, Headless UI, cmdk, MUI), forms behind up to 3 dialog or sheet buttons, and up to 40 controls outside the forms. Don't write "finds every form and control".
- **Never overstate the model's role.** Marketing copy avoids "no AI", "rule-based only" or "deterministic only" framing, and never implies a model judges results. Legal pages stay factually precise about data flows: with AI off nothing is sent to any AI provider; with AI on, only redacted page structure goes to the provider the user configures (remote endpoints need consent per host; a remote model gets the page path only, a local one the full address with its query, redacted), and Run Hound itself operates no AI service.
- **Open source, public repository:** anyone can clone it, try it and file issues. No "invite-only", "request access" or "the person who invited you".
- **Every verdict is backed by a real check and evidence:** "AI plans and explains; real checks decide." Pass or fail comes from a real check in a real browser, never from a model guessing.
- No invented users or numbers.

### Copy rules

For the site's pages. On the homepage, `pnpm build` fails above 750 words in `<main>`, and warns on an h2 over 8 words, an intro over 25, a sentence over 25 and a caption over 15 (`site/scripts/check-copy.mjs`).

- **Headings are statements**, not questions: read in order, they carry the pitch on their own. Put the key noun or number early ("26 checks: accessibility, features and security"). An h2 has at most 8 words. A card or an FAQ entry may ask the reader's own question ("Can everyone use the page?", "Is my vibe-coded app secure?").
- **Short blocks.** A section intro has at most 25 words. A card title has at most 5 words, and its body at most 22.
- **Sentences** have at most 20 words and never more than 25.
- **Captions** are in sentence case and have at most 15 words.
- **Uppercase** only for mono labels of at most 3 words (an eyebrow, the "HIGH" severity chip). Headings in the display or body face, captions and buttons are never uppercase; a mono label of at most 3 words may be a heading (the footer's column headings).
- **Kennel and Fernway** are defined at first use on a page, and at most once each on the homepage. Kennel is a pet-sitting booking page and Fernway a small SaaS app built the way AI app builders build apps, each with planted bugs and a clean version.
- **Where stages and releases appear.** On the homepage and in page heroes, a preview feature gets a plain "Preview" tag, never a release label such as "NEW IN 0.5.0" or "SINCE 0.3.0". The current release appears as a fact, never as a label on a feature: the header's release chip ("Changelog · v0.6.0" in the phone menu), the homepage's release pill and facts line, the footer's release line, and the meta line of docs and check pages ("For release 0.6.0 · Updated …", "Checked against release 0.6.0 · …"). A check's facts and its card on the checks hub may say the release that added it ("Added in 0.6.0"). The roadmap and the changelog say which release shipped what. No page writes the current release by hand: it comes from `version` in `site/src/lib/site.ts`. The pill's "New in 0.6.0: …" is the release itself, not a label on a feature. Stage names (V0 to V4) belong where the roadmap is explained (the open-source page's roadmap, the checks page, the docs, the changelog), named as "Shipped vs planned" says.
- **"Vibe-coded" is a secondary term.** "AI-built apps" stays the main term everywhere. Use "vibe-coded" where people search with it: once in the first paragraph of the AI-built apps page, in one of its h2s, in the FAQ question "Is my vibe-coded app secure?", and when quoting a source that uses it. Never in an h1, a page title, the one-line definition or the homepage hero.

## Motion

Motion shows the product working, progress through a run, proof arriving, or the result of what the reader just did. It never decorates and never delays reading. These rules hold on the site, in the local web UI and in reports, except where a rule or "Where it moves" names an exception.

1. **Purpose first.** Every moving thing is the product working (the homepage's hero run), progress through the loop (the pipeline in the homepage's How it works band), proof arriving (evidence, ticks) or feedback on an action. Anything else ships static.
2. **Text never moves or waits.** No heading, paragraph, caption, card text, link or button is ever faded, moved, blurred, split or typed in. Only `aria-hidden` figure internals, lines, rings, ticks, outlines, media inside figures (never their captions) and the line hound move. Feedback on the reader's own action is the exception (rule 1): a pressed button may scale to 0.97, the arrow in a button, an arrow link or the release pill may nudge 2 px (`--motion-nudge`) on hover and focus, and a panel the reader opens (the phone menu, the search dialog, a tab panel) may fade in and rise or grow into place in `--transition-duration-short`.
3. **One story per page, played once.** Then it rests on the finished state. The hero run has a Replay button. Scroll effects play once per page view, and their triggers are removed.
4. **Scroll starts effects; it drives only one.** Only the pipeline in the homepage's How it works band is drawn by scrolling. No scroll-jacking, pinning, parallax, smooth-scroll library or scrubbed text, and no `scroll-behavior: smooth`.
5. **Transform, opacity and SVG stroke drawing only.** Rises of 8 to 16 px; scale 0.96 to 1.04.
6. **One accent-coloured thing moves at a time.** On the site, a unit test holds each storyboard to it. Status colours follow the palette: running is an accent ring, pass is accent, fail and high severity are `fail`. Live status in the local UI is the exception: its running ring, Live dot and progress bar may move together while a run lasts.
7. **Interruptible.** A pointer or key inside the hero run skips to its end. Focus moving into an effect, printing, or jumping past it finishes it.
8. **The finished state is the server's state.** Readers without JavaScript, crawlers, screenshot tools, reduced motion and Save-Data all get it. Decorative parts that rest invisible do so by class, never by inline style.
9. **Nothing loops and nothing waits in the background.** No `requestAnimationFrame` loop runs at rest. Only status that is really live moves, and only while it lasts: the local UI's running ring, its Live dot, its live view of the page and its elapsed clock.
10. **Real numbers only.** No number animates or counts up to its value; a live clock shows the real elapsed time. Every value shown in motion comes from a real run.
11. **Frequent and keyboard-driven actions don't move things.** Arrow keys switch tabs at once; hover on repeated cards changes colour only.

### Where it moves

- **The site:** the homepage's hero run, once, with Replay. The pipeline in the homepage's How it works band, drawn as you scroll. The evidence trio and the check cards, drawn once as they come into view. Below-the-fold figure reveals, and the hound on the 404 page. CSS micro-interactions: button presses, hover colour, arrow nudges and Copy; the header turning opaque after 8 px of scroll (a step, not a scrub); the phone menu and the search dialog opening; the docs "On this page" marker; the ring on a linked card, fading once; and a tab crossfade where a tablist remains. Evidence recordings (GIFs) play once and rest on the frame that proves the finding.
- **The local web UI** (`app/src/server/ui/styles.ts` and `client.ts`): a running scenario's ring spins, and the dot on the Live badge pulses while the badge says Live. The progress bar grows (400 ms) and switches slide (150 ms); they move by width and position, from before rule 5, and new motion follows rule 5. On screens up to 68rem wide, choosing a finding scrolls its detail into view smoothly (at once under reduced motion). While a run is live, the Browser preview swaps in each new frame of the page under test, and the elapsed time goes up once a second. Both are the run itself, so they keep updating under reduced motion. Nothing else moves, apart from the evidence recordings below.
- **Reports** (`report.html`) have no motion of their own.
- **Evidence recordings** in reports and the local UI still loop as Run Hound writes them (`repeat: 0` in `app/src/engine/evidence.ts`), an exception to rule 9 until the app writes them to play once. Only the site's copies play once.

### Reduced motion, Save-Data and print

- With `prefers-reduced-motion: reduce`, distances, staggers and draws go to zero, and spins and pulses stop. Colour and opacity changes of 180 ms or less may be removed too: the site shortens every animation and transition to 0.01 ms, and the local UI turns them off.
- On the site, reduced motion and Save-Data both mean the animation code (GSAP) is never downloaded: every figure shows its finished frame, and the hero has no Replay.
- No motion toggle of our own: the system setting covers it (WCAG 2.3.3 is AAA). On the site, everything that plays by itself ends in under 5 s, and the longest, the hero run, has Replay and skips on any input.
- Print and forced colours get the finished frames.

### Tokens and tools

- **One copy of the numbers.** The site's durations, easings and distances live only in `site/src/styles/tokens.css`:
  - durations: `--transition-duration-micro` (presses, hover colour, ticks), `-short` (copy state, the menu, dialogs), `-medium` (rises, rail moves) and `-long` (crossfades, the trace fade);
  - easings: `--ease-enter`, `--ease-exit`, `--ease-move`, and `--ease-stamp` for the 404 hound's nose only;
  - the `--motion-*` distances and times. Reduced motion sets all of them but the hold to zero.
- Tailwind exposes them as `duration-short`, `ease-move` and so on, and `site/src/motion/tokens.ts` reads them for GSAP. New motion in the local UI and reports, which can't load the site's CSS, takes its values from that file.
- Progress bars and the pipeline's connectors are linear. Staggers stop at 6 items.
- **Tools.** CSS for micro-interactions. GSAP, with ScrollTrigger and DrawSVG, only inside `site/src/motion/`, loaded after the page has loaded and only when motion is allowed. GSAP is under its Standard 'no charge' license (https://gsap.com/standard-license), not an OSI licence: import it only inside `site/src/motion/`, and never copy its code into the repository.
