# SiteChronicle

Self-hosted, evidence-based web auditing and change intelligence for a single authorized operator.

SiteChronicle combines repeatable browser measurements, SEO and structured-data inspection, accessibility checks, passive security posture review, behavioral-friction signals, immutable artifacts, historical comparisons and explainable cause candidates. It deliberately separates observed facts from hypotheses.

## What is implemented

- Single-user, self-hosted dashboard with signed `HttpOnly`, `SameSite=Strict` sessions and production CSRF origin enforcement.
- Authorized-domain registry, optional DNS/well-known ownership verification, reusable scan profiles and timezone-aware cron schedules.
- Rate-limited crawl discovery from links, robots.txt and sitemap files, with normalized URL inventory and page-template classification.
- Mobile/desktop Chromium evidence, screenshots, normalized DOM, console/network failures, axe accessibility results and behavioral-friction observations.
- Multi-run Lighthouse performance/SEO/accessibility/best-practices scores, lab metrics and resource inventory; optional CrUX field data when an API key is configured.
- Deterministic SEO, structured-data, metadata, image, agent-readiness and cross-page commerce-fact consistency rules.
- Passive response-header, cookie and TLS inspection; optional authenticated internal ZAP passive baseline. Unsupported form submission and active-attack profiles are rejected.
- SHA-256 addressed HTML, header, screenshot, metric, scanner and report artifacts. A definitive finding cannot be created without evidence references.
- Audit-to-audit score, page and finding lifecycle comparison. Cause candidates are explicitly marked `confirmed`, `likely` or `unknown`.
- Styled A4 HTML/PDF audit and comparison reports with reproducibility manifests and evidence IDs.

Behavioral analysis reports observable interface conditions such as interruptive overlays, small targets, preselected choices, urgency wording and missing nearby trust information. It does **not** claim to read a visitor's emotions or guarantee conversion uplift.

## Safety defaults

- Passive, read-only navigation only.
- Forms and checkout mutations are disabled.
- Active security scanning is disabled.
- Private networks and cloud metadata targets are blocked.
- Every finding must reference stored evidence.
- Behavioral findings describe observable risk signals, not user emotions or guaranteed conversion impact.

## Local development

Requirements: Node.js, Bun, Docker, Docker Compose and a Chromium compatible with Playwright.

1. Copy `.env.example` to `.env` and replace the secrets.
2. Start PostgreSQL: `docker compose up -d postgres`.
3. Run migrations: `bun run migrate`.
4. Build the dashboard: `bun run build:web`.
5. Start the API: `bun run dev`.
6. Start the worker in a second terminal: `bun run dev:worker`.

The API defaults to `http://127.0.0.1:43180`; Vite development UI defaults to `http://127.0.0.1:43181`.

Run the deterministic checks with `bun run typecheck && bun run test`. With a local instance running, the browser login/dashboard smoke test is available through:

```sh
SITECHRONICLE_TEST_PASSWORD='<admin password>' bun run test:ui-smoke
```

The isolated full-stack fixture test uses `compose.e2e.yml`; it temporarily enables private targets only for the fixture services, exercises two complete audits and deletes its test domain afterward.

## Production

Create a `.env` with at least:

```dotenv
POSTGRES_PASSWORD=<long-random-value>
ADMIN_PASSWORD=<long-random-value>
SESSION_SECRET=<at-least-32-random-bytes>
PUBLIC_BASE_URL=https://audit.example.com
SITECHRONICLE_HOST=audit.example.com
```

Then run:

```sh
docker compose up -d --build
```

Open `https://<SITECHRONICLE_HOST>`, sign in, add an origin you are authorized to inspect, select a scan profile and run the first baseline. Use **Compare runs** only after a second completed audit. Keep profiles identical when the delta will drive a decision; the comparison engine displays a warning if the toolchain or profile changed.

To enable the optional passive ZAP service, set `ZAP_API_KEY`, set `ZAP_API_URL=http://zap:8080`, then start with `docker compose --profile security up -d`. SiteChronicle sends only explicit GET requests to already-crawled pages; the ZAP spider and active scanner are never invoked. In Compose, ZAP has no direct egress and reaches targets only through the worker's SSRF-filtered audit proxy.

The worker has outbound audit access but no published port, no Docker socket, no Linux capabilities and only the artifact volume. PostgreSQL and API stay on the internal backend network. ZAP is isolated on a separate control network without direct egress; only Caddy is connected to the public edge network.

Set `RETENTION_DAYS` to a positive number to remove completed, failed and cancelled audits after that many days. Set it to `0` to retain them indefinitely. The dashboard reports worker heartbeat state, while `/api/readiness` returns 503 until both the database and a worker are available.

## Audit interpretation

- **Measured:** the value or defect was directly captured in this run.
- **Research-backed hypothesis:** the interface condition is observed, while its user or revenue effect remains a hypothesis supported by the cited standard or research.
- **Site hypothesis:** a plausible local impact that needs analytics or an experiment.
- **Confirmed cause:** before/after artifacts directly establish the relevant implementation change.
- **Likely/unknown cause:** evidence is partial or insufficient. SiteChronicle does not manufacture certainty.

Lighthouse is controlled lab data, not field-user Core Web Vitals. CrUX is shown separately when available. Automated accessibility results do not replace keyboard, screen-reader and checkout testing by people.

## Comparison integrity

Audits preserve the scan profile, tool versions, runtime, timestamps and artifact hashes. Comparisons warn when profiles or scanner versions differ. Cause candidates are labeled `confirmed`, `likely` or `unknown`; the engine is required to say unknown when artifacts do not establish a reliable cause.

## Backups

Run `deploy/backup.sh /absolute/backup/path`. The script exports PostgreSQL, artifacts and SHA-256 checksums. Restore only after rehearsal on a separate server:

```sh
CONFIRM_RESTORE=yes deploy/restore.sh /absolute/backup/path YYYYMMDDTHHMMSSZ
```

The restore verifies checksums and archive paths before stopping API/worker services, replacing the database and merging the content-addressed artifact archive.
