# AI spec: plan review, suggested flows and explanations (0.3.0)

The build contract for Run Hound's optional AI layer. It extends [v1-spec.md](v1-spec.md); everything there still holds. The code contracts are `app/src/ai/types.ts`, the JSDoc of every `app/src/ai/*.ts` module, `app/src/checks/ai-flow.ts` and the AI fields in `app/src/core/types.ts`.

## Rules

1. **The model never decides pass or fail.** It recommends and ranks built-in scenarios, composes flows out of a fixed step vocabulary whose assertions are deterministic, and writes advisory text. Findings from AI-suggested flows are `advisory`; built-in verdicts, severities and texts are never changed.
2. **Off by default.** `enabled: false` until the user turns it on (Settings page, `RUNHOUND_AI=1` or `run --ai`). With AI off, plans, runs and reports are byte-for-byte what 0.2.0 produced (apart from the version).
3. **Local needs no consent; remote does.** An endpoint on loopback, a private network, `*.localhost`, `host.docker.internal` or `host.containers.internal` is local. Anything else, and Bedrock always, is remote and needs `allowRemote` (a consent box naming the host, `RUNHOUND_AI_ALLOW_REMOTE=1` or `--ai-allow-remote`). Without it nothing is sent, not even a model list request. Consent saved from the Settings page is tied to a host: `ai.json` stores `allowRemoteHost` (the endpoint host when consent was saved) and the consent counts only while the endpoint host is still that one; a save that moves the endpoint to another host without ticking the box again clears it. Consent from the env variable or the flag names no host and applies to whatever endpoint that invocation is configured with.
4. **Only structure is sent, redacted.** The page payload (`describePage`) holds names, labels, types, roles, constraints, option labels, the URL path only when remote (origin, path and query when local; never the hash) and the scenario catalog. Never selectors, typed values, cookies, headers, response bodies, screenshots or evidence data. Explanations get the finding text and evidence facts without facts that hold typed or test values, and for remote models with URLs cut to their path. Every string goes through `redactSecrets`.
5. **Page text is data.** Prompts say so, and prompt injection can do no more than produce advisory text or a flow the validator accepts (steps that only name discovered fields and controls; destructive controls still need `--allow-destructive`).
6. **AI failure never blocks.** A failed review or suggestion call leaves the built-in plan with a warning in `Plan.ai.warnings` (shown in the UI and CLI); a failed explanation leaves the finding without one.
7. **Keys stay on the server.** The saved key is never returned by the API, written to reports or logged; `AiStatus.hasKey` says whether one is set. A saved key does not follow a changed endpoint: a save that changes the provider or the endpoint origin without a new key removes the saved key and says so (`notice`: "The saved API key was removed because the endpoint changed.").
8. **Only this machine's UI drives the AI API.** Every `/api/ai*` request (GET included) must send `X-Run-Hound: 1` (a cross-site `<img>`/`<link>`/form can't, and a cross-site fetch with it needs a preflight the server never grants), besides the Sec-Fetch-Site and Origin checks.

## Configuration

Resolved by `resolveAiConfig` from defaults < `<configDir>/ai.json` (written by the Settings page atomically: a temp file created 0600 in the same directory, then renamed; the directory is created 0700) < env < CLI flags. `configDir` is `$RUNHOUND_CONFIG_DIR`, else `$XDG_CONFIG_HOME/run-hound`, else `~/.config/run-hound`. Env and flag values show as locked on the Settings page.

| Env | Flag | Meaning |
|---|---|---|
| `RUNHOUND_AI` | `--ai` / `--no-ai` | on/off |
| `RUNHOUND_AI_PROVIDER` | `--ai-provider` | `ollama`, `openai-compatible`, `bedrock` |
| `RUNHOUND_AI_BASE_URL` | `--ai-base-url` | e.g. `http://127.0.0.1:11434/v1` |
| `RUNHOUND_AI_MODEL` | `--ai-model` | model id |
| `RUNHOUND_AI_API_KEY` | | Bearer key or Bedrock API key (Bedrock also reads `AWS_BEARER_TOKEN_BEDROCK`) |
| `RUNHOUND_AI_REGION` | | Bedrock region (else `AWS_REGION`, `AWS_DEFAULT_REGION`) |
| `RUNHOUND_AI_ALLOW_REMOTE` | `--ai-allow-remote` | consent for a remote endpoint |
| `RUNHOUND_AI_FEATURES` | | comma list of `review,suggest,explain` (default all) |
| `RUNHOUND_AI_TIMEOUT_MS` | | per request, default 120000 |

Bedrock auth: a Bedrock API key (Bearer), else SigV4 from `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN`. AWS profiles and SSO are not supported in 0.3.0.

## Providers (no new dependencies)

- **ollama** (`ai/ollama.ts`): Ollama's native `POST /api/chat` (base URL minus a trailing `/v1`) with `think: false`, `format: <schema>`, `stream: false` and `options: {temperature: 0, num_ctx: 16384}`. Thinking is off and the context raised because a reasoning model on Ollama's default 4096-token context spends it all thinking and never answers. A model without thinking control (400 mentioning "think") is retried once without `think`, remembered per model. A missing model says to run `ollama pull <model>`.
- **openai-compatible** (`ai/openai-compatible.ts`): Chat Completions with `response_format: json_schema` (strict), temperature 0; falls back to `json_object` with the schema in the prompt when a server rejects `json_schema`. Covers LM Studio, llama.cpp, vLLM, OpenAI, OpenRouter, Groq, Together and other OpenAI-compatible endpoints. `finish_reason: "length"` with no answer (only thinking) is a `bad-output` error saying the model ran out of output space; it is not retried.
- **bedrock** (`ai/bedrock.ts`): Converse with one forced tool whose input schema is the answer schema.
- **client** (`ai/client.ts`): parse, validate, one retry with the error fed back, then `AiError("bad-output")`. Errors from the provider call itself (transport, HTTP, out of output space) are not retried.
- Schemas use the portable subset: every property required, nullable instead of optional, `additionalProperties: false`, no numeric or length limits.

## Features

- **Review** (`ai/review.ts`): the model answers `{id, recommended, priority, rationale}` per scenario. Merge: `Scenario.ai = {rationale, recommended}`, `priority` updated, `defaultSelected = recommended && !destructive`. Unknown ids are ignored; nothing is added, removed or reordered.
- **Suggest** (`ai/suggest.ts`, `checks/ai-flow.ts`): up to 5 flows of at most 8 `FlowStep`s ending in an `expect`. `flowProblem` rejects anything that names a field or control the form doesn't have. Kept flows become `ai-flow:<n>` scenarios in the Features group, after the built-in ones, **never ticked by default**, destructive when they click a destructive control. `ai-flow` runs the steps under the navigation guard and decides each `expect` deterministically; a failed expect is one advisory, medium finding with a GIF, a final frame and a Playwright spec.
- **Explain** (`ai/explain.ts`): after the run and before the report is written, one call per finding (at most 20, sequential) → `Finding.ai = {summary, askYourAi, model}`, shown as "AI explanation (advisory)" beside the built-in "What to ask your AI". `Report.ai` records the model, how many were explained and warnings.

## Surfaces

- **Runner**: `discoverAndPlan(url, {ai})` reviews then suggests after `buildPlan`; `runPlan(plan, {ai})` explains before `writeReport`. Engine steps ("Asking ollama/ornith-1.5:9b to review the plan") appear in the live log.
- **API**: `GET /api/ai` → `AiStatus`; `PUT /api/ai` (JSON, same-origin only) → saves an `AiConfigPatch`, returns `AiStatus` plus `notice` when the saved key was removed; `POST /api/ai/test` → `testConnection`; `GET /api/ai/models?provider=&baseUrl=` → `AiModelList` (saved key used server-side); `POST /api/plan {url, ai?: boolean}` (default: on when AI is enabled and usable; the AI steps stop when the request is aborted and after 4 minutes in all, and the plan still comes back with a warning); `GET /api/settings` adds `ai`.
- **Web UI**: Settings → AI card (provider presets, base URL, model dropdown from `/api/ai/models` with Refresh and "Other…", key field that never shows the saved key, region for Bedrock, feature toggles, consent box naming the host requests would go to, re-drawn when the provider, base URL or region change and unticked unless that host is the consented one, Test connection; a save's `notice` is shown). New Run → "Review with AI" toggle, an "AI" chip and rationale under each reviewed scenario, "Suggested by AI" scenarios with their steps. Report → AI explanation panel.
- **CLI**: the flags above on `run`; `run-hound ai status` and `run-hound ai test`. A remote endpoint without consent with `--ai` is exit 2 with the reason.
- **Reports**: HTML and Markdown show rationales in the scenario list, the AI flows' steps, and each finding's AI explanation labelled advisory; the header names the model ("Planned with help from ollama/ornith-1.5:9b").
- **Containers**: compose passes the `RUNHOUND_AI_*` and AWS variables and mounts a config volume; Ollama on the host is `http://host.containers.internal:11434/v1` (Podman) or `http://host.docker.internal:11434/v1` (Docker).
