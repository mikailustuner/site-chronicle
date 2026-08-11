import { describe, expect, it } from 'vitest';
import { validateTarget as validateApiTarget } from '../apps/api/src/security/target.js';
import { validateTarget as validateWorkerTarget } from '../apps/worker/src/security/target.js';

describe('SSRF target validation', () => {
  for (const target of ['http://127.0.0.1', 'http://10.0.0.1', 'http://169.254.169.254', 'http://[::1]', 'http://[::ffff:127.0.0.1]']) {
    it(`blocks ${target}`, async () => {
      await expect(validateApiTarget(target, false)).rejects.toThrow(/blocked/);
      await expect(validateWorkerTarget(target, false)).rejects.toThrow(/blocked/);
    });
  }

  it('rejects unusual target ports', async () => {
    await expect(validateApiTarget('https://example.com:22', false)).rejects.toThrow(/port/);
  });

  it('allows public IPv4 targets', async () => {
    await expect(validateApiTarget('https://172.66.1.12', false)).resolves.toMatchObject({ addresses: ['172.66.1.12'] });
    await expect(validateWorkerTarget('https://172.66.1.12', false)).resolves.toBeInstanceOf(URL);
  });
});
