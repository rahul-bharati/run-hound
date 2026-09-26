# Kennel runtime contract

This complements `docs/v0-spec.md` and, for the V1 parts, `docs/v1-spec.md` (the specs win on any conflict). The contract tests in `test/` enforce it.
Anything named here (texts, attribute values, field keys) is load-bearing: tests and Run Hound checks rely on it.

## Process

- Build: `vite build` (output in `dist/`). Start: `node server/index.mjs` from `fixtures/kennel`.
- Env:
  - `PORT` (default `3000`): Kennel app and API.
  - `ANALYTICS_PORT` (default `3001`): mock third-party analytics server, started by the same process.
  - `KENNEL_BUGS`: `none` (default), `all` (every V0 and V1 bug), or a comma list such as `F01,A03` (case-insensitive, whitespace ignored).
  - `HOST` (default `0.0.0.0`): bind address for both servers.
- When both servers are listening, the process writes a line containing `kennel listening` to stdout.
- Exits cleanly on `SIGTERM` / `SIGINT`.

## Mock analytics (separate origin)

- `GET /collect` and `POST /collect`: record the hit, answer `204`. Only `/collect` hits are recorded.
- `GET /hits`: `200 { "hits": [ { "method": "GET" | "POST", "url": "/collect?...", "body": "<raw body string>" } ] }` in arrival order.
- `POST /reset`: clears hits, answers `204`.
- Sends `Access-Control-Allow-Origin: *` and answers CORS preflight (`OPTIONS`) with `204`, so the browser never logs a CORS error.

## API (Kennel origin)

| Method and path | Behaviour |
|---|---|
| `GET /api/__config` | `200 { "bugs": ["F01", ...], "analyticsUrl": "http://<request hostname>:<ANALYTICS_PORT>" }`. `bugs` is `[]` in clean mode and every V0 and V1 id for `all`, sorted. |
| `POST /api/__reset` | clears all bookings, `204` |
| `GET /api/availability` | `200 { "available": true }` |
| `GET /api/bookings` | `200` JSON array of bookings, oldest first |
| `POST /api/bookings` | `201` booking, `400 { "errors": { <field>: <message> } }`, or `500 { "error": "Something went wrong" }` |
| `DELETE /api/bookings/:id` | `204`, or `404 { "error": "Not found" }` |
| any other `/api/*` | `404 { "error": "Not found" }` |
| `GET /` | redirects (`302`) to `/book` |
| `GET /book` | the built `index.html` (SPA); static assets from `dist/` |

Booking fields (request body keys = response keys = `errors` keys):

| Key | Rule |
|---|---|
| `petName` | required, trimmed, 1..50 chars |
| `petType` | required, one of `dog`, `cat`, `other` |
| `startDate` | required, valid `YYYY-MM-DD` |
| `endDate` | required, valid `YYYY-MM-DD`, on or after `startDate` (clean mode) |
| `ownerEmail` | required, looks like an email (`x@y.z`) |
| `phone` | optional string, max 30 chars; `""` when absent |
| `instructions` | optional string, max 1000 chars; `""` when absent |

A created booking is `{ id, petName, petType, startDate, endDate, ownerEmail, phone, instructions, createdAt }`. Unknown keys (for example a password) are ignored and never stored or echoed.
A malformed JSON body gets `400 { "errors": { "body": "..." } }`.
`petName === "Crash"` (after trim) makes the create request fail with `500 { "error": "Something went wrong" }`.
In clean mode no response body ever contains a stack trace, file path or `node:internal` reference.

## Page `/book`

- `<h1>` "Book a sitter"; one `<form>`; favicon provided (no 404 on load).
- On load the frontend calls `GET /api/__config`, `GET /api/availability` and `GET /api/bookings`.
- Labels (visible `<label>` text = accessible name, exact): `Pet name`, `Start date`, `End date`, `Owner email`, `Phone`, `Special instructions` (textarea), `Password`, `Confirm password`.
- Pet type: `<fieldset>` with `<legend>Pet type</legend>` and three native `<input type="radio" name="petType">` labelled `Dog`, `Cat`, `Other` (values `dog`, `cat`, `other`).
- "Create an account" is a `<fieldset>` (legend "Create an account") holding the two password inputs, both `type="password"` with `autocomplete="new-password"`. Passwords are never sent in the booking request. Owner email has `autocomplete="email"`, phone `autocomplete="tel"`.
- Owner email has helper text `We only use this to confirm your booking.` in an element with `data-kennel="email-hint"`, referenced by the email input's `aria-describedby`; its text contrast is at least 4.5:1.
- Buttons: `Book` (type submit), `Save draft` (type button), an icon-only clear button next to pet name with accessible name `Clear pet name` and `data-kennel="clear-pet-name"` (clears the pet name input and focuses it), and in the bookings list one icon-only remove button per booking with accessible name `Remove booking for <petName>` and `data-kennel="remove-booking"` (sends `DELETE /api/bookings/:id`, then refreshes the list).
- Every button and radio has a rendered box of at least 24x24 px.
- Save draft writes the form values (no passwords) as JSON to `localStorage["kennel:draft"]` and shows `Draft saved` in a `role="status"` element.
- Client validation on Book: every invalid field gets `aria-invalid="true"` (for pet type: the radios or their fieldset) and `aria-describedby` pointing at a visible error message element; a polite live region (`aria-live="polite"` or `role="status"`) announces that the form has errors. Error message text is red (computed colour with red > 150, green and blue < 100) in every mode. End date before start date is rejected in the browser with an `endDate` error (in every mode).
- While the create request is pending, Book is `disabled`.
- On success: the booking list reloads and a `role="status"` message `Booking saved` appears; the form is reset.
- On a server error: a visible `role="alert"` element shows `Something went wrong`, all inputs keep their values and Book is enabled again.
- "Your bookings": a `<section>` with `<h2>Your bookings</h2>` and a `<ul>` with one `<li>` per booking from `GET /api/bookings`, showing pet name, pet type (`Dog`/`Cat`/`Other`), start and end dates as `YYYY-MM-DD`, owner email, phone and special instructions as plain text.
- After a successful booking the frontend sends one `POST <analyticsUrl>/collect` with body `{"event":"booking_created"}` (no personal data).
- Focus: every focusable control shows an outline (non-`none` style, width > 0) or a box-shadow change when focused by keyboard.
- Layout: at a 320x800 viewport the page has no horizontal scroll (`scrollWidth <= clientWidth + 1`).
- Paste is never prevented; no console errors, page errors, failed requests or 4xx/5xx responses on load or on the golden path.
- V1, outside the form: the "Your bookings" heading has a `Refresh` button (type button, `data-kennel="refresh-bookings"`) that reloads the list with `GET /api/bookings`.

## Response headers, cookies and source maps (V1)

- Every response carries `Content-Security-Policy` (`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://<request hostname>:<ANALYTICS_PORT>; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'`), `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`.
- `GET /book` sets `kennel_session=<uuid>; Path=/; HttpOnly; SameSite=Lax` when the request has no `kennel_session` cookie.
- The API sends no CORS headers (the frontend is same-origin); `OPTIONS` on `/api/*` answers `204`.
- The build writes source maps next to the bundle without a `sourceMappingURL` comment (Vite `sourcemap: "hidden"`); requests for `*.map` answer `404`.

## Bugs (each changes exactly one behaviour)

| Id | Change from clean |
|---|---|
| F01 | `Save draft` does nothing: no `Draft saved`, `localStorage` untouched. |
| F02 | On a 5xx from create, no message ever appears; Book stays disabled (spinner). |
| F03 | `Special instructions` is dropped: the `Booking saved` toast still shows, but the stored booking has `instructions: ""` and the list shows none. |
| F04 | Book is not disabled while pending; a double click sends two create requests and books twice. |
| F05 | The availability call goes to `undefined/api/availability` (resolved relative to the page, so it 404s) and logs a console error. |
| F06 | The server accepts `endDate` before `startDate` (`201`); the browser still blocks it. |
| A01 | Phone has no `<label>`, `aria-label` or `aria-labelledby`; only `placeholder="Phone"`. |
| A02 | The clear button has no accessible name (icon only, no `aria-label`/text/title). |
| A03 | Pet type is three clickable `<div>`s (inside `data-kennel="pet-type"`) with no role, tabindex or keyboard handler; no radio inputs. Clicking still selects. |
| A04 | Every `<input>` (text, email, tel, date, password) and the textarea gets `outline: none` on focus with no replacement (buttons keep their focus style). |
| A05 | Errors are red text only: no `aria-invalid`, no `aria-describedby` to the message, no live region/alert with error text. |
| A06 | The email helper text contrast drops below 4.5:1. |
| A07 | Paste is prevented (`preventDefault` on `paste`) on the Confirm password input only. |
| A08 | Remove buttons render at 16x16 px. |
| A09 | The form has a fixed width that overflows a 320 px viewport. |
| S01 | `index.html` loads an extra script (via `<script src>`) that contains an obviously fake LLM-provider key matching `sk-proj-[A-Za-z0-9_-]{20,}` and containing `FAKE`. |
| S02 | `index.html` loads an extra script that contains a JWT whose payload has `"role":"service_role"`. |
| S03 | After booking, the frontend calls `GET <analyticsUrl>/collect?event=booking_created&email=<ownerEmail>` (URL-encoded). |
| S04 | The `500` body includes a `stack` (a real `Error().stack`) and the page shows it in the error message. |
| F07 | V1. The `Refresh` button beside "Your bookings" (outside the form) has no click handler. |
| S05 | V1. No `Content-Security-Policy`, `X-Content-Type-Options` or `Referrer-Policy` on any response. |
| S06 | V1. The `kennel_session` cookie is set without `HttpOnly` (still `SameSite=Lax`). |
| S07 | V1. Every `/api/*` response echoes the request's `Origin` (including `null`) in `Access-Control-Allow-Origin`, with `Access-Control-Allow-Credentials: true`. |
| S08 | V1. The source maps (`/assets/*.js.map`, with `sourcesContent`) are served with `200`. |
