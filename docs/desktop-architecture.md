# Desktop architecture (D1)

The architecture decision for shipping Run Hound as a desktop app on Linux, Windows and macOS. This is a **specification and recommendation only**: no product code changes here, and no dependency is added to `package.json`. D2 through D5 implement the result.

Everything the existing app guarantees still holds: local execution, browser isolation, the safety gate, deterministic checks, and redaction. The desktop app is a distribution and interaction change, not a change to the engine's contracts.

## Rules

1. **The engine is reused, not rewritten.** The desktop app wraps the existing entrypoints; it does not reimplement planning, checks, sign-in or reporting.
2. **One support matrix, set by Playwright.** The tested target browser is Playwright's Chromium, so Playwright's stated system requirements set the floor for the desktop app regardless of what the shell supports. Vendor *prerequisites* are not the same as *intended product targets*: this document supports Windows 11+ x64, macOS 14+ Intel and Apple Silicon, and the listed Linux distributions on x64 and arm64. **Windows Server, WSL and Windows arm64 are not claimed as targets** — no architecture-specific evidence was gathered for them, and they are listed here only as vendor prerequisites.
3. **The tested browser is headed-capable and bundled.** Manual sign-in (SSO, 2FA, one-time codes) needs a visible browser that the user can interact with, so the full Chromium build is required — the headless shell alone is not sufficient for the desktop milestone. The current default headless path must keep working unchanged alongside it.
4. **Browser path configuration precedes Playwright's import.** `app/src/engine/isolation.ts:21` imports `playwright` statically at module load. `PLAYWRIGHT_BROWSERS_PATH` and `PLAYWRIGHT_SKIP_BROWSER_GC` must therefore be set in the process environment **before the engine module is imported**, not merely before `launcher.launch`. A desktop entry point that imports the engine first can resolve the user cache instead of the bundled browser.
5. **The renderer is treated as untrusted.** The window displays target-derived content: page titles, findings, screenshots, traces and report text. The renderer runs with no Node integration and context isolation on, navigation and window-open requests to anything other than the local server are refused, and access to the local API is limited to the loopback server. Run Hound's own window chrome is the only trusted surface.
6. **The engine runs supervised, not on the UI thread.** Engine work is started from the main process but executed in a supervised child (Electron `utilityProcess`), so a long run cannot freeze the window and a crash is contained and reportable rather than taking the app down.
7. **Signing and notarization are release gates on macOS and Windows.** Unsigned desktop builds are not a supported outcome; they are an experiment used only inside the spike.
8. **Automatic updates are deferred for the first desktop release.** Distribution is a GitHub Release download. The app may check for a newer version and open the release page; it does not install updates in place.
9. **No behaviour claim is made for an unverified platform.** Linux distribution formats, macOS temp-folder cleanup and Windows file locking are proven by the spike before they are promised.

## What the desktop app reuses

Verified against the current tree.

| Capability | Reusable as-is | Evidence |
|---|---|---|
| Server construction | `createApp()` returns a `Hono` instance; binding is a separate adapter | `app/src/server/app.ts:49`, `app/src/cli/adapters/server.ts:4-17` |
| Server binding | `startServerWithApp` wraps `@hono/node-server` `serve` and takes `app.fetch`; the desktop app may bind loopback itself or call the Hono `fetch` in process | `app/src/cli/adapters/server.ts:1-16` |
| Local UI | The browser client is one concatenated script (`HELPERS + ROUTING + … + REPORT`), so it loads as a single served page | `app/src/server/ui/client.ts:12` |
| Run lifecycle | `runPlan` wraps the run in a secret-registration `try`/`finally`; the body resolves the run id, creates `<runsDir>/<runId>`, launches the browser, signs in, runs scenarios and writes the report | `app/src/engine/runner/run-flow.ts:167-172`, `205-215` |
| Cancellation | `options.signal` with `whenStopped`; `skipRest` records every not-yet-run scenario as skipped | `app/src/engine/runner/run-flow.ts:220-226`, `228-236` |
| Browser launch | `launchChromium` passes caller options straight through, so `executablePath` and `headless` are already injectable; the per-launch environment, temp folder and `ISOLATED_CONTEXT` download refusal are enforced inside it | `app/src/engine/isolation.ts:206-210`, `221-224` |
| Cleanup | Temp folder removal runs on close, on `disconnected`, on launch failure and on process `exit` | `app/src/engine/isolation.ts:174-190`, `226-237` |
| Config storage | `configDir` resolves `$RUNHOUND_CONFIG_DIR`, else `$XDG_CONFIG_HOME/run-hound`, else `~/.config/run-hound` | `app/src/config/ai.ts:34-45` |
| Credential storage | AI keys and test-account passwords are encrypted in `secrets.json`, bound to their names by AES-256-GCM; the data key is in `secrets.key`, wrapped by the OS keychain on the desktop or kept by Run Hound itself on the command line. See [2026-10-06 decision](decisions/10-2026.md#2026-10-06-encrypted-secret-store). | `app/src/operations/secret-store.ts:1-18` |
| Release automation | CI and release currently build Linux container images for `linux/amd64` and `linux/arm64` only | `.github/workflows/release-images.yml:177-229` |

### Gaps the desktop app must close

| Gap | Evidence | Consequence |
|---|---|---|
| No native packaging or build pipeline | Releases are container images only (above) | A desktop build, signing and publish pipeline is new work (D4) |
| The entry point is TypeScript run through `tsx` | `app/package.json` `bin.run-hound = ./src/cli.ts`; `tsx` is a runtime dependency | A desktop build needs a compiled JavaScript entry; bundling `tsx` was not verified from a primary source and is not assumed |
| Secrets are encrypted and protected | `secret-store.ts`, `key-protector.ts`, `Dockerfile` | Keys and passwords are sealed in an encrypted store, and the data key is wrapped by the OS credential store on the desktop (Electron `safeStorage`) or kept as 0600 by Run Hound elsewhere. See [2026-10-06 decision](decisions/10-2026.md#2026-10-06-encrypted-secret-store). |
| Config path is XDG-oriented | `config/ai.ts:34-45` | `~/.config` is not the native macOS location; the desktop app should resolve a platform-appropriate directory and keep the override |
| Report directory is working-directory-relative | `run-flow.ts:205` (`resolve(options.runsDir ?? "runs")`) | A desktop app launched from Finder or the Start menu has no meaningful working directory; the runs directory must be passed explicitly |
| No user-facing authentication | No account or session code for Run Hound itself was found; the saved accounts are target-app test identities | A future hosted workspace needs its own sign-in (T3) |
| Browser delivery is implicit | `launcher.launch({ ...options })` inherits Playwright's default browser location; `PLAYWRIGHT_BROWSERS_PATH` and browser GC are not set anywhere in `app/src` | The desktop build must decide where the bundled Chromium lives and must prevent Playwright's browser GC from deleting it |

## Support matrix

Playwright's published system requirements ([playwright.dev/docs/intro](https://playwright.dev/docs/intro)) are the binding floor:

- Windows 11+, Windows Server 2019+, or WSL
- macOS 14 (Sonoma) or later
- Debian 12/13, Ubuntu 22.04/24.04/26.04, x86-64 or arm64
- Node.js 22.x, 24.x or 26.x (the app already requires `>=22.12`)

Caveat, stated honestly: that page is written for Playwright Test. It is the vendor's published support statement and is used here as the conservative floor. It was not confirmed whether a library consumer is held to the same matrix.

Resulting desktop targets: **Windows 11+ x64, macOS 14+ Intel and Apple Silicon, and Linux x64/arm64 on the supported distributions.** Older macOS and Windows 10 are out of scope even though the shells below support them, because the tested browser does not.

**Not claimed:** Windows Server 2019+, WSL, and Windows arm64. All three appear in the vendor's prerequisites; none has architecture-specific evidence for the bundled browser, and WSL is not a desktop target. Any of them requires its own spike before it can be added.

## Shell options

Researched from vendor documentation on 4 October 2026, not from memory.

### Electron

- **Runtime**: the Electron main process *is* Node, so the existing engine runs in-process with no second runtime to ship ([process model](https://www.electronjs.org/docs/latest/tutorial/process-model)). Long runs should execute in a supervised [`utilityProcess.fork`](https://www.electronjs.org/docs/latest/api/utility-process) child rather than the main process, so the window stays responsive and a crash is contained; `child_process.fork` also works.
- **Windowing**: `BrowserWindow` + `loadURL` loads the existing served UI directly ([process model](https://www.electronjs.org/docs/latest/tutorial/process-model)). The renderer runs with no Node integration and context isolation on, which is what Rule 5 requires; the UI already talks to the server over HTTP, so it needs no privileged bridge.
- **Updates**: fully deferrable — nothing happens until `checkForUpdates()` is called ([updates](https://www.electronjs.org/docs/latest/tutorial/updates)). `Squirrel.Mac` requires a signed app for updates to work at all.
- **Signing**: macOS needs an Apple Developer Program membership, a `Developer ID Application` certificate and notarization ([code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)). Windows application signing does not strictly require an EV certificate — a standard code-signing certificate is accepted — but an EV certificate is what buys SmartScreen reputation, and reputation is what makes a new app install without a scary warning. Microsoft Artifact Signing is an alternative supplier for the same reputation goal. **The exact current requirement and reputation behaviour must be verified with the certificate supplier before an EV certificate is treated as a required budget item.**
- **Linux formats**: deb, rpm, Flatpak, Snapcraft and ZIP via Forge; Forge has no AppImage maker ([Forge makers](https://www.electronforge.io/config/makers/deb)).
- **Minimum OS**: macOS Ventura 13+, Windows 10+, Linux x64/arm64, aligned with Chromium support ([Electron README](https://github.com/electron/electron/blob/main/README.md)).
- **Size**: release assets measured upstream at roughly 117 MB (linux-x64), 124 MB (darwin-arm64) and 151 MB (win32-x64), plus a separate Chromium for testing.

### Tauri 2

- **Runtime**: no embedded Node. A Node app must ship as a sidecar — either a bundled Node runtime or a packaged binary ([Node.js as a sidecar](https://v2.tauri.app/learn/sidecar-nodejs/), [sidecar](https://v2.tauri.app/develop/sidecar/)). macOS and Linux GUI apps do not inherit the shell `PATH`, so Node discovery needs explicit handling.
- **Windowing**: `WebviewUrl::External` can point at a dynamic loopback port ([WebviewUrl](https://docs.rs/tauri/latest/tauri/enum.WebviewUrl.html)), using system webviews: WebView2, WKWebView and webkitgtk.
- **Updates**: the updater signature "cannot be disabled", but the *check* is an explicit API call, so deferral remains under app control ([updater](https://v2.tauri.app/plugin/updater/)).
- **Signing**: same Apple Developer account and notarization requirement; ad-hoc signing is possible but leaves users whitelisting the app manually ([macOS signing](https://v2.tauri.app/distribute/sign/macos/)).
- **Linux formats**: deb, rpm, AppImage, Flatpak, Snap, AUR. AppImage must be built on an old enough base (Ubuntu 22.04 / Debian 12 suggested) to keep `GLIBC` compatibility, and the image grows from a few MB to 70+ MB ([AppImage](https://v2.tauri.app/distribute/appimage/)).
- **Minimum OS**: macOS Catalina 10.15+, Windows 7+ on the prerequisites page, but Windows also needs WebView2 ([prerequisites](https://v2.tauri.app/start/prerequisites/)).

### Recommendation: Electron

The deciding factor is that **Run Hound's engine is a Node application and Chromium must ship either way.** Playwright's Chromium is required for the tested target regardless of the shell, so Tauri's "no bundled browser" advantage does not apply to this product: Tauri would add a system webview *and* require shipping a Node runtime, while Electron supplies the Node runtime and the window.

Secondary factors:

- No Rust toolchain and no second runtime in the shipped product.
- The update mechanism can be deferred outright, which Rule 5 requires anyway.
- macOS signing and notarization cost is identical under both options, so it does not differentiate them.

Accepted costs of this recommendation, stated rather than minimised:

- **Electron bundles a second Chromium.** Playwright's Chromium is required for the tested target under either shell, so Electron's own browser is an additional download, additional on-disk browser storage, a second Chromium to security-patch, and a second Chromium's memory while a run is in progress. The installed footprint is expected to be materially larger than a Tauri build, but **no reproducible measurement exists yet** — upstream compressed asset sizes do not establish an installed size, and the spike must measure it (step 8) before any size figure is published.
- Windows SmartScreen reputation is what makes a first-time install unremarkable; whether that needs an EV certificate is a supplier question, not a settled fact (see above).
- Electron's minimum OS is looser than the product's floor, so the matrix in this document, not Electron, defines support.

**Fallback if the measured cost is unacceptable:** Tauri with a bundled Node runtime. More moving parts, but one browser instead of two. That is a spike outcome, not a preference.

## Bundling the tested browser

- Ship Playwright's Chromium inside the app in an **application-private, version-tagged directory**, and point `PLAYWRIGHT_BROWSERS_PATH` at it. A private directory matters: a shared registry is what lets one Playwright installation garbage-collect another one's browsers.
- **Set both browser environment variables before the engine is imported** (Rule 4), because `app/src/engine/isolation.ts:21` imports `playwright` statically. Setting them inside the app's own launch path is what makes them apply; another installer on the same machine will not inherit them.
- **Garbage collection is an install-time behaviour, not a launch-time one.** Playwright prunes browser revisions during its install/registry bookkeeping, not while a browser is launching. The hazard is therefore narrow and specific: if any step in the app's own lifecycle runs a Playwright install against a shared registry, it can remove the revision the app depends on. The mitigations are the private version-tagged directory plus `PLAYWRIGHT_SKIP_BROWSER_GC=1` set in the app's environment; the app should never run an install step at all. Spike step 7 must exercise a real reinstall to confirm the bundled browser survives.
- Ship the full Chromium build, not only the headless shell, because manual sign-in requires a visible browser (Rule 3). The container image's headless-shell-only choice does not carry over, and the existing default headless path must be re-verified after the change.
- Licensing is compatible: Playwright is Apache-2.0 and Chromium is BSD. **Unverified:** no primary source was found confirming that Chrome for Testing binaries may be redistributed inside a commercial desktop application. Resolve this before publishing a signed build.

## Platform risks to prove in the spike

| Risk | Evidence | Why it matters |
|---|---|---|
| macOS per-launch home redirection is unproven | `app/src/engine/isolation.ts:125-128` sets `CFFIXED_USER_HOME` because macOS resolves its per-user folders through `NSSearchPathForDirectoriesInDomains`/`NSHomeDirectory` rather than `HOME`, and records "Not yet verified on macOS"; the footprint test only covers the env-driven folders | Leaked browser profiles and artifacts on macOS if the redirect does not take effect |
| Windows cleanup can hit `EBUSY`/`EPERM` while Chromium holds handles | `isolation.ts:159`, `168` rely on retries plus a synchronous `exit` hook | Leaked temp folders accumulate on the user's disk |
| Headed Linux needs a display session | `isolation.ts:104-114` forwards `DISPLAY`/`WAYLAND_DISPLAY`/`XAUTHORITY` | Wayland sessions and minimal installs may fail to show the browser; the sign-in flow depends on it |
| Temp-path joining is platform-branched while the folder is created with the host's `join` | `isolation.ts:88`, `116` | Mismatch is possible when `platform` is simulated in tests but not on a real host |
| Saved secrets resist copying, not a program running as the user | `secret-store.ts`, `key-protector.ts` | Encrypted with the OS keychain or Run Hound's own key; a program already running as the same user can still read them. Stated in `SECURITY.md` ([2026-10-06](decisions/10-2026.md#2026-10-06-encrypted-secret-store)) |
| The app has no meaningful working directory when launched from a GUI | `run-flow.ts:205` defaults `runsDir` to `"runs"` | Reports would scatter or fail; the desktop app must pass an explicit path |

## The smallest spike

One disposable experiment, run on all three OS families, on real CI runners and at least one real desktop each. It must answer, with evidence, every unknown in this document.

1. Start the engine in a supervised child process, bind loopback, load the existing UI, and complete one already-approved fixture scenario through the unchanged engine.
2. Show live progress and the existing report; open a report from disk.
3. Exercise cancellation mid-run, then confirm remaining scenarios are recorded as skipped.
4. Quit the app and confirm no orphan browser process, and no leftover per-launch temp folder.
5. Kill the app mid-run and confirm the same cleanup, plus a recoverable state on next launch.
6. Launch a headed browser and complete a manual sign-in by hand, then confirm the captured session is reusable by the engine.
7. Confirm the browser environment variables are in place **before** the engine is imported, by asserting which executable path resolves, and confirm a reinstall of the app leaves the bundled browser intact.
8. Exercise the renderer boundary: confirm the window cannot reach Node, cannot open an external window, and cannot navigate away from the local server, while a report containing hostile text from the tested app still renders safely.
9. Record a support matrix result per OS: install, first run, run, cancel, quit, crash, cleanup, and **measured** disk footprint and peak memory.

The spike is throwaway. Its output is this document's open questions answered, plus follow-up tickets — not shipped code.

## Needs maintainer confirmation

- **Signing budget.** An Apple Developer Program membership (annual) plus notarization is required for macOS. On Windows, application signing itself does not require an EV certificate, but SmartScreen reputation does affect how a first install looks to a user; the certificate supplier should confirm what buys that reputation and at what cost before this is budgeted. No workaround is proposed for macOS.
- **Linux packaging priority.** Flatpak and Snap impose sandboxing rules that interact with the per-launch browser isolation and the safety gate's local-address model. deb and rpm are the lower-risk first targets; AppImage needs a separate, older build base for `GLIBC` compatibility.
- **Update policy.** Rule 8 defers in-app updates. A GitHub Releases download plus a version check is the proposed first-release behaviour.
- **Credential storage.** Decided: [2026-10-06](decisions/10-2026.md#2026-10-06-encrypted-secret-store). Saved keys and passwords are encrypted in `secrets.json`, bound to their names; the data key is wrapped by the OS keychain on the desktop or kept by Run Hound itself elsewhere. In Docker, only environment variables are used.
- **Renderer hardening.** Rule 5's boundary is a proposal, not a measured configuration; the spike confirms it, and tightening it further is a follow-up.

## Sources

- Ticket #27 (D1); related contracts `docs/execution-grants.md`, `docs/team-workflow.md`, `docs/hosted-sync-privacy.md`, `docs/launch-spec.md`.
- Code citations as listed above, read in this worktree.
- Vendor documentation: Electron process model, utility process, updates, code signing, support policy, Electron Forge makers; Tauri sidecar (Node.js), sidecar, WebviewUrl, updater, macOS signing, AppImage, prerequisites; Playwright installation/system requirements and browsers.
- Installed versions: Playwright 1.63.0 with Chromium revision 1243; Hono 4.13.8; `@hono/node-server` 2.1.1; Node engine `>=22.12`.

## Implementation status

The `@run-hound/desktop` package (`desktop/`) implements Rules 1 to 5 with the engine still in the main process; the supervised `utilityProcess` (Rule 6) is the next slice, and browser bundling is D3.

- **Build:** `desktop/scripts/build.mjs` (esbuild) emits `dist/main.js`, `dist/preload.cjs` and `dist/engine.js`. The engine is bundled from `app/src`, because the app imports its TypeScript by `.js` specifiers and only `tsx` can run that source; Playwright and axe stay external and ship as the desktop package's dependencies.
- **Start-up order (Rule 4):** the main process sets `RUNHOUND_CONFIG_DIR` and, in a packaged app that ships `resources/playwright-browsers`, `PLAYWRIGHT_BROWSERS_PATH` and `PLAYWRIGHT_SKIP_BROWSER_GC`, then imports `dist/engine.js`. Until D3, the app uses Playwright's per-user browser cache.
- **Window (Rule 5):** context isolation, sandbox, no Node; the preload exposes only `DesktopPreloadBridge`. Navigation and new windows are pinned to the engine's origin; `http:`/`https:` links open in the default browser and other schemes are dropped. Only clipboard writes are granted.
- **Proof:** `pnpm --filter @run-hound/desktop test:launch` launches the app with Playwright's Electron driver and checks the window, the API, a Chromium planning run, the bridge and the navigation lock; CI runs it against the development build and an unpacked Linux package.
