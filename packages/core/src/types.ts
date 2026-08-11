import { z } from 'zod';

export const auditCategories = [
  'performance',
  'seo',
  'accessibility',
  'best-practices',
  'security',
  'behavioral-ux',
  'agent-readiness',
] as const;

export const severityLevels = ['critical', 'high', 'medium', 'low', 'info'] as const;
export const confidenceLevels = ['confirmed', 'likely', 'unknown'] as const;

export type AuditCategory = (typeof auditCategories)[number];
export type Severity = (typeof severityLevels)[number];
export type ConfidenceLevel = (typeof confidenceLevels)[number];

export const ScanProfileSchema = z.object({
  name: z.string().min(1).max(120).default('Standard audit'),
  maxUrls: z.number().int().min(1).max(50_000).default(250),
  maxBrowserPages: z.number().int().min(1).max(200).default(12),
  crawlRatePerSecond: z.number().min(0.1).max(10).default(1),
  respectRobots: z.boolean().default(true),
  performanceRuns: z.number().int().min(1).max(5).default(3),
  devices: z.array(z.enum(['mobile', 'desktop'])).min(1).default(['mobile', 'desktop']),
  states: z.array(z.enum(['fresh-session', 'returning-session', 'popup-closed'])).min(1).default(['fresh-session']),
  includeSecurityBaseline: z.boolean().default(true),
  includeCrux: z.boolean().default(false),
  allowForms: z.boolean().default(false),
  activeSecurity: z.boolean().default(false),
  locale: z.string().default('tr-TR'),
  timezone: z.string().default('Europe/Istanbul'),
  waitAfterLoadMs: z.number().int().min(0).max(30_000).default(3_000),
});

export type ScanProfile = z.infer<typeof ScanProfileSchema>;

export interface AuditManifest {
  auditId: string;
  domainId: string;
  origin: string;
  startedAt: string;
  completedAt?: string;
  scannerVersions: Record<string, string>;
  profile: ScanProfile;
  profileHash: string;
  workerId: string;
  environment: {
    platform: string;
    node: string;
    region?: string;
    containerImage?: string;
  };
}

export interface EvidenceRef {
  id: string;
  kind: 'html' | 'screenshot' | 'network' | 'lighthouse' | 'axe' | 'headers' | 'tls' | 'sitemap' | 'robots' | 'dom' | 'metric' | 'text' | 'report';
  sha256: string;
  mimeType: string;
  relativePath: string;
  pageUrl?: string;
  selector?: string;
  metadata?: Record<string, unknown>;
}

export interface Finding {
  id: string;
  auditId: string;
  pageId?: string;
  pageUrl?: string;
  ruleId: string;
  rulesetVersion: string;
  category: AuditCategory;
  severity: Severity;
  title: string;
  observation: string;
  impactHypothesis: string;
  impactStatus: 'measured' | 'research-backed-hypothesis' | 'site-hypothesis' | 'informational';
  probableCause: string;
  recommendation: string;
  acceptanceCriteria: string[];
  evidenceIds: string[];
  sourceUrls: string[];
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  fingerprint: string;
  numericValue?: number;
  numericUnit?: string;
  createdAt: string;
}

export interface PageSnapshot {
  id: string;
  auditId: string;
  url: string;
  normalizedUrl: string;
  finalUrl: string;
  statusCode: number;
  template: PageTemplate;
  title: string;
  description: string;
  canonical: string;
  h1: string[];
  language: string;
  robots: string;
  contentHash: string;
  domHash?: string;
  screenshotHash?: string;
  rawHtmlBytes: number;
  headers: Record<string, string>;
  metrics: Record<string, unknown>;
  resources: ResourceSnapshot[];
  createdAt: string;
}

export type PageTemplate = 'home' | 'category' | 'product' | 'content' | 'search' | 'account' | 'cart' | 'checkout' | 'policy' | 'unknown';

export interface ResourceSnapshot {
  url: string;
  type: string;
  transferBytes: number;
  encodedBytes?: number;
  status?: number;
  initiator?: string;
  hash?: string;
  thirdParty: boolean;
}

export interface CategoryScore {
  category: AuditCategory;
  score: number | null;
  source: string;
  measuredAt: string;
  details?: Record<string, unknown>;
}

export interface AuditComparison {
  id: string;
  baselineAuditId: string;
  currentAuditId: string;
  comparable: boolean;
  warnings: string[];
  scoreDeltas: Array<{ category: AuditCategory; before: number | null; after: number | null; delta: number | null }>;
  findings: {
    added: Finding[];
    resolved: Finding[];
    persistent: Array<{ before: Finding; after: Finding; severityChanged: boolean }>;
  };
  pages: PageComparison[];
  causes: CauseCandidate[];
  createdAt: string;
}

export interface PageComparison {
  normalizedUrl: string;
  status: 'added' | 'removed' | 'changed' | 'unchanged';
  changes: Array<{ field: string; before: unknown; after: unknown; delta?: number }>;
}

export interface CauseCandidate {
  pageUrl?: string;
  metric: string;
  summary: string;
  explanation: string;
  confidence: number;
  level: ConfidenceLevel;
  evidence: Array<{ field: string; before: unknown; after: unknown }>;
}

export interface AuditSummary {
  auditId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  origin: string;
  startedAt: string;
  completedAt?: string;
  scores: CategoryScore[];
  findingCounts: Record<Severity, number>;
  pagesScanned: number;
}
