# Signed-in runs and access checks (V2 preview)

This page covers testing pages behind a sign-in as test accounts you own, the V2 checks that run signed in, and what sign-in can't do yet.

Pages behind a sign-in can be tested signed in, as one of two test accounts **you own** on your app: A and B. Run Hound signs in with a fresh session at the start of each plan and run, and every check then runs signed in. Four V2 checks join the plan: three from 0.4.0 and one that writes (0.5.0):

| Check | What it asks | Planned |
|---|---|---|
| `access-control` | Signed in as A, Run Hound finds A's data on the page. Can account B read it? Can a visitor who isn't signed in? | Signed in. The account B scenario only when B is set up and "A and B must not see each other's data" is on. Ticked. |
| `mass-assignment` | Does the server store `role`, `isAdmin`, `plan`, `credits`, `verified` and similar fields that the form never sends? | Signed in, for each form that saves (it needs a JSON save request, and skips with the reason otherwise). **Unticked**: it changes account A, then restores it. |
| `deep-links` | Do the app's own pages load when opened directly (a reload, a shared link)? | When the page links to other pages of the app, signed in or not. Ticked. |
| `csrf` (0.5.0) | Can a page on another site make A's browser change A's data (no CSRF token, no Origin check, a session cookie sent cross-site)? | Signed in, for each form that saves a record. **Unticked**. |

What they never do:

- `access-control` replays only the read requests (GET) that returned A's data on this page, as B and with no session. It never replays a path that acts (`/logout`, `/unsubscribe`), and each of its two scenarios saves at most one test record as A, through a form that saves a record, so it has data to look for. When it finds none, it is skipped with the reason.
- `mass-assignment` saves the form as A, sends the same save once more with the extra fields, reads the record back, then saves the original values again. Its notes say what came back, what the server kept, and what it couldn't restore (a field that wasn't there before can't be removed: check account A).
- `deep-links` opens at most 10 of the page's own links, each in a fresh browser, and never a link that acts when opened: sign out, delete, unsubscribe, disconnect, accept an invitation, `?action=delete`.
- `csrf` writes only the test record Run Hound created as A **in the same scenario** (never one of A's own records, never an id found by listing or guessing), and only to your app's own origin or its local API. It never calls sign-out, password, email, account-deletion, payment-provider, invitation or sharing endpoints, even with `--allow-destructive`. A write counts as working only when a re-read as A shows it, never from a status code. Afterwards it puts the record back, re-reads it, and names anything it couldn't undo ("check Account A"); a scenario is never a pass while such a note stands.
- `csrf` sends the forged request from a real browser page on another site (`127.0.0.1` for a `localhost` app, and the other way round), so the browser attaches only the cookies it would for any website; only requests a web page can send without a CORS preflight are forged. On any other host name (a private name from `RUNHOUND_ALLOWED_HOSTS`, `host.docker.internal`) no cross-site origin can be set up and the scenario is **inconclusive**, never a pass. Point it at `http://localhost:<port>` or `http://127.0.0.1:<port>`.

**"A and B must not see each other's data"** (on by default) is your statement that A and B are different users, not teammates in one workspace. Only then does B reading A's data count as a bug, so the account B scenario is planned only when it is on.

**Web UI:** **Settings → Test accounts**: for each account, the sign-in page URL, username and password, then **Save** and **Test sign-in**. New Run → **Sign in as**.

**Command line** (from source, in `app/`; in the test lab, start each line with `docker compose -f run-hound.compose.yml run --rm run-hound` instead of `pnpm exec tsx src/cli.ts`):

```sh
pnpm exec tsx src/cli.ts accounts set a --login-url http://localhost:5173/login --username alex@example.test --password-stdin
pnpm exec tsx src/cli.ts accounts set b --login-url http://localhost:5173/login --username sam@example.test --password-stdin
pnpm exec tsx src/cli.ts accounts test          # signs in as each account and says where it landed
pnpm exec tsx src/cli.ts accounts status        # what is set, and where each value comes from
pnpm exec tsx src/cli.ts run http://localhost:5173/app --as a --approve all
```

`--password-stdin` asks for the password without showing it, or reads it from a pipe (`printf '%s\n' "$PASSWORD" | … accounts set a --password-stdin`); a password is never taken from a flag, so it stays out of your shell history. To try it on the test lab's Fernway app: accounts `alex@fernway.test` (A) and `sam@fernway.test` (B), sign-in page `http://fernway-bugs:4110/login`, target `http://fernway-bugs:4110/app`; the passwords are in [fixtures/fernway/README.md](../fixtures/fernway/README.md#accounts). [TESTING.md](../TESTING.md#signed-in-runs-and-access-checks-v2-preview) walks through it.

**Secrets.** Accounts are saved next to the AI settings (`accounts.json`, mode 0600, in a 0700 folder; in the test lab that is `./runs/.config/accounts.json`); `RUNHOUND_ACCOUNT_A_LOGIN_URL`, `…_USERNAME`, `…_PASSWORD`, `…_LABEL` (and `_B_`) and `RUNHOUND_ACCOUNTS_ISOLATED` override them field by field. The API and the UI never send a saved password back. A saved password is only sent to the site (origin) it was saved for: move the sign-in page to another site and it has to be entered again. Passwords, session cookies and tokens never appear in reports, evidence, specs, logs, progress or AI prompts, and neither do usernames; reports name accounts by their label. Evidence screenshots are taken with the account's name and session values dotted out; the live view is not masked (it stays on your machine).

**What sign-in can't do (yet):**

- It needs a sign-in form with a username (or email) field and a password field on one page. Verification codes (multi-factor), captchas, "Sign in with Google/GitHub" and two-step pages that ask for the email first and the password on the next page aren't supported; **Test sign-in** and `accounts test` say what they ran into. Turn them off for test accounts in your development setup.
- The session must survive a new browser: cookies, localStorage and IndexedDB (Supabase and Firebase keep it there) work. A session kept only in sessionStorage doesn't, and the plan fails with "still shows the sign-in page".
- The sign-in page and the page under test must use the same host name (`localhost` and `127.0.0.1` keep their cookies apart).
- While signed in, Run Hound never clicks sign-out controls and never submits a form that sets a password (change password, sign up), even with `--allow-destructive`.
- `csrf` needs the app on `localhost` or `127.0.0.1` (its cross-site page is served on the other one); on any other host name it is inconclusive. Rate limits and file upload are planned.

Contract: [docs/v2-spec.md](v2-spec.md).
