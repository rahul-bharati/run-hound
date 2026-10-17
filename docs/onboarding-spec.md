# Onboarding spec (O1): the desktop app's first launch

The contract for O1: a first-launch setup that asks for an AI provider, a key and the models to use, and can be skipped at every step. It also adds the main and helper model roles, a "Delete all keys and data" action, and key removal when the app is uninstalled on Windows. Decisions: [first-launch onboarding](decisions/10-2026.md#2026-10-17-first-launch-onboarding), [main and helper models](decisions/10-2026.md#2026-10-17-main-and-helper-models), [keys removed with the app](decisions/10-2026.md#2026-10-17-keys-removed-with-the-app), [environment keys bound to their endpoint](decisions/10-2026.md#2026-10-17-env-keys-bound-to-their-endpoint).

## Rules

1. **AI stays optional.** Every screen can be skipped. Skipping leaves AI off (`enabled: false`), exactly as today ([ai-spec rule 2](ai-spec.md#rules)). The checks never need a model.
2. **The AI rules still hold.** A remote provider needs the consent box naming its host ([rule 3](ai-spec.md#rules)); a saved key is encrypted, bound to its origin and never returned by the API ([rule 7](ai-spec.md#rules)). Onboarding saves through the same API Settings uses, so it can't bypass either.
3. **Once.** Onboarding shows on the desktop's first launch and never again by itself. Settings → AI can run it again.
4. **Desktop only, for now.** Not in Docker, where keys come from environment variables and the store refuses to save ([2026-10-06](decisions/10-2026.md#2026-10-06-encrypted-secret-store)), and not in the command line's `serve`. The UI module is shared, so `serve` can show it later.

## When it shows

At start-up the desktop app runs the command line import first ([D3](decisions/10-2026.md#2026-10-07-desktop-settings-import)). Then the UI asks `GET /api/onboarding`:

- `{ show: true }` when the desktop folder has no `onboarding.json` and the resolved AI config is not usable yet (no provider, or a provider that needs a key and has none).
- `{ show: false }` otherwise. When the import already brought a usable setup, the engine writes `onboarding.json` with `outcome: "imported"` and onboarding never shows.

When `show` is true the UI opens `#/welcome` instead of New run. `POST /api/onboarding { outcome: "configured" | "skipped" }` writes the marker: `onboarding.json` in the desktop settings folder, `{ "version": 1, "completedAt": "<ISO time>", "outcome": "..." }`. A later onboarding that must show again bumps `version`. Both routes sit behind the same guards as `/api/ai*` (`X-Run-Hound`, Sec-Fetch-Site and Origin, and the per-launch token once it lands).

## Screens

Five screens on one route, `#/welcome`, each one its own view. Every screen has "Step n of 5", Back (except the first), one primary button and a "Skip setup" link that goes to screen 5's skipped variant. Focus moves to each screen's heading. Everything works with the keyboard alone, at 320 px wide, and passes the axe rules Run Hound itself checks. Wording follows the desktop rules: "this computer", no `RUNHOUND_*` names ([2026-10-09](decisions/10-2026.md#2026-10-09-desktop-wording)).

1. **Welcome.** "Welcome to Run Hound", then three points:
   - It tests a page of an app on this computer in a real browser.
   - Every finding comes from a built-in check with evidence and a Playwright test. The checks are plain code and need no AI.
   - AI is optional: with your own key it reviews the plan, suggests extra flows, explains findings and, as an agent, investigates a goal you give it.

   Primary: "Set up AI". Secondary: "Skip for now".
2. **Provider.** One choice from radio cards, nothing preselected ([K1](decisions/10-2026.md#2026-10-07-byok-providers): no default provider): Anthropic (Claude), OpenAI, Google Gemini, Amazon Bedrock, and "A model on this computer" (Ollama, LM Studio or another OpenAI-compatible server). One line under the local option: the agent needs one of the four cloud providers ([agent-spec rule 4](agent-spec.md#rules)).
3. **Key.** For the chosen provider:
   - **A short guide**: three or four numbered steps and a button that opens the provider's key page in the browser. The URLs are the existing `AI_PRESETS[].keyUrl` values in `app/src/server/ui/client/settings-ai.ts`. Move them to one shared constant both pages use, and add one for Bedrock. Keep the steps generic enough that a provider's console redesign doesn't make them wrong, and check every link and step against the provider's own page when building. Draft steps:
     - Anthropic: sign in to the Claude Console, open Settings → API keys, create a key, copy it (it is shown once). The account needs billing set up.
     - OpenAI: sign in to the OpenAI Platform, open API keys, create a secret key, copy it.
     - Google Gemini: sign in to Google AI Studio, open Get API key, create a key, copy it.
     - Amazon Bedrock: in the AWS console open Amazon Bedrock, generate an API key (or use an AWS profile already on this computer), and make sure the models you want are enabled in your region.
     - Local: start the server (Ollama, LM Studio and so on); no key needed unless the server asks for one.

     Each guide ends with: "Keep this key private. Run Hound keeps it encrypted on this computer and sends it only to <host>."
   - **The fields**, as Settings → AI has them: a password field with show/hide (paste allowed); for Bedrock the region, and the choice between an API key and an AWS profile; for local providers the base URL (prefilled from the preset) and an optional key.
   - **Consent**, for a remote provider: the consent box from Settings, naming the host. It has to be ticked to continue.
   - **Test connection**: the existing `POST /api/ai/test`. Next saves with `PUT /api/ai` and is enabled after a successful test. "Save without testing" is a secondary action that shows the test's error.
4. **Models.** Two selects filled from `GET /api/ai/models`:
   - **Main model**: "Investigates as the agent and drafts testing briefs".
   - **Helper model**: "Reviews the plan, suggests extra flows and explains findings".

   A "Use the main model for everything" checkbox clears the helper (no `helperModel`). The recommended pair is preselected (see [Recommended models](#recommended-models)). One line on cost: the main model answers once per agent step, the helper a few times per run. A local provider gets one select, since it runs only the helper's jobs. Where the model list can't be read (Bedrock without list permission, a server without `/models`), a text field takes the model ID, as in Settings. Next saves both with `PUT /api/ai` and sets `enabled: true`.
5. **Ready.**
   - **Configured**: "AI is set up", with the provider and both models. Then: "Your key is encrypted with this computer's keychain in Run Hound's own folder, and only Run Hound opens it. Remove it any time in Settings → AI, or with Delete all keys and data. Uninstalling Run Hound on Windows deletes it; on macOS and Linux, use Delete all keys and data before you remove the app."
   - **Skipped**: "You can add a key later in Settings → AI. Run Hound's checks work without AI."

   Primary: "Test my app" (New run). Secondary: "Open Settings". Either one posts the outcome.

## Main and helper models

- `ai.json` gains `helperModel` (string, optional). It is set from Settings, `RUNHOUND_AI_HELPER_MODEL`, or the command line flag next to the existing model flag, if there is one; check `app/src/cli`. Without it, the helper is the main model.
- `app/src/ai/session.ts` gives the session two clients on the same provider, endpoint, key and consent: `client` (main) and `helper`. Brief drafting (`agent/draft-brief.ts`) and agent turns use `client`. Plan review (`ai/review.ts`), suggested flows (`ai/suggest.ts`) and explanations (`ai/explain.ts`) use `helper`. Route them at the call sites; don't change those modules' internals (another ticket owns `ai/explain.ts`).
- `AiStatus`, `GET /api/ai` and Settings → AI show and save both models. Settings gets a Helper model select under the model select, with the same checkbox.
- Plans, runs and reports that record the model record the one that did that job.
- The connection test tests the main model.

### Recommended models

`RECOMMENDED_MODELS` in `app/src/constants/ai-constants.ts`: an ordered list of patterns per provider, one list for the main model and one for the helper. The first model in the live list that matches the first pattern that matches anything wins. With no match, both selects start on the first listed model. Anthropic: main `/opus/` then `/sonnet/`, helper `/sonnet/` then `/haiku/` (today that picks `claude-opus-5-5` and `claude-sonnet-5-5`). The same patterns work for Claude on Bedrock (`anthropic.claude-…` and `us.anthropic.claude-…` IDs). Set the OpenAI and Gemini patterns from their live lists when building: the K1 live tests (`app/tests/live/providers.live.test.ts`) can print them. Never hard-code a model ID as the only choice.

## Environment keys bound to their endpoint

An environment key (`RUNHOUND_AI_API_KEY`, `AWS_BEARER_TOKEN_BEDROCK`) is sent only to:
- a fixed provider's official endpoint;
- Bedrock in the configured region;
- an endpoint the same invocation sets through the environment or a flag (`RUNHOUND_AI_BASE_URL`, the base-URL flag).

It never goes to a base URL that comes only from the saved `ai.json`, which `PUT /api/ai` can change. That case gets the same `problem` a stale saved key gets: "enter a key for <origin>". The change is in `app/src/operations/ai-storage.ts`, next to the saved-key origin binding. ai-spec rule 7 changes to match.

## Delete all keys and data

- **In Settings**, in the card that says how keys and passwords are kept: "Delete all keys and data". A confirmation lists what goes: saved AI keys, test-account passwords, AI and run settings, the store's key, the onboarding and import markers. An "Also delete my reports" checkbox starts unticked. On confirm, the UI opens `#/welcome`.
- **The engine**: `POST /api/data/delete { includeRuns: boolean }`, behind the same guards. It deletes those files in the desktop settings folder and, if asked, the runs folder. It also clears the secret store's in-memory key: add one exported function to `operations/secret-store.ts` for this, after the secret-store fix PR has merged (it owns that file until then). It never deletes outside the resolved folders, and never the command line's folder. Before deleting anything, check that the desktop and command line folders differ on every OS (`desktop/src/config.ts` and the command line's resolver).
- **macOS** keeps the "Safe Storage" keychain item, which Electron can't remove. Without the store's key file it unlocks nothing.
- **Docker** (`RUNHOUND_SECRETS=environment`) and the command line don't show the button.

## Uninstall on Windows

- **What is removed**: the NSIS uninstaller deletes the desktop settings folder (`%APPDATA%\run-hound`, from `desktop/src/config.ts`) and Electron's own profile folder (`app.getPath("userData")`). It keeps the reports (`%LOCALAPPDATA%\run-hound\runs`), which are the user's, and says so in `docs/desktop-install.md`.
- **Not on update**: it must not delete anything when it runs as part of an update or an install over an existing one. electron-builder runs the old uninstaller during an over-the-top install. Use `nsis.deleteAppDataOnUninstall` only if, in the installed electron-builder's NSIS templates, it skips updates and deletes these exact folders. Otherwise write a `nsis.include` script with a `customUnInstall` macro that checks for an update the same way the templates do. Read the templates in `node_modules/app-builder-lib/templates/nsis/` before choosing.
- **CI proof**: the first-run legs (`desktop/scripts/first-run-*.mjs`) prove it. After an install over the top, a saved setting is still there; after uninstall, both folders are gone. If the release-pipeline PR still owns `desktop/scripts/` when you get there, put the check in a new file or rebase onto it once it merges.

## Out of scope

- An orchestrator that hands work to sub-agents on cheaper models. That is a change to the agent contract's single loop, planned after the launch.
- Onboarding in Docker or the command line.
- More than one saved key per provider.
- Prices.
- A helper on a different provider from the main model.

## Tests

- `app/tests/features/server/`:
  - `GET`/`POST /api/onboarding`, including the imported case;
  - the guards on the new routes;
  - `POST /api/data/delete`, which deletes only the listed files, deletes runs only when asked, and never touches the command line folder;
  - helper model save and status.
- `app/tests/features/ai/`:
  - helper routing (review, suggest, explain use the helper; briefs use the main model);
  - `RECOMMENDED_MODELS` picking, including no match;
  - environment key binding: a saved base URL without an environment one gets no environment key.
- `app/tests/features/server/ui-*.test.ts`:
  - each screen's structure, Skip from every screen, focus on each heading;
  - the remote consent gate;
  - Next only after a successful test;
  - the delete confirmation.
- `desktop/tests/`: the NSIS config, and the first-run leg checks above.
- Update `docs/ai-spec.md` (model roles, rule 7), `docs/app-ui-spec.md` (`#/welcome`, Settings changes) and `docs/desktop-install.md` (uninstall and removing keys).
