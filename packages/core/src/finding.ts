import { hashObject, newId } from './hash.js';
import type { Finding } from './types.js';

export const RULESET_VERSION = '1.0.0';

export type FindingInput = Omit<Finding, 'id' | 'fingerprint' | 'createdAt' | 'rulesetVersion' | 'confidenceLevel'> & {
  id?: string;
  createdAt?: string;
  rulesetVersion?: string;
};

export function createFinding(input: FindingInput): Finding {
  if (input.evidenceIds.length === 0) throw new Error(`Finding ${input.ruleId} must include evidence`);
  const confidence = Math.max(0, Math.min(1, input.confidence));
  const fingerprint = hashObject({
    ruleId: input.ruleId,
    pageUrl: input.pageUrl ? normalizeFindingUrl(input.pageUrl) : null,
    observation: normalizeObservation(input.observation),
    measurementContext: input.measurementContext ?? null,
  });
  return {
    ...input,
    id: input.id ?? newId('finding'),
    rulesetVersion: input.rulesetVersion ?? RULESET_VERSION,
    createdAt: input.createdAt ?? new Date().toISOString(),
    confidence,
    confidenceLevel: confidence >= 0.85 ? 'confirmed' : confidence >= 0.55 ? 'likely' : 'unknown',
    fingerprint,
  };
}

function normalizeFindingUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  return `${url.origin}${url.pathname}`.replace(/\/$/, '');
}

function normalizeObservation(value: string): string {
  return value.toLowerCase().replace(/\d+(?:[.,]\d+)?/g, '#').replace(/\s+/g, ' ').trim();
}
