# Run Hound brand

One brand across the marketing site (`site/`), the local web UI (`app/src/server/ui/`, served by `app/src/server/app.ts`), reports (`report.html`) and evidence frames. Consistency is the rule: same palette, type, logo and voice everywhere.

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

- **Accent sparingly:** one primary action per view, the key word in a headline, active states, progress.
- Status: pass = accent, fail = `fail`, running = accent outline ring, queued = `dim`.
- Severity: critical/high = `fail`, medium = `warn`, low = `dim`.
- Evidence frames keep their own highlight tones (fail red, pass green, info), since they sit on screenshots of other people's apps.

## Type

- **Display:** Bricolage Grotesque, extra bold, tight tracking (headlines, big numbers).
- **Body:** Geist.
- **Mono:** Geist Mono (labels in small caps with wide tracking, URLs, code, timings).
- The local UI and reports can't load web fonts offline; they use the same stack with system fallbacks (`ui-sans-serif, system-ui` and `ui-monospace`).

## Logo

- `site/public/brand/hound-mark-light.png`: light strokes with the mint highlight, for dark backgrounds (default).
- `site/public/brand/hound-mark-dark.png`: navy strokes, for light backgrounds.
- `site/public/brand/hound-mark-light-160.png`: small light mark for the app UI and reports (embed as a data URI).
- `site/src/app/icon.png` (512) and `apple-icon.png` (180): the mark on a `#0A1014` rounded square.
- Source: `site/assets/hound-logo.png`. Wordmark: "Run Hound" in the display face next to the mark. Never recolour the mark or put it on a busy background.

## Voice

Calm, specific, evidence first. Show proof, not adjectives.

- **Lead with AI-assisted positioning:** Run Hound is AI-assisted UI testing for AI-built apps.
- **AI features are shipped and optional (0.3.0):** plan review (a model recommends and ranks each scenario with a reason), AI-suggested flows (built only from discovered fields and buttons, checked deterministically, unticked by default, findings advisory) and AI explanations (advisory, beside the built-in text), with "Bring your own model" (Ollama, LM Studio, llama.cpp, vLLM, any OpenAI-compatible endpoint, Amazon Bedrock). Always say they are **off by default** and **never decide pass or fail**; don't label them "coming soon".
- **Shipped vs planned.** Shipped: V0 (one form) and V1 (the whole page) in 0.1.0 and 0.2.0; optional AI in 0.3.0; and in 0.4.0 the **V2 preview**: test accounts and signed-in runs, access checks (can another account or a signed-out visitor read your data), mass assignment and deep links, plus modern widgets and forms in dialogs; in 0.5.0 the CSRF check (`csrf`). Call V2 a "preview", not done. Keep "planned" labels only for what isn't built: multi-page feature runs, write-side access checks (`write-access`), rate limits, file upload, prompt injection, paywall trust (`paywall-trust`), whole-app testing (V3), live staging sites (V4), vision, editing scenarios and a hosted runner.
- **Say what discovery covers, not "every form".** Run Hound finds up to 5 forms per page (native fields and the common widget libraries: Radix/shadcn, Headless UI, cmdk, MUI), forms behind up to 3 dialog or sheet buttons, and up to 40 controls outside the forms. Don't write "finds every form and control".
- **Never overstate the model's role.** Marketing copy avoids "no AI", "rule-based only" or "deterministic only" framing, and never implies a model judges results. Legal pages stay factually precise about data flows: with AI off nothing is sent to any AI provider; with AI on, only redacted page structure goes to the provider the user configures (remote endpoints need consent per host; a remote model gets the page path only, a local one the full address with its query, redacted), and Run Hound itself operates no AI service.
- **Open source, public repository:** anyone can clone it, try it and file issues. No "invite-only", "request access" or "the person who invited you".
- **Every verdict is backed by a real check and evidence:** "AI plans and explains; real checks decide." Pass or fail comes from a real check in a real browser, never from a model guessing.
- No invented users or numbers.
