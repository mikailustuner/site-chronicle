import { describe, expect, test } from 'vitest';
import { solutionPlaybook } from '../apps/api/src/strategy-routes.js';

describe('multidisciplinary solution playbooks', () => {
  test('every supported area creates actionable evidence gates', () => {
    for (const area of ['software','security','automation','advertising','growth','product','operations','research','other']) {
      const actions = solutionPlaybook(area);
      expect(actions.length).toBeGreaterThanOrEqual(2);
      expect(actions[0]?.title).toContain('evidence boundary');
      for (const action of actions) {
        expect(action.rationale.length).toBeGreaterThan(10);
        expect(action.instructions.length).toBeGreaterThan(0);
        expect(action.acceptance.length).toBeGreaterThan(0);
      }
    }
  });

  test('security stays authorization-first and automation stays recoverable', () => {
    expect(JSON.stringify(solutionPlaybook('security'))).toMatch(/Authorize, scope|authorization|scope/i);
    expect(JSON.stringify(solutionPlaybook('automation'))).toMatch(/idempotency/i);
    expect(JSON.stringify(solutionPlaybook('automation'))).toMatch(/recoverable/i);
  });
});
