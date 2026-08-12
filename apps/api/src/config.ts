import { z } from 'zod';

const booleanFromEnv = z.string().optional().transform((value) => value === 'true');
const optionalSecret = (minimum = 1) => z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().min(minimum).optional(),
);

function isPrivateNetworkHostname(hostname: string): boolean {
  const octets = hostname.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [first, second] = octets as [number, number, number, number];
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 100 && second >= 64 && second <= 127);
}

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(43180),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().min(1).default('postgres://sitechronicle:sitechronicle@127.0.0.1:54329/sitechronicle'),
  ARTIFACTS_PATH: z.string().default('./data/artifacts'),
  ADMIN_PASSWORD: z.string().min(12).default('development-only-password'),
  SESSION_SECRET: z.string().min(32).default('development-session-secret-change-me-now'),
  PUBLIC_BASE_URL: z.string().url().default('http://127.0.0.1:43180'),
  TRUST_PRIVATE_HTTP: booleanFromEnv,
  ALLOW_PRIVATE_TARGETS: booleanFromEnv,
  REQUIRE_DOMAIN_VERIFICATION: booleanFromEnv,
  WEB_DIST_PATH: z.string().default('../../web/dist'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CHROME_PATH: z.preprocess((value) => value === '' ? undefined : value, z.string().optional()),
  AI_PROVIDER: z.enum(['none', 'openai-compatible', 'anthropic-compatible']).default('none'),
  AI_API_KEY: optionalSecret(),
  AI_BASE_URL: z.preprocess((value) => value === '' ? undefined : value, z.string().url().optional()),
  AI_MODEL: z.string().optional(),
  // Compose deliberately passes an empty string when this optional feature is
  // not configured. Treat that as absent so the core application can start;
  // saving encrypted connector credentials will still return a clear 503.
  CONNECTOR_MASTER_KEY: optionalSecret(32),
});

const parsed = ConfigSchema.parse(process.env);

if (parsed.NODE_ENV === 'production') {
  if (parsed.ADMIN_PASSWORD === 'development-only-password') throw new Error('ADMIN_PASSWORD must be changed in production');
  if (parsed.SESSION_SECRET === 'development-session-secret-change-me-now') throw new Error('SESSION_SECRET must be changed in production');
  const publicUrl = new URL(parsed.PUBLIC_BASE_URL);
  const trustedPrivateHttp = parsed.TRUST_PRIVATE_HTTP
    && publicUrl.protocol === 'http:'
    && isPrivateNetworkHostname(publicUrl.hostname);
  if (publicUrl.protocol !== 'https:' && !trustedPrivateHttp) {
    throw new Error('PUBLIC_BASE_URL must use HTTPS in production unless TRUST_PRIVATE_HTTP=true and the host is a private IPv4 address');
  }
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
  secureCookies: new URL(parsed.PUBLIC_BASE_URL).protocol === 'https:',
  allowPrivateTargets: parsed.ALLOW_PRIVATE_TARGETS,
  requireDomainVerification: parsed.REQUIRE_DOMAIN_VERIFICATION,
  webDistPath: parsed.WEB_DIST_PATH,
  logLevel: parsed.LOG_LEVEL,
  chromePath: parsed.CHROME_PATH,
  aiProvider: parsed.AI_PROVIDER,
  aiApiKey: parsed.AI_API_KEY,
  aiBaseUrl: parsed.AI_BASE_URL,
  aiModel: parsed.AI_MODEL,
  connectorMasterKey: parsed.CONNECTOR_MASTER_KEY,
};
