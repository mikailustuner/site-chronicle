import { z } from 'zod';
import type { Finding } from '@sitechronicle/core';
import { config } from '../config.js';

const ResponseSchema = z.object({
  notes: z.array(z.object({
    findingId: z.string(),
    clarification: z.string().max(1000),
    evidenceIds: z.array(z.string()).min(1),
    confidence: z.number().min(0).max(1),
  })).max(50),
});

const systemPrompt = 'You are an evidence reviewer. Return JSON {notes:[{findingId,clarification,evidenceIds,confidence}]}. Do not create findings, claim causality, or cite evidence IDs not provided.';

export async function enrichWithAi(findings: Finding[]): Promise<Record<string, { clarification: string; confidence: number }> | null> {
  if (config.aiProvider === 'none' || !config.aiApiKey || !config.aiBaseUrl || !config.aiModel) return null;

  const allowed = new Set(findings.flatMap((item) => item.evidenceIds));
  const payload = findings.slice(0, 100).map((item) => ({
    id: item.id,
    title: item.title,
    observation: item.observation,
    probableCause: item.probableCause,
    evidenceIds: item.evidenceIds,
  }));
  const baseUrl = config.aiBaseUrl.replace(/\/$/, '');
  const anthropic = config.aiProvider === 'anthropic-compatible';
  const response = await fetch(`${baseUrl}/${anthropic ? 'messages' : 'chat/completions'}`, {
    method: 'POST',
    headers: anthropic
      ? {
          'x-api-key': config.aiApiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        }
      : {
          authorization: `Bearer ${config.aiApiKey}`,
          'content-type': 'application/json',
        },
    body: JSON.stringify(anthropic
      ? {
          model: config.aiModel,
          max_tokens: 8192,
          temperature: 0,
          system: systemPrompt,
          messages: [{ role: 'user', content: JSON.stringify(payload) }],
        }
      : {
          model: config.aiModel,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: JSON.stringify(payload) },
          ],
        }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`AI provider ${response.status}`);

  const body = await response.json() as any;
  const content = anthropic
    ? body.content?.filter((block: any) => block?.type === 'text').map((block: any) => block.text).join('')
    : body.choices?.[0]?.message?.content;
  const parsed = ResponseSchema.parse(JSON.parse(String(content ?? '{}')));
  return Object.fromEntries(parsed.notes
    .filter((note) => note.evidenceIds.every((id) => allowed.has(id)))
    .map((note) => [note.findingId, { clarification: note.clarification, confidence: note.confidence }]));
}
