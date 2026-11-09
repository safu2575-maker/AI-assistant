export interface TypoCatalogue {names:string[];values:string[]}
/** Bounded adjacent-transposition distance. Never used for numeric identifiers. */
function distance(a:string,b:string):number {
 if(Math.abs(a.length-b.length)>1)return 2;
 const d=Array.from({length:a.length+1},()=>Array<number>(b.length+1).fill(0));
 for(let i=0;i<=a.length;i++)d[i][0]=i;for(let j=0;j<=b.length;j++)d[0][j]=j;
 for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++){d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+Number(a[i-1]!==b[j-1]));if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])d[i][j]=Math.min(d[i][j],d[i-2][j-2]+1);}
 return d[a.length][b.length];
}
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const reserved=new Set('not no without excluding except before after above below between greater less than and or by for in of as show what total average sum count distinct top bottom previous next year month ytd ttm running cumulative'.split(' '));
export function correctCatalogueTypos(question:string,catalogue:TypoCatalogue):{question:string;corrections:string[]} {
 if(question.length>2000||question.includes(';')||question.startsWith('#'))return {question,corrections:[]};
 if(catalogue.names.length>2000)return {question,corrections:[]};
 const valueSet=new Set(catalogue.values),lowerQuestion=question.toLowerCase();
 const protectedSpans:Array<[number,number]>=[];
 const hardSpans:Array<[number,number]>=[];
 for(const m of question.matchAll(/"[^"]*"|'[^']*'|\([^)]*\)|\[[^\]]*\]/g))hardSpans.push([m.index!,m.index!+m[0].length]);
 for(const name of [...catalogue.names,...catalogue.values].filter(Boolean)){
  if(name.length>160||!lowerQuestion.includes(name.toLowerCase()))continue;
  for(const m of question.matchAll(new RegExp('(?<![\\w])'+escape(name)+'(?![\\w])','gi')))(valueSet.has(name)?hardSpans:protectedSpans).push([m.index!,m.index!+m[0].length]);
 }
 // Explicit comparison literals are user data even when absent from the catalogue.
 for(const m of question.matchAll(/(?:!=|<>|>=|<=|=|>|<)\s*[^;]+/g))hardSpans.push([m.index!,m.index!+m[0].length]);
 const candidates=[...new Set(catalogue.names)].filter(n=>/^[a-z][a-z ]{3,79}$/i.test(n)).map(name=>({name,words:name.toLowerCase().split(/\s+/)}));
 const words=[...question.matchAll(/[a-z0-9_]+/gi)];const changes:Array<{start:number;end:number;replacement:string;source:string}>=[];
 for(let i=0;i<words.length;i++){
  const options:Array<{name:string;end:number;count:number;score:number}>=[];
  for(const candidate of candidates){
   const count=candidate.words.length;if(count>8||i+count>words.length)continue;
   const start=words[i].index!,end=words[i+count-1].index!+words[i+count-1][0].length;
   // Exact words inside a longer misspelled name are safe; exact complete entities/values are not.
   if(hardSpans.some(([a,b])=>a<end&&b>start))continue;
   if(protectedSpans.some(([a,b])=>a<end&&b>start&&!(a>=start&&b<=end&&b-a<end-start)))continue;
   if(!/^[a-z ]+$/i.test(question.slice(start,end)))continue;
   let score=0,valid=true;
   for(let k=0;k<count;k++){const a=words[i+k][0].toLowerCase(),b=candidate.words[k];if(a===b)continue;if(a.length<4||b.length<4||reserved.has(a)||reserved.has(b)){valid=false;break;}const diff=distance(a,b);if(diff>1){valid=false;break;}score+=diff;}
   if(valid&&score>0&&score<=2&&score/Math.max(1,candidate.name.length)<=0.25)options.push({name:candidate.name,end,count,score});
  }
  if(!options.length)continue;
  options.sort((a,b)=>a.score-b.score||b.count-a.count);
  const best=options[0],ties=options.filter(o=>o.score===best.score&&o.count===best.count);
  if(new Set(ties.map(o=>o.name.toLowerCase())).size>1)throw new Error('Did you mean '+ties.slice(0,3).map(o=>o.name).join(' or ')+'? Select the intended field or measure from suggestions.');
  const start=words[i].index!;changes.push({start,end:best.end,replacement:best.name,source:question.slice(start,best.end)});i+=best.count-1;
  if(changes.length>3)return {question,corrections:[]};
 }
 let corrected=question;for(const c of [...changes].reverse())corrected=corrected.slice(0,c.start)+c.replacement+corrected.slice(c.end);
 return {question:corrected,corrections:changes.map(c=>`Interpreted “${c.source}” as “${c.replacement}”`)};
}

/** Suggest full catalogue names from a misspelled prefix; clicks remain explicit choices. */
export function typoSuggestionMatches(label:string,query:string):boolean {
 const a=query.toLowerCase().trim().split(/\s+/),b=label.toLowerCase().split(/\s+/);
 if(a.length>b.length||a.length>8||query.length>80||label.length>80)return false;
 let edits=0;
 for(let i=0;i<a.length;i++){if(a[i]===b[i])continue;if(!/^[a-z]{4,}$/.test(a[i])||!b[i]||b[i].length<4||reserved.has(a[i])||reserved.has(b[i]))return false;const d=distance(a[i],b[i]);if(d>1)return false;edits+=d;}
 return edits>0&&edits<=2;
}

