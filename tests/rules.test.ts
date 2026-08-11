import { describe, expect, it } from 'vitest';
import { analyzeSeo } from '../apps/worker/src/scanners/seo.js';
import { analyzeSecurity } from '../apps/worker/src/scanners/security.js';
import type { CrawledPage } from '../apps/worker/src/crawler.js';

describe('deterministic audit rules', () => {
  it('finds missing on-page signals with evidence references', () => {
    const page = fixturePage('<html><head></head><body><img src="x.jpg"></body></html>');
    const result = analyzeSeo({ auditId: 'a', pageId: 'p', page, htmlEvidenceId: 'ev-html' });
    expect(result.findings.map((item) => item.ruleId)).toEqual(expect.arrayContaining(['SEO-TITLE-001', 'SEO-DESC-001', 'SEO-H1-001', 'SEO-CANON-001', 'SEO-IMG-001']));
    expect(result.findings.every((item) => item.evidenceIds.includes('ev-html'))).toBe(true);
  });

  it('recognizes Product structured data', () => {
    const html = '<html><head><title>Product title example</title><meta name="description" content="A useful product description"><link rel="canonical" href="https://example.com/product-1234"><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Dress"}</script></head><body><h1>Dress</h1></body></html>';
    const page = { ...fixturePage(html), template: 'product' as const, title: 'Product title example', description: 'A useful product description', canonical: 'https://example.com/product-1234', h1: ['Dress'] };
    const result = analyzeSeo({ auditId: 'a', pageId: 'p', page, htmlEvidenceId: 'ev' });
    expect(result.findings.some((item) => item.ruleId === 'SEO-PRODUCT-001')).toBe(false);
  });

  it('scores passive security posture transparently', () => {
    const page = fixturePage('<html><head><title>Example title here</title></head><body><h1>Example</h1></body></html>');
    const result = analyzeSecurity({ auditId: 'a', pageId: 'p', page, headersEvidenceId: 'headers' });
    expect(result.score).toBeLessThan(100);
    expect(result.findings.some((item) => item.ruleId === 'SEC-CSP-001')).toBe(true);
    expect(result.findings.every((item) => item.evidenceIds[0] === 'headers')).toBe(true);
  });
});

function fixturePage(html:string):CrawledPage{return{url:'https://example.com/product-1234',normalizedUrl:'https://example.com/product-1234',finalUrl:'https://example.com/product-1234',statusCode:200,headers:{},html,title:'',description:'',canonical:'',h1:[],language:'en',robots:'',contentHash:'hash',template:'unknown',links:[]}}
