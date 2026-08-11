export function median(values:number[]):number{if(!values.length)return 0;const sorted=[...values].sort((a,b)=>a-b);const middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]!:(sorted[middle-1]!+sorted[middle]!)/2}
export { newId } from '@sitechronicle/core';
export type { CategoryScore, ResourceSnapshot, ScanProfile } from '@sitechronicle/core';
