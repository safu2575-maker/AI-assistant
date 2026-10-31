import { applyAlwaysFilter } from "./alwaysFilter";
import { ParameterConfig, ParameterPlan } from "./parameterQuery";
export interface AnswerGroup { id:string; name:string; kind:'field'|'measure'; members:string[]; hiddenMembers?:string[]; filters?:Array<{field:string;values:string[]}>; aliases:string[]; enabled:boolean }
export function validateAnswerGroups(groups:AnswerGroup[]|undefined, fields:string[], measures:string[], reserved:string[]=[]):void {
 if(groups===undefined)return;
 if(!Array.isArray(groups)||groups.length>50)throw new Error('Use at most 50 field and measure groups.');
 const names=new Set([...fields,...measures,...reserved].map(n=>n.trim().toLowerCase()));const ids=new Set<string>();
 for(const group of groups){
  if(!group||!['field','measure'].includes(group.kind)||typeof group.id!=='string'||ids.has(group.id)||typeof group.name!=='string'||!group.name.trim()||typeof group.enabled!=='boolean'||!Array.isArray(group.members)||group.members.length<2||group.members.length>10||new Set(group.members).size!==group.members.length||!Array.isArray(group.aliases))throw new Error('Each group needs a unique ID, a name, and 2–10 different members.');
  ids.add(group.id);
  if(group.hiddenMembers!==undefined&&(!Array.isArray(group.hiddenMembers)||group.hiddenMembers.some(m=>!group.members.includes(m))||group.members.every(m=>group.hiddenMembers!.includes(m))))throw new Error(group.name+': keep at least one visible member and hide only members of this group.');
  if(group.filters!==undefined&&(!Array.isArray(group.filters)||group.filters.some(f=>!f||!(group.kind==='field'?group.members:fields).includes(f.field)||!Array.isArray(f.values)||f.values.some(v=>typeof v!=='string'||!v.trim()))))throw new Error(group.name+': filters must use available fields and nonempty exact values.');
  const available=group.kind==='field'?fields:measures;
  for(const member of group.members)if(!available.includes(member))throw new Error(group.name+': unavailable '+group.kind+' '+member+'. Update this group.');
  for(const alias of [group.name,...group.aliases]){if(typeof alias!=='string'||!alias.trim()||/[;=\[\]"']/u.test(alias))throw new Error('Use a nonempty group name or synonym without query punctuation.');const key=alias.trim().toLowerCase();if(names.has(key))throw new Error('Group name or synonym conflicts with another name: '+alias);names.add(key);}
 }
}
/** Expand once, outside quoted values and internal state envelopes. Never create a new model column. */
export function expandAnswerGroups(question:string,groups:AnswerGroup[]|undefined):string {
 if(!groups?.some(g=>g.enabled)||question.startsWith(';'))return question;
 const entries=groups.filter(g=>g.enabled).flatMap(g=>[g.name,...g.aliases].map(name=>({name,filters:g.filters||[],members:g.members.filter(m=>!g.hiddenMembers?.includes(m))}))).sort((a,b)=>b.name.length-a.name.length);
 const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const protectedNames=new Set(groups.flatMap(g=>g.members).map(m=>m.toLowerCase()));
 const terms=[...new Set([...entries.map(e=>e.name),...groups.flatMap(g=>g.members)])].sort((a,b)=>b.length-a.length);
 const pattern=new RegExp('(?<![\\p{L}\\p{N}_])('+terms.map(escape).join('|')+')(?![\\p{L}\\p{N}_])','giu');
 const split=question.search(/;\s*(?:answerFilters|analysisState|modelScope):/i);const head=split<0?question:question.slice(0,split),tail=split<0?'':question.slice(split);
 const used=new Map<string,{field:string;values:string[];group:true}>();
 const expanded=head.split(/("[^"\\]*(?:\\.[^"\\]*)*"|'[^']*')/g).map((part,i)=>i%2?part:part.replace(pattern,match=>{if(protectedNames.has(match.toLowerCase()))return match;const entry=entries.find(e=>e.name.toLowerCase()===match.toLowerCase())!;for(const filter of entry.filters){if(!filter.values.length)continue;const prior=used.get(filter.field);const values=prior?prior.values.filter(v=>filter.values.includes(v)):filter.values.slice();if(!values.length)throw new Error('Group filters conflict for '+filter.field+'.');used.set(filter.field,{field:filter.field,values,group:true});}return entry.members.join(' and ');})).join('')+tail;
 if(!used.size)return expanded;
 const existing=/;\s*answerFilters:\s*(\S+)/i.exec(expanded);
 const filters=existing?JSON.parse(decodeURIComponent(existing[1])):[];
 if(!Array.isArray(filters))throw new Error('Invalid answer filters.');
 const combined=[...filters,...used.values()];
 const marker='; answerFilters: '+encodeURIComponent(JSON.stringify(combined));
 if(existing)return expanded.slice(0,existing.index)+marker+expanded.slice(existing.index+existing[0].length);
 const scope=expanded.search(/;\s*modelScope:/i);
 return scope<0?expanded+marker:expanded.slice(0,scope)+marker+expanded.slice(scope);
}

export function applyGroupFilters(plan:ParameterPlan,config:ParameterConfig,rules:Array<{field:string;values:string[]}>|undefined):ParameterPlan {
 let result=plan;
 for(const rule of rules||[])if(rule.values.length){try{result=applyAlwaysFilter(result,{...config,alwaysFilter:rule});}catch(error){throw new Error(String((error as Error).message).replace(/Always filter/g,'Group filter'));}}
 return result;
}
