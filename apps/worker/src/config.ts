import { z } from 'zod';

const bool = z.string().optional().transform((value) => value === 'true');
const optionalUrl = z.preprocess(
  (value) => value === '' ? undefined : value,
  z.string().url().optional(),
);
const Schema = z.object({
  DATABASE_URL: z.string().default('postgres://sitechronicle:sitechronicle@127.0.0.1:54329/sitechronicle'),
  ARTIFACTS_PATH: z.string().default('./data/artifacts'),
  WORKER_ID: z.string().default(`worker-${process.pid}`),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(30_000).default(1500),
  CHROME_PATH: z.string().optional(),
  ALLOW_PRIVATE_TARGETS: bool,
  ZAP_API_URL: optionalUrl,
  ZAP_API_KEY: z.string().optional(),
  CRUX_API_KEY: z.string().optional(),
  AI_PROVIDER: z.enum(['none', 'openai-compatible']).default('none'),
  AI_API_KEY: z.string().optional(),
  AI_BASE_URL: optionalUrl,
  AI_MODEL: z.string().optional(),
});

const value = Schema.parse(process.env);
export const config = {
  databaseUrl: value.DATABASE_URL,
  artifactsPath: value.ARTIFACTS_PATH,
  workerId: value.WORKER_ID,
  concurrency: value.WORKER_CONCURRENCY,
  pollIntervalMs: value.POLL_INTERVAL_MS,
  chromePath: value.CHROME_PATH,
  allowPrivateTargets: value.ALLOW_PRIVATE_TARGETS,
  zapApiUrl: value.ZAP_API_URL,
  zapApiKey: value.ZAP_API_KEY,
  cruxApiKey: value.CRUX_API_KEY,
  aiProvider: value.AI_PROVIDER,
  aiApiKey: value.AI_API_KEY,
  aiBaseUrl: value.AI_BASE_URL,
  aiModel: value.AI_MODEL,
};
