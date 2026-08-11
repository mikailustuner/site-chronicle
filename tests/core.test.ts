import { describe, expect, it } from 'vitest';
import {
  ScanProfileSchema, compareAudits, createFinding, hashObject, normalizeUrl, parseHttpUrl, sha256, stableStringify,
  type AuditManifest, type PageSnapshot,
} from '../packages/core/src/index.js';

describe('core invariants', () => {
  it('normalizes URL tracking noise and order', () => {
    expect(normalizeUrl('HTTPS://Example.com:443/path/?utm_source=x&b=2&a=1#hero')).toBe('https://example.com/path?a=1&b=2');
  });

  it('rejects non-http URL schemes and embedded credentials', () => {
    expect(() => parseHttpUrl('file:///etc/passwd')).toThrow(/HTTP/);
    expect(() => parseHttpUrl('https://user:pass@example.com')).toThrow(/Credentials/);
  });

  it('produces stable hashes regardless of object key order', () => {
    expect(stableStringify({ b: 2, a: { z: 1, y: 2 } })).toBe('{"a":{"y":2,"z":1},"b":2}');
    expect(hashObject({ b: 2, a: 1 })).toBe(hashObject({ a: 1, b: 2 }));
    expect(sha256('evidence')).toHaveLength(64);
  });

  it('refuses to create an unsupported finding', () => {
    expect(() => createFinding({
      auditId: 'audit', ruleId: 'TEST-1', category: 'seo', severity: 'high', title: 'No evidence',
      observation: 'Nothing captured', impactHypothesis: 'Unknown', impactStatus: 'site-hypothesis',
      probableCause: 'Unknown', recommendation: 'Capture evidence', acceptanceCriteria: ['Evidence exists'],
      evidenceIds: [], sourceUrls: [], confidence: 0,
    })).toThrow(/must include evidence/);
  });

  it('uses a stable finding fingerprint across audits', () => {
    const common = {
      ruleId: 'SEO-TITLE-001', category: 'seo' as const, severity: 'high' as const, title: 'Missing title',
      observation: 'No title was found', impactHypothesis: 'Weak signal', impactStatus: 'research-backed-hypothesis' as const,
      probableCause: 'Template omission', recommendation: 'Add title', acceptanceCriteria: ['Title exists'],
      evidenceIds: ['ev'], sourceUrls: [], confidence: 1, pageUrl: 'https://example.com/page?utm_source=x',
    };
    expect(createFinding({ auditId: 'a1', ...common }).fingerprint).toBe(createFinding({ auditId: 'a2', ...common }).fingerprint);
  });

  it('fills safe scan-profile defaults', () => {
    const profile = ScanProfileSchema.parse({});
    expect(profile.allowForms).toBe(false);
    expect(profile.activeSecurity).toBe(false);
    expect(profile.performanceRuns).toBe(3);
  });
});

describe('historical comparison', () => {
  it('detects score, page and probable LCP causes without claiming certainty', () => {
    const profile = ScanProfileSchema.parse({ maxUrls: 2, performanceRuns: 1 });
    const beforeManifest = manifest('before', profile, '13.4.1');
    const afterManifest = manifest('after', profile, '13.4.1');
    const before = page('before', 2200, 200_000, []);
    const after = page('after', 4600, 1_500_000, [{ url: 'https://cdn.example.com/new.js', type: 'script', transferBytes: 300_000, thirdParty: true }]);
    const result = compareAudits({
      baseline: { manifest: beforeManifest, scores: [score('performance', 80)], findings: [], pages: [before] },
      current: { manifest: afterManifest, scores: [score('performance', 55)], findings: [], pages: [after] },
    });
    expect(result.comparable).toBe(true);
    expect(result.scoreDeltas[0]?.delta).toBe(-25);
    expect(result.causes[0]?.metric).toBe('lcp');
    expect(result.causes[0]?.level).toBe('likely');
    expect(result.causes[0]?.explanation).toMatch(/transfer grew|new script/);
  });

  it('warns when scanner versions differ', () => {
    const profile = ScanProfileSchema.parse({});
    const result = compareAudits({
      baseline: { manifest: manifest('before', profile, '13'), scores: [], findings: [], pages: [] },
      current: { manifest: manifest('after', profile, '14'), scores: [], findings: [], pages: [] },
    });
    expect(result.warnings.join(' ')).toMatch(/version changed/);
  });
});

function manifest(id: string, profile: ReturnType<typeof ScanProfileSchema.parse>, lighthouse: string): AuditManifest {
  return { auditId: id, domainId: 'domain', origin: 'https://example.com', startedAt: new Date(0).toISOString(), scannerVersions: { lighthouse }, profile, profileHash: hashObject(profile), workerId: 'test', environment: { platform: 'test', node: 'test' } };
}
function page(auditId: string, lcp: number, transfer: number, extra: PageSnapshot['resources']): PageSnapshot {
  return { id: `page-${auditId}`, auditId, url: 'https://example.com/', normalizedUrl: 'https://example.com/', finalUrl: 'https://example.com/', statusCode: 200, template: 'home', title: 'Example', description: 'Description', canonical: 'https://example.com/', h1: ['Example'], language: 'en', robots: '', contentHash: auditId, rawHtmlBytes: 1000, headers: {}, metrics: { performance: { lcpMs: lcp } }, resources: [{ url: 'https://example.com/hero.jpg', type: 'image', transferBytes: transfer, thirdParty: false }, ...extra], createdAt: new Date().toISOString() };
}
function score(category:'performance', value:number){return{category,score:value,source:'test',measuredAt:new Date().toISOString()}}
