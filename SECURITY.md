# Security model

SiteChronicle opens untrusted public web content in a browser. Treat the worker as hostile-content infrastructure.

- Only HTTP(S) targets are accepted. Private, loopback, link-local, multicast, documentation and cloud metadata ranges are rejected for IPv4 and IPv6.
- DNS is revalidated during redirects and browser subresource interception.
- The worker runs without host filesystem mounts other than the dedicated artifact volume, without the Docker socket, without Linux capabilities, and with `no-new-privileges`.
- Form submission and active security scans are disabled by default. A verified property is required before an active profile can be queued.
- Cookies, authorization headers and query secrets must never be supplied in public scan profiles. Evidence export can contain personal data rendered by a target; configure retention accordingly.
- The ZAP service is optional and internal-only. Do not publish its API port.
- Production requires a long unique admin password, a random session secret, HTTPS and backups.

Report security issues privately to the system owner. Do not attach captured customer data to public issues.
