# Launch readiness: 0.6.1 to 0.6.5

This is the contract for the releases that lead to Run Hound's public launch. The **0.6.1 section binds**: every behaviour in it has a name, a shape and a test (listed in [The tests that pin 0.6.1](#the-tests-that-pin-061)), and the tests were written and seen failing before any of it was built ([decision](decisions/09-2026.md#2026-09-25-contracts-and-failing-tests-first)). The sections for 0.6.2 to 0.6.5 are the plan; each gets a detailed contract like 0.6.1's before its work starts.

Every Playwright and Node API named here was checked against the installed code (Playwright 1.63.0 in `node_modules/playwright-core`, Node 24.21 for the runtime checks); see [Verified API references](#verified-api-references).

## The plan

Decided by the maintainer on 30 September 2026 ([decision](decisions/09-2026.md#2026-09-30-launch-at-0-6-5)): Run Hound launches publicly at **0.6.5**, with Docker and `npx run-hound`, to get feedback from people using it. **1.0.0** is the release that refactors the app code so it is maintainable; the V0 to V4 stages no longer decide when 1.0.0 comes. Native desktop packages (Windows, macOS, Linux) come after that, with a desktop launch of their own.

| Release | Name | What it brings |
|---|---|---|
| 0.6.1 | Isolated by default | The test browser gets an allowlisted environment and a home of its own, and never saves a download; Bedrock access keys can be saved in Settings; `~/.aws` is read only when a profile is named; AI secrets are redacted everywhere; the egress rules are written down; a footprint test proves a run touches nothing else |
| 0.6.2 | Clean launch | A per-launch token for the UI; Chromium's sandbox on (with a warning when it can't start); `serve --open` in Run Hound's own app window with a throwaway profile; `--no-open`; `run-hound doctor` |
| 0.6.3 | npx | `npx run-hound`; host state in `./.run-hound/` with its own `.gitignore`, one shared browser cache, `RUNHOUND_HOME`; the first browser download is announced; `run-hound clean`; CI on macOS and Windows |
| 0.6.4 | Launch prep | Hardened compose files; deleting runs; a "Send feedback" link in the UI that opens a prefilled GitHub issue; launch copy |
| 0.6.5 | Launch | A pre-release first, then the public launch |
| 1.0.0 | Maintainable | The app-code refactor |

## 0.6.1: isolated by default

A run must not reach into the rest of the machine, and the machine must not reach into the run. What 0.6.1 changes, in order:

1. [The browser's environment](#1-the-browsers-environment): every Chromium Run Hound launches gets an allowlisted environment, with HOME and the XDG folders in a per-launch folder Run Hound owns and removes.
2. [Downloads](#2-downloads): no browser context accepts a download.
3. [Bedrock credentials](#3-bedrock-credentials): an access key ID and secret access key (and an optional session token) can be saved in Settings, `ai.json` or the environment; they are write-only; `~/.aws` is read only when a profile is named; `credential_process` gets none of Run Hound's own secrets.
4. [Redaction](#4-redaction): the AI secrets are registered with the redactor, and a labelled AWS secret access key has a pattern of its own.
5. [Egress](#5-egress): `docs/security.md` says what the tested page may reach and why.
6. [The footprint contract test](#6-the-footprint-contract-test): a real run proves all of the above together.
7. [Records and release](#7-records-and-release).

### 1. The browser's environment

**Today.** No launch site passes `env`, so Chromium gets all of `process.env`: Playwright uses `options.env` when it is set and `process.env` otherwise (`coreBundle.js:39798`), and Chromium's `amendEnvironment` hands it on unchanged (`coreBundle.js:43219`, and `:43503` for the BiDi build). Every AWS key, AI key, account password, proxy variable and token in the shell reaches the process that runs the tested app's JavaScript. With the user's HOME, Chromium also writes into the user's folders: on a Linux machine with an NVIDIA driver, one headless run wrote a shader cache to `$XDG_CACHE_HOME/nvidia/GLCache/` (observed while writing this contract, and by the footprint test).

#### 1.1 The module

`app/src/engine/isolation.ts` is the only module in `app/src` that imports a browser type (`chromium`, `firefox`, `webkit`) from `playwright`, and the only one that calls `launch`, `launchPersistentContext` or `launchServer` on one. Tests are exempt. It exports:

```ts
export const BROWSER_FOLDER_PREFIX = "run-hound-browser-";
export const ISOLATED_CONTEXT: Readonly<{ acceptDownloads?: boolean }>; // { acceptDownloads: false }
export function browserEnv(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, dir: string, options?: { headed?: boolean }): Record<string, string>;
export interface LaunchDeps { launcher?: Pick<BrowserType, "launch">; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; tmpRoot?: string; remove?: (folder: string) => Promise<void> }
export function launchChromium(options?: LaunchOptions, deps?: LaunchDeps): Promise<Browser>;
```

#### 1.2 `browserEnv`

A pure function: it reads nothing and writes nothing. It returns the allowlisted variables of `env` that are set and not empty, plus the pointed variables, and nothing else. Pointed paths are joined with `path.win32` for `win32` and `path.posix` otherwise, so the result doesn't depend on the machine running it. Any platform other than `darwin` and `win32` follows the Linux rules.

**Passed through, when set:**

| Platform | Variables |
|---|---|
| All | `PATH`, `LANG`, `LANGUAGE`, `LC_ALL` and every other `LC_*`, `TZ` |
| Linux | `FONTCONFIG_FILE`, `FONTCONFIG_PATH`, `LD_LIBRARY_PATH` |
| Linux, headed only | `DISPLAY`, `WAYLAND_DISPLAY`, `XAUTHORITY`, and `XDG_RUNTIME_DIR` only when `WAYLAND_DISPLAY` is set |
| macOS | `TMPDIR` |
| Windows | `PATHEXT`, `SystemRoot`, `SystemDrive`, `windir`, `ComSpec`, `NUMBER_OF_PROCESSORS`, `PROCESSOR_ARCHITECTURE`, `OS`, `ProgramData`, `ProgramFiles`, `ProgramFiles(x86)`, `ProgramW6432`, `CommonProgramFiles`, `CommonProgramFiles(x86)`, `CommonProgramW6432` |

On Windows, names are matched case-insensitively and each kept variable keeps the name as `env` spells it (`Path`, `SYSTEMROOT`).

**Pointed into `dir`:**

| Platform | Variables |
|---|---|
| Linux | `HOME` = `<dir>/home`, `XDG_CONFIG_HOME` = `<dir>/config`, `XDG_CACHE_HOME` = `<dir>/cache`, `XDG_DATA_HOME` = `<dir>/data`, `XDG_STATE_HOME` = `<dir>/state`, `TMPDIR` = `<dir>/tmp` |
| macOS | The same without `TMPDIR`, plus `CFFIXED_USER_HOME` = `<dir>/home` (macOS's per-user folders — Library/Application Support, Library/Caches, Library/Saved Application State — are likely resolved through `NSSearchPathForDirectoriesInDomains`/`NSHomeDirectory`, which honour this instead of `HOME`; not yet verified, see below) |
| Windows | `USERPROFILE` = `<dir>\home`, `APPDATA` = `<dir>\config`, `LOCALAPPDATA` = `<dir>\cache`, `TEMP` and `TMP` = `<dir>\tmp` |

**Headed X11.** Moving HOME would hide `~/.Xauthority`, so for a headed launch with `DISPLAY` set, no `XAUTHORITY`, and `HOME` set, `XAUTHORITY` is `<env.HOME>/.Xauthority`. Chromium only reads that file.

**Everything else is dropped.** That includes `AWS_*`, `RUNHOUND_*`, `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` and `NO_PROXY` in any letter case, `NODE_OPTIONS`, `LD_PRELOAD`, `DBUS_SESSION_BUS_ADDRESS`, `SSH_AUTH_SOCK`, `GITHUB_TOKEN`, any `*_API_KEY`, `PLAYWRIGHT_BROWSERS_PATH`, `USER`, `LOGNAME`, `HOMEDRIVE` and `HOMEPATH`.

**Why these choices.**

- `TMPDIR` stays as it is on macOS. The per-user `/var/folders/…/T/` is already private to the user, and a longer path there could push the Unix socket headed Chromium makes past macOS's 104-byte limit.
- A headless launch gets no display variables at all.
- `XDG_RUNTIME_DIR` goes only with Wayland. It also leads to the session bus (`$XDG_RUNTIME_DIR/bus`), which the browser has no use for.
- `DBUS_SESSION_BUS_ADDRESS` is dropped, so the browser can't reach the desktop's keyring or portals. Playwright already passes `--password-store=basic` and `--use-mock-keychain`.
- Fonts come from the system configuration only. User fonts under the moved HOME aren't seen, so rendering is the same on every machine with the same system fonts.
- macOS and Windows follow these rules from 0.6.1, but they are **to be verified, not proved**: `browserEnv`'s variables are env-driven and unit-tested on every platform, but whether they are the variables Chromium and the OS actually consult for its per-user folders on macOS (`CFFIXED_USER_HOME`, still unconfirmed) and Windows (the env vars here, or the Known Folder APIs instead) is untested without those OSes. The footprint test runs there in CI from 0.6.3, which is when this is verified. A rule that breaks the browser on either platform, or that the real OS resolves differently from what's assumed here, is fixed then, recorded as a decision, and never widened past what the browser needs.

#### 1.3 The per-launch folder: `launchChromium`

1. `mkdtemp(join(deps.tmpRoot ?? os.tmpdir(), "run-hound-browser-"))` makes the folder, and inside it `home`, `config`, `cache`, `data`, `state`, `tmp` and `artifacts`.
2. It calls `(deps.launcher ?? chromium).launch({ ...options, env: browserEnv(deps.env ?? process.env, deps.platform ?? process.platform, folder, { headed: options.headless === false }), artifactsDir: join(folder, "artifacts") })`. `artifactsDir` keeps Playwright's artifacts folder (downloads, traces, videos) inside Run Hound's folder instead of `os.tmpdir()/playwright-artifacts-*` (`coreBundle.js:39755-39761`). Playwright leaves a given `artifactsDir` in place (`types.d.ts:25385-25390`), so Run Hound removes it with the folder.
3. The folder is removed (`deps.remove ?? rm` with `recursive`, `force` and `maxRetries: 3`) in three cases:
   - before `browser.close()` resolves;
   - when the browser disconnects on its own (a crash);
   - when the launch throws — including a failed subfolder `mkdir` — before the error is rethrown unchanged.

   As a last resort, a synchronous best-effort removal runs on the process's `exit` event for any folder still open. That hook is registered right after `mkdtemp`, before the subfolders or the browser exist, and it is dropped only once the async removal actually succeeds; a failed async removal (e.g. Windows `EBUSY`/`EPERM` while a Chromium child still holds a handle) keeps the hook registered rather than silently losing Run Hound's last chance to clean up.
4. Playwright's own temporary profile is not Run Hound's to move. `launch()` takes no `userDataDir` (`coreBundle.js:63298`), so Playwright makes `os.tmpdir()/playwright_chromiumdev_profile-*` itself (`:39768`) and removes it when the browser closes (`launchProcess` cleanup, `:9326-9329`). A crash of Run Hound itself (SIGKILL, power loss) can leave both folders behind; `run-hound clean` removes them from 0.6.3.
5. The returned `Browser`'s `newContext` and `newPage` are wrapped so every context they open gets `ISOLATED_CONTEXT` last (after the caller's own options), whatever the caller passes — belt and braces alongside the explicit spread at each call site (below), so a future context from an isolated launch can't accept downloads by omission.

#### 1.4 The launch sites

Each of these calls `launchChromium` with the options it builds today, and none keeps an import of `chromium`:

- `app/src/engine/runner.ts:473` (discovery) and `:930` (the run), through `launchOptions` (`:161`);
- `app/src/server/accounts.ts:80` (the sign-in test in Settings and `run-hound accounts test`).

The test helpers (`app/test-support/harness.ts`, the UI tests) launch their own browsers and are exempt.

### 2. Downloads

Every browser context Run Hound opens includes `...ISOLATED_CONTEXT`, which is `{ acceptDownloads: false }`:

- runner discovery's (`runner.ts:487`);
- `CheckContext.openPage` (`context.ts:592`);
- sign-in's (`auth.ts:1857`);
- the evidence renderer's (`evidence.ts:159`).

`APIRequestContext`s (`context.ts:436`) have no downloads.

**The option is the boolean `false`, not `"deny"`.**

- The public type is `acceptDownloads?: boolean` (`types.d.ts:25732`), and the client maps `false` to the protocol's `"deny"` (`coreBundle.js:62169-62175`).
- The string `"deny"` would not type-check. At runtime it is truthy, so it would be sent as `"accept"`.
- Left unset, it is `"accept"` (`coreBundle.js:51447-51448`), and Chromium saves the file into Playwright's artifacts folder (seen in testing).
- With `false`, Chromium is told `Browser.setDownloadBehavior` `deny` (`coreBundle.js:38581-38583`). The page's `download` event still fires, and `Download.failure()` and `path()` report "Pass { acceptDownloads: true } when you are creating your browser context." (`coreBundle.js:52130`, seen in testing). Nothing is written.

### 3. Bedrock credentials

#### 3.1 Methods, and the order Bedrock uses them

1. **A Bedrock API key**, sent as `Authorization: Bearer`, from `apiKey` (Settings, `ai.json`, `RUNHOUND_AI_API_KEY`, else `AWS_BEARER_TOKEN_BEDROCK`). This is unchanged.
2. **SigV4** with the first of:
   1. the AWS access keys in the environment;
   2. the access keys saved in `ai.json` (new);
   3. the named profile in `~/.aws`.

   With none of them, it fails with `AiError("auth", "Bedrock needs credentials: an API key, AWS access keys or an AWS profile")` and nothing is read or sent.

The pair is never sent anywhere. SigV4 sends a signature bound to the request's host, so unlike `apiKey` the pair needs no origin binding (`apiKeyOrigin`).

#### 3.2 Fields and variables

`AiConfig` (`app/src/ai/types.ts`) gains three fields, `null` by default and in `DEFAULT_AI_CONFIG`. They are saved in `ai.json` under the same names:

| Field | What | Environment (Bedrock only) |
|---|---|---|
| `awsAccessKeyId` | The access key ID | `AWS_ACCESS_KEY_ID` |
| `awsSecretAccessKey` | Its secret access key. Write-only | `AWS_SECRET_ACCESS_KEY` |
| `awsSessionToken` | The session token of temporary keys, optional. Write-only | `AWS_SESSION_TOKEN` |

- There are no `RUNHOUND_AI_AWS_*` aliases: AWS's own names are what every AWS tool, and both compose files, already use.
- The access key ID is never returned either. The `aws-access-key` pattern already treats it as something to hide.

#### 3.3 How the pair resolves

- **One source for the whole pair.** The pair resolves as a unit, defaults < `ai.json` < environment. There is no flag.
- **Only a full pair counts.** A layer counts only when it has both the ID and the secret: a lone `AWS_ACCESS_KEY_ID` leaves the file's pair in place, and a lone saved ID resolves to nothing.
- **The token travels with its pair.** It comes only from the same layer as the pair, so the file's token never rides on the environment's keys.
- **Environment keys are for Bedrock only.** For other providers the environment pair is ignored, like `AWS_BEARER_TOKEN_BEDROCK`.
- **`sources.awsKeys`** is `"file"`, `"env"` or `"default"` (`AiStatus["sources"]`).
- **`resolveAwsCredentials`** takes the saved pair as `saved?: AwsCredentials | null` and checks it after the environment keys and before any profile, returning `source: "saved"` without reading a file. `converseJson` passes `saved` from its config (`Pick<AiConfig, …>` gains the three fields). `awsCredentialsAvailable` takes `saved` too.

#### 3.4 When `~/.aws` is read

Only when a profile is named. There is no implicit `"default"` ([decision](decisions/09-2026.md#2026-09-30-aws-only-when-a-profile-is-named)).

- **What names a profile:** `awsProfile` (Settings or `ai.json`), `RUNHOUND_AI_AWS_PROFILE`, or `AWS_PROFILE`. `AWS_PROFILE` counts because it is the standard, explicit way to name one, and Settings already shows it locked. A profile explicitly named `default` is read like any other.
- **`awsProfileName(env, configured)`** returns `configured || env.AWS_PROFILE || null`, so `null` means no profile is named.
- **With no profile named, nothing under `~/.aws` is opened or checked.** That covers `credentials`, `config` and `sso/cache` in all three places that read them today:
  - the credential chain (`resolveAwsCredentials`, `aws-credentials.ts:369`);
  - the region fallback (`resolveAiConfig` through `awsProfileRegion`, `config.ts:201`, and `converseJson`, `bedrock.ts:34`);
  - every status call (`aiStatus` through `awsCredentialsAvailable`, `config.ts:450`).

  `AWS_CONFIG_FILE` and `AWS_SHARED_CREDENTIALS_FILE` only move a named profile's files; they don't make Run Hound read them. `awsProfileRegion` returns `null` and `awsCredentialsAvailable` counts only the environment pair and `saved`.
- **Region**, when no profile is named, comes only from the config, `RUNHOUND_AI_REGION`, `AWS_REGION` or `AWS_DEFAULT_REGION`. With none, the status says "Choose a Bedrock region". SigV4 without a region fails "not-configured", even with an endpoint override.
- **Migration.** Anyone who relied on the unnamed `[default]` profile sets the AWS profile to `default` in Settings, or sets `RUNHOUND_AI_AWS_PROFILE=default` or `AWS_PROFILE=default`. The CHANGELOG's 0.6.1 section says so under "Changed". The status problem stays "Bedrock needs credentials: an API key, AWS access keys or an AWS profile".

#### 3.5 What `credential_process` gets

A `credential_process` helper runs only for a named profile. It is started with `env: credentialProcessEnv(options.env ?? process.env)`; today `spawn` gets no `env` (`aws-credentials.ts:310`), so it inherits `process.env`, whatever `env` the chain was given.

`credentialProcessEnv(env)` (exported from `aws-credentials.ts`, pure) returns `env` without:

- every variable whose name starts with `RUNHOUND_`;
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` and `AWS_BEARER_TOKEN_BEDROCK`.

Names are matched case-insensitively. Everything else is kept.

**Why this, and not an allowlist.**

- The helper is the user's own program, named in their own `~/.aws/config` and run only because they named that profile. The AWS CLI runs it with the whole environment, and real helpers depend on theirs: aws-vault's backend setting, 1Password's `OP_SESSION_*`, a session bus for a keyring prompt, HOME for their own configuration. An allowlist would break them unpredictably.
- What must not reach the helper is what Run Hound holds and the helper has no use for: Run Hound's own variables (the AI key, account passwords, config paths) and credentials of the other methods.
- The chain only reaches the helper when there is no full environment pair, so a stray secret or token there belongs to no key it could use, and a Bedrock API key is a different method altogether.
- The keys saved in `ai.json` are never in any environment.

#### 3.6 Saving: `saveAiConfig`

`AiConfigPatch` gains the three fields.

- **Setting.** `awsAccessKeyId` and `awsSecretAccessKey` are set together, both non-empty. Leaving both out, or sending both as `""`, keeps the saved pair.
- **Removing.**
  - `null` for either removes the pair and its token.
  - `awsSessionToken` is saved only with a new pair: a new pair without one removes the saved token, and `null` removes the token alone.
- **Refused patches.** These are refused with an `Error`, and nothing is written:
  - one of the ID and secret without the other, or a new ID with `""` for the secret;
  - a token without a new pair;
  - an ID that isn't 16 to 128 letters, digits or underscores (`/^\w{16,128}$/`);
  - a secret or token that contains whitespace.
- **A pair set by the environment is locked.** A patch that sets or removes it throws an `Error` naming `AWS_ACCESS_KEY_ID`. Sending nothing for it is fine.
- **Errors name fields, never values.** The server's 400 answers are redacted as today.
- **The file.** The fields are written by the existing `writePrivate` (`config.ts:317`): a new `0600` file renamed into place, in a `0700` folder. There is no OS keychain ([decision](decisions/09-2026.md#2026-09-30-aws-only-when-a-profile-is-named)); protection is file permissions, as for `apiKey` and `accounts.json`.

#### 3.7 API

- **`GET /api/ai`**, and `ai` in `GET /api/settings`, return `AiStatus`. It gains:
  - `hasAwsKeys: boolean`: a pair is set, from `ai.json` or, for Bedrock, the environment;
  - `hasAwsSessionToken: boolean`;
  - `sources.awsKeys`.

  All three are always set by `aiStatus`. `hasKey` is true for Bedrock when an API key, a pair, or a named profile with usable credentials is there.
- **Never in a response:** the key ID, the secret or the token, and no field named `awsAccessKeyId`, `awsSecretAccessKey` or `awsSessionToken`. This covers the PUT answer, a later GET and `/api/settings`.
- **`PUT /api/ai`** takes an `AiConfigPatch` with the three fields and answers:
  - `200 AiStatus`;
  - `400 {error}` for half a pair, an invalid value, or a pair locked by the environment, naming `AWS_ACCESS_KEY_ID` in the last case and never a value.

  The route comment in `app/src/server/app.ts` (the `/api/ai` block) says so.
- **`run-hound ai status`** keeps its output (its lines are redacted) and never prints a secret.

#### 3.8 Settings

The AI card, for Amazon Bedrock only, adds a **Credentials** select, `#ai-aws-auth`, with these options:

| Value | Text | Shows |
|---|---|---|
| `api-key` | Bedrock API key | The existing `#ai-key` field ("API key") |
| `access-keys` | Access keys | `#ai-aws-key-id`, `#ai-aws-secret` and `#ai-aws-session-token` |
| `profile` | AWS profile | The existing `#ai-aws-profile` field ("AWS profile") |

It is a select and not radio buttons because the radios' labels would share words with the "API key" and "AWS profile" fields' labels.

- **Only the chosen method's fields show.** For other providers the select and the key fields are hidden and never sent.
- **The first choice follows the status:**
  - `api-key` when `sources.apiKey` is `"file"` or `"env"`;
  - else `access-keys` when `hasAwsKeys`;
  - else `profile` when `awsProfile` is set;
  - else `api-key`.
- **The access-key fields:**
  - "Access key ID" (`#ai-aws-key-id`, text, `autocomplete="off"`);
  - "Secret access key" (`#ai-aws-secret`, `type="password"`, `autocomplete="new-password"`);
  - "Session token (optional)" (`#ai-aws-session-token`, `type="password"`, `autocomplete="new-password"`).

  Each is in an element with the class `ai-aws-keys-field`. None is ever prefilled. Placeholders are "Saved" when `hasAwsKeys` (the token field: `hasAwsSessionToken`) and "Not set" otherwise. The hint reads "Stays on this machine in ai.json; never shown again."
- **Remove keys.** A "Remove keys" button (`#ai-aws-keys-remove`) shows when keys are saved and not locked. It toggles to "Undo remove" like "Remove key" does.
- **Locked keys.** When `sources.awsKeys` is `"env"`, the three fields are disabled, show the lock note ("Set by environment") and are never sent.
- **The profile field's placeholder** becomes "Profile name" instead of "default".
- **Save sends, for Bedrock:**
  - the chosen method's values: the typed API key, or `apiKey: null` after "Remove key"; the typed pair and token, or `awsAccessKeyId: null` after "Remove keys", or nothing when nothing was typed; `awsProfile` (the value, or `null` when empty);
  - `null` for each other method's value that is saved in `ai.json` (`apiKey` when `sources.apiKey` is `"file"`, `awsAccessKeyId` when `sources.awsKeys` is `"file"`, `awsProfile` when `sources.awsProfile` is `"file"`), so one method is saved at a time;
  - never a locked field.

  Half a pair is sent as typed, and the page shows the server's error.

### 4. Redaction

- **What is registered.** `resolveAiConfig` (and so `saveAiConfig`, the server on every request, and the CLI) registers every AI secret it reads with `registerSecretLiterals` (`redact.ts:283`), whether or not the value applies:
  - from `ai.json`: `apiKey`, `awsSecretAccessKey` and `awsSessionToken`;
  - `RUNHOUND_AI_API_KEY`;
  - for Bedrock, `AWS_BEARER_TOKEN_BEDROCK`, `AWS_SECRET_ACCESS_KEY` and `AWS_SESSION_TOKEN`.
- **One registration at a time.** The module holds one registration. Each call registers the new set, then unregisters the previous one, so there is no gap, and a secret the config no longer holds stops being registered.
- **What the redactor writes.** A registered value is replaced by `[REDACTED:account-secret]` in every encoding `registerSecretLiterals` covers. Values shorter than 4 characters are ignored, as for passwords. The access key ID isn't registered: the `aws-access-key` pattern already hides AKIA/ASIA IDs.
- **Credentials the chain resolves.** `resolveAwsCredentials` registers the `secretAccessKey` and `sessionToken` it returns, from any source: the environment, `saved`, a named profile, `credential_process` or IAM Identity Center. They stay registered while the process runs, and a refresh replaces the previous registration for the same profile.
- **The new pattern.** An AWS secret access key has no prefix of its own, so it gets a pattern only after its label. `redact.ts`'s `PATTERNS` gains, after `aws-access-key`:

  ```js
  { kind: "aws-secret-key", regex: /(?<=\b(?:aws[_-]?)?secret[_-]?access[_-]?key\\?["']?\s*[:=]\s*\\?["']?)[A-Za-z0-9\/+]{40}(?![A-Za-z0-9\/+=])/gi }
  ```

  - **What it matches:** the 40-character value after `aws_secret_access_key`, `AWS_SECRET_ACCESS_KEY`, `aws-secret-access-key`, `SecretAccessKey` or `secretAccessKey`, with optional quotes (JSON-escaped too), then `:` or `=`.
  - **What it replaces:** only the value, so `aws_secret_access_key = [REDACTED:aws-secret-key]` keeps the label readable.
  - **What it leaves alone:** an unlabelled 40-character string, and a shorter or longer value.
- **Consequence for `bundle-secrets`.** A labelled secret key in a page's script becomes a critical finding, "Secret key shipped to every visitor: an AWS secret access key". `app/src/checks/bundle-secrets.ts` gains:
  - `KIND_NAMES["aws-secret-key"] = "an AWS secret access key"`;
  - an entry in `SPEC_PATTERNS`, with no flags because the exported spec builds it with `new RegExp(pattern)`:

    ```js
    "aws-secret-key": String.raw`(?:aws|AWS)?[_-]?(?:secret|SECRET|Secret)[_-]?(?:access|ACCESS|Access)[_-]?(?:key|KEY|Key)\\?["']?\s*[:=]\s*\\?["']?[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+=])`,
    ```

- **The result.** A saved AI secret never reaches a report (`report.json`, `report.md`, `report.html`), a spec file, evidence, a log line, a progress event or an API answer, whatever its shape.

### 5. Egress

`docs/security.md` gains a section, "What the tested page can reach", which says:

- **Navigations are guarded.** Every navigation (top level, frame or popup) must pass the safety gate. A redirect or DNS answer that escapes it closes the context (`app/src/engine/guard.ts`, its three layers).
- **Other requests from the tested page are allowed**, to any host: scripts, styles, fonts, images, `fetch`/XHR, beacons and sockets. The reasons:
  - the app needs its CDNs, fonts, analytics, sign-in provider and API host to behave as it does for its users;
  - blocking them would test a broken page and report false findings;
  - the browser that makes them holds nothing of the user's: a throwaway profile, no extensions, the allowlisted environment of 0.6.1, no downloads, and only the test accounts' sessions.
- **What that means.** The app's own third-party code can send whatever the page shows, including the test account's data, to the hosts the app itself includes, exactly as it does for any user of the app. Use test accounts, not real ones.
- **The exceptions.** Requests a check sends itself (`CheckContext.request`, replays) pass the gate. The evidence renderer is offline.
- **What comes later.** An opt-in strict mode that holds other requests to the allowed hosts is planned after the launch.

`docs/security.md` also links this contract.

### 6. The footprint contract test

`app/tests/features/engine/footprint/footprint.test.ts` runs a real run: discovery, then one scenario, in headless Chromium, against a fixture page on `127.0.0.1` from `app/test-support/server.ts`. The scenario opens the page, clicks a download link, takes a frame and a card, and writes a log line.

**Setup.**

- **Sentinels.** Under one `mkdtemp` root, the empty folders `home`, `xdg-config`, `xdg-cache`, `xdg-data`, `xdg-state`, `tmp`, `config` and `runs`.
- **Moved folders.** For the run, `HOME` and `USERPROFILE` → `home`; `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `XDG_DATA_HOME` and `XDG_STATE_HOME` → theirs; `TMPDIR`, `TMP` and `TEMP` → `tmp` (so `os.tmpdir()` is `tmp`, which Node reads on every call); `RUNHOUND_CONFIG_DIR` → `config`; `runsDir` → `runs`.
- **Planted variables.** `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `RUNHOUND_AI_API_KEY`, `GITHUB_TOKEN` and `HTTPS_PROXY`, each carrying a random marker.
- **The spy.** `chromium.launch` is spied on and still launches the real browser.
- **Restoring.** Everything is restored after the run. Playwright found its browsers when it loaded, so moving HOME doesn't hide them.

**Assertions.**

- The report is in `runs/<runId>/report.json`, with the scenario passed.
- Both launches passed an explicit `env` without the marker, with HOME in `tmp/run-hound-browser-*/home`. Playwright gives `options.env` to the Chromium process as is (`coreBundle.js:39798`, `:43219`, `:9320`), so this is Chromium's environment. `/proc/<pid>/environ` can't be relied on: Chromium rewrites its process title over that memory (with a large environment it read back empty in testing).
- `home`, `xdg-config`, `xdg-cache`, `xdg-data` and `xdg-state` are empty.
- `tmp` is empty: no `playwright_chromiumdev_profile-*`, `playwright-artifacts-*` or `run-hound-browser-*` is left.
- The root holds only the sentinel folders.
- The download was refused.
- **macOS and Windows only** (`it.runIf`, so this is a no-op elsewhere): no Chromium- or Playwright-named entry newly appears, across the run, in the real OS-resolved per-user folders that the sentinels above don't touch — macOS's `Library/Application Support`, `Library/Caches` and `Library/Saved Application State` under the real home (`os.userInfo().homedir`, which reads the password database directly, not `HOME`); Windows's real `%LOCALAPPDATA%` and `%APPDATA%` (never overridden by this test, unlike `USERPROFILE`/`TEMP`/`TMP`). This is what makes "to be verified" in [1.2](#12-browserenv) become verified, once CI runs there.

It runs in the normal app suite. From 0.6.3 it runs on macOS and Windows CI too.

### 7. Records and release

- **Decisions.** They are recorded in [docs/decisions/09-2026.md](decisions/09-2026.md) and indexed in [DECISIONS.md](../DECISIONS.md), from `2026-09-30-launch-at-0-6-5` on. Work that carries them out records only new decisions it makes.
- **Roadmap wording.** Replace the "0.9.9 is the npx release" and "1.0.0 completes V4" wording with the plan above in:
  - `docs/roadmap.md` ("Road to 1.0" becomes the launch plan);
  - `README.md` (Roadmap section, and a row for this document in its Documentation table);
  - the site's roadmap and FAQ content and `site/src/app/llms-full.txt/route.ts` and `site/src/app/llms.txt/llms.ts`;
  - `docs/brand.md` where it names 1.0.0.

  Site tests hold the new wording, and a test fails if "0.9.9" or "1.0.0 is the release that completes V4" comes back.
- **Other docs.**
  - `docs/ai-spec.md`: the "Bedrock auth" section and the configuration table give the methods and order above, the three fields, when `~/.aws` is read, and what `credential_process` gets. `RUNHOUND_AI_AWS_PROFILE`'s row loses "else `default`".
  - `.env.example` and `run-hound.env.example`: the AWS block says access keys can also be saved in Settings, and that `~/.aws` is read only for a named profile.
  - `docs/security.md`: [Egress](#5-egress).
- **CHANGELOG.** "## Unreleased" becomes "## 0.6.1 (Isolated by default), 30 September 2026". Its "Changed" section names the migration in [3.4](#34-when-aws-is-read).
- **Version.** 0.6.1 in `app/package.json` and `site/src/lib/site.ts` (`version`, `released: "30 September 2026"`, `releasedIso: "2026-09-30"`).
  - The homepage pill "New in 0.6.1: …" is at most 46 characters, for example "New in 0.6.1: an isolated test browser".
  - Labels such as "checked against release 0.6.0" stay truthful to the run data they show: a figure from the 0.6.0 runs keeps saying 0.6.0.

### The tests that pin 0.6.1

| File | What it pins |
|---|---|
| `app/tests/features/engine/isolation/isolation.test.ts` | `browserEnv` on Linux (headless, headed, X11 and Wayland, the `XAUTHORITY` default), any other POSIX platform, macOS (including `CFFIXED_USER_HOME`) and Windows (case-insensitive names); no planted value in any result; `ISOLATED_CONTEXT`; `launchChromium` with an injected launcher (the folder and its subfolders, `env` and `artifactsDir`, removal on close, crash and failed launch; the exit-time fallback kept when an injected `remove` fails, dropped once it succeeds; `newContext`/`newPage` forced to `acceptDownloads: false` whatever the caller passes); `engine/isolation.ts` as the only module that imports or launches a browser type |
| `app/tests/features/engine/isolation/isolation-launch-sites.test.ts` | Real runs with `chromium.launch` and each browser's `newContext` spied on: discovery, the run, signed-in discovery (`auth.ts`) and `testSignIn` (`server/accounts.ts`) each launch isolated and leave no folder; every context (discovery, `openPage`, sign-in, the evidence renderer) has `acceptDownloads: false`; a clicked download is refused |
| `app/tests/features/engine/footprint/footprint.test.ts` | [The footprint contract](#6-the-footprint-contract-test) |
| `app/tests/features/ai/aws-access-keys.test.ts` | `resolveAwsCredentials` order (env, `saved`, named profile) and `source: "saved"`; no read under a sentinel `~/.aws` without a named profile (with `readFileSync`/`existsSync` recorded), `AWS_CONFIG_FILE` included; `awsProfileName` returning `null`; `awsProfileRegion` and `awsCredentialsAvailable`; `credentialProcessEnv` and the environment a real helper sees; `converseJson` signing with the saved pair and taking no region from `~/.aws` |
| `app/tests/features/ai/config-access-keys.test.ts` | Resolution of the pair (file, env over file, token only with its pair, half pairs, Bedrock only); region only from a named profile; every `saveAiConfig` rule above, `0600`/`0700`, errors without values; `aiStatus`'s `hasAwsKeys`, `hasAwsSessionToken` and `sources.awsKeys` without any value; a `[default]` profile not counted |
| `app/tests/features/server/app-ai-credentials.test.ts` | `PUT`, then `GET /api/ai` and `GET /api/settings` without the pair or token; `ai.json` `0600`; 400 for half a pair and for an env-locked pair (naming `AWS_ACCESS_KEY_ID`); no region or credentials from a `[default]` profile under the server's HOME |
| `app/tests/features/server/ui-ai-credentials.test.ts` | [Settings](#38-settings) |
| `app/tests/features/ai/ai-secrets-redacted.test.ts` | Registration by `resolveAiConfig` (file, env, a key that doesn't apply, replacement) and by `resolveAwsCredentials`; a saved secret kept out of a real run's report files, spec files and log |
| `app/tests/features/engine/redact/redact-aws-secret.test.ts` | The `aws-secret-key` pattern: the labelled forms, `findSecrets`, and what it must not match |
| `app/tests/features/checks/bundle-secrets/bundle-secrets-aws-secret.test.ts` | The `bundle-secrets` finding, its redaction, and a spec whose pattern matches the script |
| `app/tests/features/ai/aws-credentials.test.ts`, `app/tests/features/ai/config.test.ts` | Updated: the tests that pinned the unnamed `[default]` profile now pin that it is read only when named |

### Not in 0.6.1

These stay as they are until the release named:

- the Chromium sandbox (0.6.2; Playwright passes `--no-sandbox` unless `chromiumSandbox: true`, `coreBundle.js:43346-43347`);
- the UI token (0.6.2);
- where `runs/` and the config live on a host install (0.6.3; today `./runs` under the working folder and `~/.config/run-hound`);
- the browser cache location (0.6.3);
- deleting runs (0.6.4);
- a strict egress mode (after the launch).

## 0.6.2: clean launch

- **A per-launch UI token.**
  - `serve` makes a random token for each start, puts it in the printed and opened URL, and swaps it for an HttpOnly, SameSite=Strict cookie on first use.
  - Every `/api/*` request needs it, on top of today's Host, Origin, `Sec-Fetch-Site` and `X-Run-Hound: 1` checks. Those stop other websites, but not another local user or process.
  - The Docker entrypoint prints the URL with its token.
- **Chromium's sandbox on.**
  - `launchChromium` passes `chromiumSandbox: true` (the default is `false`: `types.d.ts:25402-25405`, and `--no-sandbox` is added otherwise, `coreBundle.js:43346-43347`).
  - When the sandboxed launch fails, it launches again without the sandbox, warns on the command line and in the UI, and records it in the report (for example, `report.browser.sandbox: false` with the reason).
  - The environment allowlist may need `CHROME_DEVEL_SANDBOX` for the setuid sandbox. That is checked on the image and on hosts.
- **`serve --open`.**
  - Run Hound's own Chromium opens the UI in an app window (`--app=<url>`) with a throwaway profile: `launchPersistentContext` on a user-data folder inside the per-launch folder, with `browserEnv`, removed when the window closes. Ctrl+C closes the window and the server together.
  - It is the default when a display exists (`canShowBrowser`) and never happens in Docker, whose image has only the headless shell. `--no-open` and `RUNHOUND_NO_OPEN=1` turn it off.
  - It needs full Chromium, not the headless shell. `--app` under Playwright's control is unverified: a smoke test comes first.
- **`run-hound doctor`.** It lists the paths Run Hound uses, the environment variables it reads, the sandbox and egress state, whether `~/.aws` will be read (a named profile or not), and the browsers installed.

## 0.6.3: npx

- **An npm package.**
  - `app/package.json` stops being `private`, gets a build of `bin` for Node ≥ 22.12, and is published as `run-hound`, so `npx run-hound` starts it.
- **Host state in the project.**
  - It lives in `./.run-hound/`, with `config/` and `runs/` inside and a `.gitignore` of its own containing `*`. `RUNHOUND_HOME` moves it.
  - Docker keeps `./runs/.config` as today.
- **One shared browser cache.**
  - It is a single Run Hound folder per user, set as `PLAYWRIGHT_BROWSERS_PATH`. Playwright's default would be `~/.cache`, `~/Library/Caches` or `%LOCALAPPDATA%` (`coreBundle.js:32662-32670`), and the variable replaces it (`:33118-33130`).
  - The first download is announced with its size and where it goes before it starts.
- **`run-hound clean`.** It removes what a crash left:
  - `run-hound-browser-*`, `playwright_chromiumdev_profile-*` and `playwright-artifacts-*` older than the running process, in the temp folder;
  - on request, old runs and the browser cache.
- **CI on macOS and Windows.** The app suite, the footprint test included, runs there. It proves `browserEnv`'s macOS and Windows rules, and a failure there is fixed and recorded as a decision.

## 0.6.4: launch prep

- **Hardened compose files.**
  - `cap_drop: [ALL]`, with `CHOWN`, `SETUID` and `SETGID` added back for the entrypoint's ownership switch;
  - `security_opt: [no-new-privileges:true]`;
  - a `tmpfs` for `/tmp`;
  - `read_only` where the image allows it;
  - checked together with the sandbox.
- **Deleting runs.** `DELETE /api/runs/:runId`, a button in the UI and a CLI command.
- **A "Send feedback" link in the UI.** It opens a GitHub issue prefilled with the version, operating system and install method. It never includes report content, targets or secrets.
- **Launch copy.** For the site, the README and TESTING.md.

## 0.6.5: launch

A GitHub pre-release first, tried through `RUNHOUND_TAG`, then the release and the public launch, asking for feedback.

## After the launch

- **1.0.0** refactors the app code so it is maintainable. The stages V0 to V4 no longer decide when it comes.
- **Native desktop packages** for Windows, macOS and Linux follow, with a desktop launch of their own.
- **A strict egress mode.**

## Verified API references

Every reference is to the installed code. Line numbers are for Playwright 1.63.0 (`node_modules/playwright-core`).

| What | Where | Used for |
|---|---|---|
| `LaunchOptions.env?: { [key: string]: string \| undefined }` | `types/types.d.ts:25414` | The per-launch environment |
| `LaunchOptions.artifactsDir` ("not cleaned up when the browser closes") | `types/types.d.ts:25385-25390` | Artifacts inside the per-launch folder |
| `LaunchOptions.chromiumSandbox` ("Defaults to `false`") | `types/types.d.ts:25402-25405` | 0.6.2 |
| `BrowserContextOptions.acceptDownloads?: boolean` | `types/types.d.ts:25728-25732` | Downloads |
| Client `launch()`: no `userDataDir`; `env` → `envObjectToArray` (drops `undefined`) | `lib/coreBundle.js:63297-63313`, `:57571-57578` | |
| Launch validator accepts `env`, `artifactsDir`, `chromiumSandbox` | `lib/coreBundle.js:16581-16601` | |
| `const env = options.env ? envArrayToObject(options.env) : process.env` | `lib/coreBundle.js:39798` (`envArrayToObject` `:9436-9441`) | Why Chromium inherits everything today |
| Chromium `amendEnvironment(env) { return env; }` | `lib/coreBundle.js:43219` (BiDi `:43503`) | |
| `spawn(command, args, { env: options.env, … })`; temp folders removed on exit | `lib/coreBundle.js:9315-9329` | |
| `artifactsDir` else `mkdtemp(os.tmpdir()/playwright-artifacts-)`; `userDataDir` `mkdtemp(os.tmpdir()/playwright_${name}dev_profile-)` | `lib/coreBundle.js:39755-39768` | What is left in the temp folder |
| `--no-sandbox` unless `chromiumSandbox === true` | `lib/coreBundle.js:43346-43347` | 0.6.2 |
| `toAcceptDownloadsProtocol`: `undefined` → unset, truthy → `"accept"`, else `"deny"` | `lib/coreBundle.js:62155`, `:62169-62175` | `false`, not `"deny"` |
| Default `acceptDownloads = "accept"` (non-Electron) | `lib/coreBundle.js:51447-51448` | |
| Chromium `Browser.setDownloadBehavior` `deny` | `lib/coreBundle.js:38581-38583` | |
| A denied download's message | `lib/coreBundle.js:52130` | The tests' `Download.failure()` |
| Browser cache default and `PLAYWRIGHT_BROWSERS_PATH` | `lib/coreBundle.js:32662-32670`, `:33118-33130` | 0.6.3 |
| `ProcessEnvOptions.env?: NodeJS.ProcessEnv` (`spawn`) | `node_modules/@types/node/child_process.d.ts:535` | `credential_process` |
| `os.tmpdir()`, `os.homedir()` read `TMPDIR` and `HOME` on every call | `node_modules/@types/node/os.d.ts:225`, `:463`; checked on Node 24.21 | The footprint test's sentinels |
