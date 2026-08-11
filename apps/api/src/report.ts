import { chromium } from 'playwright';
import { newId, type AuditComparison, type CategoryScore, type Finding, type PageSnapshot } from '@sitechronicle/core';
import type { Database } from './db.js';
import { ArtifactStore } from './artifacts.js';

interface AuditReportData {
  audit: Record<string, unknown>;
  scores: CategoryScore[];
  findings: Finding[];
  pages: PageSnapshot[];
}

export async function buildAuditReport(database: Database, auditId: string, format: 'html' | 'pdf'): Promise<{ reportId: string; evidenceId: string }> {
  const data = await loadAuditReportData(database, auditId);
  const html = renderAuditReport(data);
  const store = new ArtifactStore(database);
  const evidence = format === 'html'
    ? await store.put({ auditId, kind: 'report', mimeType: 'text/html; charset=utf-8', data: html, extension: 'html', metadata: { reportType: 'audit' } })
    : await store.put({ auditId, kind: 'report', mimeType: 'application/pdf', data: await htmlToPdf(html), extension: 'pdf', metadata: { reportType: 'audit' } });
  const reportId = newId('report');
  await database`INSERT INTO reports (id, audit_id, format, evidence_id) VALUES (${reportId}, ${auditId}, ${format}, ${evidence.id})`;
  return { reportId, evidenceId: evidence.id };
}

export async function buildComparisonReport(database: Database, comparisonId: string, format: 'html' | 'pdf'): Promise<{ reportId: string; evidenceId: string }> {
  const rows = await database<Array<Record<string, unknown>>>`SELECT * FROM comparisons WHERE id = ${comparisonId}`;
  const row = rows[0];
  if (!row) throw new Error('Comparison not found');
  const comparison = row.payload as unknown as AuditComparison;
  const auditId = comparison.currentAuditId;
  const html = renderComparisonReport(comparison);
  const store = new ArtifactStore(database);
  const evidence = format === 'html'
    ? await store.put({ auditId, kind: 'report', mimeType: 'text/html; charset=utf-8', data: html, extension: 'html', metadata: { reportType: 'comparison', comparisonId } })
    : await store.put({ auditId, kind: 'report', mimeType: 'application/pdf', data: await htmlToPdf(html), extension: 'pdf', metadata: { reportType: 'comparison', comparisonId } });
  const reportId = newId('report');
  await database`INSERT INTO reports (id, comparison_id, format, evidence_id) VALUES (${reportId}, ${comparisonId}, ${format}, ${evidence.id})`;
  return { reportId, evidenceId: evidence.id };
}

async function loadAuditReportData(database: Database, auditId: string): Promise<AuditReportData> {
  const audits = await database<Array<Record<string, unknown>>>`SELECT * FROM audits WHERE id = ${auditId}`;
  if (!audits[0]) throw new Error('Audit not found');
  const findingRows = await database<Array<{ payload: Finding }>>`SELECT payload FROM findings WHERE audit_id = ${auditId} ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END`;
  const pages = await database<Array<Record<string, unknown>>>`SELECT * FROM pages WHERE audit_id = ${auditId} ORDER BY normalized_url`;
  return {
    audit: audits[0],
    scores: (audits[0].scores ?? []) as CategoryScore[],
    findings: findingRows.map((row) => row.payload),
    pages: pages.map(rowToPage),
  };
}

function renderAuditReport(data: AuditReportData): string {
  const auditId = String(data.audit.id);
  const origin = String((data.audit.manifest as Record<string, unknown>)?.origin ?? '');
  const createdAt = String(data.audit.created_at ?? '');
  const counts = countSeverities(data.findings);
  const body = `
    <section class="cover"><div><div class="eyebrow">Evidence-based web audit</div><h1>SiteChronicle<br>Audit Report</h1><p>${escapeHtml(origin)}</p></div><div class="cover-meta"><span>${escapeHtml(createdAt)}</span><span>${escapeHtml(auditId)}</span></div></section>
    <section><div class="kicker">Decision summary</div><h1>Measured state, preserved evidence</h1>
      <div class="cards">${data.scores.map((score) => card(score.category, score.score === null ? '—' : String(Math.round(score.score)))).join('')}${card('Critical findings', String(counts.critical))}${card('Pages scanned', String(data.pages.length))}</div>
      <p class="lead">Every finding below is linked to captured evidence. Behavioral effects remain hypotheses unless measured user data is attached.</p>
    </section>
    <section class="page-break"><div class="kicker">Scores</div><h1>Category baseline</h1>${scoreTable(data.scores)}</section>
    <section class="page-break"><div class="kicker">Prioritized findings</div><h1>What should change</h1>${data.findings.map(findingBlock).join('') || '<p>No findings were stored.</p>'}</section>
    <section class="page-break"><div class="kicker">Inventory</div><h1>Audited pages</h1>${pageTable(data.pages)}</section>
    <section class="page-break"><div class="kicker">Method</div><h1>Reproducibility manifest</h1><pre>${escapeHtml(JSON.stringify(data.audit.manifest, null, 2))}</pre></section>`;
  return documentShell(`SiteChronicle audit — ${origin}`, body);
}

function renderComparisonReport(comparison: AuditComparison): string {
  const body = `
    <section class="cover"><div><div class="eyebrow">Change intelligence</div><h1>SiteChronicle<br>Comparison Report</h1><p>What changed, and why</p></div><div class="cover-meta"><span>${escapeHtml(comparison.createdAt)}</span><span>${escapeHtml(comparison.id)}</span></div></section>
    <section><div class="kicker">Comparison</div><h1>Baseline → current</h1><p class="lead">${escapeHtml(comparison.baselineAuditId)} → ${escapeHtml(comparison.currentAuditId)}</p>
      ${comparison.warnings.map((warning) => `<div class="warning">${escapeHtml(warning)}</div>`).join('')}
      <table><thead><tr><th>Category</th><th>Before</th><th>After</th><th>Delta</th></tr></thead><tbody>${comparison.scoreDeltas.map((item) => `<tr><td>${escapeHtml(item.category)}</td><td>${item.before ?? '—'}</td><td>${item.after ?? '—'}</td><td class="${(item.delta ?? 0) < 0 ? 'negative' : 'positive'}">${item.delta === null ? '—' : `${item.delta > 0 ? '+' : ''}${item.delta}`}</td></tr>`).join('')}</tbody></table>
    </section>
    <section class="page-break"><div class="kicker">Finding lifecycle</div><h1>New and resolved</h1><h2>New (${comparison.findings.added.length})</h2>${comparison.findings.added.map(findingBlock).join('') || '<p>None.</p>'}<h2>Resolved (${comparison.findings.resolved.length})</h2>${comparison.findings.resolved.map(findingBlock).join('') || '<p>None.</p>'}</section>
    <section class="page-break"><div class="kicker">Cause engine</div><h1>Why metrics changed</h1>${comparison.causes.map((cause) => `<article class="finding"><div><span class="tag ${cause.level}">${cause.level}</span><h3>${escapeHtml(cause.summary)}</h3></div><p>${escapeHtml(cause.explanation)}</p><p><b>Confidence:</b> ${Math.round(cause.confidence * 100)}%</p><table><thead><tr><th>Evidence</th><th>Before</th><th>After</th></tr></thead><tbody>${cause.evidence.map((item) => `<tr><td>${escapeHtml(item.field)}</td><td>${escapeHtml(formatValue(item.before))}</td><td>${escapeHtml(formatValue(item.after))}</td></tr>`).join('')}</tbody></table></article>`).join('') || '<p>No reliable cause candidate was established.</p>'}</section>
    <section class="page-break"><div class="kicker">Page delta</div><h1>Changed surfaces</h1><table><thead><tr><th>URL</th><th>Status</th><th>Changes</th></tr></thead><tbody>${comparison.pages.filter((page) => page.status !== 'unchanged').map((page) => `<tr><td>${escapeHtml(page.normalizedUrl)}</td><td>${page.status}</td><td>${page.changes.map((change) => escapeHtml(change.field)).join(', ')}</td></tr>`).join('')}</tbody></table></section>`;
  return documentShell('SiteChronicle comparison report', body);
}

function documentShell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
  :root{--ink:#17212b;--brand:#214e47;--accent:#b98943;--muted:#607078;--line:#d8dfdc;--wash:#f3f5f4;--red:#a5423f;--green:#2e755f}
  *{box-sizing:border-box}body{margin:0;font:10pt/1.5 Arial,sans-serif;color:var(--ink)}@page{size:A4;margin:16mm 14mm 18mm;@bottom-left{content:"created by SiteChronicle";font-size:7pt;color:#718078}@bottom-right{content:"Page " counter(page) " / " counter(pages);font-size:7pt;color:#718078}}
  @page cover{margin:0;@bottom-left{content:none}@bottom-right{content:none}}.cover{page:cover;min-height:297mm;background:var(--brand);color:white;padding:28mm 22mm;display:flex;flex-direction:column;justify-content:space-between}.cover h1{font:500 38pt/1.04 Georgia,serif;color:white}.cover p{font-size:15pt;color:#dbe8e4}.eyebrow,.kicker{text-transform:uppercase;letter-spacing:.15em;color:var(--accent);font-weight:bold;font-size:8pt}.cover-meta{display:flex;justify-content:space-between;border-top:1px solid #ffffff55;padding-top:6mm}
  section{margin-bottom:8mm}h1{font:500 25pt/1.15 Georgia,serif;margin:2mm 0 7mm}h2{font:600 15pt Georgia,serif;border-bottom:1px solid var(--line);padding-bottom:2mm;margin-top:9mm}h3{color:var(--brand);margin:2mm 0}.lead{font-size:12pt;color:#405159}.page-break{break-before:page}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:3mm}.card{padding:4mm;border:1px solid var(--line);border-radius:2mm;background:white}.card b{display:block;font:600 22pt Georgia;color:var(--brand)}.card span{font-size:8pt;color:var(--muted)}
  table{width:100%;border-collapse:collapse;font-size:8.3pt;margin:4mm 0}th{background:var(--brand);color:white;text-align:left;padding:2.5mm}td{padding:2.2mm;border-bottom:1px solid var(--line);vertical-align:top}tr:nth-child(even){background:var(--wash)}.finding{border-top:2px solid var(--brand);padding-top:3mm;margin:6mm 0;break-inside:avoid}.tag{display:inline-block;border-radius:10mm;padding:1mm 2mm;background:#edf2f0;color:var(--brand);font-size:7pt;font-weight:bold}.tag.critical{background:#f8e6e5;color:var(--red)}.tag.high{background:#faeee3;color:#a75f24}.tag.confirmed{background:#e5f2ec;color:var(--green)}.tag.unknown{background:#f2eee7;color:#806d50}.warning{border-left:3px solid var(--accent);padding:3mm;background:#faf3e8;margin:3mm 0}.positive{color:var(--green)}.negative{color:var(--red)}pre{white-space:pre-wrap;background:#14282a;color:#eef5f2;padding:4mm;font-size:7pt;overflow-wrap:anywhere}.small{font-size:8pt;color:var(--muted)}
  </style></head><body>${body}</body></html>`;
}

async function htmlToPdf(html: string): Promise<Uint8Array> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    return new Uint8Array(await page.pdf({ format: 'A4', printBackground: true, margin: { top: '16mm', right: '14mm', bottom: '18mm', left: '14mm' } }));
  } finally {
    await browser.close();
  }
}

function findingBlock(finding: Finding): string {
  return `<article class="finding"><div><span class="tag ${finding.severity}">${escapeHtml(finding.severity.toUpperCase())}</span> <span class="tag">${escapeHtml(finding.category)}</span></div><h3>${escapeHtml(finding.title)}</h3><p><b>Observed:</b> ${escapeHtml(finding.observation)}</p><p><b>Why it matters:</b> ${escapeHtml(finding.impactHypothesis)} <span class="small">(${escapeHtml(finding.impactStatus)})</span></p><p><b>Probable cause:</b> ${escapeHtml(finding.probableCause)}</p><p><b>Change:</b> ${escapeHtml(finding.recommendation)}</p><p><b>Acceptance:</b> ${finding.acceptanceCriteria.map(escapeHtml).join(' · ')}</p><p class="small">Rule ${escapeHtml(finding.ruleId)} · Confidence ${Math.round(finding.confidence * 100)}% · Evidence ${finding.evidenceIds.map(escapeHtml).join(', ')}</p></article>`;
}

function scoreTable(scores: CategoryScore[]): string {
  return `<table><thead><tr><th>Category</th><th>Score</th><th>Source</th><th>Measured</th></tr></thead><tbody>${scores.map((score) => `<tr><td>${escapeHtml(score.category)}</td><td>${score.score === null ? '—' : Math.round(score.score)}</td><td>${escapeHtml(score.source)}</td><td>${escapeHtml(score.measuredAt)}</td></tr>`).join('')}</tbody></table>`;
}

function pageTable(pages: PageSnapshot[]): string {
  return `<table><thead><tr><th>URL</th><th>Status</th><th>Template</th><th>Title</th><th>HTML</th></tr></thead><tbody>${pages.map((page) => `<tr><td>${escapeHtml(page.normalizedUrl)}</td><td>${page.statusCode}</td><td>${page.template}</td><td>${escapeHtml(page.title)}</td><td>${Math.round(page.rawHtmlBytes / 1024)} KB</td></tr>`).join('')}</tbody></table>`;
}

function card(label: string, value: string): string { return `<div class="card"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div>`; }
function escapeHtml(value: unknown): string { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]!); }
function formatValue(value: unknown): string { return typeof value === 'string' ? value : JSON.stringify(value); }
function countSeverities(findings: Finding[]): Record<string, number> { return findings.reduce((acc, item) => ({ ...acc, [item.severity]: (acc[item.severity] ?? 0) + 1 }), { critical: 0, high: 0, medium: 0, low: 0, info: 0 } as Record<string, number>); }
function rowToPage(row: Record<string, unknown>): PageSnapshot { return { id: String(row.id), auditId: String(row.audit_id), url: String(row.url), normalizedUrl: String(row.normalized_url), finalUrl: String(row.final_url), statusCode: Number(row.status_code), template: row.template as PageSnapshot['template'], title: String(row.title), description: String(row.description), canonical: String(row.canonical), h1: row.h1 as string[], language: String(row.language), robots: String(row.robots), contentHash: String(row.content_hash), ...(row.dom_hash ? { domHash: String(row.dom_hash) } : {}), ...(row.screenshot_hash ? { screenshotHash: String(row.screenshot_hash) } : {}), rawHtmlBytes: Number(row.raw_html_bytes), headers: row.headers as Record<string,string>, metrics: row.metrics as Record<string,unknown>, resources: row.resources as PageSnapshot['resources'], createdAt: String(row.created_at) }; }
