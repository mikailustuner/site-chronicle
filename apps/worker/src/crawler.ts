import { load } from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import { gunzipSync } from 'node:zlib';
import { classifyPageTemplate, normalizeUrl, sameSite, sha256, type ScanProfile } from '@sitechronicle/core';
import { safeFetch } from './security/target.js';

export interface CrawledPage {
  url: string; normalizedUrl: string; finalUrl: string; statusCode: number; headers: Record<string,string>; html: string;
  title: string; description: string; canonical: string; h1: string[]; language: string; robots: string; contentHash: string;
  template: ReturnType<typeof classifyPageTemplate>; links: string[]; setCookies?: string[];
}

export interface CrawlResult { pages: CrawledPage[]; robots: { url:string; text:string; status:number }; sitemaps: Array<{url:string;text:string;status:number}>; warnings:string[] }

const xmlParser = new XMLParser({ ignoreAttributes: false, trimValues: true });

export async function crawlSite(origin: string, profile: ScanProfile, onProgress?: (message:string)=>void): Promise<CrawlResult> {
  const warnings: string[] = [];
  const robotsUrl = new URL('/robots.txt', origin).toString();
  const robotsResponse = await safeFetch(robotsUrl, { maxBytes: 1_000_000, allowedScope:origin }).then((result) => {
    if (!sameSite(result.finalUrl, origin)) throw new Error(`Cross-host redirect blocked: ${result.finalUrl}`);
    return result;
  }).catch((error) => { warnings.push(`robots.txt: ${String(error)}`); return null; });
  const robotsText = robotsResponse ? new TextDecoder().decode(robotsResponse.body) : '';
  const robots = { url: robotsUrl, text: robotsText, status: robotsResponse?.response.status ?? 0 };
  const robotRules = profile.respectRobots ? parseRobotsRules(robotsText) : [];
  const sitemapUrls = parseSitemapDirectives(robotsText);
  if (!sitemapUrls.length) sitemapUrls.push(new URL('/sitemap.xml', origin).toString());
  const sitemaps: CrawlResult['sitemaps'] = [];
  const discovered = new Set<string>([normalizeUrl(origin)]);
  const sitemapQueue = sitemapUrls.slice(0,10);const seenSitemaps=new Set<string>();
  while (sitemapQueue.length && sitemaps.length < 30 && discovered.size < profile.maxUrls) {
    const sitemapUrl = sitemapQueue.shift()!;
    if(seenSitemaps.has(sitemapUrl))continue;seenSitemaps.add(sitemapUrl);
    if (!sameSite(sitemapUrl, origin)) { warnings.push(`External sitemap skipped: ${sitemapUrl}`); continue; }
    const response = await safeFetch(sitemapUrl, { maxBytes: 15_000_000, allowedScope:origin }).then((result) => {
      if (!sameSite(result.finalUrl, origin)) throw new Error(`Cross-host redirect blocked: ${result.finalUrl}`);
      return result;
    }).catch((error) => { warnings.push(`Sitemap ${sitemapUrl}: ${String(error)}`); return null; });
    if (!response) continue;
    let text:string;try{const sitemapBody=/\.gz(?:$|\?)/i.test(sitemapUrl)?gunzipSync(response.body,{maxOutputLength:50_000_000}):response.body;text=new TextDecoder().decode(sitemapBody)}catch(error){warnings.push(`Sitemap ${sitemapUrl}: ${String(error)}`);continue}
    sitemaps.push({ url:sitemapUrl,text,status:response.response.status });
    for (const location of extractSitemapLocations(text)) {
      if (!sameSite(location, origin)) continue;
      if (/\.xml(?:\.gz)?(?:$|\?)/i.test(location) && sitemapQueue.length < 30) sitemapQueue.push(location);
      else if (!isDisallowed(location, robotRules)) discovered.add(normalizeUrl(location));
      if (discovered.size >= profile.maxUrls) break;
    }
  }

  const pages: CrawledPage[] = [];
  const queue = [...discovered];const enqueued=new Set(queue);
  const seen = new Set<string>();
  while (queue.length && pages.length < profile.maxUrls) {
    const url = queue.shift()!;
    if (seen.has(url) || isDisallowed(url, robotRules)) continue;
    seen.add(url);
    onProgress?.(`Crawling ${pages.length + 1}/${Math.min(profile.maxUrls, queue.length + pages.length + 1)}: ${url}`);
    const response = await safeFetch(url, { maxBytes: 10_000_000, allowedScope:origin }).catch((error) => { warnings.push(`${url}: ${String(error)}`); return null; });
    if (!response) continue;
    if (!sameSite(response.finalUrl, origin)) { warnings.push(`${url}: Cross-host redirect blocked: ${response.finalUrl}`); continue; }
    const contentType = response.response.headers.get('content-type') ?? '';
    if (!contentType.includes('html')) continue;
    const html = new TextDecoder().decode(response.body);
    const page = parsePage(url, response.finalUrl, response.response.status, response.response.headers, html, response.setCookies);
    pages.push(page);
    if (pages.length < profile.maxUrls) for (const link of page.links) if (enqueued.size<profile.maxUrls&&!enqueued.has(link)&&sameSite(link,origin)&&!isDisallowed(link,robotRules)){queue.push(link);enqueued.add(link)}
    const delay = Math.round(1000 / profile.crawlRatePerSecond);
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  }
  return { pages, robots, sitemaps, warnings };
}

function parsePage(url:string, finalUrl:string, statusCode:number, headers:Headers, html:string, setCookies:string[]): CrawledPage {
  const $ = load(html);
  const links = $('a[href]').map((_,element) => { try { return normalizeUrl($(element).attr('href')!, finalUrl); } catch { return null; } }).get().filter(Boolean);
  const title = $('title').first().text().trim();
  return {
    url, normalizedUrl:normalizeUrl(finalUrl), finalUrl, statusCode, headers:Object.fromEntries(headers.entries()), html,
    title, description:$('meta[name="description" i]').attr('content')?.trim() ?? '', canonical:resolveMaybe($('link[rel="canonical" i]').attr('href'),finalUrl),
    h1:$('h1').map((_,element)=>$(element).text().replace(/\s+/g,' ').trim()).get().filter(Boolean), language:$('html').attr('lang')?.trim() ?? '', robots:$('meta[name="robots" i]').attr('content')?.trim() ?? '',
    contentHash:sha256(normalizeHtml(html)), template:classifyPageTemplate(finalUrl,title,$('body').attr('class') ?? ''), links:[...new Set(links)], setCookies,
  };
}
function resolveMaybe(value:string|undefined,base:string):string { if(!value)return ''; try{return normalizeUrl(value,base)}catch{return value} }
function normalizeHtml(html:string):string { return html.replace(/nonce="[^"]+"/gi,'nonce="#"').replace(/\b(?:session|request|csrf)[-_]?id["'=:\s]+[a-z0-9_-]+/gi,'dynamic-id').replace(/\s+/g,' ').trim(); }
function parseSitemapDirectives(text:string):string[] { return text.split(/\r?\n/).map(line=>line.match(/^\s*Sitemap:\s*(\S+)/i)?.[1]).filter((value):value is string=>Boolean(value)); }
interface RobotRule { pattern:string;allow:boolean }
function parseRobotsRules(text:string):RobotRule[] {
  const groups:Array<{agents:string[];rules:RobotRule[]}> = [];
  let agents:string[]=[];let rules:RobotRule[]=[];
  const flush=()=>{if(agents.length||rules.length)groups.push({agents,rules});agents=[];rules=[]};
  for(const raw of text.split(/\r?\n/)){
    const line=raw.replace(/#.*/,'').trim();if(!line)continue;
    const ua=line.match(/^User-agent:\s*(.+)$/i);if(ua){if(rules.length)flush();agents.push(ua[1]!.trim().toLowerCase());continue}
    const directive=line.match(/^(Allow|Disallow):\s*(.*)$/i);if(!directive||!agents.length)continue;
    const pattern=directive[2]!.trim();if(pattern)rules.push({pattern,allow:directive[1]!.toLowerCase()==='allow'});
  }
  flush();const exact=groups.filter(group=>group.agents.includes('sitechronicle'));return(exact.length?exact:groups.filter(group=>group.agents.includes('*'))).flatMap(group=>group.rules);
}
function isDisallowed(url:string,rules:RobotRule[]):boolean {
  const parsed=new URL(url);const value=`${parsed.pathname}${parsed.search}`;
  const matches=rules.filter(rule=>robotPattern(rule.pattern).test(value)).sort((left,right)=>right.pattern.length-left.pattern.length||Number(right.allow)-Number(left.allow));
  return matches[0]?.allow===false;
}
function robotPattern(pattern:string):RegExp {
  const anchored=pattern.endsWith('$');const body=(anchored?pattern.slice(0,-1):pattern).replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*');
  return new RegExp(`^${body}${anchored?'$':''}`);
}
function extractSitemapLocations(xml:string):string[] { try { const doc=xmlParser.parse(xml) as Record<string,unknown>; const root=(doc.urlset ?? doc.sitemapindex) as Record<string,unknown>|undefined; const items=(root?.url ?? root?.sitemap) as unknown; const array=Array.isArray(items)?items:items?[items]:[]; return array.map(item=>typeof item==='object'&&item?String((item as Record<string,unknown>).loc??''):'').filter(Boolean); } catch { return [...xml.matchAll(/<loc[^>]*>([^<]+)<\/loc>/gi)].map(match=>match[1]!.trim()); } }
