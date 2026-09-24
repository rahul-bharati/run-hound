# Business model

Status: proposal. Nothing here is built yet. Monetization comes after the open-source core has real users.

## Principles

1. **Free:** everything one developer needs to test their own app.
2. **Paid:** teams, scale, convenience and compliance.
3. **Never paywall a check.** All functional, accessibility and security checks stay in the open core. Finding the holes is the mission and the source of trust, and free alternatives exist (Playwright's test agents, axe, platform scanners; see [research.md](research.md)). A weakened free tier loses to them.
4. **Local stays private.** No part of licensing or billing sends anything about the app being tested.

## Open core vs paid

| Core (open source) | Paid |
|---|---|
| Agent loop and all checks (functional, a11y, security) | **Hosted inference:** runs without a GPU, Ollama or the user's own model API key |
| Plan approval UI, reports, Playwright spec export | **Hosted runner:** test a deployed app (e.g. Lovable, Bolt) behind domain-ownership verification; aimed at vibe coders |
| BYO LLM: Ollama, Bedrock, any OpenAI-compatible endpoint | **Team dashboard:** run history, trends, regressions across runs |
| Docker image and CLI; localhost plus domain verification | **CI / GitHub app:** PR comments, scheduled regression runs |
| Kennel fixture and scoring ([fixtures.md](fixtures.md)) | **Compliance exports:** WCAG / European Accessibility Act conformance reports |
| JSON run format and replay | **Org features:** SSO, roles, audit log, priority support |

The paid column is mostly **server-side**: it runs on our infrastructure, so it has value that can't be patched out of an open-source image.

## Licensing

- **Core: Apache-2.0.** Permissive, includes a patent grant, and is accepted by the companies small teams work at. AGPL would do more to deter cloud clones, but some companies ban it, which hurts adoption. Since the paid value is hosted, Apache is safe.
- **Paid code: separate private repo** producing a `run-hound-ee` image (or hosted services only). This keeps the public repo cleanly open source. The alternative, an `ee/` folder under a commercial license in the same repo (GitLab's model), is possible but mixes licenses in one tree.
- **No BSL/FSL for the core.** They are source-available, not OSI-approved open source, and developers notice.
- **Contributions:** decide between a CLA and a DCO **before the first outside contribution.** A CLA keeps the option to relicense or dual-license later; a DCO is lighter but makes relicensing hard.

## API key in the Docker command

```bash
docker run -e RUNHOUND_KEY=rh_live_... -p 3000:3000 rahulrbharati/run-hound
```

This is an established pattern (Metabase, n8n, GitLab, Grafana Enterprise use license keys or tokens this way).

- **Without a key, the core runs fully.** The key only adds paid features.
- **Keys are signed licenses.** An Ed25519-signed token that the container verifies offline, with an occasional check-in to renew. No call home on every run.
- **The key mostly unlocks server-side services** (hosted inference, dashboard, CI app). A check inside the open code can be removed by forking, so it shouldn't guard anything valuable.
- **Privacy:** the license check sends only the key and version. Document this plainly.
- **Issuing keys:** a payment webhook triggers a small key-issuing service we run, or a service with license-key APIs (e.g. Keygen, Lemon Squeezy). Check whether the chosen payment provider issues keys itself before building one.

## Risks

- **Unproven market.** Octomind, the closest precedent, reportedly shut down in May 2026 for lack of market validation ([research.md](research.md) §2).
- **Hosted inference costs.** Vision-heavy, multi-step runs cost real money per run. Price per run or with credits, and use the accessibility tree before screenshots to keep costs down.
- **Hosted runner liability.** Testing deployed apps needs domain-ownership verification and destructive actions off by default, as in the core.

## Validate before building billing

1. Ship the free core and get real users.
2. Measure demand: how many ask for hosted inference, team features or a hosted runner (waitlist sign-ups, issues, direct requests).
3. Build the paid piece with the clearest demand first, most likely hosted inference.
