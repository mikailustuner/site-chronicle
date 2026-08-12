import { z } from 'zod';
import type { Database } from './db.js';

const EventSchema = z.object({
  metric: z.enum(['page_view', 'LCP', 'CLS', 'INP', 'FCP', 'TTFB']),
  value: z.number().finite().min(0).max(10_000_000),
  path: z.string().max(2048).default('/'),
  rating: z.enum(['good', 'needs-improvement', 'poor']).nullable().optional(),
  referrerHost: z.string().max(255).nullable().optional(),
  device: z.enum(['mobile', 'desktop', 'tablet', 'unknown']).default('unknown'),
});

const minuteCounts = new Map<string, { minute: number; count: number }>();

export async function collectTelemetry(input: {
  database: Database;
  key: string;
  requestOrigin?: string;
  body: unknown;
}): Promise<'accepted' | 'not_found' | 'origin_rejected' | 'rate_limited'> {
  const rows = await input.database<Array<{ id: string; origin: string; telemetry_enabled: boolean }>>`
    SELECT id,origin,telemetry_enabled FROM domains WHERE telemetry_key=${input.key} AND archived_at IS NULL
  `;
  const domain = rows[0];
  if (!domain || !domain.telemetry_enabled) return 'not_found';
  if (!input.requestOrigin || normalizeOrigin(input.requestOrigin) !== normalizeOrigin(domain.origin)) return 'origin_rejected';
  if (!consume(input.key)) return 'rate_limited';
  const raw = typeof input.body === 'string' ? JSON.parse(input.body) : input.body;
  const event = EventSchema.parse(raw);
  const path = safePath(event.path);
  await input.database`
    INSERT INTO telemetry_samples (domain_id,path,metric,value,rating,referrer_host,device)
    VALUES (${domain.id},${path},${event.metric},${event.value},${event.rating ?? null},${event.referrerHost ?? null},${event.device})
  `;
  return 'accepted';
}

export function trackerScript(endpoint: string): string {
  return `(()=>{'use strict';const E=${JSON.stringify(endpoint)},D=innerWidth<768?'mobile':innerWidth<1100?'tablet':'desktop';let R=null;try{R=document.referrer?new URL(document.referrer).hostname:null}catch{}const rate=(n,v)=>{const t=n==='LCP'?[2500,4000]:n==='CLS'?[.1,.25]:n==='INP'?[200,500]:n==='FCP'?[1800,3000]:[800,1800];return v<=t[0]?'good':v>t[1]?'poor':'needs-improvement'},send=(metric,value,rating=null)=>{try{navigator.sendBeacon(E,new Blob([JSON.stringify({metric,value,path:location.pathname||'/',rating,referrerHost:R,device:D})],{type:'text/plain'}))}catch{}};send('page_view',1);try{const n=performance.getEntriesByType('navigation')[0];if(n&&n.responseStart>=0)send('TTFB',n.responseStart,rate('TTFB',n.responseStart))}catch{}let l=0,c=0,i=0;try{new PerformanceObserver(x=>{for(const e of x.getEntries())l=Math.max(l,e.startTime)}).observe({type:'largest-contentful-paint',buffered:true})}catch{}try{new PerformanceObserver(x=>{for(const e of x.getEntries())if(!e.hadRecentInput)c+=e.value}).observe({type:'layout-shift',buffered:true})}catch{}try{new PerformanceObserver(x=>{for(const e of x.getEntries())i=Math.max(i,e.duration||0)}).observe({type:'event',buffered:true,durationThreshold:40})}catch{}try{new PerformanceObserver(x=>{for(const e of x.getEntries())if(e.name==='first-contentful-paint')send('FCP',e.startTime,rate('FCP',e.startTime))}).observe({type:'paint',buffered:true})}catch{}let done=false;const flush=()=>{if(done)return;done=true;if(l)send('LCP',l,rate('LCP',l));send('CLS',c,rate('CLS',c));if(i)send('INP',i,rate('INP',i))};addEventListener('pagehide',flush,{once:true});document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flush()},{once:true})})();`;
}

function consume(key: string): boolean {
  const minute = Math.floor(Date.now() / 60_000);
  const current = minuteCounts.get(key);
  if (!current || current.minute !== minute) {
    minuteCounts.set(key, { minute, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= 2_000;
}

function normalizeOrigin(value: string): string {
  try { return new URL(value).origin; } catch { return ''; }
}

function safePath(value: string): string {
  const path = value.split('?')[0]!.split('#')[0]!.trim();
  return path.startsWith('/') ? path.slice(0, 2048) : '/';
}
