# Run Hound brand

One brand across the marketing site (`site/`), the local web UI (`app/src/server/app.ts`), reports (`report.html`) and evidence frames. Consistency is the rule: same palette, type, logo and voice everywhere.

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

Calm, specific, evidence first. Show proof, not adjectives. Never claim what V0 doesn't do: no "AI generates" (V0 planning is rule-based), no "bring your own model" (planned), no invented users or numbers.
