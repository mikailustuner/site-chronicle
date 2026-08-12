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
  const domains = await database<Array<{ business_priority:number }>>`SELECT business_priority FROM domains WHERE id=${input.domainId}`;
  const businessRelevance = Number(domains[0]?.business_priority ?? 3) / 5;
  const seen: string[] = [];

  for (const finding of input.findings) {
    const confidence = Math.round(finding.confidence * 100);
    const priority = Math.min(100, Math.round(
      severityWeight[finding.severity] * .68 + confidence * .22 + businessRelevance * 10,
    ));
    const fingerprint = `finding:${finding.fingerprint}`;
    seen.push(fingerprint);
    const validationPlan = finding.numericValue !== undefined
      ? `Apply the change, rerun the same scan profile, and verify that ${finding.numericUnit ?? 'the measured value'} improves without regressions. Traffic and revenue impact remain unavailable without private analytics.`
      : 'Apply the change, rerun the same scan profile, and confirm every acceptance criterion against new evidence. Use contextual SERP and public performance observations where available; do not infer visitor or revenue impact.';
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
  return seen.length;
}

function estimateEffort(finding: Finding): 'small' | 'medium' | 'large' {
  if (finding.category === 'performance' || finding.category === 'security') return 'large';
  if (finding.severity === 'low' || finding.ruleId.includes('TITLE') || finding.ruleId.includes('DESC')) return 'small';
  return 'medium';
}
