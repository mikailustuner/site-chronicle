# Security model

SiteChronicle opens untrusted public web content in a browser. Treat the worker as hostile-content infrastructure.

- Only HTTP(S) targets are accepted. Private, loopback, link-local, multicast, documentation and cloud metadata ranges are rejected for IPv4 and IPv6.
- DNS is revalidated during redirects and browser subresource interception.
- The worker runs without host filesystem mounts other than the dedicated artifact volume, without the Docker socket, without Linux capabilities, and with `no-new-privileges`.
- Chromium runs as the unprivileged `pwuser` with its sandbox enabled through Playwright's version-pinned seccomp profile.
- Form submission and active security scans are not implemented; profiles requesting either capability are rejected.
- Cookies, authorization headers and query secrets must never be supplied in public scan profiles. Evidence export can contain personal data rendered by a target; configure `RETENTION_DAYS` and test deletion/restore procedures accordingly.
- Keep `.env` readable only by its owner (`chmod 600 .env`). Production rejects non-HTTPS public addresses. `TRUST_PRIVATE_HTTP=true` is an explicit homeserver exception limited to RFC1918/Tailscale IPv4 addresses; use it only on a trusted LAN/tailnet.
- Keep `CONNECTOR_MASTER_KEY` separate from session and database secrets. Connector credentials are AES-256-GCM encrypted at rest, redacted in API responses and should be rotated if the master key or database backup is exposed.
- Licensed SERP, CrUX and Common Crawl connectors use fixed provider endpoints. Competitor pages are limited to approved public HTTP(S) targets and respect robots.txt; direct Google-result-page scraping is not implemented.
- The ZAP service is optional and internal-only. It has no direct egress in Compose and uses only GET-based passive scanning through the worker's filtered proxy. Do not publish its API port.
- Production requires a long unique admin password, a random session secret and backups. Prefer HTTPS; private HTTP is intended only for trusted LAN/Tailscale deployments.

Report security issues privately to the system owner. Do not attach captured customer data to public issues.
