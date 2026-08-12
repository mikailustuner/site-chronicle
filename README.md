# SiteChronicle

SiteChronicle is a private, self-hosted SEO, search-visibility, performance and web-quality intelligence workspace for one authorized operator. It monitors any number of sites using outbound requests and public/licensed data—without customer GA4/GSC access, a site tag, an inbound webhook or a public home-server port.

Observed facts, provider observations, hypotheses and unavailable metrics are deliberately separated. A contextual SERP sample is never presented as a universal Google rank; a before/after association is never presented as Google causality; missing public data is never converted to zero.

## Implemented capabilities

- Multi-site portfolio with archive, restore, deletion-impact preview and confirmed permanent deletion.
- Market-aware search projects: country, language, location and mobile/desktop context are stored for every site.
- Candidate keyword discovery from the latest authorized crawl, manual approval, tracking tiers and explicit business priority.
- Licensed Google-result observation through workspace-owned DataForSEO or SerpApi credentials. Direct Google HTML scraping is disabled.
- Context-preserving SERP history, target rank, features, top competitors and movement against the preceding comparable sample.
- SERP competitor discovery, manual approval, robots-aware public-page snapshots and evidence-supported gap candidates.
- Page-feature index covering title/headings, deterministic topic terms, surface entities, schema types, word count, internal inlinks and crawl depth.
- Tag-free public performance: CrUX History when public coverage exists, synthetic availability from the home-server vantage, and existing Lighthouse lab measurements shown as separate sources.
- Common Crawl index observations labeled as sampled and incomplete—not a backlink graph or a complete index.
- Deterministic technical SEO, accessibility, performance, structured-data, security posture, behavioral-friction and agent-readiness audits.
- Immutable SHA-256 audit and connector artifacts, timestamps, source context and an evidence archive.
- Explainable opportunities with confidence, counterevidence, acceptance criteria, validation plan and lifecycle state.
- Change log and bounded rank experiments with baseline/evaluation windows, minimum-sample checks and explicit confounders.
- Read-only AI analyst grounded in portfolio, audit, opportunity, keyword, SERP, public-performance and experiment data. It has no site-changing tools.
- Daily/periodic automations sharing a domain-fair queue, deduplication, retry handling, budget gates and connector circuit breakers.
- Minimal private dashboard with encrypted connector management and no customer-measurement UI.

Traffic, clicks, conversions and revenue cannot be measured objectively under the no-customer-data/no-tag boundary. SiteChronicle reports those fields as unavailable and optimizes observable leading indicators: technical eligibility, contextual visibility, content/intent differences, public performance and controlled change outcomes.

## Evidence and safety rules

- Public targets are limited to HTTP(S); private, loopback, link-local, metadata and unsafe redirect targets are blocked.
- Crawling is read-only, rate-limited and robots-aware. Forms, checkout mutations and active attacks are disabled.
- SERP provider URLs, CrUX and Common Crawl endpoints are fixed in code; credentials are AES-256-GCM encrypted and never returned to the browser.
- Every recommendation exposes its observation, rationale, confidence, evidence references, counterevidence and validation method.
- Lighthouse is lab data; CrUX is aggregated public field data; home-server uptime is synthetic. They are never merged into a fake “traffic” metric.
- Behavioral findings describe observable interface conditions, not emotions or guaranteed conversion uplift.

## Local development

Requirements: Bun, Docker/Compose and a Playwright-compatible Chromium.

1. Copy `.env.example` to `.env` and replace every secret.
2. Start PostgreSQL: `docker compose up -d postgres`.
3. Run migrations: `bun run migrate`.
4. Build: `bun run build`.
5. Start the API: `bun run dev`.
6. Start the worker separately: `bun run dev:worker`.

The API defaults to `http://127.0.0.1:43180`; the Vite UI defaults to `http://127.0.0.1:43181`.

Validation commands:

```sh
bun run typecheck
bun test
bun run build
SITECHRONICLE_TEST_PASSWORD='<admin password>' bun run test:ui-smoke
```

## Home-server production

Required configuration:

```dotenv
POSTGRES_PASSWORD=<long-random-value>
ADMIN_PASSWORD=<long-random-value>
SESSION_SECRET=<at-least-32-random-bytes>
CONNECTOR_MASTER_KEY=<at-least-32-random-bytes-used-only-for-connector-encryption>
PUBLIC_BASE_URL=http://192.168.1.50:43180
TRUST_PRIVATE_HTTP=true
SITECHRONICLE_BIND_IP=0.0.0.0
SITECHRONICLE_PORT=43180
```

Run `docker compose up -d --build` and open the configured LAN/Tailscale URL. No inbound internet exposure is required: the API is for the private operator interface, while the worker initiates outbound HTTPS requests.

In **Settings**, configure one licensed SERP provider (DataForSEO or SerpApi), optionally CrUX, and optionally keyless Common Crawl. Set provider budgets before enabling frequent schedules. Real provider credentials are required for live rank collection; test fixtures do not prove an external subscription.

The worker has no published port, Docker socket or Linux capabilities. PostgreSQL stays on the internal network. Optional ZAP passive inspection remains internal and GET-only through the filtered audit proxy.

Set `RETENTION_DAYS=0` to retain evidence indefinitely or a positive number to compact old completed audits, connector runs and external artifacts. Back up with `deploy/backup.sh /absolute/backup/path`; rehearse restores on another machine before relying on them.

## Interpretation vocabulary

- **Measured:** directly captured by the stated scanner/source in the recorded context.
- **Public provider observation:** externally supplied, timestamped and context-bound.
- **Research-backed hypothesis:** observed condition with a cited standard or primary reference; local effect remains unproven.
- **Site hypothesis:** plausible local effect requiring a recorded change and repeated measurement.
- **Unavailable / no public data:** not measured; never equivalent to zero or healthy.

See [OUTBOUND-ONLY-SEO-INTELLIGENCE-PLAN.md](./OUTBOUND-ONLY-SEO-INTELLIGENCE-PLAN.md) for architecture, phase coverage and operational limits.
