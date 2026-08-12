import { createHash } from 'node:crypto';
import { request } from 'playwright';

const baseURL=process.env.SITECHRONICLE_TEST_URL??'https://localhost';
const password=process.env.SITECHRONICLE_TEST_PASSWORD??process.env.ADMIN_PASSWORD;
if(!password)throw new Error('SITECHRONICLE_TEST_PASSWORD or ADMIN_PASSWORD is required');

const client=await request.newContext({baseURL,ignoreHTTPSErrors:true,extraHTTPHeaders:{origin:new URL(baseURL).origin}});
let domainId='';let activeAuditId='';
try{
  await expectJson('/api/session',{method:'POST',data:{password}},200);
  await cleanupFixtures();
  const domain=await expectJson('/api/domains',{method:'POST',data:{name:`E2E Fixture ${Date.now()}`,origin:'http://fixture:8080',authorizationConfirmed:true}},201);domainId=domain.id;
  const profiles=await expectJson(`/api/domains/${domainId}/profiles`,{},200);const profile=profiles[0];
  await expectJson(`/api/profiles/${profile.id}`,{method:'PATCH',data:{name:'E2E minimal',config:{...profile.config,maxUrls:2,maxBrowserPages:1,crawlRatePerSecond:10,performanceRuns:1,devices:['desktop'],states:['fresh-session'],includeSecurityBaseline:false,includeCrux:false,waitAfterLoadMs:0}}},200);

  const first=await expectJson(`/api/domains/${domainId}/audits`,{method:'POST',data:{profileId:profile.id}},202);activeAuditId=first.auditId;
  await expectJson(`/api/domains/${domainId}/audits`,{method:'POST',data:{profileId:profile.id}},409);
  const firstResult=await waitForAudit(first.auditId);activeAuditId='';validateCompletedAudit(firstResult);
  const opportunities=await expectJson(`/api/opportunities?domainId=${domainId}&status=all`,{},200);if(!opportunities.length||opportunities.some(item=>!item.evidence_ids?.length))throw new Error('Evidence-backed opportunities were not generated');
  const keyword=await expectJson(`/api/domains/${domainId}/keywords`,{method:'POST',data:{query:'fixture product guide',targetUrl:'http://fixture:8080/product.html',intent:'informational',trackingTier:'standard',businessPriority:4,status:'approved'}},201);
  const keywords=await expectJson(`/api/keywords?domainId=${domainId}`,{},200);if(!keywords.some(item=>item.id===keyword.id&&item.status==='approved'))throw new Error('Outbound keyword inventory is incomplete');
  const visibility=await expectJson(`/api/visibility?domainId=${domainId}`,{},200);if(visibility.serpStatus!=='not-configured'||!String(visibility.contextNotice).includes('provider observations'))throw new Error('SERP unavailability/context boundary is incomplete');
  const trackerResponse=await client.get('/t/00000000000000000000000000000000/tracker.js');if(trackerResponse.status()!==404)throw new Error(`Legacy public tracker must be closed, received ${trackerResponse.status()}`);
  const refresh=await expectJson(`/api/domains/${domainId}/public-performance/refresh`,{method:'POST',data:{}},202);if(!refresh.jobId)throw new Error('Public performance refresh was not queued');
  await waitForJobs();
  const performance=await expectJson(`/api/public-performance?domainId=${domainId}`,{},200);if(!performance.metrics.some(item=>item.source==='synthetic-home-server')||!performance.metrics.some(item=>item.status==='not-configured'))throw new Error('Source/status-labeled public performance is incomplete');
  const chat=await expectJson('/api/chat',{method:'POST',data:{domainId,message:'What should I prioritize and what is actually measured?'}},201);if(!chat.message.content||!chat.tools.includes('domain_intelligence'))throw new Error('Grounded AI fallback did not use domain tools');

  const evidence=firstResult.evidence[0];const evidenceResponse=await client.get(`/api/evidence/${evidence.id}`);if(!evidenceResponse.ok())throw new Error(`Evidence fetch failed: ${evidenceResponse.status()}`);const bytes=await evidenceResponse.body();const digest=createHash('sha256').update(bytes).digest('hex');if(digest!==evidence.sha256)throw new Error('Evidence response hash does not match its database digest');
  const htmlReport=await expectJson(`/api/audits/${first.auditId}/reports`,{method:'POST',data:{format:'html'}},201);await expectEvidence(htmlReport.evidenceId,'text/html');
  const pdfReport=await expectJson(`/api/audits/${first.auditId}/reports`,{method:'POST',data:{format:'pdf'}},201);await expectEvidence(pdfReport.evidenceId,'application/pdf');

  const second=await expectJson(`/api/domains/${domainId}/audits`,{method:'POST',data:{profileId:profile.id}},202);activeAuditId=second.auditId;const secondResult=await waitForAudit(second.auditId);activeAuditId='';validateCompletedAudit(secondResult);
  const comparison=await expectJson('/api/comparisons',{method:'POST',data:{baselineAuditId:first.auditId,currentAuditId:second.auditId}},201);if(!comparison.comparable)throw new Error(`Identical E2E runs were not comparable: ${JSON.stringify(comparison.warnings)}`);
  const deletion=await expectJson(`/api/domains/${domainId}/deletion-preview`,{},200);if(Number(deletion.audits)!==2||Number(deletion.evidence)<1||Number(deletion.opportunities)<1)throw new Error(`Deletion preview is incomplete: ${JSON.stringify(deletion)}`);
  await expectJson(`/api/domains/${domainId}`,{method:'DELETE'},200);domainId='';
  console.log(JSON.stringify({ok:true,firstAudit:first.auditId,secondAudit:second.auditId,pages:firstResult.pages.length,findings:firstResult.findings.length,evidence:firstResult.evidence.length,comparison:comparison.id}));
}finally{
  if(activeAuditId)await client.post(`/api/audits/${activeAuditId}/cancel`).catch(()=>undefined);
  if(domainId)await client.delete(`/api/domains/${domainId}`).catch(()=>undefined);
  await client.dispose();
}

async function expectJson(path,options,expected){const response=await client.fetch(path,options);const text=await response.text();let value;try{value=JSON.parse(text)}catch{throw new Error(`${path} returned non-JSON ${response.status()}: ${text.slice(0,300)}`)}if(response.status()!==expected)throw new Error(`${path} expected ${expected}, received ${response.status()}: ${text.slice(0,500)}`);return value}
async function cleanupFixtures(){const domains=await expectJson('/api/domains',{},200);for(const domain of domains.filter(item=>item.origin==='http://fixture:8080'&&String(item.name).startsWith('E2E Fixture '))){const audits=await expectJson(`/api/audits?domainId=${domain.id}&limit=200`,{},200);for(const audit of audits.filter(item=>['queued','running'].includes(item.status)))await client.post(`/api/audits/${audit.id}/cancel`);await client.delete(`/api/domains/${domain.id}`)}}
async function waitForAudit(id){const deadline=Date.now()+300_000;while(Date.now()<deadline){const value=await expectJson(`/api/audits/${id}`,{},200);const status=value.audit.status;if(status==='completed')return value;if(['failed','cancelled'].includes(status))throw new Error(`Audit ${id} ended as ${status}: error=${value.audit.error??'none'} summary=${JSON.stringify(value.audit.summary)}`);await new Promise(resolve=>setTimeout(resolve,2000))}throw new Error(`Audit ${id} timed out`)}
async function waitForJobs(){const deadline=Date.now()+60_000;while(Date.now()<deadline){const status=await expectJson('/api/intelligence-status',{},200);const active=status.jobs.some(item=>['queued','running'].includes(item.status));if(!active)return;await new Promise(resolve=>setTimeout(resolve,500))}throw new Error('Intelligence job timed out')}
function validateCompletedAudit(value){const coverage=value.audit.summary?.coverage;if(value.pages.length!==2)throw new Error(`Expected 2 fixture pages, got ${value.pages.length}`);if(coverage?.browser?.completed!==1||coverage?.lighthouse?.completed!==1)throw new Error(`Required coverage is incomplete: ${JSON.stringify(coverage)}`);const evidenceIds=new Set(value.evidence.map(item=>item.id));if(value.findings.some(finding=>!finding.evidenceIds.length||finding.evidenceIds.some(id=>!evidenceIds.has(id))))throw new Error('A finding has a missing evidence reference');const browserMetrics=value.pages.map(page=>page.metrics?.['browser_desktop_fresh-session']).find(Boolean);if(!browserMetrics?.blockedRequests?.some(item=>item.reason==='state-changing-method'))throw new Error('The fixture POST was not recorded as policy-blocked')}
async function expectEvidence(id,mime){const response=await client.get(`/api/evidence/${id}`);if(!response.ok())throw new Error(`Report evidence ${id} failed: ${response.status()}`);if(!String(response.headers()['content-type']).startsWith(mime))throw new Error(`Report ${id} has unexpected MIME ${response.headers()['content-type']}`);if(!String(response.headers()['content-disposition']).startsWith('inline'))throw new Error(`Generated report ${id} is not served inline`)}
