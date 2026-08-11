import { z } from 'zod';

const booleanFromEnv = z.string().optional().transform((value) => value === 'true');

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(43180),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().min(1).default('postgres://sitechronicle:sitechronicle@127.0.0.1:54329/sitechronicle'),
  ARTIFACTS_PATH: z.string().default('./data/artifacts'),
  ADMIN_PASSWORD: z.string().min(12).default('development-only-password'),
  SESSION_SECRET: z.string().min(32).default('development-session-secret-change-me-now'),
  PUBLIC_BASE_URL: z.string().url().default('http://127.0.0.1:43180'),
  ALLOW_PRIVATE_TARGETS: booleanFromEnv,
  REQUIRE_DOMAIN_VERIFICATION: booleanFromEnv,
  WEB_DIST_PATH: z.string().default('../../web/dist'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CHROME_PATH: z.preprocess((value) => value === '' ? undefined : value, z.string().optional()),
});

const parsed = ConfigSchema.parse(process.env);

if (parsed.NODE_ENV === 'production') {
  if (parsed.ADMIN_PASSWORD === 'development-only-password') throw new Error('ADMIN_PASSWORD must be changed in production');
  if (parsed.SESSION_SECRET === 'development-session-secret-change-me-now') throw new Error('SESSION_SECRET must be changed in production');
  if (new URL(parsed.PUBLIC_BASE_URL).protocol !== 'https:') throw new Error('PUBLIC_BASE_URL must use HTTPS in production');
}

export const config = {
  nodeEnv: parsed.NODE_ENV,
  port: parsed.PORT,
  host: parsed.HOST,
  databaseUrl: parsed.DATABASE_URL,
  artifactsPath: parsed.ARTIFACTS_PATH,
  adminPassword: parsed.ADMIN_PASSWORD,
  sessionSecret: parsed.SESSION_SECRET,
  publicBaseUrl: parsed.PUBLIC_BASE_URL,
  allowPrivateTargets: parsed.ALLOW_PRIVATE_TARGETS,
  requireDomainVerification: parsed.REQUIRE_DOMAIN_VERIFICATION,
  webDistPath: parsed.WEB_DIST_PATH,
  logLevel: parsed.LOG_LEVEL,
  chromePath: parsed.CHROME_PATH,
};
