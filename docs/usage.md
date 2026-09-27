# Using Run Hound

This page covers the web UI, the command line (commands, options and exit codes), and the reports and evidence a run writes.

## Web UI

Open the UI (<http://localhost:4000> in the test lab, <http://localhost:4310> with [the ports from the install guide](install.md#ports)). The sidebar has three pages (on a narrow screen they're under **Menu**):

- **New Run**: enter `http://kennel:3000/book` in the test lab or `http://localhost:5310/book` from source (the `http://` is optional), choose **Sign in as** (Not signed in, or a test account) and press **Plan checks**. A strip above the plan shows what was found: each form with its fields and buttons, the controls outside the forms, and the whole page. The plan is grouped as **Accessibility**, **Features** and **Security** (each with a "Select all" box), and the scenarios run in that order. Press **Start run (N scenarios)**.
- **The running view** shows the numbered scenario list with each one's status and time (the current one expanded with its live steps), a counter and progress bar, the elapsed time, the browser (Chromium version), a live preview of the page under test with its address, and a timestamped activity log. **Stop run** stops it for real: the scenario in progress and the rest are marked skipped ("Stopped by you") and a report is still written. **Back to test plan** plans the same page again with the same scenarios ticked.
- **The report** (same address once the run ends): the verdict and counts, **Re-run** (runs the same scenarios on the same page again), **Open HTML report**, **Download** (report.md, report.json, specs), results you can filter (All, Passed, Issues, Skipped), and for the selected scenario its evidence, reproduction steps, key facts, what to ask your AI and the generated Playwright test.
- **Runs**: every run on this machine, newest first, including finished runs read back from the runs folder after a restart. A signed-in run says which account ran it.
- **Settings**: defaults for "Allow destructive scenarios" and "Show the browser window" (saved in this browser), **Test accounts**, **AI**, and this server's version, runs folder, allowed hosts and accepted server host names.

**Show the browser window** also opens a visible Chromium window on the machine running Run Hound; it needs a display, and it is greyed out where there is none (as in a container). Pages have their own addresses (`#/new`, `#/runs`, `#/runs/<id>`, `#/settings`), so reload and back work; old `#run=<id>` links still open the run. The UI refuses an empty selection, and runs at most two runs at a time.

## Command line

```sh
# in the folder with run-hound.compose.yml (the test lab)
docker compose -f run-hound.compose.yml run --rm run-hound run http://kennel:3000/book --plan-only    # list the scenarios and their ids
docker compose -f run-hound.compose.yml run --rm run-hound run http://kennel:3000/book --approve all   # run everything
```

From source, the same commands start with `pnpm exec tsx src/cli.ts` in `app/` instead (`pnpm exec tsx src/cli.ts run http://localhost:5310/book --approve all`). `run-hound help` prints the full usage.

| Command | What it does |
|---|---|
| `run <url> [options]` | Plans the checks for one page and runs them. |
| `serve [--port 4000] [--host 127.0.0.1] [--runs-dir <dir>]` | The web UI and its API. |
| `ai status` / `ai test [--ai-* flags]` | Shows the effective AI settings (never the key), or makes one small call to check the model answers. |
| `accounts status` | Both test accounts: label, sign-in page, username, whether a password is saved, where each value comes from, and whether A and B must not see each other's data. |
| `accounts set a\|b [--login-url <url>] [--username <name>] [--label <text>] [--password-stdin]` | Saves a test account; values you leave out are kept. The password is only read from stdin. |
| `accounts test [a\|b]` | Signs in (both accounts when you name none) and says the page it landed on, or why it failed. |
| `accounts clear a\|b` | Removes a test account. |
| `help`, `--version` | The usage, and the version. |

Options for `run`:

- `--approve all|default|<id,id>`: which scenarios to run (default: the recommended ones; `all` includes the ones that are unticked by default, such as `mass-assignment` and the write-side checks `csrf`, `write-access` and `paywall-trust`, which change a test account's data and put it back).
- `--plan-only`: list the planned scenarios and their ids, then stop.
- `--allow-destructive`: also run scenarios that may change or delete data.
- `--as a|b`: sign in as test account A or B first and run every check signed in ([Signed-in runs](signed-in-runs.md)).
- `--headed`: open a visible browser window (a source install with a display only).
- `--runs-dir <dir>`: where run folders go (default `./runs`).
- `--json`: the report (or the plan) as JSON on stdout; progress and the run folder go to stderr.
- `--ai` / `--no-ai`, `--ai-provider`, `--ai-model`, `--ai-base-url`, `--ai-allow-remote`: see [AI (optional)](ai.md).

The plan lists each scenario with what it tests (`[Book a sitter form]`, `[Whole page]`). Progress lines on stderr name each group (`== Accessibility (6 scenarios; group 1 of 3) ==`), each step and each page as it loads (`> page http://…`); each scenario's result line ends with its duration, and the summary starts with `Finished in <duration>` and a line per group. A page without a form is planned with the page-wide checks only, with a warning.

**Exit codes.** `run` exits:

- **0** with no confirmed findings (advisory findings are reported but don't fail the run);
- **1** with at least one confirmed finding;
- **2** on an error: a refused or unreachable target, an error page (such as a 404), a page with nothing to test, bad arguments or an approval that names no scenarios, `--ai` when AI can't be used, or `--as` with an account that isn't set up or can't sign in. It also exits 2 when **nothing was tested**: every approved scenario errored or was skipped (for example the app stopped answering after the plan; the report says why).

`accounts test` exits 0 when every account it tried signed in and 2 otherwise; `ai test` exits 0 when the model answered and 1 otherwise.

## Reports and evidence

Reports land in `./runs/<runId>/` with Docker (`app/runs/<runId>/` from source): `report.html`, `report.md`, `report.json`, an `artifacts/` folder and a `specs/` folder of Playwright tests. Every finding carries evidence you can check without rerunning anything:

- **Frames** (`.png`): the screenshot with the element boxed and labelled, a header with the page URL, time, check and step, a caption, and a facts panel with the measured data.
- **GIFs** (`.gif`): flows such as a double-click, a Tab walk or a submit-and-reload, one annotated frame per step.
- **Cards** (`.png`): requests, responses, script excerpts and console lines, with the proving line marked.

The report says how long the run took, has a per-group table (Accessibility, Features, Security: results, findings and time) and labels each finding with its group. It also lists every scenario that ran, under its group, with its result, duration and notes (why it errored or was skipped), the planned scenarios you did not approve, checks that had nothing to test on the form, and the pages tested. A signed-in run says which account ran it ("Signed in as Account A"). Evidence text is redacted; pixels can't be, so a page that shows a secret shows it in its screenshots and in the live view.

The exported specs need `@playwright/test` in the project that runs them (`npm i -D @playwright/test`, plus `@axe-core/playwright` for the axe-states specs); run one with `npx playwright test <file>`. Specs for `access-control`, `csrf`, `write-access` and `paywall-trust` read the accounts from `RUNHOUND_ACCOUNT_A_LOGIN_URL`, `…_USERNAME` and `…_PASSWORD` (and `_B_`) in the environment; the `mass-assignment` spec needs your signed-in storage state added. No credential is written into a spec. Their sign-in is a stand-in to adapt to your app before running them ([Known limitations](../TESTING.md#known-limitations)). Runs create a few test records in the target app (each scenario's description says when); Run Hound doesn't delete them.
