# V1 spec: single page on localhost

The build contract for V1 (0.2.0). It extends [v0-spec.md](v0-spec.md), which still holds for everything not changed here: the safety gate and navigation guard, the form checks, evidence, groups, timing and the tester release rules. The acceptance suite enforces both.

## Discovery: the whole page

`discoverPage(page)` (`app/src/engine/discover.ts`) returns a `DiscoveredPage`:

- **`forms`**: every form scope on the page with at least one usable field, at most 5, the one with the most fields first (document order on a tie), so `forms[0]` is the form V0 would have picked. A scope is a `<form>`, or the tightest container of fields that sit outside every `<form>` and has a button (with forms on the page, a container that holds a `<form>` is not a candidate). Each form carries its `index`.
- **`controls`**: buttons and button-like controls outside every form scope (`button`, `input[type=button|submit|reset|image]`, `[role=button|switch|tab]`, `summary`, and links whose `href` is empty, `#` or `javascript:`). Hidden and disabled controls are left out; at most 40.
- **`links`**: how many links with a real `href` the page has. They navigate by definition and are not clicked; following them is V3 (whole app).
- **`title`**: the document title.

A page without a form is **not** an error any more: it is planned with the page-wide checks and a plan warning ("No form was found on this page…"). It is still refused (`NoFormFoundError`, CLI exit 2, API 400) when the page answered 4xx/5xx, when a dev server refused the host name, or when no page-wide check applies either (an empty plan would look like a clean pass).

## Planning

`Check.scope` is `"form"` (default) or `"page"`. `buildPlan(target, page, checks)`:

- **Form checks** plan once per form, with `scope: "form"`, `formIndex` and `scopeLabel` (the form's name + " form", or "Form N"). Scenarios of the first form keep their V0 ids; later forms add `@form-<n>` ("dead-control:activate-controls@form-2"). With more than one form, titles end with the form's label.
- **Page checks** plan once, with `scope: "page"` and `scopeLabel: "Whole page"`. Page-scoped: `bundle-secrets`, `reflow-320`, `focus-visible` (one set of scripts, one layout and one Tab order per page) and the five V1 checks.
- **Search forms** (`DiscoveredForm.search`: `role="search"`, inside `<search>`, only search fields, or a GET form with an `action` and one or two short fields) save nothing, so `persistence`, `double-submit`, `silent-failure`, `client-only-validation` and `verbose-errors` don't plan for them. `keyboard-completion` counts a GET navigation to the same site as the form being sent. A nameless search form is labelled "Search form".
- **One finding per problem across forms:** `axe-states` scans the whole page for the main form but excludes the other forms, and scans only its own form for the others (a state where that form is gone, such as a search results page, is not scanned). Run Hound's own placeholder-only label rule follows the same scope. Test values carry the form's number (`…f2…`), so one form's saved record never answers for another's.
- **Forms that don't show what they save:** when none of `persistence`'s values is visible after reload *and* none was shown right after saving, the page doesn't display saved records (a newsletter or contact form): the scenario is skipped with that reason instead of reporting lost data. A value shown after saving and gone after reload is still a finding.
- **Session-ending controls** ("Log out", "Sign out", "Disconnect", "Cancel subscription", "Close account", "Empty cart", "Clear all", "Reset all …") count as destructive, like "Delete", so neither `dead-control` nor `page-controls` clicks them without `--allow-destructive`.
- `Plan.page` holds the `DiscoveredPage`; `Plan.form` stays the main form (an empty form, `selector: "body"`, when there is none), so V0 readers keep working. Plans and reports written by V0 have no `page` and no scopes; everything reads them as one form.
- The runner gives each scenario its own form (`CheckContext.form`) and the whole page (`CheckContext.discoveredPage`), and stamps each finding with its scenario's `scopeLabel` (`Finding.scope`), shown in the web UI and both reports.
- The CLI prints `planSummary(plan)` ("Found 2 forms (…) and 3 controls outside them; 24 scenarios planned.") and each scenario's `[scopeLabel]` with `--plan-only`. The web UI shows the same inventory above the plan and a scope chip on each scenario ("Whole page", or the form's label on a page with several forms) plus "New in V1" on the V1 checks.

## Browser

Every browser context gets `locale` = Node's resolved locale (a valid BCP 47 tag). Chromium otherwise takes it from `LANG`, and with `LANG` unset (common in containers) reports `en-US@posix`, which the page's own `Intl` APIs reject.

`Capture.requests[].responseHeaders` records every response header (`allHeaders()`, so `set-cookie` is included) for responses from the page's origin and other local origins.

## V1 checks

All five are page-scoped. **Dev servers** (a request to a hot-reload client or dev-only runtime: Vite, Next.js dev, webpack dev server, Nuxt, Astro; `looksLikeDevServer`) don't send production headers, cookie flags or CORS settings, so `security-headers`, `cookie-flags` and `cors` mark their findings **advisory** there and `source-maps` is **skipped** with the reason.

| Check id | Group | Scenario | Pass when | Fail when (finding) |
|---|---|---|---|---|
| `page-controls` | Features | Click every control outside the forms (at most 20, destructive-looking names left out unless `--allow-destructive`), each on a freshly loaded page, with the same probe as `dead-control` (nothing typed first) | Each causes a request, DOM change, navigation, storage change, value change or focus change | A control does nothing (high). One finding for all of them; GIF of the click |
| `security-headers` | Security | Read the headers of the page's own document response | CSP present and limiting scripts, `frame-ancestors` or `X-Frame-Options: DENY/SAMEORIGIN`, `X-Content-Type-Options: nosniff`, no `unsafe-url`/`no-referrer-when-downgrade` referrer policy, HSTS on https | One finding listing every problem: missing CSP, missing clickjacking protection, missing HSTS on https (medium); missing nosniff, CSP allowing any script, leaky referrer policy (low; advisory when only these). Card of the headers with the problems marked |
| `cookie-flags` | Security | Read the cookies the page sets on load (`context.cookies()` plus `Set-Cookie` headers) | Every session-like cookie (name matches session, sid, auth, token, jwt, remember, login…; CSRF tokens excluded) is HttpOnly, not `SameSite=None` (from the header), and Secure on https | A session cookie lacks HttpOnly (high; "set by a page script" when no `Set-Cookie` set it), is `SameSite=None` (medium) or lacks Secure on https (high). Values are never shown |
| `cors` | Security | Repeat up to 5 of the page's own 2xx GETs (same origin or the app's API on another local origin) plus the page itself from a sandboxed iframe, so the browser sends `Origin: null` (any website can). The frame lives in a blank page Run Hound serves on 127.0.0.1 for the scenario (a loopback page, so Chromium's local-network rules allow the requests) in the same guarded context | The browser lets the frame read none of the answers | An answer is readable by `Origin: null` with `Access-Control-Allow-Credentials: true` (high), or without credentials (low, advisory). `*` without credentials is a public API and passes. Only GETs the page already made are repeated (never paths that act, such as `/logout` or `/unsubscribe`), with no redirects and 10 s each: nothing is created or changed |
| `source-maps` | Security | For up to 15 same-origin scripts: the `SourceMap`/`X-SourceMap` header, else the `sourceMappingURL` comment, else `<script>.map`; fetched from the page, no redirects, same origin only, streamed and cut at 8 MB, 15 s each | No map is served | A public map with `sourcesContent` (medium) or with source names only (low). Inline `data:` maps count. Card with the map URLs and source paths |

## Kennel V1

Clean mode sends `Content-Security-Policy` (allowing the analytics origin in `connect-src`), `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin` on every response; sets `kennel_session` as `HttpOnly; SameSite=Lax`; sends no CORS headers on its API; builds hidden source maps and answers 404 for them; and has a `Refresh` button beside "Your bookings", outside the form. [CONTRACT.md](../fixtures/kennel/CONTRACT.md) has the details.

| Bug | Change | Caught by |
|---|---|---|
| F07 | `Refresh` has no click handler | `page-controls` |
| S05 | No security headers | `security-headers` |
| S06 | `kennel_session` without HttpOnly | `cookie-flags` |
| S07 | The API echoes any `Origin` (including `null`) with credentials | `cors` |
| S08 | Source maps (with `sourcesContent`) are served | `source-maps` |

`KENNEL_BUGS=all` turns on every V0 and V1 bug. Golden files: `fixtures/kennel/expected/{F07,S05,S06,S07,S08}.json`; `clean.json` requires every V0 and V1 check to pass.

## Containers

`docker-compose.yml` runs Run Hound with every test app: `kennel` (bugs from `KENNEL_BUGS`, default all), `kennel-clean`, and the five sample apps from one small image (`fixtures/samples/Dockerfile`). Inside the network the apps are reached by service name (`http://kennel:3000/book`, `http://spa-fetch:4102/`, …), and `RUNHOUND_ALLOWED_HOSTS` lists them. `.env.example` documents every setting (host ports, `KENNEL_BUGS`, the runs folder, allowed hosts); every published port is bound to `127.0.0.1`. The `cross-origin-api` sample reads `PAGE_HOSTS` so its API accepts the page's service-name origin.
