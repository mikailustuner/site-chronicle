import type { Database } from '../db.js';
import { decryptCredentials, type ConnectorCredentials } from './secrets.js';

export interface SerpRequest { query:string; location:string; country:string; language:string; device:'mobile'|'desktop'; depth:number }
export interface SerpItem { type:string; rankAbsolute:number|null; rankGroup:number|null; domain:string; url:string|null; title:string; snippet:string; payload:Record<string,unknown> }
export interface SerpResponse { provider:string; observedAt:Date; items:SerpItem[]; features:SerpItem[]; raw:Record<string,unknown>; externalReference?:string; cost:number }

export async function loadSerpConnector(database:Database,id:string):Promise<{id:string;provider:string;credentials:ConnectorCredentials;config:Record<string,unknown>;dailyBudget:number;monthlyBudget:number}> {
  const rows=await database<Array<Record<string,unknown>>>`SELECT * FROM connector_configs WHERE id=${id} AND enabled=true AND provider IN ('dataforseo','serpapi') AND (circuit_open_until IS NULL OR circuit_open_until<now())`;
  const row=rows[0];if(!row)throw new Error('SERP connector is disabled or circuit-open');if(!row.encrypted_credentials)throw new Error('SERP connector credentials are not configured');
  return{id:String(row.id),provider:String(row.provider),credentials:decryptCredentials(String(row.encrypted_credentials)),config:(row.config??{}) as Record<string,unknown>,dailyBudget:Number(row.daily_budget??0),monthlyBudget:Number(row.monthly_budget??0)};
}

export async function assertBudget(database:Database,connector:{id:string;dailyBudget:number;monthlyBudget:number},estimatedCost:number):Promise<void>{
  const rows=await database<Array<{day:number;month:number}>>`SELECT COALESCE(sum(actual_cost) FILTER(WHERE started_at>=date_trunc('day',now())),0)::double precision AS day,COALESCE(sum(actual_cost) FILTER(WHERE started_at>=date_trunc('month',now())),0)::double precision AS month FROM connector_runs WHERE connector_id=${connector.id}`;
  const spent=rows[0]??{day:0,month:0};if(connector.dailyBudget>0&&Number(spent.day)+estimatedCost>connector.dailyBudget)throw new Error('SERP connector daily budget would be exceeded');if(connector.monthlyBudget>0&&Number(spent.month)+estimatedCost>connector.monthlyBudget)throw new Error('SERP connector monthly budget would be exceeded');
}

export async function fetchSerp(connector:Awaited<ReturnType<typeof loadSerpConnector>>,request:SerpRequest):Promise<SerpResponse>{
  return connector.provider==='dataforseo'?fetchDataForSeo(connector.credentials,request):fetchSerpApi(connector.credentials,request);
}

async function fetchDataForSeo(credentials:ConnectorCredentials,input:SerpRequest):Promise<SerpResponse>{
  const auth=Buffer.from(`${credentials.login}:${credentials.password}`).toString('base64');
  const response=await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/advanced',{method:'POST',headers:{authorization:`Basic ${auth}`,'content-type':'application/json'},body:JSON.stringify([{keyword:input.query,location_name:input.location,language_code:input.language,device:input.device,os:input.device==='mobile'?'android':'windows',depth:input.depth}]),signal:AbortSignal.timeout(90_000)});
  const raw=await response.json() as Record<string,unknown>;if(response.status===429)throw Object.assign(new Error('DataForSEO rate limited'),{rateLimited:true});if(!response.ok)throw new Error(`DataForSEO ${response.status}`);
  const tasks=(raw.tasks??[]) as Array<Record<string,unknown>>;const task=tasks[0]??{};if(Number(task.status_code??0)>=40000)throw new Error(`DataForSEO task ${task.status_code}: ${String(task.status_message??'failed')}`);const result=((task.result??[]) as Array<Record<string,unknown>>)[0]??{};const rawItems=(result.items??[]) as Array<Record<string,unknown>>;const parsed=normalizeItems(rawItems);
  return{provider:'dataforseo',observedAt:new Date(String(result.datetime??new Date().toISOString())),items:parsed.items,features:parsed.features,raw,...(task.id?{externalReference:String(task.id)}:{}),cost:Number(task.cost??0)};
}

async function fetchSerpApi(credentials:ConnectorCredentials,input:SerpRequest):Promise<SerpResponse>{
  const url=new URL('https://serpapi.com/search.json');url.searchParams.set('engine','google');url.searchParams.set('q',input.query);url.searchParams.set('location',input.location);url.searchParams.set('hl',input.language);url.searchParams.set('gl',input.country.toLowerCase());url.searchParams.set('device',input.device);url.searchParams.set('num',String(Math.min(input.depth,100)));url.searchParams.set('api_key',credentials.apiKey);
  const response=await fetch(url,{signal:AbortSignal.timeout(90_000)});const raw=await response.json() as Record<string,unknown>;if(response.status===429)throw Object.assign(new Error('SerpApi rate limited'),{rateLimited:true});if(!response.ok)throw new Error(`SerpApi ${response.status}: ${String(raw.error??'failed')}`);
  const organic=((raw.organic_results??[]) as Array<Record<string,unknown>>).map((item,index)=>({type:'organic',rankAbsolute:Number(item.position??index+1),rankGroup:Number(item.position??index+1),domain:hostname(String(item.link??'')),url:item.link?String(item.link):null,title:String(item.title??''),snippet:String(item.snippet??''),payload:item}));
  const features:ObjectEntries=[];for(const [key,value] of Object.entries(raw)){if(['organic_results','search_metadata','search_parameters','search_information','pagination','serpapi_pagination'].includes(key)||!value)continue;if(Array.isArray(value)||typeof value==='object')features.push([key,value])}
  return{provider:'serpapi',observedAt:new Date(String((raw.search_metadata as Record<string,unknown>|undefined)?.created_at??new Date().toISOString())),items:organic,features:features.map(([type,payload])=>({type,rankAbsolute:null,rankGroup:null,domain:'',url:null,title:type,snippet:'',payload:{value:payload}})),raw,externalReference:String((raw.search_metadata as Record<string,unknown>|undefined)?.id??''),cost:1};
}

type ObjectEntries=Array<[string,unknown]>;
function normalizeItems(rawItems:Array<Record<string,unknown>>):{items:SerpItem[];features:SerpItem[]}{const items:SerpItem[]=[];const features:SerpItem[]=[];for(const item of rawItems){const type=String(item.type??'unknown');const url=item.url?String(item.url):null;const normalized={type,rankAbsolute:numberOrNull(item.rank_absolute),rankGroup:numberOrNull(item.rank_group),domain:String(item.domain??hostname(url??'')),url,title:String(item.title??''),snippet:String(item.description??item.snippet??''),payload:item};if(type==='organic')items.push(normalized);else features.push(normalized)}return{items,features}}
function hostname(value:string):string{try{return new URL(value).hostname.toLowerCase().replace(/^www\./,'')}catch{return''}}
function numberOrNull(value:unknown):number|null{const n=Number(value);return Number.isFinite(n)&&n>0?n:null}
