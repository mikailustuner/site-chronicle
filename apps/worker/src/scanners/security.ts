import tls from 'node:tls';
import { createFinding, type Finding } from '@sitechronicle/core';
import type { CrawledPage } from '../crawler.js';
import { config } from '../config.js';
import { resolveTarget } from '../security/target.js';
import { getAuditProxy } from '../security/proxy.js';

export function analyzeSecurity(input:{auditId:string;pageId:string;page:CrawledPage;headersEvidenceId:string}):{findings:Finding[];score:number} {
  const {auditId,pageId,page,headersEvidenceId}=input;const h=lower(page.headers);const findings:Finding[]=[];const base={auditId,pageId,pageUrl:page.finalUrl,evidenceIds:[headersEvidenceId],sourceUrls:['https://developer.mozilla.org/en-US/observatory/docs/faq']};
  const add=(ruleId:string,severity:Finding['severity'],title:string,observation:string,recommendation:string,confidence=1)=>findings.push(createFinding({...base,ruleId,category:'security',severity,title,observation,impactHypothesis:'Missing browser-side defense can increase exposure when another vulnerability exists.',impactStatus:'research-backed-hypothesis',probableCause:'The response security-header policy is absent or incomplete.',recommendation,acceptanceCriteria:['Header is present on HTML responses','Policy is validated in report-only/staging before enforcement'],confidence}));
  if(!h['strict-transport-security']&&page.finalUrl.startsWith('https:'))add('SEC-HSTS-001','high','HSTS is missing','HTTPS response does not include Strict-Transport-Security.','Add HSTS after confirming all subdomains support HTTPS.');
  if(!h['content-security-policy'])add('SEC-CSP-001','high','Content Security Policy is missing','No Content-Security-Policy response header was observed.','Deploy a nonce/hash-based CSP; begin with Report-Only and remove unsafe dependencies.');
  if(!h['x-content-type-options'])add('SEC-NOSNIFF-001','medium','MIME sniffing protection is missing','X-Content-Type-Options was not observed.','Send X-Content-Type-Options: nosniff.');
  if(!h['x-frame-options']&&!/frame-ancestors/i.test(h['content-security-policy']??''))add('SEC-FRAME-001','high','Frame embedding protection is missing','Neither X-Frame-Options nor CSP frame-ancestors was observed.','Set CSP frame-ancestors and a compatible X-Frame-Options policy.');
  if(!h['referrer-policy'])add('SEC-REFERRER-001','medium','Referrer Policy is missing','Referrer-Policy was not observed.','Set a deliberate policy such as strict-origin-when-cross-origin.');
  if(!h['permissions-policy'])add('SEC-PERMISSIONS-001','low','Permissions Policy is missing','Permissions-Policy was not observed.','Disable browser capabilities not used by the site.');
  const cookies=page.setCookies??Object.entries(page.headers).filter(([key])=>key.toLowerCase()==='set-cookie').map(([,value])=>value);
  const cookieNames=(items:string[])=>items.map(item=>item.split('=',1)[0]||'(unnamed)').join(', ');
  const insecure=cookies.filter(cookie=>!/(?:^|;)\s*Secure(?:;|$)/i.test(cookie));if(insecure.length)add('SEC-COOKIE-001','high','Cookies are missing Secure',`Missing Secure: ${cookieNames(insecure)}.`,'Mark session and sensitive cookies Secure.');
  const scriptReadable=cookies.filter(cookie=>!/(?:^|;)\s*HttpOnly(?:;|$)/i.test(cookie));if(scriptReadable.length)add('SEC-COOKIE-002','medium','Cookies may be missing HttpOnly',`Missing HttpOnly: ${cookieNames(scriptReadable)}.`,'Mark cookies not required by JavaScript as HttpOnly.',.75);
  const noSameSite=cookies.filter(cookie=>!/(?:^|;)\s*SameSite\s*=/i.test(cookie));if(noSameSite.length)add('SEC-COOKIE-003','medium','Cookie SameSite policy is not explicit',`Missing SameSite: ${cookieNames(noSameSite)}.`,'Set SameSite=Lax or Strict unless a documented cross-site flow requires None; Secure.',.8);
  if(h['server']||h['x-powered-by'])findings.push(createFinding({...base,ruleId:'SEC-DISCLOSURE-001',category:'security',severity:'low',title:'Technology disclosure headers are visible',observation:`Observed ${[h['server']?'Server':'',h['x-powered-by']?'X-Powered-By':''].filter(Boolean).join(' and ')}.`,impactHypothesis:'Version or platform disclosure can assist reconnaissance but is not a vulnerability alone.',impactStatus:'informational',probableCause:'Default server/framework headers remain enabled.',recommendation:'Remove unnecessary disclosure headers without treating this as a substitute for patching.',acceptanceCriteria:['Unnecessary framework header is removed','Patch management remains in place'],confidence:1}));
  const penalty=findings.reduce((sum,item)=>sum+({critical:30,high:14,medium:7,low:2,info:0}[item.severity]),0);
  return {findings,score:Math.max(0,100-penalty)};
}

export async function inspectTls(origin:string):Promise<Record<string,unknown>> {
  const url=new URL(origin);if(url.protocol!=='https:')throw new Error('Origin does not use HTTPS');const target=await resolveTarget(origin);
  return new Promise((resolve,reject)=>{const socket=tls.connect({host:target.address,port:Number(url.port||443),servername:url.hostname,rejectUnauthorized:true,timeout:10_000},()=>{const cert=socket.getPeerCertificate();resolve({secure:true,authorized:socket.authorized,protocol:socket.getProtocol(),cipher:socket.getCipher(),validFrom:cert.valid_from,validTo:cert.valid_to,subject:cert.subject,issuer:cert.issuer,fingerprint256:cert.fingerprint256,address:target.address});socket.end()});socket.on('error',reject);socket.on('timeout',()=>{socket.destroy();reject(new Error('TLS inspection timed out'))})});
}

export async function runZapBaseline(origin:string, pageUrls:string[]):Promise<Record<string,unknown>|null>{
  if(!config.zapApiUrl)return null;
  const hostname=new URL(origin).hostname;
  const urls=[...new Set(pageUrls)].filter(value=>{try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&url.hostname===hostname}catch{return false}}).slice(0,30);
  if(!urls.length)throw new Error('ZAP passive baseline has no in-scope pages');
  const proxy=await getAuditProxy();
  await zapJson<Record<string,unknown>>('network/action/setHttpProxy',{host:config.auditProxyAdvertiseHost,port:String(proxy.port),realm:'',username:'',password:''});
  await zapJson<Record<string,unknown>>('network/action/setHttpProxyEnabled',{enabled:'true'});
  // accessUrl performs one explicit GET. We intentionally do not invoke ZAP's
  // spider or active scanner because they can submit forms or mutate a target.
  for(const url of urls)await zapJson<Record<string,unknown>>('core/action/accessUrl',{url,followRedirects:'false'});
  for(let i=0;i<60;i+=1){const pending=await zapJson<{recordsToScan?:string}>('pscan/view/recordsToScan');if(Number(pending.recordsToScan)<=0)break;if(i===59)throw new Error('ZAP passive queue timed out');await new Promise(r=>setTimeout(r,1000))}
  const origins=[...new Set(urls.map(value=>new URL(value).origin))];
  const alerts:Array<Record<string,unknown>>=[];
  for(const baseurl of origins){const result=await zapJson<{alerts?:Array<Record<string,unknown>>}>('core/view/alerts',{baseurl,start:'0',count:'500'});alerts.push(...(result.alerts??[]))}
  const unique=[...new Map(alerts.map(alert=>[[alert.pluginId,alert.url,alert.param,alert.evidence].map(String).join('\u0000'),alert])).values()];
  return {mode:'passive-get-only',requestedUrls:urls,alerts:unique};
}
async function zapJson<T>(path:string,parameters:Record<string,string>={}):Promise<T>{
  if(!config.zapApiUrl)throw new Error('ZAP API URL is not configured');
  const url=new URL(`/JSON/${path}/`,config.zapApiUrl);url.search=new URLSearchParams({apikey:config.zapApiKey??'',...parameters}).toString();
  const response=await fetch(url,{signal:AbortSignal.timeout(15_000)});if(!response.ok)throw new Error(`ZAP API ${response.status}`);return response.json() as Promise<T>
}
function lower(headers:Record<string,string>):Record<string,string>{return Object.fromEntries(Object.entries(headers).map(([k,v])=>[k.toLowerCase(),v]))}
