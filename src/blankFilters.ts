import { BasicFilter, IFilter } from 'powerbi-models';
import type { ParameterConfig } from './parameterQuery';

/** Extract only field-qualified blank predicates; never guess which field "blank" means. */
export function extractBlankFilters(text:string,config:ParameterConfig):{text:string;filters:IFilter[];summary:string[]}{
 const filters:IFilter[]=[],summary:string[]=[];
 const names=new Map<string,typeof config.fields>();
 for(const field of config.fields)for(const name of [field.name,...field.aliases||[],...config.groupAliases?.[field.name]||[]]){const key=name.toLowerCase();names.set(key,[...new Set([...(names.get(key)||[]),field])]);}
 const escape=(v:string)=>v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const token=String.raw`(?:\(\s*(?:blank|"\s*"|'\s*')\s*\)|blank\b|"\s*"|'\s*')`;
 const clauses:string[]=[];
 for(const name of [...names.keys()].sort((a,b)=>b.length-a.length)){
  const pattern=new RegExp(String.raw`(^|[\s;,])(${escape(name)})(?:\s*=\s*|\s+)(${token})(?=\s*(?:$|[;,]|\b(?:and|for|as|by|where|with)\b))`,'gi');
  text=text.replace(pattern,(whole,prefix,_name,_value,offset)=>{
   // Do not interpret a field-looking phrase within another filter's quoted value.
   const before=text.slice(0,offset+prefix.length);if((before.match(/"/g)||[]).length%2||(before.match(/'/g)||[]).length%2)return whole;
   const candidates=names.get(name)!;if(candidates.length!==1)throw new Error(`Ambiguous synonym ${name}; use the full field name.`);
   const field=candidates[0];if(clauses.includes(field.name))throw new Error(`Specify ${field.name} once.`);clauses.push(field.name);
   filters.push(new BasicFilter({table:field.table,column:field.column},'In',[null as unknown as string]).toJSON());summary.push(`${field.name}: (Blank)`);
   return prefix;
  });
 }
 if(filters.length){
  // Remove connectors left by a consumed predicate, retaining other explicit filters.
  text=text.replace(/\b(where|with)\s*(?:;|and\b)\s*/gi,'$1 ').replace(/(?:;|\band\b)\s*$/gi,'').replace(/\b(?:where|with)\s*$/gi,'').replace(/\b(?:where|with)\s+(?=for\b|as\b)/gi,'').replace(/\bfor\s*$/i,'');
 }
 return {text,filters,summary};
}
