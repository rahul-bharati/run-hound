# Install the Run Hound desktop app

The desktop app is Run Hound in its own window: the same engine and checks as the web UI and the command line, plus its own settings folder and the Chromium it tests with, so it needs no Docker and no separate browser. It runs on your machine and tests pages of apps that run on your machine, as the other ways do.

> **Internal testing builds only.** Until code signing is set up, the installers are not signed (macOS) or not signed by a publisher Windows knows, and nothing unsigned is published. A release is published only after signing, as the [architecture rules](desktop-architecture.md) require (Rule 7). If you have an installer, it came from the maintainers for testing. Don't pass it on.

## Where it runs

From the [support matrix](desktop-architecture.md#support-matrix), which Playwright's Chromium sets:

| System | Installer | Notes |
|---|---|---|
| macOS 14 (Sonoma) or later, Apple Silicon or Intel | `.dmg` | If more than one `.dmg` is offered, take the one for your chip. |
| Windows 11 or later, x64 | `.exe` installer | Windows on Arm, Windows Server and WSL are not supported. |
| Debian 12 or 13, Ubuntu 22.04, 24.04 or 26.04, x64 or arm64 | `.deb` | |
| Other Linux distributions, x64 or arm64 | `.rpm` | Built for testing; there is no support claim for it yet. |

## Where your data lives

The app keeps your settings, saved keys and reports in folders of its own, apart from the command line's and from the app's files. Installing, updating and uninstalling never touch them.

| | Settings and saved keys | Reports |
|---|---|---|
| macOS | `~/Library/Application Support/run-hound` | `~/Library/Application Support/run-hound/runs` |
| Windows | `%APPDATA%\run-hound` | `%LOCALAPPDATA%\run-hound\runs` |
| Linux | `~/.config/run-hound-desktop` (or `$XDG_CONFIG_HOME/run-hound-desktop`) | `~/.local/share/run-hound/runs` (or `$XDG_DATA_HOME/run-hound/runs`) |

- **Settings folder:** `ai.json` (your AI choices), `accounts.json` (the test accounts you saved) and `secrets.json` with `secrets.key` (the encrypted API keys and test-account passwords).
- **Reports:** one folder per run, each with its `report.html`, evidence and generated Playwright test.
- `RUNHOUND_CONFIG_DIR` and `RUNHOUND_RUNS_DIR`, if set when the app starts, replace these two folders.
- On the first launch the app copies your command line settings once (from `~/.config/run-hound`, or `$XDG_CONFIG_HOME/run-hound`) and says so. See the [decision](decisions/10-2026.md#2026-10-07-desktop-settings-import).

## macOS

**Install.** Open the `.dmg`, drag **Run Hound** onto **Applications**, then eject the disk image.

**First launch (unsigned build).** Gatekeeper does not open an app it can't verify. You'll see that Apple could not check "Run Hound" for malicious software, with a **Done** or **Move to Trash** button.

- macOS 15 (Sequoia) or later: choose **Done**, open **System Settings > Privacy & Security**, scroll to the message about "Run Hound", choose **Open Anyway** and confirm with your password. This is needed once.
- macOS 14 (Sonoma): Control-click (or right-click) **Run Hound** in Applications, choose **Open**, then **Open** again.
- Or, in Terminal, remove the download mark and open it normally: `xattr -dr com.apple.quarantine "/Applications/Run Hound.app"`.

A signed and notarized build opens with the usual "downloaded from the internet" prompt only.

**Update.** Download the newer `.dmg`, quit Run Hound, drag the new **Run Hound** onto **Applications** and choose **Replace**. Your settings, keys and reports stay. An unsigned build can make macOS ask again for access to the keychain after an update. Choose **Always Allow**. If a saved key can't be read, enter it again in **Settings**.

**Uninstall.** Quit Run Hound and drag it from Applications to the Trash. That leaves your settings, keys and reports in place. To remove them as well, delete the two folders above (the reports are inside the settings folder) and, if you like, the app's browser profile `~/Library/Application Support/Run Hound`. Deleting the folders also deletes the saved keys. macOS may keep a "Run Hound Safe Storage" item in Keychain Access; you can delete it, because it is useless without the folder.

## Windows

**Install.** Run the installer and follow it. Run Hound then appears in the Start menu.

**First launch (unsigned build).** SmartScreen shows **Windows protected your PC** because the installer has no publisher it knows. Choose **More info**, then **Run anyway**. If the file is marked as downloaded, you can also open its **Properties** and tick **Unblock**. A signed build shows the publisher's name instead. Windows may still warn about a newly signed app until it has built up a reputation.

**Update.** Download the newer installer and run it. It replaces the installed app and keeps your settings, keys and reports. Close Run Hound first if it is open.

**Uninstall.** Open **Settings > Apps > Installed apps**, find **Run Hound** and choose **Uninstall**. That leaves your settings, keys and reports in place. To remove them as well, delete `%APPDATA%\run-hound` and `%LOCALAPPDATA%\run-hound` (paste each into File Explorer's address bar), and, if you like, the app's browser profile `%APPDATA%\Run Hound`. Deleting these also deletes the saved keys.

## Linux

**Install.** Download the package for your CPU (x64 or arm64) and install it with your package manager, so it brings the libraries it needs:

```sh
sudo apt install ./<the downloaded file>.deb    # Debian, Ubuntu
sudo dnf install ./<the downloaded file>.rpm    # Fedora and other rpm-based systems
```

Start **Run Hound** from the applications menu, or run `run-hound` in a terminal.

**First launch.** There is no Gatekeeper or SmartScreen step on Linux. The app opens a visible browser for manual sign-in, so it needs a graphical session.

**Update.** Download the newer package and install it the same way. The package manager upgrades the installed version, and your settings, keys and reports stay.

**Uninstall.** Find the package name, then remove it:

```sh
dpkg -l | grep -i run-hound         # Debian, Ubuntu
sudo apt remove <the package name>

rpm -qa | grep -i run-hound         # Fedora and other rpm-based systems
sudo dnf remove <the package name>
```

Removing the package leaves your settings, keys and reports in place. To remove them as well, delete `~/.config/run-hound-desktop` and `~/.local/share/run-hound` (or the `$XDG_CONFIG_HOME` and `$XDG_DATA_HOME` equivalents), and, if you like, the app's browser profile `~/.config/Run Hound`. Deleting these also deletes the saved keys.

## The update check

The app does not update itself and never installs anything. Once at launch, in the background after the window shows, it asks GitHub Releases whether a newer version exists:

- The request is `GET https://api.github.com/repos/rahul-bharati/run-hound/releases/latest`, anonymous, with an `accept` header and a `user-agent` of `Run-Hound-Desktop/<your version>`. It sends nothing else: no account, no settings, no run data. GitHub sees your IP address, as with any request.
- If the release is newer than yours, the sidebar shows **Run Hound &lt;version&gt; is available.** with a **Download** link to that release's page on GitHub, and **Dismiss**. The link opens in your default browser. Download the installer there and update as described above. Dismissing hides the notice for that session; it comes back at the next launch while your version is still the older one.
- If you're offline, GitHub is slow or rate limits the request, or the answer is not what the app expects, nothing is shown and the app works as before.
- The check runs at most once per launch, and the window doesn't wait for it.

To turn the check off (offline machines, tests, CI), start the app with `RUNHOUND_NO_UPDATE_CHECK=1`:

- Linux: `RUNHOUND_NO_UPDATE_CHECK=1 run-hound`.
- Windows: add a user environment variable named `RUNHOUND_NO_UPDATE_CHECK` with the value `1` (**Settings > System > About > Advanced system settings > Environment Variables**), then restart Run Hound.
- macOS: run `launchctl setenv RUNHOUND_NO_UPDATE_CHECK 1`, then start Run Hound. This lasts until you log out or restart.

With the check off, the app makes no request to GitHub at all.
