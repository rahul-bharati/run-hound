# Development

This page covers working on Run Hound itself: the test suites, the test fixtures it is scored against, and where decisions are recorded.

## From source

To set up a clone for development, follow [From source (contributing)](install.md#from-source-contributing).

## Running the suites

```sh
pnpm --filter run-hound test                  # unit + browser tests for the engine and checks
pnpm --filter run-hound exec tsc --noEmit
pnpm --filter kennel test                     # Kennel's own tests (clean mode and every bug)
pnpm --filter fernway test                    # Fernway's own tests (builds it once; clean mode and every bug)
pnpm test:acceptance                          # Run Hound against Kennel, Fernway and the sample apps, clean and with every planted bug
```

The suites pick random free ports, so they don't collide with anything already running. CI ([.github/workflows/ci.yml](../.github/workflows/ci.yml)) runs on every pull request and every push to main, split into parallel jobs: the type-checks and every suite above, a build of the four Docker images with a smoke test in the compose test lab, and a lint and build of the website. A release reuses CI's already-passing run on main for the same commit when there is one, and otherwise runs CI itself; either way, it publishes no image unless CI passed.

## Test fixtures

Run Hound is developed and scored against deliberately broken apps with planted bugs behind toggles and a clean mode:

- **Kennel**: a single booking form (`/book`) on a small in-memory Node server with a mock analytics service ([fixtures/kennel/CONTRACT.md](../fixtures/kennel/CONTRACT.md), [bugs.json](../fixtures/kennel/bugs.json)). Its V0 and V1 bugs cover the form and page checks.
- **Fernway**: a Lovable-style SaaS app (Vite, React 19, Tailwind CSS, Radix/shadcn-style components, react-hook-form with zod, sonner) with a landing page, sign-up, sign-in, an onboarding wizard, and a dashboard and settings behind a real sign-in with two accounts ([fixtures/fernway/README.md](../fixtures/fernway/README.md), [CONTRACT.md](../fixtures/fernway/CONTRACT.md), [bugs.json](../fixtures/fernway/bugs.json)). W01-W10 are the bugs AI-built apps typically ship with; V01-V05 are the access bugs the V2 checks look for (`access-control`, `mass-assignment` and `deep-links`, 0.4.0), and V06-V09 the write bugs: writes to another account's task, writes without a session, CSRF, and an upgrade success page that grants Pro without a payment. `csrf` (0.5.0) catches V08, `write-access` (0.6.0) catches V06 and V07, and `paywall-trust` (0.6.0) catches V09.
- **Sample apps**: five well-built apps ([fixtures/samples/README.md](../fixtures/samples/README.md)) as the false-positive suite.

Fernway replaces, for 0.4.0, the multi-page Kennel on a local Supabase described in [docs/fixtures.md](fixtures.md); that stays planned as a Supabase variant. Scoring, in CI on every pull request, covers planted bugs found, false positives in clean mode and evidence on every finding; repeating runs to check that findings are stable is planned ([docs/fixtures.md](fixtures.md#scoring)).

## Releasing

A release is three things, moved together in one commit: `app/package.json`'s `version`, `site/src/lib/site.ts`'s `version`, `released` and `releasedIso`, and the root `CHANGELOG.md` — rename its `## Unreleased` heading to `## <version> (<one-line summary>), <date>` (the date `released` and `releasedIso` also carry). Nothing else in the repo is pinned to a release version any more ([2026-09-29](decisions/09-2026.md#2026-09-29-images-latest-no-version-pins)): `run-hound.compose.yml`'s published images always resolve `ghcr.io/rahul-bharati/<name>:${RUNHOUND_TAG:-latest}`, and `docker-compose.yml` (built from source) tags its own builds `:local`. `app/tests/features/cli/cli-version.test.ts` checks the three move together: it reads `app/package.json`'s version directly, checks `site.ts`'s `version` against it (a plain `X.Y.Z` release only; pre-releases are skipped) and checks `released`/`releasedIso` against the CHANGELOG heading. It also mirrors `release-images.yml`'s `check-version` job, which checks only the tag against `app/package.json` and the CHANGELOG section, and guards that neither compose file pins an image to a version — `site.ts` is not that job's concern, since a bad `site.ts` fails `pnpm test` (in CI, which the release depends on) rather than the release workflow itself.

Then tag and push (`git tag vX.Y.Z && git push origin vX.Y.Z`) a commit that is on `main` and whose CI run on `main` passed. Two workflows start on the tag and share one GitHub Release:

- [release-images.yml](../.github/workflows/release-images.yml) builds, tags (`X.Y.Z`, `X.Y` and, for a full release, `latest`) and publishes the four images, then adds the compose file and the CHANGELOG section to the release.
- [desktop-installers.yml](../.github/workflows/desktop-installers.yml) first checks the tag's commit is on `main` with a passing CI run there (the `preflight` job), then builds, signs and verifies the installers, and adds them, `SHA256SUMS` and the installer table to the release.

The release is created as a **draft** and neither workflow publishes it alone: the one that completes the set publishes it (`scripts/release-coordination.mjs`; as a pre-release for a version with a `-`, otherwise as the latest release). So `releases/latest`, which the desktop app's update check reads, never names a version whose installers are missing, and the compose file never names images that aren't on GHCR yet. The two parts write their own marked block of the notes (`<!-- run-hound:images -->`, `<!-- run-hound:desktop -->`) and leave anything else, so neither overwrites the other; text you add outside the blocks stays. If one part is missing (the installers' gate failed, signing isn't set up yet, the signing run is waiting for approval), the release stays a draft: fix the cause and re-run that workflow's failed jobs, or publish the draft by hand once you have checked it.

### Signing secrets

Installers are signed on a release tag only. Pushes to `main` and `integration/desktop`, pull requests (including agents' `claude/*` branches) and manual runs build unsigned installers, named `…-unsigned`, whatever secrets exist: the workflow doesn't hand them the secrets, and `desktop/scripts/signing.mjs` refuses to sign outside a `v*.*.*` tag on GitHub Actions. The macOS and Windows build legs of a tag run in the GitHub Environment `release-signing`, where the signing secrets live. Do the following once, in the repository's **Settings**, before adding any secret:

1. **Environments → New environment → `release-signing`.**
   - **Required reviewers:** add yourself (and another maintainer when there is one). Each tag's macOS and Windows build waits for a reviewer's approval before it starts. Leave **Prevent self-review** off while you are the only maintainer; it would block your own approval.
   - **Allow administrators to bypass configured protection rules:** off.
   - **Deployment branches and tags → Selected branches and tags → Add deployment branch or tag rule → Ref type: Tag, name pattern `v*.*.*`.** No branch rule. Then no branch, pull request or workflow in a branch can use the Environment's secrets, even one that edits the workflow file.
2. **Add the secrets to that Environment (Environment secrets), not as a repository or organization secret.** A repository secret is visible to every workflow run, including a branch's edited workflow. Every non-tag build runs a check that fails when it can see one of these names, so a mistake shows up at once:

   | Platform | Secret | What it is |
   |---|---|---|
   | macOS | `MACOS_CSC_LINK`, `MACOS_CSC_KEY_PASSWORD` | base64 of the Developer ID Application certificate (`.p12`), and its password |
   | macOS notarization, one set | `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | the Apple ID, an app-specific password for it, and the team ID |
   | | or `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | the App Store Connect API key's text, its key ID and its issuer ID |
   | Windows | `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | base64 of the code-signing certificate (`.pfx`), and its password |

3. **Settings → Rules → Rulesets → New tag ruleset**, target `v*`, enforcement active, with **Restrict creations**, **Restrict updates** and **Restrict deletions** on, and bypass for repository admins only. Only a maintainer can then push a release tag.
4. **A branch ruleset for `main`** (and `integration/desktop`): require a pull request and the CI checks to pass, block force pushes and deletions. The preflight check trusts that a commit on `main` came through that.
5. **Settings → Actions → General:** default workflow permissions **Read repository contents permission**, and approval required before a fork pull request's workflows run (for all external contributors).

A signed build is then checked, not trusted: on macOS `codesign --verify --deep --strict`, the Developer ID Application authority and hardened runtime, `spctl -a -vv -t exec` and `xcrun stapler validate` on the app inside the dmg; on Windows `Get-AuthenticodeSignature` on the installer and the app (status `Valid`, a signer and a timestamp). Any failing check fails the build, and the release gate publishes nothing.

### Pinned actions

The release workflows pin every third-party action to a full commit SHA, with its version in a comment (`uses: actions/checkout@<40 hex> # v7.0.1`); a tag such as `v7` can be moved by whoever controls the action's repository, a SHA can't. `app/tests/config/release-workflows.test.ts` fails when one isn't. To update one, resolve the new version's commit and read the action's `runs.using` from it (it should be `node24`):

```sh
git ls-remote --tags https://github.com/actions/checkout 'refs/tags/v7.0.1' 'refs/tags/v7.0.1^{}'   # an annotated tag: take the ^{} commit
```

`ci.yml`, `site-links.yml` and the Claude workflows still use version tags.

## Code maintenance

For how the app code is arranged, where a declaration belongs, and the traps to avoid when changing it, see [code-maintenance.md](code-maintenance.md).

## Decisions

Record every decision in the append-only decision log. See [DECISIONS.md](../DECISIONS.md) for the index and how to add a decision.
