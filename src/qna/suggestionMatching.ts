export interface SuggestionCandidate { label:string; detail:string; originalName?:string }
/** Preserve first occurrence and stable exact-match ordering without quadratic scans. */
export function matchSuggestionCandidates<T extends SuggestionCandidate>(items:T[],query:string,limit:number):T[] {
 const compact=(value:string)=>value.toLowerCase().replace(/\s+/g,'');
 const q=compact(query),seen=new Set<string>(),exact:T[]=[],partial:T[]=[];
 for(const item of items){
  const label=item.label.toLowerCase();
  const normalized=label.replace(/\s+/g,'');
  if(!normalized.includes(q))continue;
  const key=JSON.stringify([label,item.detail,item.originalName]);
  if(seen.has(key))continue;seen.add(key);
  (normalized===q?exact:partial).push(item);
 }
 return [...exact,...partial].slice(0,limit);
}
