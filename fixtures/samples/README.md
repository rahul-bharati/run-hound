# Sample apps (unfamiliar, well-built)

Five small apps that Run Hound was **not** built or tuned against. Each one is correct and accessible on purpose: labels on every field, errors marked with `aria-invalid` and linked with `aria-describedby`, announced status messages, visible focus, correct `autocomplete`, layouts that reflow at 320 px, server-side validation with plain JSON or HTML errors (no stack traces), and no third-party requests.

So **any confirmed finding Run Hound reports on these apps is a false positive.** They are the regression suite for the "Unfamiliar apps" rule in [`docs/v0-spec.md`](../../docs/v0-spec.md) (Tester release). Planted bugs belong in Kennel (`fixtures/kennel`), never here.

Each app is one Node file (`server.mjs`, `node:http` only, no dependencies, no build step) plus static HTML, CSS and JavaScript. Data is kept in memory and is lost when the server stops. Every server reads `PORT` (and `HOST`, default all interfaces) and prints a line containing `listening` once it accepts connections.

| App | What it is | Start it | Run Hound target |
|---|---|---|---|
| `classic-post` | Server-rendered sign-up form, **no JavaScript**. Posts urlencoded data to `/signup`. Valid: `303` redirect to `/signup/thanks/<id>`, which shows the saved values. Invalid: `422` and the form again, with an error summary (`role="alert"`), `aria-invalid`, `aria-describedby` and focus on the first invalid field. A hidden one-time token turns a repeated POST (double-click, back and resubmit) into the same record. | `PORT=4101 node fixtures/samples/classic-post/server.mjs` | `http://localhost:4101/signup` |
| `spa-fetch` | Vanilla-JS contact form. Validates in the browser, saves with `fetch` (JSON) to same-origin `/api/messages`, lists saved messages (they survive a reload). `role="status"` live region, button disabled while the request is pending, `:focus-visible` outlines. | `PORT=4102 node fixtures/samples/spa-fetch/server.mjs` | `http://localhost:4102/` |
| `login` | Email and password sign-in (`autocomplete="email"` / `"current-password"`, paste allowed), a "Show password" toggle button (`aria-pressed`), `401` on wrong credentials with the error announced in a `role="alert"` region. The only account is `demo@example.test` / `correct-horse`. | `PORT=4103 node fixtures/samples/login/server.mjs` | `http://localhost:4103/` |
| `cross-origin-api` | RSVP form on `PORT` whose JavaScript saves JSON to an API on `API_PORT`, a **different origin** that allows the page through CORS. This is the "API on another origin" case: checks that assume a same-origin API must skip with a plain reason, not report failures. | `PORT=4104 API_PORT=4105 node fixtures/samples/cross-origin-api/server.mjs` | `http://localhost:4104/` |
| `multi-form` | V1 (single page): a header with a **search form** (plain GET to `/search`) and a "Menu" toggle, a contact form saving JSON to `/api/messages` (listed under "Messages you've sent", with a **Refresh** button outside the form), and a footer **newsletter form** saving to `/api/subscribe` that never shows the address again. Tests every form on a page, search-form handling, forms that don't display what they save, and buttons outside forms. | `PORT=4106 node fixtures/samples/multi-form/server.mjs` | `http://localhost:4106/` |

Pick any free ports (port 3000 is Kennel's default). For `cross-origin-api`, `PORT` and `API_PORT` must differ; open the page at `localhost` or `127.0.0.1` (a CSP can't name an IPv6 literal, so a page opened at `[::1]` can't reach the API).

## Running Run Hound against a sample

```sh
PORT=4102 node fixtures/samples/spa-fetch/server.mjs &
cd app && pnpm exec tsx src/cli.ts run http://localhost:4102/ --approve all --runs-dir /tmp/rh-runs
```

## Regression test

`tests/acceptance/src/samples.acceptance.test.ts` starts each app on free ports, plans with every scenario approved, runs it and asserts: discovery found the form, no scenario errored, **zero confirmed findings**, every skipped scenario gives a plain-language reason, `pagesVisited` is not empty, and for `classic-post` the POST, 303 and thank-you page flow is followed without tripping the navigation guard. It prints every scenario's status, notes and findings for each app.

```sh
cd tests/acceptance
pnpm exec vitest run src/samples.acceptance.test.ts                              # all four
ACCEPTANCE_SAMPLES=login KEEP_RUNS=1 pnpm exec vitest run src/samples.acceptance.test.ts   # one app, keep its report
```
