# Desktop acceptance: first run on clean machines (D5)

How a desktop installer is validated before the maintainer accepts the milestone (M1, ticket D5, issue #48): what CI proves on a fresh machine for each platform and where the evidence is, what only a person can check, and where acceptance is recorded. Install, update and uninstall for users are in [desktop-install.md](desktop-install.md); the installer pipeline is in [desktop-architecture.md](desktop-architecture.md).

## What CI proves

Every run of [`desktop-installers.yml`](../.github/workflows/desktop-installers.yml) builds the installers, then the `first-run` and `first-run-rpm` jobs take each one to a fresh GitHub runner, which is the clean machine: no Run Hound, no settings, no browser cache. Each leg installs the real artifact, drives the installed app with [`desktop/scripts/first-run-check.mjs`](../desktop/scripts/first-run-check.mjs) (Playwright's Electron support, `_electron.launch({ executablePath })`, with `RUNHOUND_NO_UPDATE_CHECK=1`), uninstalls it, and checks what is left. On Linux the app gets a fresh home. On macOS and Windows it runs on the runner's own home, which is already clean, and the check first asserts that no Run Hound data is there (the settings, reports and profile folders): a made-up `HOME` has no login keychain on macOS, so the first access to the keychain stops with a system dialog before the window opens, and a changed profile is not what a Windows user has. The app under test is only the installed artifact; the harness (the checkout, `pnpm install`, Playwright and the spa-fetch sample app) comes from the repository.

| Step | What it proves |
|---|---|
| **First launch** | The window shows the engine on loopback, the engine answers, `/api/ai` reports how saved keys are protected (`os-keychain` or `run-hound`), no run and no key exist, and the settings are in the documented folder. The import marker, if there is one, says nothing was imported. The installed executable, Electron's app name and the profile folder carry the product's names (below). The app's version, Electron and Chromium are recorded. |
| **Model setup** | `PUT /api/ai` saves an Anthropic model and a **made-up** key with consent for a remote provider. Then `hasKey` is true, `savedKeys` lists `anthropic`, the API never returns the key, and no file in the settings or reports folder holds it as plain text. No provider is called: plans are made with AI off and `/api/ai/test` is never used. |
| **Representative URL run** | Plans the sample app (`fixtures/samples/spa-fetch`) from the installed app's own Chromium, runs the scenarios selected by default, waits for the end, and saves `report.json` and `report.html`. Zero confirmed findings (the sample is built correctly, so any confirmed finding is a false positive), no errored scenario, a page visited, and the report's version is the app's. |
| **Cancellation** | A second run is stopped after its first scenario. It ends stopped (`report.stopped`), every approved scenario has a result, and the ones that did not finish are `skipped` with the note "Stopped by you". |
| **Restart** | The app is closed and launched again on the same home. Both runs are listed and their reports still open and exist on disk, and the AI settings, the consent and the saved key are still there (the key can still be read). |
| **Uninstall removed the app** | After the platform's uninstall (below), the executable and the installed folder or bundle are gone. |
| **Uninstall left none of the package's files** (Linux) | None of the files `dpkg -L` or `rpm -ql` listed is still on disk. |
| **Uninstall kept your data** | The settings and reports folders from the [data table](desktop-install.md#where-your-data-lives) are still there, with `ai.json`, `secrets.json` and the reports of both runs. |

Each step is recorded with its result and duration. The job summary shows the table, and a failed step names what was wrong.

### Legs, commands and evidence

The commands are the silent equivalents of the user steps in [desktop-install.md](desktop-install.md). Evidence is the workflow artifact of the same name, kept 30 days.

| Platform | Runner | Install | Uninstall | Evidence artifact | Blocking |
|---|---|---|---|---|---|
| Linux x64 deb | `ubuntu-24.04` | `sudo apt-get install -y ./<file>.deb`, under `xvfb-run` | `sudo apt-get remove -y run-hound` | `first-run-linux-x64-deb` | yes |
| Linux arm64 deb | `ubuntu-24.04-arm` | the same | the same | `first-run-linux-arm64-deb` | yes |
| Linux x64 rpm | `ubuntu-24.04`, in a `fedora:44` container | `dnf install -y <file>.rpm`, under `xvfb-run` | `dnf remove -y run-hound` | `first-run-linux-x64-rpm` | yes |
| Linux arm64 rpm | `ubuntu-24.04-arm`, in a `fedora:44` container | the same | the same | `first-run-linux-arm64-rpm` | yes |
| macOS arm64 | `macos-15` | `hdiutil attach` the dmg, copy the `.app` to `/Applications` | delete the `.app` | `first-run-macos-arm64` | yes |
| macOS x64 | `macos-15-intel` | the same | the same | `first-run-macos-x64` | yes |
| Windows x64 | `windows-2025` | the NSIS installer with `/S` (per user, `%LOCALAPPDATA%\Programs`) | `Uninstall Run Hound.exe /S` from the install folder | `first-run-windows-x64` | yes |
| Windows x64, older image | `windows-2022` | the same installer, built on `windows-2025` | the same | `first-run-windows-2022-x64` | yes |

Every leg has run green ([PR #49](https://github.com/rahul-bharati/run-hound/pull/49)), so a failure in any of them fails the workflow. A new leg starts with `advisory: true` (it reports without failing) until a run shows it green. The release gate reads every leg's result: a failed blocking leg stops publishing ("first run failed (…)" in the gate's summary), and advisory legs are listed there but block nothing. The Fedora legs are the closest to a bare system: the rpm's declared dependencies are installed before anything else, and the harness is added afterwards. The Ubuntu runner image already has many libraries, so the deb legs prove the install and the first run, and less about missing dependencies.

When a leg's first run fails, the leg also runs the installed app directly, without Playwright, and records it (see below), so a start-up failure can be told from a failure of Playwright's way of starting the app. On Windows it also runs V8 flags and stock Electron on the runner, to isolate a crash.

Each artifact holds:

- `first-run.json`: the app version, platform, architecture, the installer's file name, size and SHA-256, the installed executable, Electron and Chromium versions, the data folders and the app's profile folder (`userData`), the run ids, a digest of each report, and every step's result and duration. After the uninstall it also holds the uninstall steps.
- `summary.md`: the same as a table, as shown in the job summary.
- `report.html` and `report.json` of the representative run, `report-stopped.json` of the cancelled one.
- `window-first-launch.png` and `window-after-restart.png`.
- `fuses.txt` and `fuses.json` (the Electron fuses of the installed binary, on every leg) and `diagnostics.md`.
- After a failed first run: one row per direct run in `diagnostics.md`, `app-direct*.log`, `app-direct.json` and `screen-*.png` (macOS and Windows); on macOS `macos-signature.txt`, `macos-log.txt` and `crash-reports/`; on Windows `windows-events.txt`, `chromium.log`, `authenticode.txt` and `exe-version.txt`.
- `installed.txt` (what the package manager or the OS says was installed, with its version) and, on Linux, `package-files.txt`.

### What CI cannot prove

- **How the window looks and behaves as a native window**: title bar, controls, icon in the dock, taskbar or launcher. The screenshots show the page, not the frame around it.
- **Gatekeeper and SmartScreen.** A file from a workflow artifact has no quarantine or "downloaded from the internet" mark, so neither warns. The unsigned first launch in [desktop-install.md](desktop-install.md) is checked by hand.
- **A real provider key.** The check never sends a request to a provider.
- **A real desktop session**: a system keychain that asks for access, a desktop that has a display scaling or a theme. The runners use their own session, and Xvfb on Linux.
- **A Mac with no usable login keychain.** The runner has one. Without it macOS shows a system dialog, "Keychain Not Found: A keychain cannot be found to store 'Run Hound Key'", before the window opens, and the window waits for it. Cancelling lets Run Hound fall back to its own store. This is a manual-check item below, not a CI blocker.
- **An update over an older install.** There is no older release yet.

### The names the check asserts

The names a user sees are set in `desktop/package.json` and checked on every platform, so a rename can't slip back in: the first-run check fails if the installed executable, Electron's app name or the profile folder differ.

| | Name | Where it comes from (electron-builder 26.15.3, `app-builder-lib`) |
|---|---|---|
| Electron's app name, its profile folder (`userData`) and the keychain or libsecret item | `Run Hound` | the top-level `productName` of `desktop/package.json`, which Electron prefers to the package name (`app.getName()` in `electron.d.ts`); it is copied into the packaged `package.json` (`fileTransformer.js`) |
| macOS | `Run Hound.app`, with `Run Hound` inside `Contents/MacOS` | `macPackager.js`: `${productFilename}.app` and `CFBundleExecutable`; `productFilename` is the product name because only Linux sets `executableName` |
| Windows | `%LOCALAPPDATA%\Programs\run-hound-desktop\Run Hound.exe`, uninstaller `Uninstall Run Hound.exe` | `ElectronFramework.js` (`${productFilename}.exe`); the folder is `APP_FILENAME`, the package name that `build.extraMetadata.name` sets (`appInfo.js`, `targetUtil.js`, `multiUser.nsh`) |
| Linux | `/opt/Run Hound/run-hound`, package `run-hound` | `build.linux.executableName`, `deb.packageName`, `rpm.packageName`; the folder is the product name |

## Defects and release blockers

A step that fails on a leg, or a manual check that goes wrong, is a defect. File it as an issue that names the platform, the installer, the step and the artifact, and link it in the table below. A defect is a **release blocker** when it stops a user from installing, launching, running, cancelling, restarting or uninstalling on a platform in the support matrix, or loses or exposes their data. The ticket stays open until every blocker is fixed and the legs that showed it are green.

| Defect | Platform | Step or check | Blocker | Issue | Status |
|---|---|---|---|---|---|
| | | | | | |

## Manual checklist for the maintainer (M1 acceptance)

Use the installers from the workflow run you are accepting (private artifacts `installers-*`), or the signed release once there is one. Tick each item per platform.

**1. The window (macOS, Windows, Linux).** Open the installed app and look at the chrome:

- [ ] The title bar and its draggable strip behave as a native window's do: the window moves by the strip and has no stray second title bar.
- [ ] The window controls (close, minimise, maximise or full screen) are present, work and sit where the OS puts them. Nothing overlaps the controls.
- [ ] The app icon is the Run Hound one in the window, the dock or taskbar, the Start menu or applications menu, and the installer.
- [ ] The window is dark from the first frame (no white flash), and text can be copied and pasted.

**2. A first run with a real provider key.** On a clean user (or after deleting the data folders):

- [ ] Open **Settings**, choose a provider and model, enter your own key, and test the connection: it answers.
- [ ] Plan a page of one of your own apps with **Review with AI** on, run it, and read the report.
- [ ] Quit and open the app again: the settings, the key and the run are still there.

**3. An unsigned build's first launch (until signing is set up).**

- [ ] macOS: Gatekeeper's prompt and the **Open Anyway** (macOS 15) or Control-click **Open** (macOS 14) steps in [desktop-install.md](desktop-install.md) work as written, and the bundle and folder names match what the document says.
- [ ] Windows: SmartScreen's **More info** and **Run anyway** steps work as written.
- [ ] A signed and notarized build, when there is one, opens with the usual "downloaded from the internet" prompt only.

**3b. A Mac with no usable login keychain (a fresh user account, or a deleted keychain).**

- [ ] On the first launch macOS may show "Keychain Not Found: A keychain cannot be found to store 'Run Hound Key'" before the window. Choose **Cancel**: the window opens and saved keys use Run Hound's own store (**Settings** shows which).

**4. Uninstall and data cleanup.** With the uninstall steps in [desktop-install.md](desktop-install.md):

- [ ] The app is gone from the applications list, the Start menu or launcher, and **Settings > Apps > Installed apps** on Windows.
- [ ] Your settings, keys and reports are still in the folders the document names.
- [ ] Deleting those folders (and the app's profile folder) removes the rest, and a new install is a first run again.
- [ ] macOS: look in Keychain Access for the item the document calls "Run Hound Safe Storage". Electron names it from the app's name, which is `Run Hound` (see `appName` in `first-run.json`), so correct the document if it reads differently.

## Acceptance record

Fill in one row per acceptance. The evidence run is the `Desktop installers` workflow run whose `first-run-*` artifacts you checked.

| Date | App version | Platforms (installer file and checked by) | Evidence run URL | Defects (issues) | Accepted by |
|---|---|---|---|---|---|
| | | | | | |

Maintainer acceptance of M1 is recorded here and on issue #48. The ticket moves to Done after the pull request that carries the acceptance is merged.
