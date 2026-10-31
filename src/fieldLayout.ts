import type { ParameterConfig } from './parameterQuery';
export function fieldLayout(text:string,config:Pick<ParameterConfig,"fields"|"groupAliases">){
 const roles=new Map<string,'parent'|'row'|'column'>();
 const esc=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const names=config.fields.flatMap(f=>[f.name,...f.aliases||[],...config.groupAliases?.[f.name]||[]].map(name=>({name,field:f.name}))).sort((a,b)=>b.name.length-a.name.length);
 // Mask quotes and explicit filter clauses; layout words inside values stay literal.
 for(const item of names){
  const rx=new RegExp(`(^|[\\s,;])(${esc(item.name)})\\s+(?:as\\s+)?(\\(\\s*(?:p|parent|r|rows?|c|columns?|col|colum)\\s*\\)|parent|rows?|columns?|col|colum)(?=$|[\\s,;])`,'gi');
  const masked=text.replace(/"[^"]*"|'[^']*'/g,v=>' '.repeat(v.length)).replace(/\b(?:where|with)\s+[\s\S]*$/i,v=>' '.repeat(v.length));
  const matches=[...masked.matchAll(rx)].reverse();
  for(const m of matches){
   const full=(m[2]+' '+m[3]).toLowerCase();if(config.fields.some(f=>f.name.toLowerCase()===full))continue;
   if(new Set(names.filter(n=>n.name.toLowerCase()===item.name.toLowerCase()).map(n=>n.field)).size>1)throw new Error(`Ambiguous synonym ${item.name}; use the full field name.`);
   const word=m[3].replace(/[()\s]/g,'').toLowerCase(),role=word.startsWith('p')?'parent':word.startsWith('r')?'row':'column';
   if(roles.has(item.field)&&roles.get(item.field)!==role)throw new Error(`Conflicting layout instructions for ${item.field}.`);
   roles.set(item.field,role);const start=m.index!+m[1].length+m[2].length;text=text.slice(0,start)+' '.repeat(m[0].length-m[1].length-m[2].length)+text.slice(m.index!+m[0].length);
  }
 }
 return {text,roles};
}
