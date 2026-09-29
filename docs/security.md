# Safety and security

This page covers which targets Run Hound will test, how its browser and its own server are restricted, and the security rules it follows.

## Safety

The target must be `localhost`, a private address, or listed in `RUNHOUND_ALLOWED_HOSTS` (which skips the address check with no ownership check, so list only hosts you own); a test account's sign-in page must pass the same gate. The browser is pinned to the address the gate approved and is stopped if a page navigates off it; requests a check replays or re-fetches are sent from the page, so they get the same pinning. Destructive scenarios only run with `--allow-destructive`. The UI and API answer only to loopback names and addresses (`localhost`, `127.0.0.1`, `::1`), the host of `RUNHOUND_PUBLIC_URL` and the address given to `serve --host` (not a wildcard such as `0.0.0.0`), so another container on the same network can't use them by the server's IP address; add other names or addresses with `RUNHOUND_SERVER_HOSTS`. They send a strict Content-Security-Policy, refuse to be framed, and serve `report.html` sandboxed with no scripts.

From 0.6.1, the test browser is isolated from the machine it runs on: it gets an allowlisted environment and a home folder of its own, never saves a download, and `~/.aws` is read only for a named profile. The contract, and the plan up to the public launch: [Launch readiness](launch-spec.md#061-isolated-by-default).

For a host install (from source, or `npx` from 0.6.3 — Docker is unaffected, since its browser already saw neither the host's `HOME` nor its proxy), the isolated browser's own home folder means two things that worked before 0.6.1 may not: a target trusted only through your system or user NSS database (`mkcert`, or `next dev --experimental-https`) fails `ERR_CERT_AUTHORITY_INVALID`, since the per-launch home has no certificates in it; and behind a proxy-only network, the browser can't reach the tested page's own third-party requests (a CDN, a sign-in provider) at all, since `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` are no longer passed through. Both are read as false findings, not a security gap; an explicit opt-in for a proxy and a trusted CA is planned (CHANGELOG's 0.6.1 entry).

## What the tested page can reach

- **Navigations are guarded.** Every navigation (top level, frame or popup) must pass the safety gate above. A redirect or DNS answer that escapes it closes the context (`app/src/engine/guard.ts`, its three layers).
- **Other requests from the tested page are allowed**, to any host: scripts, styles, fonts, images, `fetch`/XHR, beacons and sockets. Reasons:
  - the app needs its CDNs, fonts, analytics, sign-in provider and API host to behave as it does for its users;
  - blocking them would test a broken page and report false findings;
  - the browser that makes them holds nothing of the user's: a throwaway profile, no extensions, the allowlisted environment of 0.6.1, no downloads, and only the test accounts' sessions.
- **What that means.** The app's own third-party code can send whatever the page shows, including the test account's data, to the hosts the app itself includes, exactly as it does for any user of the app. Use test accounts, not real ones.
- **The exceptions.** Requests a check sends itself (`CheckContext.request`, replays) pass the gate. The evidence renderer is offline.
- **What comes later.** An opt-in strict mode that holds other requests to the allowed hosts is planned after the public launch.

Contract: [Launch readiness](launch-spec.md#5-egress); [decision](decisions/09-2026.md#2026-09-30-third-party-requests-allowed).

## Security

- Users must not be able to misuse Run Hound to scan websites/apps they don't own.
- localhost and private IPs are allowed by default.
- Any other domain requires ownership verification before it can be scanned: either a DNS TXT record or a nonce placed in a `<meta>` tag in the HTML header. The scan only runs where the nonce is found.
- Status in 0.6.0: ownership verification isn't built yet. Other hosts are refused unless listed in `RUNHOUND_ALLOWED_HOSTS`, which is not checked for ownership, so list only hosts you own.
- No destructive actions (real payments, deleting data) unless the user explicitly opts in.
- Reports redact any secrets they find; keys are never used or tested. Test-account passwords, session values and usernames are kept out of everything Run Hound writes.
