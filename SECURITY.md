# Security policy

To report a security problem in Run Hound or its website, please follow the disclosure policy at
https://run-hound.rahulbharati.com/security/. In short: report it privately through GitHub's private vulnerability
reporting (Security → [Report a vulnerability](https://github.com/rahul-bharati/run-hound/security/advisories/new) on
this repository), not in a public issue.

What Run Hound does to keep its own runs safe (which targets it will test, how its browser and server are restricted)
is described in [docs/security.md](docs/security.md).

## Saved credentials

AI provider keys (API key, AWS secret access key and session token) and test-account passwords are encrypted in `<configDir>/secrets.json`, each sealed with AES-256-GCM under a random data key and bound to its name. Each provider's API key is also bound to the origin it was saved for and is only ever sent there. The data key is kept in `<configDir>/secrets.key`:

- **Desktop app**: the data key is wrapped by the OS credential store (macOS Keychain, Windows DPAPI, or Linux Secret Service). On Linux without a keyring, Run Hound keeps the data key itself.
- **Command line**: the data key is kept by Run Hound as a private file (0600, folder 0700).
- **Docker image**: `RUNHOUND_SECRETS=environment` (set by the Dockerfile). Keys and passwords come only from environment variables; nothing is saved to the mounted volume.

Each provider keeps its own saved key (`ai.key.<provider>` in `secrets.json`); switching providers keeps them. Moving a provider to another endpoint origin removes that provider's saved key. RUNHOUND_AI_API_KEY still applies to whichever provider is in effect.

Existing plain-text secrets in `ai.json` or `accounts.json` are moved into the encrypted store automatically on first read and removed from the old files.

A save rewrites the whole of `secrets.json`, so it never starts from a file it could not read. If `secrets.json` exists but can't be read just now (another program holds it, for example antivirus or a sync tool on Windows), the save fails with a message and changes nothing; the saved keys and passwords are still there once the file opens again. If it reads but is not a secret store (cut short, not JSON), nothing in it can be read, and the next save moves it aside as `secrets.json.corrupt-<time>-<random>` (private, like the original) before writing a clean store, so the damaged file is kept, never overwritten. Run Hound never deletes these backups; delete one yourself once you no longer need it ([decision, 2026-10-17](docs/decisions/10-2026.md#2026-10-17-unreadable-secret-store-is-not-empty)).

**Limits:** both protections keep secrets out of plain text and make `secrets.json` useless on its own (copied, synced, backed up, or shown on screen). Neither stops a program already running as the same user on the same machine; only a passphrase typed at launch would, which is deliberately not part of this design. Once the desktop app wraps the key with the OS keychain, the command line cannot read saved secrets and shows a message to use environment variables instead.
