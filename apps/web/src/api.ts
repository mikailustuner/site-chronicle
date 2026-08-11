export class ApiError extends Error {
  constructor(public readonly status:number,public readonly payload:unknown){super(typeof payload==='object'&&payload&&'error' in payload?String((payload as {error:unknown}).error):`HTTP ${status}`)}
}
export async function api<T>(path:string,options:RequestInit={}):Promise<T>{const response=await fetch(path,{credentials:'same-origin',...options,headers:{...(options.body?{'content-type':'application/json'}:{}),...options.headers}});const type=response.headers.get('content-type')??'';const payload=type.includes('json')?await response.json():await response.text();if(!response.ok)throw new ApiError(response.status,payload);return payload as T}
export function post<T>(path:string,body:unknown):Promise<T>{return api(path,{method:'POST',body:JSON.stringify(body)})}
export function patch<T>(path:string,body:unknown):Promise<T>{return api(path,{method:'PATCH',body:JSON.stringify(body)})}
