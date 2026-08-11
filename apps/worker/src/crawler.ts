import { load } from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import { classifyPageTemplate, normalizeUrl, sameSite, sha256, type ScanProfile } from '@sitechronicle/core';
import { safeFetch } from './security/target.js';

export interface CrawledPage {
  url: string; normalizedUrl: string; finalUrl: string; statusCode: number; headers: Record<string,string>; html: string;
  title: string; description: string; canonical: string; h1: string[]; language: string; robots: string; contentHash: string;
  template: ReturnType<typeof classifyPageTemplate>; links: string[];
}

export interface CrawlResult { pages: CrawledPage[]; robots: { url:string; text:string; status:number }; sitemaps: Array<{url:string;text:string;status:number}>; warnings:string[] }

const xmlParser = new XMLParser({ ignoreAttributes: false, trimValues: true });

export async function crawlSite(origin: string, profile: ScanProfile, onProgress?: (message:string)=>void): Promise<CrawlResult> {
  const warnings: string[] = [];
  const robotsUrl = new URL('/robots.txt', origin).toString();
  const robotsResponse = await safeFetch(robotsUrl, { maxBytes: 1_000_000 }).catch((error) => { warnings.push(`robots.txt: ${String(error)}`); return null; });
  const robotsText = robotsResponse ? new TextDecoder().decode(robotsResponse.body) : '';
  const robots = { url: robotsUrl, text: robotsText, status: robotsResponse?.response.status ?? 0 };
  const disallows = profile.respectRobots ? parseRobotsDisallow(robotsText) : [];
  const sitemapUrls = parseSitemapDirectives(robotsText);
  if (!sitemapUrls.length) sitemapUrls.push(new URL('/sitemap.xml', origin).toString());
  const sitemaps: CrawlResult['sitemaps'] = [];
  const discovered = new Set<string>([normalizeUrl(origin)]);
  const sitemapQueue = sitemapUrls.slice(0,10);
  while (sitemapQueue.length && sitemaps.length < 30 && discovered.size < profile.maxUrls) {
    const sitemapUrl = sitemapQueue.shift()!;
    if (!sameSite(sitemapUrl, origin)) { warnings.push(`External sitemap skipped: ${sitemapUrl}`); continue; }
    const response = await safeFetch(sitemapUrl, { maxBytes: 15_000_000 }).catch((error) => { warnings.push(`Sitemap ${sitemapUrl}: ${String(error)}`); return null; });
    if (!response) continue;
    const text = new TextDecoder().decode(response.body);
    sitemaps.push({ url:sitemapUrl,text,status:response.response.status });
    for (const location of extractSitemapLocations(text)) {
      if (!sameSite(location, origin)) continue;
      if (/\.xml(?:\.gz)?(?:$|\?)/i.test(location) && sitemapQueue.length < 30) sitemapQueue.push(location);
      else if (!isDisallowed(location, disallows)) discovered.add(normalizeUrl(location));
      if (discovered.size >= profile.maxUrls) break;
    }
  }

  const pages: CrawledPage[] = [];
  const queue = [...discovered];
  const seen = new Set<string>();
  while (queue.length && pages.length < profile.maxUrls) {
    const url = queue.shift()!;
    if (seen.has(url) || isDisallowed(url, disallows)) continue;
    seen.add(url);
    onProgress?.(`Crawling ${pages.length + 1}/${Math.min(profile.maxUrls, queue.length + pages.length + 1)}: ${url}`);
    const response = await safeFetch(url, { maxBytes: 10_000_000 }).catch((error) => { warnings.push(`${url}: ${String(error)}`); return null; });
    if (!response) continue;
    const contentType = response.response.headers.get('content-type') ?? '';
    if (!contentType.includes('html')) continue;
    const html = new TextDecoder().decode(response.body);
    const page = parsePage(url, response.finalUrl, response.response.status, response.response.headers, html);
    pages.push(page);
    if (pages.length < Math.min(profile.maxUrls, 50)) for (const link of page.links) if (!seen.has(link) && sameSite(link, origin) && !isDisallowed(link, disallows)) queue.push(link);
    const delay = Math.round(1000 / profile.crawlRatePerSecond);
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  }
  return { pages, robots, sitemaps, warnings };
}

function parsePage(url:string, finalUrl:string, statusCode:number, headers:Headers, html:string): CrawledPage {
  const $ = load(html);
  const links = $('a[href]').map((_,element) => { try { return normalizeUrl($(element).attr('href')!, finalUrl); } catch { return null; } }).get().filter(Boolean);
  const title = $('title').first().text().trim();
  return {
    url, normalizedUrl:normalizeUrl(finalUrl), finalUrl, statusCode, headers:Object.fromEntries(headers.entries()), html,
    title, description:$('meta[name="description" i]').attr('content')?.trim() ?? '', canonical:resolveMaybe($('link[rel="canonical" i]').attr('href'),finalUrl),
    h1:$('h1').map((_,element)=>$(element).text().replace(/\s+/g,' ').trim()).get().filter(Boolean), language:$('html').attr('lang')?.trim() ?? '', robots:$('meta[name="robots" i]').attr('content')?.trim() ?? '',
    contentHash:sha256(normalizeHtml(html)), template:classifyPageTemplate(finalUrl,title,$('body').attr('class') ?? ''), links:[...new Set(links)],
  };
}
function resolveMaybe(value:string|undefined,base:string):string { if(!value)return ''; try{return normalizeUrl(value,base)}catch{return value} }
function normalizeHtml(html:string):string { return html.replace(/nonce="[^"]+"/gi,'nonce="#"').replace(/\b(?:session|request|csrf)[-_]?id["'=:\s]+[a-z0-9_-]+/gi,'dynamic-id').replace(/\s+/g,' ').trim(); }
function parseSitemapDirectives(text:string):string[] { return text.split(/\r?\n/).map(line=>line.match(/^\s*Sitemap:\s*(\S+)/i)?.[1]).filter((value):value is string=>Boolean(value)); }
function parseRobotsDisallow(text:string):string[] { let active=false; const values:string[]=[]; for(const raw of text.split(/\r?\n/)){const line=raw.replace(/#.*/,'').trim();const ua=line.match(/^User-agent:\s*(.+)$/i);if(ua){active=ua[1]!.trim()==='*';continue}const dis=line.match(/^Disallow:\s*(.*)$/i);if(active&&dis?.[1]?.trim())values.push(dis[1].trim())} return values; }
function isDisallowed(url:string,rules:string[]):boolean { const path=new URL(url).pathname; return rules.some(rule=>path.startsWith(rule.replace(/\*.*$/,''))); }
function extractSitemapLocations(xml:string):string[] { try { const doc=xmlParser.parse(xml) as Record<string,unknown>; const root=(doc.urlset ?? doc.sitemapindex) as Record<string,unknown>|undefined; const items=(root?.url ?? root?.sitemap) as unknown; const array=Array.isArray(items)?items:items?[items]:[]; return array.map(item=>typeof item==='object'&&item?String((item as Record<string,unknown>).loc??''):'').filter(Boolean); } catch { return [...xml.matchAll(/<loc[^>]*>([^<]+)<\/loc>/gi)].map(match=>match[1]!.trim()); } }
