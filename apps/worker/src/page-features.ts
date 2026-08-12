import { load } from 'cheerio';
import { normalizeUrl } from '@sitechronicle/core';
import type { Database } from './db.js';
import type { CrawledPage } from './crawler.js';

interface FeaturePage { page:CrawledPage;pageId:string;htmlEvidenceId:string }

export async function refreshPageFeatures(database:Database,input:{domainId:string;auditId:string;origin:string;pages:FeaturePage[]}):Promise<void>{
  const sourceKind=`audit:${input.auditId}`;const observedAt=new Date();
  await database`DELETE FROM page_features WHERE domain_id=${input.domainId} AND source_kind=${sourceKind}`;
  const byUrl=new Map(input.pages.map(item=>[safeNormalize(item.page.finalUrl),item]));
  const inlinks=new Map<string,number>();const edges=new Map<string,string[]>();
  for(const item of input.pages){
    const from=safeNormalize(item.page.finalUrl);const targets=[...new Set(item.page.links.map(safeNormalize).filter(url=>byUrl.has(url)))];edges.set(from,targets);
    for(const target of targets)inlinks.set(target,(inlinks.get(target)??0)+1);
  }
  const depth=calculateDepth(safeNormalize(input.origin),edges);
  for(const item of input.pages){
    const $=load(item.page.html);$('script,style,noscript,svg,template').remove();
    const text=$('main,article,body').first().text().replace(/\s+/g,' ').trim();const pageUrl=safeNormalize(item.page.finalUrl);
    const headings=$('h1,h2,h3').map((_,node)=>$(node).text().replace(/\s+/g,' ').trim()).get().filter(Boolean).slice(0,150);
    const topics=topTerms(text);const entities=surfaceEntities(text);const schemaTypes=extractSchemaTypes(load(item.page.html));
    await database`INSERT INTO page_features(id,domain_id,page_url,source_kind,title,headings,entities,topics,intent,word_count,internal_inlinks,crawl_depth,schema_types,evidence_ids,observed_at)
      VALUES(${'pageFeature_'+item.pageId},${input.domainId},${pageUrl},${sourceKind},${item.page.title},${database.json(headings as never)},${database.json(entities as never)},${database.json(topics as never)},${inferPageIntent(item.page)},${countWords(text)},${inlinks.get(pageUrl)??0},${depth.get(pageUrl)??null},${database.json(schemaTypes as never)},${database.json([item.htmlEvidenceId,`page:${item.pageId}`] as never)},${observedAt})`;
  }
}

function calculateDepth(root:string,edges:Map<string,string[]>):Map<string,number>{const result=new Map<string,number>([[root,0]]);const queue=[root];while(queue.length){const current=queue.shift()!;const nextDepth=(result.get(current)??0)+1;for(const target of edges.get(current)??[]){if(result.has(target))continue;result.set(target,nextDepth);queue.push(target)}}return result}
function safeNormalize(value:string):string{try{return normalizeUrl(value)}catch{return value}}
function countWords(text:string):number{return(text.match(/[\p{L}\p{N}]+/gu)??[]).length}
function inferPageIntent(page:CrawledPage):string{if(['product','category','cart','checkout'].includes(page.template))return'commercial';if(page.template==='content')return'informational';if(/contact|iletisim|iletişim|location|konum/i.test(page.finalUrl))return'local';return'unknown'}
function topTerms(text:string):Array<{term:string;mentions:number}>{const stop=new Set(['the','and','for','with','this','that','from','your','you','are','bir','ile','için','ve','bu','şu','da','de','çok','daha','olarak','olan','ama']);const counts=new Map<string,number>();for(const word of text.toLocaleLowerCase('tr-TR').match(/[\p{L}\p{N}]{3,}/gu)??[]){if(stop.has(word))continue;counts.set(word,(counts.get(word)??0)+1)}return[...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,60).map(([term,mentions])=>({term,mentions}))}
function surfaceEntities(text:string):Array<{label:string;mentions:number;method:string}>{const counts=new Map<string,number>();for(const match of text.matchAll(/(?:^|[.!?]\s+)([A-ZÇĞİÖŞÜ][\p{L}\p{N}&'-]+(?:\s+[A-ZÇĞİÖŞÜ][\p{L}\p{N}&'-]+){0,3})/gu)){const label=match[1]!.trim();if(label.length<3)continue;counts.set(label,(counts.get(label)??0)+1)}return[...counts].sort((a,b)=>b[1]-a[1]).slice(0,40).map(([label,mentions])=>({label,mentions,method:'capitalized-phrase'}))}
function extractSchemaTypes($:ReturnType<typeof load>):string[]{const types=new Set<string>();$('script[type="application/ld+json"]').each((_,node)=>{try{walk(JSON.parse($(node).text()))}catch{}});function walk(value:unknown):void{if(Array.isArray(value)){value.forEach(walk);return}if(!value||typeof value!=='object')return;const row=value as Record<string,unknown>;const type=row['@type'];if(typeof type==='string')types.add(type);else if(Array.isArray(type))type.forEach(item=>types.add(String(item)));Object.values(row).forEach(walk)}return[...types].slice(0,50)}
