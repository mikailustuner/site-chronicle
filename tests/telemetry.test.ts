import { describe, expect, it } from 'vitest';
import { trackerScript } from '../apps/api/src/telemetry.js';

describe('privacy-first telemetry tag', () => {
  const script = trackerScript('https://chronicle.example/api/telemetry/collect/key');

  it('does not create persistent visitor identifiers', () => {
    expect(script).not.toContain('document.cookie');
    expect(script).not.toContain('localStorage');
    expect(script).not.toContain('sessionStorage');
    expect(script).not.toContain('userAgent');
  });

  it('collects only the pathname and supported experience metrics', () => {
    expect(script).toContain("path:location.pathname||'/'");
    expect(script).not.toContain('location.search');
    expect(script).toContain("send('page_view',1)");
    for (const metric of ['LCP', 'CLS', 'INP', 'FCP', 'TTFB']) expect(script).toContain(metric);
  });
});
