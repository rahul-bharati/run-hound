# Safety and security

This page covers which targets Run Hound will test, how its browser and its own server are restricted, and the security rules it follows.

## Safety

The target must be `localhost`, a private address, or listed in `RUNHOUND_ALLOWED_HOSTS` (which skips the address check with no ownership check, so list only hosts you own); a test account's sign-in page must pass the same gate. The browser is pinned to the address the gate approved and is stopped if a page navigates off it; requests a check replays or re-fetches are sent from the page, so they get the same pinning. Destructive scenarios only run with `--allow-destructive`. The UI and API answer only to loopback names and addresses (`localhost`, `127.0.0.1`, `::1`), the host of `RUNHOUND_PUBLIC_URL` and the address given to `serve --host` (not a wildcard such as `0.0.0.0`), so another container on the same network can't use them by the server's IP address; add other names or addresses with `RUNHOUND_SERVER_HOSTS`. They send a strict Content-Security-Policy, refuse to be framed, and serve `report.html` sandboxed with no scripts.

## Security

- Users must not be able to misuse Run Hound to scan websites/apps they don't own.
- localhost and private IPs are allowed by default.
- Any other domain requires ownership verification before it can be scanned: either a DNS TXT record or a nonce placed in a `<meta>` tag in the HTML header. The scan only runs where the nonce is found.
- Status in 0.6.0: ownership verification isn't built yet. Other hosts are refused unless listed in `RUNHOUND_ALLOWED_HOSTS`, which is not checked for ownership, so list only hosts you own.
- No destructive actions (real payments, deleting data) unless the user explicitly opts in.
- Reports redact any secrets they find; keys are never used or tested. Test-account passwords, session values and usernames are kept out of everything Run Hound writes.
