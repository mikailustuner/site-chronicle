import { newId } from './hash.js';
import type { AuditComparison, AuditManifest, CategoryScore, CauseCandidate, Finding, PageComparison, PageSnapshot } from './types.js';

export interface ComparisonInput {
  baseline: { manifest: AuditManifest; scores: CategoryScore[]; findings: Finding[]; pages: PageSnapshot[] };
  current: { manifest: AuditManifest; scores: CategoryScore[]; findings: Finding[]; pages: PageSnapshot[] };
}

export function compareAudits(input: ComparisonInput): AuditComparison {
  const warnings: string[] = [];
  const profilesMatch = input.baseline.manifest.profileHash === input.current.manifest.profileHash;
  if (!profilesMatch) warnings.push('Scan profiles differ; metric deltas may include methodology changes.');
  let scannerVersionsMatch = true;
  for (const key of new Set([...Object.keys(input.baseline.manifest.scannerVersions), ...Object.keys(input.current.manifest.scannerVersions)])) {
    if (input.baseline.manifest.scannerVersions[key] !== input.current.manifest.scannerVersions[key]) {
      scannerVersionsMatch = false;
      warnings.push(`${key} version changed: ${input.baseline.manifest.scannerVersions[key] ?? 'unknown'} → ${input.current.manifest.scannerVersions[key] ?? 'unknown'}`);
    }
  }
  const comparable = profilesMatch && scannerVersionsMatch;

  const beforeScores = new Map(input.baseline.scores.map((item) => [item.category, item.score]));
  const afterScores = new Map(input.current.scores.map((item) => [item.category, item.score]));
  const categories = new Set([...beforeScores.keys(), ...afterScores.keys()]);
  const scoreDeltas = [...categories].map((category) => {
    const before = beforeScores.get(category) ?? null;
    const after = afterScores.get(category) ?? null;
    return { category, before, after, delta: before === null || after === null ? null : round(after - before) };
  });

  const beforeFindings = new Map(input.baseline.findings.map((item) => [item.fingerprint, item]));
  const afterFindings = new Map(input.current.findings.map((item) => [item.fingerprint, item]));
  const added = input.current.findings.filter((item) => !beforeFindings.has(item.fingerprint));
  const resolved = input.baseline.findings.filter((item) => !afterFindings.has(item.fingerprint));
  const persistent = input.current.findings
    .filter((item) => beforeFindings.has(item.fingerprint))
    .map((after) => {
      const before = beforeFindings.get(after.fingerprint)!;
      return { before, after, severityChanged: before.severity !== after.severity };
    });

  const beforePages = new Map(input.baseline.pages.map((item) => [item.normalizedUrl, item]));
  const afterPages = new Map(input.current.pages.map((item) => [item.normalizedUrl, item]));
  const pageUrls = new Set([...beforePages.keys(), ...afterPages.keys()]);
  const pages: PageComparison[] = [...pageUrls].map((url) => comparePage(url, beforePages.get(url), afterPages.get(url)));
  const causes = inferCauses(input.baseline.pages, input.current.pages);

  return {
    id: newId('comparison'),
    baselineAuditId: input.baseline.manifest.auditId,
    currentAuditId: input.current.manifest.auditId,
    comparable,
    warnings,
    scoreDeltas,
    findings: { added, resolved, persistent },
    pages,
    causes,
    createdAt: new Date().toISOString(),
  };
}

function comparePage(url: string, before?: PageSnapshot, after?: PageSnapshot): PageComparison {
  if (!before && after) return { normalizedUrl: url, status: 'added', changes: [] };
  if (before && !after) return { normalizedUrl: url, status: 'removed', changes: [] };
  if (!before || !after) return { normalizedUrl: url, status: 'unchanged', changes: [] };
  const fields: Array<keyof PageSnapshot> = ['statusCode', 'finalUrl', 'title', 'description', 'canonical', 'robots', 'language', 'contentHash', 'rawHtmlBytes'];
  const changes = fields.flatMap((field) => {
    if (JSON.stringify(before[field]) === JSON.stringify(after[field])) return [];
    const delta = typeof before[field] === 'number' && typeof after[field] === 'number' ? Number(after[field]) - Number(before[field]) : undefined;
    return [{ field, before: before[field], after: after[field], ...(delta === undefined ? {} : { delta }) }];
  });
  return { normalizedUrl: url, status: changes.length ? 'changed' : 'unchanged', changes };
}

function inferCauses(beforePages: PageSnapshot[], afterPages: PageSnapshot[]): CauseCandidate[] {
  const beforeMap = new Map(beforePages.map((item) => [item.normalizedUrl, item]));
  const causes: CauseCandidate[] = [];
  for (const after of afterPages) {
    const before = beforeMap.get(after.normalizedUrl);
    if (!before) continue;
    const beforePerf = readPerformance(before.metrics);
    const afterPerf = readPerformance(after.metrics);
    if (beforePerf.lcp !== null && afterPerf.lcp !== null && afterPerf.lcp - beforePerf.lcp > 500) {
      const transferBefore = sumTransfer(before.resources);
      const transferAfter = sumTransfer(after.resources);
      const addedScripts = after.resources.filter((r) => r.type === 'script' && !before.resources.some((old) => old.url === r.url));
      const resourceGrowth = transferAfter - transferBefore;
      let confidence = 0.42;
      const evidence: CauseCandidate['evidence'] = [
        { field: 'LCP (ms)', before: beforePerf.lcp, after: afterPerf.lcp },
        { field: 'Transfer bytes', before: transferBefore, after: transferAfter },
      ];
      const reasons: string[] = [];
      if (resourceGrowth > 100_000) {
        confidence += 0.25;
        reasons.push(`page transfer grew by ${formatBytes(resourceGrowth)}`);
      }
      if (addedScripts.length) {
        confidence += 0.15;
        reasons.push(`${addedScripts.length} new script resource(s) appeared`);
        evidence.push({ field: 'New scripts', before: 0, after: addedScripts.map((item) => item.url) });
      }
      causes.push({
        pageUrl: after.url,
        metric: 'lcp',
        summary: `LCP regressed by ${Math.round(afterPerf.lcp - beforePerf.lcp)} ms`,
        explanation: reasons.length ? `Likely contributors: ${reasons.join('; ')}.` : 'A regression is measured, but captured artifacts do not establish a reliable cause.',
        confidence: Math.min(confidence, 0.95),
        level: confidence >= 0.85 ? 'confirmed' : confidence >= 0.55 ? 'likely' : 'unknown',
        evidence,
      });
    }
    if (before.title !== after.title || before.description !== after.description || before.canonical !== after.canonical) {
      causes.push({
        pageUrl: after.url,
        metric: 'seo-metadata',
        summary: 'Search metadata changed',
        explanation: 'The normalized HTML snapshot directly confirms title, description or canonical changes.',
        confidence: 1,
        level: 'confirmed',
        evidence: [
          { field: 'title', before: before.title, after: after.title },
          { field: 'description', before: before.description, after: after.description },
          { field: 'canonical', before: before.canonical, after: after.canonical },
        ],
      });
    }
  }
  return causes;
}

function readPerformance(metrics: Record<string, unknown>): { lcp: number | null } {
  const value = metrics.performance;
  if (!value || typeof value !== 'object') return { lcp: null };
  const lcp = (value as Record<string, unknown>).lcpMs;
  return { lcp: typeof lcp === 'number' ? lcp : null };
}

function sumTransfer(resources: PageSnapshot['resources']): number {
  return resources.reduce((total, item) => total + (item.transferBytes || 0), 0);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatBytes(value: number): string {
  return value > 1_000_000 ? `${(value / 1_000_000).toFixed(2)} MB` : `${Math.round(value / 1_000)} KB`;
}
