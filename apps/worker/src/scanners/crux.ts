import { config } from '../config.js';

export async function fetchCrux(origin:string):Promise<Record<string,unknown>|null>{
  if(!config.cruxApiKey)return null;const response=await fetch(`https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${encodeURIComponent(config.cruxApiKey)}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({origin,formFactor:'PHONE',metrics:['largest_contentful_paint','interaction_to_next_paint','cumulative_layout_shift','first_contentful_paint','experimental_time_to_first_byte']}),signal:AbortSignal.timeout(20_000)});if(response.status===404)return null;if(!response.ok)throw new Error(`CrUX API ${response.status}`);return response.json() as Promise<Record<string,unknown>>;
}
