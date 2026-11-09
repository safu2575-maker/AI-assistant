/** Safe calculation grammar. Source positions are retained for editor diagnostics. */
export type CalcValue = number | string | boolean | null;
export interface CalcToken { kind: 'number'|'string'|'field'|'reference'|'word'|'symbol'|'comment'|'end'; text:string; value:string; start:number; end:number }
export type CalcNode = {kind:'literal';value:CalcValue;at:number} | {kind:'field'|'reference';name:string;at:number;target?:{table:string;column:string}} | {kind:'unary';op:string;child:CalcNode;at:number} | {kind:'binary';op:string;left:CalcNode;right:CalcNode;at:number} | {kind:'call';name:string;args:CalcNode[];at:number} | {kind:'metric';name:string;filters:CalcNode[];at:number} | {kind:'filtered';expression:CalcNode;filters:CalcNode[];at:number} | {kind:'list';items:CalcNode[];at:number};
export class CalculationError extends Error { constructor(message:string,public at=0){super(message);} }
export function calculationDiagnostic(source:string,error:unknown):string { const at=error instanceof CalculationError?error.at:0;const lines=source.slice(0,at).split('\n');return `Line ${lines.length}, column ${lines.at(-1)!.length+1}: ${error instanceof Error?error.message:String(error)}`; }
/** Shared quote reader for parsing, completion and delimiter pairing.
 * Two opening apostrophes before text opt into paired-apostrophe delimiters.
 * Empty strings and ordinary doubled-apostrophe escapes retain their meaning.
 */
export function readCalculationQuote(source:string,start:number):{value:string;end:number;closed:boolean} {
 const quote=source[start],paired=quote==="'"&&source[start+1]==="'"&&!!source[start+2]&&!/[\s'"),+\-*/%=<>]/.test(source[start+2]);
 let i=start+(paired?2:1),value='';
 while(i<source.length){
  if(paired){
   if(source.slice(i,i+2)==="''"){
    const next=source[i+2];if(!next||/[\s),+\-*/%=<>]/.test(next))return {value,end:i+2,closed:true};
    value+="'";i+=2;continue;
   }
   value+=source[i++];
  }else if(source[i]===quote){
   i++;if(source[i]===quote){value+=quote;i++;}else return {value,end:i,closed:true};
  }else value+=source[i++];
 }
 return {value,end:i,closed:false};
}
export function tokenizeCalculation(source:string):CalcToken[] {
 if(source.length>16000)throw new CalculationError('Formula exceeds 16,000 characters.');
 const tokens:CalcToken[]=[];let i=0;
 while(i<source.length){if(/\s/.test(source[i])){i++;continue;}const start=i;let kind:CalcToken['kind']='symbol',value='';
  if(source.slice(i,i+2)==='//'){i+=2;while(i<source.length&&source[i]!=='\n')i++;kind='comment';value=source.slice(start,i);}
  else if(source[i]==="'"||source[i]==='"'){const quoted=readCalculationQuote(source,i);kind='string';value=quoted.value;i=quoted.end;if(!quoted.closed)throw new CalculationError('Unclosed quoted text.',start);}
  else if(source[i]==='['){i++;kind='field';while(i<source.length&&source[i]!==']')value+=source[i++];if(source[i++]!==']')throw new CalculationError('Missing ].',start);}
  else if(source[i]==='@'){i++;kind='reference';if(source[i]==='['){i++;while(i<source.length&&source[i]!==']')value+=source[i++];if(source[i++]!==']')throw new CalculationError('Missing ] in measure reference.',start);}else{const m=/^[\p{L}\p{N}_]+/u.exec(source.slice(i));if(!m)throw new CalculationError('Use @Name or @[Measure name].',start);value=m[0];i+=value.length;}}
  else {const number=/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(i));const word=/^[A-Za-z_][A-Za-z_0-9]*/.exec(source.slice(i));if(number){kind='number';value=number[0];i+=value.length;}else if(word){kind='word';value=word[0].toUpperCase();i+=word[0].length;}else {const op=/^(?:>=|<=|!=|<>|==|[()+\-*/%,=<>])/.exec(source.slice(i));if(!op)throw new CalculationError('Unsupported character '+source[i],i);value=op[0];i+=value.length;}}
  tokens.push({kind,value,text:source.slice(start,i),start,end:i});
 }tokens.push({kind:'end',text:'',value:'',start:i,end:i});return tokens;
}
export function parseCalculation(source:string):CalcNode {
 const ts=tokenizeCalculation(source).filter(t=>t.kind!=='comment');let p=0,depth=0;
 const peek=()=>ts[p],take=()=>ts[p++],is=(v:string)=>peek().value===v,expect=(v:string)=>{if(!is(v))throw new CalculationError('Expected '+v,peek().start);take();};
 const literal=():CalcNode=>{const t=take();if(t.kind==='number')return {kind:'literal',value:Number(t.value),at:t.start};if(t.kind==='string')return {kind:'literal',value:t.value,at:t.start};if(t.kind==='field'||t.kind==='reference')return {kind:t.kind,name:t.value.trim(),at:t.start};if(['TRUE','FALSE','NULL'].includes(t.value))return {kind:'literal',value:t.value==='NULL'?null:t.value==='TRUE',at:t.start};
  if(t.value==='('){if(peek().kind==='string'&&(ts[p+1].value===','||ts[p+1].value===')')){const name=take().value,filters:CalcNode[]=[];while(is(',')){take();filters.push(expr(0));}expect(')');return {kind:'metric',name,filters,at:t.start};}const n=expr(0);if(is(',')){const filters:CalcNode[]=[];while(is(',')){take();if(is(')'))throw new CalculationError('Expected a field predicate after comma.',peek().start);filters.push(expr(0));}expect(')');return {kind:'filtered',expression:n,filters,at:t.start};}expect(')');return n;}
  if(t.kind==='word'&&is('(')){take();const args:CalcNode[]=[];if(!is(')')){args.push(expr(0));while(is(',')){take();args.push(expr(0));}}expect(')');return {kind:'call',name:t.value,args,at:t.start};}
  if(t.kind==='word'&&!['AND','OR','NOT','IN','BETWEEN'].includes(t.value))return {kind:'metric',name:t.text,filters:[],at:t.start};
  throw new CalculationError('Expected a measure expression, number, reference or function.',t.start);
 };
 const precedence:Record<string,number>={OR:1,AND:2,'=':3,'==':3,'!=':3,'<>':3,'>':3,'<':3,'>=':3,'<=':3,IN:3,BETWEEN:3,'+':4,'-':4,'*':5,'/':5,'%':5};
 const expr=(min:number):CalcNode=>{if(++depth>100)throw new CalculationError('Formula nesting exceeds 100.',peek().start);try{let left:CalcNode;const t=peek();if(['+','-','NOT'].includes(t.value)){take();left={kind:'unary',op:t.value,child:expr(t.value==='NOT'?3:6),at:t.start};}else left=literal();
  while(true){let op=peek().value;const negated=op==='NOT'&&['IN','BETWEEN'].includes(ts[p+1]?.value);if(negated)op=ts[p+1].value;const prec=precedence[op];if(prec===undefined||prec<min)break;const at=take().start;if(negated)take();let right:CalcNode;
   if(op==='IN'){expect('(');const items=[expr(4)];while(is(',')){take();items.push(expr(4));}expect(')');right={kind:'list',items,at};}
   else if(op==='BETWEEN'){const a=expr(4);expect('AND');right={kind:'list',items:[a,expr(4)],at};}else right=expr(prec+1);
   if(['+','-','*','/','%'].includes(op)){const metric=(n:CalcNode):CalcNode=>n.kind==='literal'&&typeof n.value==='string'?{kind:'metric',name:n.value,filters:[],at:n.at}:n;left=metric(left);right=metric(right);}
   left={kind:'binary',op:negated?'NOT '+op:op,left,right,at};
  }return left;
 }finally{depth--;}};
 if(is('='))take();const ast=expr(0);walkCalculation(ast,n=>{if(n.kind==='metric'||n.kind==='filtered')n.filters.forEach(validateCalculationPredicate);});if(peek().kind!=='end')throw new CalculationError('Unexpected '+peek().text,peek().start);return ast;
}
/** A comma after a grouped expression introduces predicates, never another value. */
export function validateCalculationPredicate(n:CalcNode):void {
 if(n.kind==='unary'&&n.op==='NOT'){validateCalculationPredicate(n.child);return;}
 if(n.kind==='binary'&&['AND','OR'].includes(n.op)){validateCalculationPredicate(n.left);validateCalculationPredicate(n.right);return;}
 if(n.kind!=='binary'||n.left.kind!=='field'||!['=','==','!=','<>','>','<','>=','<=','IN','NOT IN','BETWEEN','NOT BETWEEN'].includes(n.op))throw new CalculationError('After a comma use a field predicate, for example [Year] = 2026. Function arguments belong inside a named function.',n.at);
 const literal=(v:CalcNode):boolean=>v.kind==='literal'||v.kind==='unary'&&v.op==='-'&&v.child.kind==='literal'&&typeof v.child.value==='number';
 if(!(n.right.kind==='list'?n.right.items.every(literal):literal(n.right)))throw new CalculationError('Filter values must be literals; quote text values.',n.right.at);
}
/** Find the active grouping comma without confusing function arguments or IN lists. */
export function calculationFilterCompletion(source:string):{start:number;usedFields:string[]}|undefined {
 try{const tokens=tokenizeCalculation(source).filter(t=>!['end','comment'].includes(t.kind));const stack:Array<{functionArgs:boolean;comma?:number;start:number;fields:Array<{name:string;end:number}>}>=[];
 for(let i=0;i<tokens.length;i++){const t=tokens[i];if(t.kind==='field'&&stack.length)stack[stack.length-1].fields.push({name:t.value,end:t.end});if(t.kind!=='symbol')continue;if(t.value==='(')stack.push({functionArgs:tokens[i-1]?.kind==='word',start:t.end,fields:[]});else if(t.value===')')stack.pop();else if(t.value===','&&stack.length)stack[stack.length-1].comma=t.end;}
 const group=stack.at(-1);if(!group||group.functionArgs||group.comma===undefined)return;
 const tail=source.slice(group.comma);if(!/^\s*(?:\[[^\]]*|[A-Za-z_ ]*)$/.test(tail))return;
 return {start:group.comma,usedFields:group.fields.filter(f=>f.end<=group.comma!).map(f=>f.name)};
 }catch{return;}
}
export function walkCalculation(node:CalcNode,visit:(node:CalcNode)=>void):void {visit(node);if(node.kind==='binary'){walkCalculation(node.left,visit);walkCalculation(node.right,visit);}else if(node.kind==='unary')walkCalculation(node.child,visit);else if(node.kind==='call')node.args.forEach(n=>walkCalculation(n,visit));else if(node.kind==='filtered'){walkCalculation(node.expression,visit);node.filters.forEach(n=>walkCalculation(n,visit));}else if(node.kind==='metric')node.filters.forEach(n=>walkCalculation(n,visit));else if(node.kind==='list')node.items.forEach(n=>walkCalculation(n,visit));}
export const quoteCalculation=(s:string)=>"'"+s.replace(/'/g,"''")+"'";
/** Token-preserving formatter; parsed AST equality is verified before returning. */
export function formatCalculation(source:string):string {
 const before=parseCalculation(source);const tokens=tokenizeCalculation(source).filter(t=>t.kind!=='end');let depth=0,result='';
 for(const t of tokens){if(t.kind==='comment'){result=result.trimEnd()+'\n'+'    '.repeat(depth)+t.text+'\n'+'    '.repeat(depth);continue;}if(t.value==='('&&t.kind==='symbol'){result+='(\n'+'    '.repeat(++depth);}else if(t.value===')'&&t.kind==='symbol'){depth--;result=result.trimEnd()+'\n'+'    '.repeat(depth)+')';}else if(t.value===','&&t.kind==='symbol')result=result.trimEnd()+',\n'+'    '.repeat(depth);else result+=t.text+' ';}
 const clean=(n:CalcNode)=>JSON.stringify(n,(k,v)=>k==='at'?undefined:v);if(clean(before)!==clean(parseCalculation(result)))throw new CalculationError('Formatting would change the formula.');return result.trim();
}
export interface CalculationRuntime { filtered?:(node:Extract<CalcNode,{kind:'filtered'}>)=>Promise<CalcValue>; trace?:(node:CalcNode,value:CalcValue)=>void; metric:(node:Extract<CalcNode,{kind:'metric'}>)=>Promise<CalcValue>; reference:(name:string)=>Promise<CalcValue>; days:(scope?:CalcNode)=>Promise<number> }
const utc=(value:CalcValue):Date=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new CalculationError('Use an ISO date: YYYY-MM-DD.');const d=new Date(value+'T00:00:00Z');if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==value)throw new CalculationError('Invalid calendar date.');return d;};
const iso=(d:Date)=>d.toISOString().slice(0,10);
export async function evaluateCalculation(node:CalcNode,rt:CalculationRuntime):Promise<CalcValue>{const value=await evaluateNode(node,rt);rt.trace?.(node,value);return value;}
async function evaluateNode(node:CalcNode,rt:CalculationRuntime):Promise<CalcValue>{
 const run=(n:CalcNode)=>evaluateCalculation(n,rt);const num=(v:CalcValue):number=>{if(typeof v!=='number'||!Number.isFinite(v))throw new CalculationError('A finite numeric value is required.',node.at);return v;};
 if(node.kind==='literal')return node.value;
 if(node.kind==='filtered'){if(!rt.filtered)throw new CalculationError('Filtered expressions require a context-aware evaluator.',node.at);return rt.filtered(node);}
 if(node.kind==='metric')return rt.metric(node);
 if(node.kind==='reference')return rt.reference(node.name);
 if(node.kind==='field'||node.kind==='list')throw new CalculationError('Fields and lists are only valid inside filters.',node.at);
 if(node.kind==='unary'){const v=await run(node.child);return node.op==='NOT'?!v:node.op==='-'?-num(v):num(v);}
 if(node.kind==='binary'){const a=await run(node.left);if(node.op==='AND')return !!a&&!!await run(node.right);if(node.op==='OR')return !!a||!!await run(node.right);const b=await run(node.right);if(node.op==='='||node.op==='==')return a===b;if(node.op==='!='||node.op==='<>')return a!==b;if(a===null||b===null)return null;const x=num(a),y=num(b);switch(node.op){case '>':return x>y;case '<':return x<y;case '>=':return x>=y;case '<=':return x<=y;case '+':return x+y;case '-':return x-y;case '*':return x*y;case '/':if(!y)throw new CalculationError('Division by zero. Use DIVIDE for an explicit fallback.',node.at);return x/y;case '%':if(!y)throw new CalculationError('Modulo by zero.',node.at);return x%y;default:throw new CalculationError('This operator is only supported in filters.',node.at);}}
 if(node.kind!=='call')throw new CalculationError('Invalid expression.',node.at);
 const name=node.name,args=node.args;
 if(name==='DAYS')return rt.days(args[0]);
 if(name==='IF'){return await run(args[0])?run(args[1]):args[2]?run(args[2]):null;}
 if(name==='CASE'){for(let i=0;i+1<args.length;i+=2)if(await run(args[i]))return run(args[i+1]);return args.length%2?run(args.at(-1)!):null;}
 if(name==='COALESCE'){for(const a of args){const v=await run(a);if(v!==null)return v;}return null;}
 if(name==='DIVIDE'){const b=await run(args[1]);if(b===null||b===0)return args[2]?run(args[2]):null;const a=await run(args[0]);return a===null?null:num(a)/num(b);}
 const v:CalcValue[]=[];for(const a of args)v.push(await run(a));
 if(name==='ABS')return Math.abs(num(v[0]));if(name==='ROUND'){const digits=v[1]===undefined?0:num(v[1]);if(!Number.isInteger(digits)||Math.abs(digits)>12)throw new CalculationError('ROUND digits must be an integer from −12 to 12.',node.at);const scale=10**digits;return Math.round(num(v[0])*scale)/scale;}
 if(name==='CEILING')return Math.ceil(num(v[0]));if(name==='FLOOR')return Math.floor(num(v[0]));
 if(['SUM','AVG','MIN','MAX','COUNT','DISTINCTCOUNT'].includes(name)){const ns=v.filter(x=>x!==null).map(num);if(name==='COUNT')return ns.length;if(name==='DISTINCTCOUNT')return new Set(ns).size;if(!ns.length)return null;return name==='SUM'?ns.reduce((a,b)=>a+b,0):name==='AVG'?ns.reduce((a,b)=>a+b,0)/ns.length:name==='MIN'?Math.min(...ns):Math.max(...ns);}
 if(name==='DAYSINMONTH'||name==='DAYSINYEAR'||name==='MONTHINDEX'){const year=num(v[0]),month=name==='DAYSINYEAR'?1:num(v[1]);if(!Number.isInteger(year)||year<100||year>9999||!Number.isInteger(month)||month<1||month>12)throw new CalculationError('Use a year from 100–9999 and month from 1–12.',node.at);if(name==='MONTHINDEX')return year*12+month;if(name==='DAYSINYEAR')return (Date.UTC(year+1,0,1)-Date.UTC(year,0,1))/86400000;return new Date(Date.UTC(year,month,0)).getUTCDate();}
 if(name==='DATEDIFF'||name==='WORKDAYS'){const a=utc(v[0]),b=utc(v[1]);const days=(+b-+a)/86400000;if(name==='DATEDIFF')return days;if(days<0||days>366000)throw new CalculationError('WORKDAYS requires an ordered range of at most 1,000 years.',node.at);let count=0;for(let i=0;i<=days;i++){const day=new Date(+a+i*86400000).getUTCDay();if(day!==0&&day!==6)count++;}return count;}
 const d=utc(v[0]),y=d.getUTCFullYear(),m=d.getUTCMonth();switch(name){case 'YEAR':return y;case 'MONTH':return m+1;case 'DAY':return d.getUTCDate();case 'STARTOFMONTH':return iso(new Date(Date.UTC(y,m,1)));case 'ENDOFMONTH':return iso(new Date(Date.UTC(y,m+1,0)));case 'STARTOFYEAR':return iso(new Date(Date.UTC(y,0,1)));case 'ENDOFYEAR':return iso(new Date(Date.UTC(y,11,31)));case 'PREVIOUSMONTH':return iso(new Date(Date.UTC(y,m-1,Math.min(d.getUTCDate(),new Date(Date.UTC(y,m,0)).getUTCDate()))));case 'PREVIOUSYEAR':return iso(new Date(Date.UTC(y-1,m,Math.min(d.getUTCDate(),new Date(Date.UTC(y-1,m+1,0)).getUTCDate()))));default:throw new CalculationError('Unsupported function '+name,node.at);}
}
export const calculationFunctions:Record<string,[number,number]>={IF:[2,3],CASE:[3,51],COALESCE:[1,50],DIVIDE:[2,3],ABS:[1,1],ROUND:[1,2],CEILING:[1,1],FLOOR:[1,1],SUM:[1,50],AVG:[1,50],MIN:[1,50],MAX:[1,50],COUNT:[1,50],DISTINCTCOUNT:[1,50],DAYS:[0,1],DAYSINMONTH:[2,2],DAYSINYEAR:[1,1],MONTHINDEX:[2,2],DATEDIFF:[2,2],WORKDAYS:[2,2],YEAR:[1,1],MONTH:[1,1],DAY:[1,1],STARTOFMONTH:[1,1],ENDOFMONTH:[1,1],STARTOFYEAR:[1,1],ENDOFYEAR:[1,1],PREVIOUSMONTH:[1,1],PREVIOUSYEAR:[1,1]};
