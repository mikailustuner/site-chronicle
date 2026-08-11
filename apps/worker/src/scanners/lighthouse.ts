import { launch } from 'chrome-launcher';
import { median, newId, type CategoryScore, type ResourceSnapshot, type ScanProfile } from './math.js';
import { ArtifactStore } from '../artifacts.js';
import type { Database } from '../db.js';
import { config } from '../config.js';
import { chromium } from 'playwright';

export interface LighthouseDeviceResult {
  device:'mobile'|'desktop';scores:{performance:number;accessibility:number;bestPractices:number;seo:number};
  metrics:{fcpMs:number|null;lcpMs:number|null;tbtMs:number|null;cls:number|null;speedIndexMs:number|null;ttiMs:number|null;transferBytes:number|null;requests:number|null;lcpSelector:string};
  resources:ResourceSnapshot[];evidenceIds:string[];runs:number;
}

export async function runLighthouse(input:{database:Database;auditId:string;pageId:string;url:string;device:'mobile'|'desktop';profile:ScanProfile}):Promise<LighthouseDeviceResult>{
  const chrome=await launch({chromePath:config.chromePath??chromium.executablePath(),chromeFlags:['--headless=new','--disable-gpu','--disable-dev-shm-usage','--no-first-run'],logLevel:'silent'});const store=new ArtifactStore(input.database);const results:Array<{lhr:any;evidenceId:string}>=[];
  try{
    const lighthouse=(await import('lighthouse')).default;
    for(let run=0;run<input.profile.performanceRuns;run+=1){
      const options:any={port:chrome.port,output:'json',logLevel:'error',formFactor:input.device,onlyCategories:['performance','accessibility','best-practices','seo'],settings:{locale:'en-US',maxWaitForFcp:15_000,maxWaitForLoad:45_000,throttlingMethod:'simulate',screenEmulation:input.device==='mobile'?{mobile:true,width:390,height:844,deviceScaleFactor:1,disabled:false}:{mobile:false,width:1440,height:1000,deviceScaleFactor:1,disabled:false}}};
      const runner=await lighthouse(input.url,options);if(!runner)throw new Error('Lighthouse returned no result');const raw=JSON.stringify(runner.lhr);const evidence=await store.put({auditId:input.auditId,pageId:input.pageId,kind:'lighthouse',mimeType:'application/json',data:raw,extension:'json',pageUrl:input.url,metadata:{device:input.device,run:run+1}});results.push({lhr:runner.lhr,evidenceId:evidence.id});
    }
  }finally{await chrome.kill()}
  const lhrs=results.map(item=>item.lhr);const representative=lhrs[Math.floor(lhrs.length/2)]!;
  const score=(key:string)=>median(lhrs.map(lhr=>Number(lhr.categories?.[key]?.score??0)*100));const auditMetric=(key:string)=>medianNullable(lhrs.map(lhr=>numberOrNull(lhr.audits?.[key]?.numericValue)));
  const networkItems=(representative.audits?.['network-requests']?.details?.items??[]) as Array<Record<string,unknown>>;const resources:ResourceSnapshot[]=networkItems.map(item=>({url:String(item.url??''),type:String(item.resourceType??'other').toLowerCase(),transferBytes:Number(item.transferSize??0),encodedBytes:Number(item.resourceSize??0),status:Number(item.statusCode??0),thirdParty:safeHostname(String(item.url??''))!==safeHostname(input.url)})).filter(item=>Boolean(item.url));
  const lcpSelector=String(representative.audits?.['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node?.selector??'');
  return{device:input.device,scores:{performance:score('performance'),accessibility:score('accessibility'),bestPractices:score('best-practices'),seo:score('seo')},metrics:{fcpMs:auditMetric('first-contentful-paint'),lcpMs:auditMetric('largest-contentful-paint'),tbtMs:auditMetric('total-blocking-time'),cls:auditMetric('cumulative-layout-shift'),speedIndexMs:auditMetric('speed-index'),ttiMs:auditMetric('interactive'),transferBytes:auditMetric('total-byte-weight'),requests:networkItems.length,lcpSelector},resources,evidenceIds:results.map(item=>item.evidenceId),runs:results.length};
}

function numberOrNull(value:unknown):number|null{return typeof value==='number'&&Number.isFinite(value)?value:null}
function medianNullable(values:Array<number|null>):number|null{const numbers=values.filter((item):item is number=>item!==null);return numbers.length?median(numbers):null}
function safeHostname(value:string):string{try{return new URL(value).hostname}catch{return''}}
