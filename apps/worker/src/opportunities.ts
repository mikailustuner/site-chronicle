import { newId, type Finding } from '@sitechronicle/core';
import type { Database } from './db.js';

const severityWeight: Record<Finding['severity'], number> = {
  critical: 92,
  high: 76,
  medium: 56,
  low: 34,
  info: 18,
};

export async function refreshOpportunities(
  database: Database,
  input: { domainId: string; auditId: string; findings: Finding[] },
): Promise<number> {
  const traffic = await database<Array<{ path: string; views: number }>>`
    SELECT path, count(*)::int AS views
    FROM telemetry_samples
    WHERE domain_id=${input.domainId} AND metric='page_view' AND recorded_at >= now() - interval '28 days'
    GROUP BY path
  `;
  const views = new Map(traffic.map((row) => [row.path, Number(row.views)]));
  const peak = Math.max(1, ...views.values());
  const seen: string[] = [];

  for (const finding of input.findings) {
    const path = safePath(finding.pageUrl);
    const exposure = path ? (views.get(path) ?? 0) / peak : 0;
    const confidence = Math.round(finding.confidence * 100);
    const priority = Math.min(100, Math.round(
      severityWeight[finding.severity] * .68 + confidence * .22 + exposure * 10,
    ));
    const fingerprint = `finding:${finding.fingerprint}`;
    seen.push(fingerprint);
    const validationPlan = finding.numericValue !== undefined
      ? `Apply the change, rerun the same scan profile, and verify that ${finding.numericUnit ?? 'the measured value'} improves without regressions. Treat traffic impact as unconfirmed until first-party observations accumulate.`
      : 'Apply the change, rerun the same scan profile, and confirm every acceptance criterion against new evidence. Compare first-party page observations before and after without claiming causality from correlation alone.';
    await database`
      INSERT INTO opportunities (
        id,domain_id,audit_id,fingerprint,category,title,observation,rationale,recommendation,
        acceptance_criteria,validation_plan,evidence_ids,source_urls,confidence,priority,effort,impact_status
      ) VALUES (
        ${newId('opportunity')},${input.domainId},${input.auditId},${fingerprint},${finding.category},${finding.title},
        ${finding.observation},${finding.impactHypothesis},${finding.recommendation},
        ${database.json(finding.acceptanceCriteria as never)},${validationPlan},
        ${database.json(finding.evidenceIds as never)},${database.json(finding.sourceUrls as never)},
        ${finding.confidence},${priority},${estimateEffort(finding)},${finding.impactStatus}
      )
      ON CONFLICT (domain_id,fingerprint) DO UPDATE SET
        audit_id=EXCLUDED.audit_id, category=EXCLUDED.category, title=EXCLUDED.title,
        observation=EXCLUDED.observation, rationale=EXCLUDED.rationale,
        recommendation=EXCLUDED.recommendation, acceptance_criteria=EXCLUDED.acceptance_criteria,
        validation_plan=EXCLUDED.validation_plan, evidence_ids=EXCLUDED.evidence_ids,
        source_urls=EXCLUDED.source_urls, confidence=EXCLUDED.confidence,
        priority=EXCLUDED.priority, effort=EXCLUDED.effort, impact_status=EXCLUDED.impact_status,
        last_seen_at=now(), resolved_at=null, updated_at=now(),
        status=CASE WHEN opportunities.status='resolved' THEN 'open' ELSE opportunities.status END
    `;
  }

  if (seen.length) {
    await database`
      UPDATE opportunities SET status='resolved',resolved_at=now(),updated_at=now()
      WHERE domain_id=${input.domainId} AND fingerprint LIKE 'finding:%'
        AND NOT (fingerprint = ANY(${seen}))
        AND status='open'
    `;
  }
  await addTelemetryOpportunities(database, input.domainId, input.auditId);
  return seen.length;
}

async function addTelemetryOpportunities(database: Database, domainId: string, auditId: string): Promise<void> {
  const rows = await database<Array<{ metric: string; samples: number; poor: number; average: number }>>`
    SELECT metric,count(*)::int AS samples,
      count(*) FILTER (WHERE rating='poor')::int AS poor,
      avg(value)::double precision AS average
    FROM telemetry_samples
    WHERE domain_id=${domainId} AND recorded_at >= now() - interval '28 days'
      AND metric IN ('LCP','CLS','INP')
    GROUP BY metric HAVING count(*) >= 20
  `;
  for (const row of rows) {
    const poorShare = row.poor / row.samples;
    if (poorShare < .25) continue;
    const fingerprint = `telemetry:${row.metric}:poor-share`;
    const evidence = [`telemetry:${domainId}:${row.metric}:28d`];
    await database`
      INSERT INTO opportunities (
        id,domain_id,audit_id,fingerprint,category,title,observation,rationale,recommendation,
        acceptance_criteria,validation_plan,evidence_ids,source_urls,confidence,priority,effort,impact_status
      ) VALUES (
        ${newId('opportunity')},${domainId},${auditId},${fingerprint},'performance',
        ${`${row.metric} is poor for a material share of observed page loads`},
        ${`${row.poor} of ${row.samples} anonymous ${row.metric} observations (${Math.round(poorShare * 100)}%) were rated poor during the last 28 days.`},
        'This is first-party field evidence from real page loads. It establishes the user-experience condition, not a guaranteed traffic or revenue effect.',
        ${`Prioritize templates with poor ${row.metric}, use audit artifacts to isolate the dominant implementation cause, and verify with new field observations.`},
        ${database.json([`Poor ${row.metric} share is below 25%`, 'At least 20 post-change observations are collected', 'No other Core Web Vital regresses'] as never)},
        'Compare equivalent 28-day windows after release. Mark validated only when the measured distribution improves; keep business impact unconfirmed without a controlled test.',
        ${database.json(evidence as never)},${database.json(['https://web.dev/articles/vitals'] as never)},
        ${Math.min(.98, .7 + Math.min(row.samples, 200) / 1000)},${Math.min(98, 65 + Math.round(poorShare * 30))},'large','measured'
      )
      ON CONFLICT (domain_id,fingerprint) DO UPDATE SET
        audit_id=EXCLUDED.audit_id,observation=EXCLUDED.observation,confidence=EXCLUDED.confidence,
        priority=EXCLUDED.priority,evidence_ids=EXCLUDED.evidence_ids,last_seen_at=now(),
        resolved_at=null,updated_at=now(),status=CASE WHEN opportunities.status='resolved' THEN 'open' ELSE opportunities.status END
    `;
  }
}

function estimateEffort(finding: Finding): 'small' | 'medium' | 'large' {
  if (finding.category === 'performance' || finding.category === 'security') return 'large';
  if (finding.severity === 'low' || finding.ruleId.includes('TITLE') || finding.ruleId.includes('DESC')) return 'small';
  return 'medium';
}

function safePath(value?: string): string | null {
  if (!value) return null;
  try { return new URL(value).pathname || '/'; } catch { return null; }
}
