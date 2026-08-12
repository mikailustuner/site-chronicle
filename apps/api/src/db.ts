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
    await transaction.unsafe(`
      ALTER TABLE domains ADD COLUMN IF NOT EXISTS default_country text NOT NULL DEFAULT 'TR';
      ALTER TABLE domains ADD COLUMN IF NOT EXISTS default_language text NOT NULL DEFAULT 'tr';
      ALTER TABLE domains ADD COLUMN IF NOT EXISTS default_location text NOT NULL DEFAULT 'Turkey';
      ALTER TABLE domains ADD COLUMN IF NOT EXISTS default_device text NOT NULL DEFAULT 'mobile';
      ALTER TABLE domains ADD COLUMN IF NOT EXISTS business_priority integer NOT NULL DEFAULT 3;
      UPDATE domains SET telemetry_enabled=false,telemetry_key=null WHERE telemetry_enabled=true OR telemetry_key IS NOT NULL;
      ALTER TABLE domains DROP CONSTRAINT IF EXISTS domains_default_device_check;
      ALTER TABLE domains ADD CONSTRAINT domains_default_device_check CHECK (default_device IN ('mobile','desktop'));
      ALTER TABLE domains DROP CONSTRAINT IF EXISTS domains_business_priority_check;
      ALTER TABLE domains ADD CONSTRAINT domains_business_priority_check CHECK (business_priority BETWEEN 0 AND 5);

      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS domain_id text REFERENCES domains(id) ON DELETE CASCADE;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS connector_id text;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS dedupe_key text;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS estimated_cost numeric(14,6) NOT NULL DEFAULT 0;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS actual_cost numeric(14,6) NOT NULL DEFAULT 0;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS outcome_status text;
      CREATE INDEX IF NOT EXISTS jobs_domain_claim_idx ON jobs(status,domain_id,run_after,priority,created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS jobs_active_dedupe_idx ON jobs(dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued','running');

      CREATE TABLE IF NOT EXISTS connector_configs (
        id text PRIMARY KEY,
        provider text NOT NULL CHECK (provider IN ('dataforseo','serpapi','crux','commoncrawl')),
        display_name text NOT NULL,
        enabled boolean NOT NULL DEFAULT true,
        encrypted_credentials text,
        credential_hint text,
        config jsonb NOT NULL DEFAULT '{}'::jsonb,
        daily_budget numeric(14,6) NOT NULL DEFAULT 0,
        monthly_budget numeric(14,6) NOT NULL DEFAULT 0,
        last_test_status text,
        last_test_message text,
        last_tested_at timestamptz,
        circuit_open_until timestamptz,
        failure_count integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(provider)
      );

      ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_connector_id_fkey;
      ALTER TABLE jobs ADD CONSTRAINT jobs_connector_id_fkey FOREIGN KEY (connector_id) REFERENCES connector_configs(id) ON DELETE SET NULL;

      CREATE TABLE IF NOT EXISTS connector_runs (
        id text PRIMARY KEY,
        connector_id text REFERENCES connector_configs(id) ON DELETE SET NULL,
        domain_id text REFERENCES domains(id) ON DELETE CASCADE,
        job_id text REFERENCES jobs(id) ON DELETE SET NULL,
        purpose text NOT NULL,
        request_context jsonb NOT NULL DEFAULT '{}'::jsonb,
        status text NOT NULL CHECK (status IN ('running','success','partial','no-data','rate-limited','blocked','failed')),
        estimated_cost numeric(14,6) NOT NULL DEFAULT 0,
        actual_cost numeric(14,6) NOT NULL DEFAULT 0,
        attempts integer NOT NULL DEFAULT 1,
        response_sha256 text,
        external_reference text,
        error text,
        started_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS connector_runs_connector_time_idx ON connector_runs(connector_id,started_at DESC);
      CREATE INDEX IF NOT EXISTS connector_runs_domain_time_idx ON connector_runs(domain_id,started_at DESC);

      CREATE TABLE IF NOT EXISTS external_artifacts (
        id text PRIMARY KEY,
        domain_id text REFERENCES domains(id) ON DELETE CASCADE,
        connector_run_id text REFERENCES connector_runs(id) ON DELETE SET NULL,
        kind text NOT NULL,
        sha256 text NOT NULL,
        mime_type text NOT NULL DEFAULT 'application/json',
        payload jsonb NOT NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        observed_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE external_artifacts DROP CONSTRAINT IF EXISTS external_artifacts_sha256_kind_key;
      CREATE UNIQUE INDEX IF NOT EXISTS external_artifacts_domain_sha_kind_idx
        ON external_artifacts(COALESCE(domain_id,''),sha256,kind);
      CREATE INDEX IF NOT EXISTS external_artifacts_domain_time_idx ON external_artifacts(domain_id,observed_at DESC);

      CREATE TABLE IF NOT EXISTS search_projects (
        id text PRIMARY KEY,
        domain_id text NOT NULL REFERENCES domains(id) ON DELETE CASCADE UNIQUE,
        country text NOT NULL DEFAULT 'TR',
        language text NOT NULL DEFAULT 'tr',
        location text NOT NULL DEFAULT 'Turkey',
        devices jsonb NOT NULL DEFAULT '["mobile"]'::jsonb,
        enabled boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS keyword_clusters (
        id text PRIMARY KEY,
        search_project_id text NOT NULL REFERENCES search_projects(id) ON DELETE CASCADE,
        name text NOT NULL,
        intent text NOT NULL DEFAULT 'unknown' CHECK (intent IN ('commercial','informational','local','navigational','transactional','unknown')),
        business_priority integer NOT NULL DEFAULT 3 CHECK (business_priority BETWEEN 0 AND 5),
        status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','approved','paused')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(search_project_id,name)
      );

      CREATE TABLE IF NOT EXISTS keywords (
        id text PRIMARY KEY,
        search_project_id text NOT NULL REFERENCES search_projects(id) ON DELETE CASCADE,
        cluster_id text REFERENCES keyword_clusters(id) ON DELETE SET NULL,
        query text NOT NULL,
        normalized_query text NOT NULL,
        source text NOT NULL DEFAULT 'manual',
        source_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
        target_url text,
        intent text NOT NULL DEFAULT 'unknown' CHECK (intent IN ('commercial','informational','local','navigational','transactional','unknown')),
        tracking_tier text NOT NULL DEFAULT 'discovery' CHECK (tracking_tier IN ('critical','standard','discovery','paused')),
        status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','approved','paused')),
        business_priority integer NOT NULL DEFAULT 3 CHECK (business_priority BETWEEN 0 AND 5),
        provider_volume integer,
        volume_context jsonb NOT NULL DEFAULT '{}'::jsonb,
        last_observed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(search_project_id,normalized_query)
      );
      CREATE INDEX IF NOT EXISTS keywords_project_status_idx ON keywords(search_project_id,status,tracking_tier);

      CREATE TABLE IF NOT EXISTS serp_runs (
        id text PRIMARY KEY,
        keyword_id text NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
        connector_run_id text REFERENCES connector_runs(id) ON DELETE SET NULL,
        provider text NOT NULL,
        location text NOT NULL,
        country text NOT NULL,
        language text NOT NULL,
        device text NOT NULL CHECK (device IN ('mobile','desktop')),
        os text,
        depth integer NOT NULL DEFAULT 20 CHECK (depth BETWEEN 1 AND 200),
        status text NOT NULL CHECK (status IN ('running','success','partial','no-data','rate-limited','blocked','failed')),
        sample_size integer NOT NULL DEFAULT 0,
        raw_artifact_id text REFERENCES external_artifacts(id) ON DELETE SET NULL,
        parser_version text NOT NULL DEFAULT '1',
        observed_at timestamptz NOT NULL,
        completed_at timestamptz,
        error text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS serp_runs_keyword_context_idx ON serp_runs(keyword_id,location,language,device,observed_at DESC);

      CREATE TABLE IF NOT EXISTS serp_results (
        id text PRIMARY KEY,
        serp_run_id text NOT NULL REFERENCES serp_runs(id) ON DELETE CASCADE,
        result_type text NOT NULL DEFAULT 'organic',
        rank_absolute integer,
        rank_group integer,
        domain text NOT NULL DEFAULT '',
        url text,
        title text NOT NULL DEFAULT '',
        snippet text NOT NULL DEFAULT '',
        is_target boolean NOT NULL DEFAULT false,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS serp_results_run_rank_idx ON serp_results(serp_run_id,rank_absolute);
      CREATE INDEX IF NOT EXISTS serp_results_domain_idx ON serp_results(domain,created_at DESC);

      CREATE TABLE IF NOT EXISTS serp_features (
        id text PRIMARY KEY,
        serp_run_id text NOT NULL REFERENCES serp_runs(id) ON DELETE CASCADE,
        feature_type text NOT NULL,
        owner_domain text,
        url text,
        rank_absolute integer,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS competitors (
        id text PRIMARY KEY,
        domain_id text NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
        hostname text NOT NULL,
        origin text,
        source text NOT NULL DEFAULT 'manual',
        status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','approved','ignored')),
        overlap_keywords integer NOT NULL DEFAULT 0,
        last_seen_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(domain_id,hostname)
      );

      CREATE TABLE IF NOT EXISTS competitor_snapshots (
        id text PRIMARY KEY,
        competitor_id text NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
        url text NOT NULL,
        status text NOT NULL CHECK (status IN ('success','blocked','failed')),
        title text NOT NULL DEFAULT '',
        description text NOT NULL DEFAULT '',
        h1 jsonb NOT NULL DEFAULT '[]'::jsonb,
        word_count integer NOT NULL DEFAULT 0,
        headings jsonb NOT NULL DEFAULT '[]'::jsonb,
        schema_types jsonb NOT NULL DEFAULT '[]'::jsonb,
        content_terms jsonb NOT NULL DEFAULT '[]'::jsonb,
        artifact_id text REFERENCES external_artifacts(id) ON DELETE SET NULL,
        observed_at timestamptz NOT NULL DEFAULT now(),
        error text
      );
      CREATE INDEX IF NOT EXISTS competitor_snapshots_competitor_time_idx ON competitor_snapshots(competitor_id,observed_at DESC);

      CREATE TABLE IF NOT EXISTS public_metric_series (
        id text PRIMARY KEY,
        domain_id text NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
        page_url text,
        metric text NOT NULL,
        value double precision,
        unit text,
        source text NOT NULL,
        source_version text NOT NULL DEFAULT '1',
        measurement_context jsonb NOT NULL DEFAULT '{}'::jsonb,
        sample_size integer,
        freshness text NOT NULL DEFAULT 'fresh',
        status text NOT NULL CHECK (status IN ('measured','no-public-data','not-configured','collection-failed')),
        evidence_id text,
        period_start timestamptz,
        period_end timestamptz,
        observed_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS public_metric_domain_metric_time_idx ON public_metric_series(domain_id,metric,observed_at DESC);

      CREATE TABLE IF NOT EXISTS page_features (
        id text PRIMARY KEY,
        domain_id text NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
        page_url text NOT NULL,
        source_kind text NOT NULL,
        title text NOT NULL DEFAULT '',
        headings jsonb NOT NULL DEFAULT '[]'::jsonb,
        entities jsonb NOT NULL DEFAULT '[]'::jsonb,
        topics jsonb NOT NULL DEFAULT '[]'::jsonb,
        intent text NOT NULL DEFAULT 'unknown',
        word_count integer NOT NULL DEFAULT 0,
        internal_inlinks integer NOT NULL DEFAULT 0,
        crawl_depth integer,
        schema_types jsonb NOT NULL DEFAULT '[]'::jsonb,
        evidence_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        observed_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(domain_id,page_url,source_kind,observed_at)
      );

      CREATE TABLE IF NOT EXISTS ranking_gap_candidates (
        id text PRIMARY KEY,
        domain_id text NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
        keyword_id text REFERENCES keywords(id) ON DELETE CASCADE,
        target_url text,
        dimension text NOT NULL,
        observation text NOT NULL,
        rationale text NOT NULL,
        recommendation text NOT NULL,
        counterevidence text,
        confidence text NOT NULL CHECK (confidence IN ('low','medium','high')),
        confidence_reason text NOT NULL,
        sample_size integer NOT NULL DEFAULT 0,
        supports_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
        counters_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
        source_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
        status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','resolved')),
        observed_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS ranking_gaps_domain_time_idx ON ranking_gap_candidates(domain_id,observed_at DESC);

      CREATE TABLE IF NOT EXISTS change_events (
        id text PRIMARY KEY,
        domain_id text NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
        title text NOT NULL,
        description text NOT NULL DEFAULT '',
        page_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
        keyword_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        deployed_at timestamptz NOT NULL,
        external_reference text,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS experiments (
        id text PRIMARY KEY,
        domain_id text NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
        change_event_id text REFERENCES change_events(id) ON DELETE SET NULL,
        title text NOT NULL,
        hypothesis text NOT NULL,
        target_metric text NOT NULL,
        target_keyword_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        control_keyword_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        baseline_start timestamptz NOT NULL,
        baseline_end timestamptz NOT NULL,
        evaluation_start timestamptz NOT NULL,
        evaluation_end timestamptz NOT NULL,
        guardrails jsonb NOT NULL DEFAULT '[]'::jsonb,
        status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','running','supported','inconclusive','regressed','cancelled')),
        result_summary text,
        uncertainty text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS experiment_observations (
        id text PRIMARY KEY,
        experiment_id text NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
        period text NOT NULL CHECK (period IN ('baseline','evaluation','control')),
        metric text NOT NULL,
        value double precision,
        sample_size integer NOT NULL DEFAULT 0,
        status text NOT NULL CHECK (status IN ('measured','insufficient','unavailable')),
        context jsonb NOT NULL DEFAULT '{}'::jsonb,
        evidence_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        observed_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS opportunity_evidence (
        opportunity_id text NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
        evidence_id text NOT NULL,
        role text NOT NULL CHECK (role IN ('supports','counters','context')),
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(opportunity_id,evidence_id,role)
      );

      CREATE TABLE IF NOT EXISTS automation_schedules (
        id text PRIMARY KEY,
        domain_id text REFERENCES domains(id) ON DELETE CASCADE,
        job_type text NOT NULL CHECK (job_type IN ('availability_probe','serp_critical','serp_standard','light_crawl','deep_crawl','lighthouse_sample','crux_refresh','competitor_refresh','common_crawl_refresh','opportunity_rebuild','experiment_evaluate','portfolio_digest')),
        cron text NOT NULL,
        timezone text NOT NULL,
        config jsonb NOT NULL DEFAULT '{}'::jsonb,
        enabled boolean NOT NULL DEFAULT true,
        priority integer NOT NULL DEFAULT 100,
        next_run_at timestamptz,
        last_run_at timestamptz,
        last_success_at timestamptz,
        last_error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS automation_schedules_due_idx ON automation_schedules(enabled,next_run_at);

      CREATE TABLE IF NOT EXISTS daily_digests (
        id text PRIMARY KEY,
        digest_date date NOT NULL UNIQUE,
        payload jsonb NOT NULL,
        read_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      INSERT INTO search_projects (id,domain_id,country,language,location,devices)
      SELECT 'search_' || replace(d.id,'domain_',''), d.id, d.default_country, d.default_language, d.default_location, jsonb_build_array(d.default_device)
      FROM domains d
      ON CONFLICT (domain_id) DO NOTHING;

      INSERT INTO schema_migrations (version) VALUES (5) ON CONFLICT (version) DO NOTHING;
    `);
  });
}

export async function closeDatabase(): Promise<void> {
  await sql.end({ timeout: 5 });
}
