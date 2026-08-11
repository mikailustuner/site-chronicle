import tls from 'node:tls';
import { createFinding, type Finding } from '@sitechronicle/core';
import type { CrawledPage } from '../crawler.js';
import { config } from '../config.js';

export function analyzeSecurity(input:{auditId:string;pageId:string;page:CrawledPage;headersEvidenceId:string}):{findings:Finding[];score:number} {
  const {auditId,pageId,page,headersEvidenceId}=input;const h=lower(page.headers);const findings:Finding[]=[];const base={auditId,pageId,pageUrl:page.finalUrl,evidenceIds:[headersEvidenceId],sourceUrls:['https://developer.mozilla.org/en-US/observatory/docs/faq']};
  const add=(ruleId:string,severity:Finding['severity'],title:string,observation:string,recommendation:string,confidence=1)=>findings.push(createFinding({...base,ruleId,category:'security',severity,title,observation,impactHypothesis:'Missing browser-side defense can increase exposure when another vulnerability exists.',impactStatus:'research-backed-hypothesis',probableCause:'The response security-header policy is absent or incomplete.',recommendation,acceptanceCriteria:['Header is present on HTML responses','Policy is validated in report-only/staging before enforcement'],confidence}));
  if(!h['strict-transport-security']&&page.finalUrl.startsWith('https:'))add('SEC-HSTS-001','high','HSTS is missing','HTTPS response does not include Strict-Transport-Security.','Add HSTS after confirming all subdomains support HTTPS.');
  if(!h['content-security-policy'])add('SEC-CSP-001','high','Content Security Policy is missing','No Content-Security-Policy response header was observed.','Deploy a nonce/hash-based CSP; begin with Report-Only and remove unsafe dependencies.');
  if(!h['x-content-type-options'])add('SEC-NOSNIFF-001','medium','MIME sniffing protection is missing','X-Content-Type-Options was not observed.','Send X-Content-Type-Options: nosniff.');
  if(!h['x-frame-options']&&!/frame-ancestors/i.test(h['content-security-policy']??''))add('SEC-FRAME-001','high','Frame embedding protection is missing','Neither X-Frame-Options nor CSP frame-ancestors was observed.','Set CSP frame-ancestors and a compatible X-Frame-Options policy.');
  if(!h['referrer-policy'])add('SEC-REFERRER-001','medium','Referrer Policy is missing','Referrer-Policy was not observed.','Set a deliberate policy such as strict-origin-when-cross-origin.');
  if(!h['permissions-policy'])add('SEC-PERMISSIONS-001','low','Permissions Policy is missing','Permissions-Policy was not observed.','Disable browser capabilities not used by the site.');
  const setCookie=Object.entries(page.headers).filter(([key])=>key.toLowerCase()==='set-cookie').map(([,value])=>value).join(',');
  if(setCookie&&!/secure/i.test(setCookie))add('SEC-COOKIE-001','high','A cookie may be missing Secure','Set-Cookie evidence does not include Secure.','Mark session and sensitive cookies Secure.');
  if(setCookie&&!/httponly/i.test(setCookie))add('SEC-COOKIE-002','medium','A cookie may be missing HttpOnly','Set-Cookie evidence does not include HttpOnly.','Mark cookies not required by JavaScript as HttpOnly.',.75);
  if(setCookie&&!/samesite/i.test(setCookie))add('SEC-COOKIE-003','medium','Cookie SameSite policy is not explicit','Set-Cookie evidence does not include SameSite.','Set SameSite=Lax or Strict unless a documented cross-site flow requires None; Secure.',.8);
  if(h['server']||h['x-powered-by'])findings.push(createFinding({...base,ruleId:'SEC-DISCLOSURE-001',category:'security',severity:'low',title:'Technology disclosure headers are visible',observation:`Observed ${[h['server']?'Server':'',h['x-powered-by']?'X-Powered-By':''].filter(Boolean).join(' and ')}.`,impactHypothesis:'Version or platform disclosure can assist reconnaissance but is not a vulnerability alone.',impactStatus:'informational',probableCause:'Default server/framework headers remain enabled.',recommendation:'Remove unnecessary disclosure headers without treating this as a substitute for patching.',acceptanceCriteria:['Unnecessary framework header is removed','Patch management remains in place'],confidence:1}));
  const penalty=findings.reduce((sum,item)=>sum+({critical:30,high:14,medium:7,low:2,info:0}[item.severity]),0);
  return {findings,score:Math.max(0,100-penalty)};
}

export async function inspectTls(origin:string):Promise<Record<string,unknown>> {
  const url=new URL(origin);if(url.protocol!=='https:')return {secure:false,reason:'Origin does not use HTTPS'};
  return new Promise((resolve,reject)=>{const socket=tls.connect({host:url.hostname,port:Number(url.port||443),servername:url.hostname,rejectUnauthorized:true,timeout:10_000},()=>{const cert=socket.getPeerCertificate();resolve({secure:true,authorized:socket.authorized,protocol:socket.getProtocol(),cipher:socket.getCipher(),validFrom:cert.valid_from,validTo:cert.valid_to,subject:cert.subject,issuer:cert.issuer,fingerprint256:cert.fingerprint256});socket.end()});socket.on('error',reject);socket.on('timeout',()=>{socket.destroy();reject(new Error('TLS inspection timed out'))})});
}

export async function runZapBaseline(origin:string):Promise<Record<string,unknown>|null>{
  if(!config.zapApiUrl)return null;const base=config.zapApiUrl;const key=config.zapApiKey??'';
  const start=await fetch(`${base}/JSON/spider/action/scan/?apikey=${encodeURIComponent(key)}&url=${encodeURIComponent(origin)}&maxChildren=30`,{signal:AbortSignal.timeout(15_000)}).then(r=>r.json()) as {scan?:string};
  if(!start.scan)throw new Error('ZAP spider did not return scan id');
  for(let i=0;i<60;i+=1){await new Promise(r=>setTimeout(r,1000));const status=await fetch(`${base}/JSON/spider/view/status/?apikey=${encodeURIComponent(key)}&scanId=${start.scan}`).then(r=>r.json()) as {status?:string};if(Number(status.status)>=100)break}
  for(let i=0;i<60;i+=1){const pending=await fetch(`${base}/JSON/pscan/view/recordsToScan/?apikey=${encodeURIComponent(key)}`).then(r=>r.json()) as {recordsToScan?:string};if(Number(pending.recordsToScan)<=0)break;await new Promise(r=>setTimeout(r,1000))}
  return fetch(`${base}/JSON/core/view/alerts/?apikey=${encodeURIComponent(key)}&baseurl=${encodeURIComponent(origin)}&start=0&count=500`).then(r=>r.json()) as Promise<Record<string,unknown>>;
}
function lower(headers:Record<string,string>):Record<string,string>{return Object.fromEntries(Object.entries(headers).map(([k,v])=>[k.toLowerCase(),v]))}
