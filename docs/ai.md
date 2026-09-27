# AI (optional)

This page covers the optional AI features: what the model does, how to turn it on from the web UI, the command line or `.env`, what is sent to it, and which models work.

AI is off until you turn it on. A model **reviews the plan** (recommends and ranks each scenario with a one-line reason), **suggests up to 5 extra flows** (steps that only use the fields and buttons Run Hound found, checked by deterministic assertions; unticked by default, findings advisory) and **explains findings** in plain words. It never decides pass or fail, and if it fails or times out you get the built-in plan with a warning.

**Web UI:** open **Settings → AI** and turn on **Use AI**. Pick a provider (Ollama, LM Studio, another OpenAI-compatible endpoint, or Amazon Bedrock). **In a container, change the Base URL**: the preset `http://127.0.0.1:11434/v1` is the container itself, so for Ollama on your machine enter `http://host.docker.internal:11434/v1` (Podman: `http://host.containers.internal:11434/v1`), and start Ollama listening on all interfaces (`OLLAMA_HOST=0.0.0.0 ollama serve`). Then choose a model from the dropdown (it lists what the server has; **Other…** takes any id), press **Save**, then **Test connection** (it tests the saved settings). New Run then shows **Review with AI**.

**Command line:** the `--ai*` flags apply only to the command they are given to, so pass the same ones to `ai test` and `run`:

```sh
# in the folder with run-hound.compose.yml; Ollama on your machine, listening on all interfaces
docker compose -f run-hound.compose.yml run --rm run-hound ai test \
  --ai-provider ollama --ai-model qwen3:8b --ai-base-url http://host.docker.internal:11434/v1   # one small call: "ok: … answered in …"
docker compose -f run-hound.compose.yml run --rm run-hound run http://kennel:3000/book --plan-only \
  --ai --ai-provider ollama --ai-model qwen3:8b --ai-base-url http://host.docker.internal:11434/v1
```

Without flags, `ai status` and `ai test` use what is saved in Settings or set in `.env`. From source, run the same commands as `pnpm exec tsx src/cli.ts ai test …` in `app/`; Ollama is then at its default address, so `--ai-base-url` isn't needed.

**In `.env`** (the compose files pass these to Run Hound). Every provider needs `RUNHOUND_AI=1` and `RUNHOUND_AI_MODEL`; a remote endpoint (OpenAI, OpenRouter, Bedrock, …) also needs `RUNHOUND_AI_ALLOW_REMOTE=1`, and a key (`RUNHOUND_AI_API_KEY`, or the AWS variables for Bedrock):

```sh
RUNHOUND_AI=1
RUNHOUND_AI_PROVIDER=ollama
RUNHOUND_AI_BASE_URL=http://host.docker.internal:11434/v1
RUNHOUND_AI_MODEL=qwen3:8b
```

**Ollama from a container:** with `--network host` on Linux it is `http://127.0.0.1:11434/v1`; otherwise `http://host.docker.internal:11434/v1` (Docker) or `http://host.containers.internal:11434/v1` (Podman), and Ollama must listen on all interfaces. Settings saved from the UI persist in `./runs/.config`: the image sets `RUNHOUND_CONFIG_DIR=/repo/app/runs/.config`, inside the runs folder you mount. **`runs/.config` holds any API key and test-account password you saved: share a single `runs/<runId>` folder, never the whole `runs/` folder.**

Settings come from the Settings page (saved to `~/.config/run-hound/ai.json`, mode 0600, or to `$RUNHOUND_CONFIG_DIR/ai.json` when it is set), then `RUNHOUND_AI_*` environment variables, then `--ai*` flags; the full list is in [docs/ai-spec.md](ai-spec.md) and [`.env.example`](../.env.example).

**Privacy:** only redacted page structure is sent (the page title and path, field labels and types, option labels, button names, the scenario list; the full page address only to a local model; for explanations, the finding text and its evidence facts), never typed values, cookies, response bodies or screenshots. A local endpoint (localhost or a private address) needs nothing more; a remote one (OpenAI, OpenRouter, Bedrock, …) is refused until you consent (the Settings checkbox, `--ai-allow-remote` or `RUNHOUND_AI_ALLOW_REMOTE=1`). API keys stay on the server and never appear in the UI or reports. Test-account passwords, usernames and session values are kept out of AI prompts. Bedrock takes a Bedrock API key, AWS access keys, or an AWS profile from `~/.aws` (`RUNHOUND_AI_AWS_PROFILE` or `AWS_PROFILE`; static keys, `credential_process` or IAM Identity Center after `aws sso login`; assume-role profiles aren't supported yet).

**Models:** small local models work (tested with a 9B model on Ollama). Ollama is called through its native API with thinking turned off, so reasoning models answer without spending their output on thinking, and asked to keep the model loaded for 15 minutes so it is still there for the explanations after the run. An explanation that times out is retried once; after two timeouts in a row the rest are skipped with a warning (raise `RUNHOUND_AI_TIMEOUT_MS` for a slow model). With other servers, prefer a non-reasoning model or turn reasoning off.
