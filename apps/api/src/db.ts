import postgres, { type Sql } from 'postgres';
import { config } from './config.js';

export type Database = Sql<Record<string, never>>;

export const sql: Database = postgres(config.databaseUrl, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  transform: { undefined: null },
});

export async function migrate(database: Database = sql): Promise<void> {
  await database.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(731_942_001)`;
    await transaction.unsafe(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version integer PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS domains (
      id text PRIMARY KEY,
      name text NOT NULL,
      origin text NOT NULL UNIQUE,
      hostname text NOT NULL,
      verification_token text NOT NULL,
      verification_method text,
      verified_at timestamptz,
      authorization_confirmed boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS scan_profiles (
      id text PRIMARY KEY,
      domain_id text REFERENCES domains(id) ON DELETE CASCADE,
      name text NOT NULL,
      config jsonb NOT NULL,
      is_default boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS audits (
      id text PRIMARY KEY,
      domain_id text NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
      profile_id text REFERENCES scan_profiles(id) ON DELETE SET NULL,
      status text NOT NULL CHECK (status IN ('queued','running','completed','failed','cancelled')),
      trigger text NOT NULL DEFAULT 'manual',
      manifest jsonb NOT NULL,
      scores jsonb NOT NULL DEFAULT '[]'::jsonb,
      summary jsonb NOT NULL DEFAULT '{}'::jsonb,
      error text,
      started_at timestamptz,
      completed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS audits_domain_created_idx ON audits(domain_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS pages (
      id text PRIMARY KEY,
      audit_id text NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
      url text NOT NULL,
      normalized_url text NOT NULL,
      final_url text NOT NULL,
      status_code integer NOT NULL,
      template text NOT NULL,
      title text NOT NULL DEFAULT '',
      description text NOT NULL DEFAULT '',
      canonical text NOT NULL DEFAULT '',
      h1 jsonb NOT NULL DEFAULT '[]'::jsonb,
      language text NOT NULL DEFAULT '',
      robots text NOT NULL DEFAULT '',
      content_hash text NOT NULL,
      dom_hash text,
      screenshot_hash text,
      raw_html_bytes integer NOT NULL DEFAULT 0,
      headers jsonb NOT NULL DEFAULT '{}'::jsonb,
      metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
      resources jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(audit_id, normalized_url)
    );
    CREATE INDEX IF NOT EXISTS pages_audit_template_idx ON pages(audit_id, template);

    CREATE TABLE IF NOT EXISTS evidence (
      id text PRIMARY KEY,
      audit_id text NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
      page_id text REFERENCES pages(id) ON DELETE SET NULL,
      kind text NOT NULL,
      sha256 text NOT NULL,
      mime_type text NOT NULL,
      relative_path text NOT NULL,
      page_url text,
      selector text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(audit_id, sha256, kind)
    );
    CREATE INDEX IF NOT EXISTS evidence_audit_idx ON evidence(audit_id);

    CREATE TABLE IF NOT EXISTS findings (
      id text PRIMARY KEY,
      audit_id text NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
      page_id text REFERENCES pages(id) ON DELETE SET NULL,
      fingerprint text NOT NULL,
      rule_id text NOT NULL,
      category text NOT NULL,
      severity text NOT NULL,
      title text NOT NULL,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(audit_id, fingerprint)
    );
    CREATE INDEX IF NOT EXISTS findings_audit_severity_idx ON findings(audit_id, severity);

    CREATE TABLE IF NOT EXISTS jobs (
      id text PRIMARY KEY,
      type text NOT NULL,
      payload jsonb NOT NULL,
      status text NOT NULL CHECK (status IN ('queued','running','completed','failed','cancelled')),
      priority integer NOT NULL DEFAULT 100,
      attempts integer NOT NULL DEFAULT 0,
      max_attempts integer NOT NULL DEFAULT 3,
      run_after timestamptz NOT NULL DEFAULT now(),
      locked_by text,
      locked_at timestamptz,
      last_error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS jobs_claim_idx ON jobs(status, run_after, priority, created_at);

    CREATE TABLE IF NOT EXISTS comparisons (
      id text PRIMARY KEY,
      baseline_audit_id text NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
      current_audit_id text NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(baseline_audit_id, current_audit_id)
    );

    CREATE TABLE IF NOT EXISTS reports (
      id text PRIMARY KEY,
      audit_id text REFERENCES audits(id) ON DELETE CASCADE,
      comparison_id text REFERENCES comparisons(id) ON DELETE CASCADE,
      format text NOT NULL,
      evidence_id text REFERENCES evidence(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK ((audit_id IS NOT NULL) OR (comparison_id IS NOT NULL))
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id text PRIMARY KEY,
      domain_id text NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
      profile_id text NOT NULL REFERENCES scan_profiles(id) ON DELETE CASCADE,
      cron text NOT NULL,
      timezone text NOT NULL,
      enabled boolean NOT NULL DEFAULT true,
      next_run_at timestamptz,
      last_run_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    INSERT INTO schema_migrations (version)
    VALUES (1)
    ON CONFLICT (version) DO NOTHING;
    `);
    await transaction.unsafe(`
      ALTER TABLE evidence DROP CONSTRAINT IF EXISTS evidence_audit_id_sha256_kind_key;
      ALTER TABLE schedules ADD COLUMN IF NOT EXISTS last_error text;
      ALTER TABLE schedules ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

      CREATE TABLE IF NOT EXISTS worker_heartbeats (
        worker_id text PRIMARY KEY,
        started_at timestamptz NOT NULL,
        last_seen_at timestamptz NOT NULL,
        concurrency integer NOT NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb
      );
      CREATE INDEX IF NOT EXISTS worker_heartbeats_seen_idx ON worker_heartbeats(last_seen_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS jobs_active_audit_idx
        ON jobs ((payload->>'auditId'))
        WHERE type='audit' AND status IN ('queued','running');

      INSERT INTO schema_migrations (version) VALUES (2) ON CONFLICT (version) DO NOTHING;
    `);
    await transaction.unsafe(`
      WITH duplicate_audits AS (
        SELECT id FROM (
          SELECT id, row_number() OVER (PARTITION BY domain_id, profile_id ORDER BY created_at, id) AS position
          FROM audits WHERE status IN ('queued','running') AND profile_id IS NOT NULL
        ) ranked WHERE position > 1
      )
      UPDATE jobs SET status='cancelled', completed_at=now(), locked_by=null, locked_at=null,
        last_error='Cancelled by migration: duplicate active audit'
      WHERE status IN ('queued','running') AND payload->>'auditId' IN (SELECT id FROM duplicate_audits);

      WITH duplicate_audits AS (
        SELECT id FROM (
          SELECT id, row_number() OVER (PARTITION BY domain_id, profile_id ORDER BY created_at, id) AS position
          FROM audits WHERE status IN ('queued','running') AND profile_id IS NOT NULL
        ) ranked WHERE position > 1
      )
      UPDATE audits SET status='failed', completed_at=now(), error='Duplicate active audit reconciled during migration'
      WHERE id IN (SELECT id FROM duplicate_audits);

      CREATE UNIQUE INDEX IF NOT EXISTS audits_active_domain_profile_idx
        ON audits (domain_id, profile_id)
        WHERE status IN ('queued','running');
      INSERT INTO schema_migrations (version) VALUES (3) ON CONFLICT (version) DO NOTHING;
    `);
    await transaction.unsafe(`
      ALTER TABLE domains ADD COLUMN IF NOT EXISTS archived_at timestamptz;
      ALTER TABLE domains ADD COLUMN IF NOT EXISTS telemetry_key text;
      ALTER TABLE domains ADD COLUMN IF NOT EXISTS telemetry_enabled boolean NOT NULL DEFAULT false;
      CREATE UNIQUE INDEX IF NOT EXISTS domains_telemetry_key_idx ON domains(telemetry_key) WHERE telemetry_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS domains_archived_idx ON domains(archived_at, created_at DESC);

      CREATE TABLE IF NOT EXISTS telemetry_samples (
        id bigserial PRIMARY KEY,
        domain_id text NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
        recorded_at timestamptz NOT NULL DEFAULT now(),
        path text NOT NULL,
        metric text NOT NULL CHECK (metric IN ('page_view','LCP','CLS','INP','FCP','TTFB')),
        value double precision NOT NULL,
        rating text CHECK (rating IN ('good','needs-improvement','poor')),
        referrer_host text,
        device text CHECK (device IN ('mobile','desktop','tablet','unknown')),
        CHECK (length(path) <= 2048),
        CHECK (value >= 0)
      );
      CREATE INDEX IF NOT EXISTS telemetry_domain_time_idx ON telemetry_samples(domain_id, recorded_at DESC);
      CREATE INDEX IF NOT EXISTS telemetry_domain_metric_time_idx ON telemetry_samples(domain_id, metric, recorded_at DESC);

      CREATE TABLE IF NOT EXISTS opportunities (
        id text PRIMARY KEY,
        domain_id text NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
        audit_id text REFERENCES audits(id) ON DELETE SET NULL,
        fingerprint text NOT NULL,
        category text NOT NULL,
        title text NOT NULL,
        observation text NOT NULL,
        rationale text NOT NULL,
        recommendation text NOT NULL,
        acceptance_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
        validation_plan text NOT NULL,
        evidence_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        source_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
        confidence double precision NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
        priority integer NOT NULL CHECK (priority >= 0 AND priority <= 100),
        effort text NOT NULL DEFAULT 'medium' CHECK (effort IN ('small','medium','large')),
        status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','planned','testing','validated','dismissed','resolved')),
        impact_status text NOT NULL CHECK (impact_status IN ('measured','research-backed-hypothesis','site-hypothesis','informational')),
        first_seen_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        resolved_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(domain_id, fingerprint)
      );
      CREATE INDEX IF NOT EXISTS opportunities_domain_status_priority_idx ON opportunities(domain_id, status, priority DESC);

      CREATE TABLE IF NOT EXISTS chat_threads (
        id text PRIMARY KEY,
        domain_id text REFERENCES domains(id) ON DELETE CASCADE,
        title text NOT NULL DEFAULT 'New conversation',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS chat_messages (
        id text PRIMARY KEY,
        thread_id text NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
        role text NOT NULL CHECK (role IN ('user','assistant')),
        content text NOT NULL,
        citations jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS chat_messages_thread_time_idx ON chat_messages(thread_id, created_at);
      CREATE TABLE IF NOT EXISTS chat_tool_runs (
        id text PRIMARY KEY,
        thread_id text NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
        tool_name text NOT NULL,
        arguments jsonb NOT NULL DEFAULT '{}'::jsonb,
        result jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      INSERT INTO schema_migrations (version) VALUES (4) ON CONFLICT (version) DO NOTHING;
    `);
  });
}

export async function closeDatabase(): Promise<void> {
  await sql.end({ timeout: 5 });
}
