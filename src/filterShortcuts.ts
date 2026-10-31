import type { ParameterConfig } from './parameterQuery';
export function filterShortcuts(text:string,config:Pick<ParameterConfig,'fields'|'groupAliases'>):string{
 const names=config.fields.flatMap(f=>[f.name,...f.aliases||[],...config.groupAliases?.[f.name]||[]]).sort((a,b)=>b.length-a.length);
 const esc=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 for(const name of names){
  const pattern=new RegExp(`(^|[\\s;,])(${esc(name)})\\s+(?:\\(\\s*(?:f|filter)\\s*\\)|filter)(?=\\s|=|$)`,'gi');
  const masked=text.replace(/"[^"]*"|'[^']*'/g,v=>' '.repeat(v.length));
  for(const m of [...masked.matchAll(pattern)].reverse()){
   if(config.fields.some(f=>f.name.toLowerCase()===m[0].trim().toLowerCase()))continue;
   const tail=text.slice(m.index!+m[0].length);
   if(!/^\s*=\s*\S/.test(tail)&&!/^\s+(?:blank\b|\(\s*(?:blank|''|"")\s*\))/i.test(tail))throw new Error(`Choose a value for ${name}: where ${name} (f) = value.`);
   if(!/\b(?:where|with)\b/i.test(masked.slice(0,m.index)))throw new Error(`Place the filter after "where": where ${name} (f) = value.`);
   text=text.slice(0,m.index!)+m[1]+m[2]+text.slice(m.index!+m[0].length);
  }
 }
 return text;
}
