import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import less from 'less';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const bundle=await build({stdin:{contents:`
import {cashFlowWorkspace} from './src/qna/cashFlowWorkspace';
import {answerCashFlow} from './src/cashFlowQuery';
import {GlobalQnaUi} from './src/qna/ui';import {GlobalQnaEngine} from './src/qna/engine';
const fields=['company','document','clearing','accountDescription','date','clearingDate','currency','item','Input'];
const setup={fields:Object.fromEntries(fields.filter(f=>f!=='Input').map(f=>[f,f])),measure:'Amount',rules:[],displayColumns:['company','document','Amount'],scope:{companies:['9720','9760'],filters:[{field:'Input',values:['Cash and cash equivalents','Petty cash']}],from:'2026-10-01',to:'2026-10-31'}};
const data=['9720','9760'].flatMap(company=>[
{document:'1',item:'1',amount:-100,accountDescription:company==='9720'?'Bank':'Operating treasury',clearing:'',date:'2026-10-01',Input:company==='9720'?'Cash and cash equivalents':'Petty cash'},
{document:'1',item:'2',amount:100,accountDescription:'Vendor',clearing:'201'},
{document:'2',item:'1',amount:-100,accountDescription:'Vendor',clearing:'201'},
{document:'2',item:'2',amount:100,accountDescription:'Expense',clearing:''}
].map(p=>({date:'2026-09-01',Input:'Not a starting branch',clearingDate:'2026-10-01',currency:'SAR',company,...p})));
const config={fields:fields.map(name=>({name,table:'Journal',column:name,type:name==='date'?'date':'text'}))};
const ui=new GlobalQnaUi(document.createElement('div'),new GlobalQnaEngine({fields:[],measures:[],rowCount:0,selectedIndices:[],formatValue:(_,v)=>String(v)}));
window.queries=[];window.cancelled=0;
window.open=()=>cashFlowWorkspace(document.getElementById('root'),setup,fields,['Amount'],async q=>{window.queries.push(JSON.parse(decodeURIComponent(q.slice(';cashflow:'.length))));if(window.slow)await new Promise(resolve=>window.release=resolve);return answerCashFlow(q,config,['Amount'],async plan=>{const rows=data.filter(p=>plan.filters.every(f=>f.values?f.values.includes(p[f.target.column]):f.conditions.every(c=>c.operator==='GreaterThanOrEqual'?p[f.target.column]>=c.value.slice(0,10):p[f.target.column]<c.value.slice(0,10))));const cols=[...plan.groups,...plan.measures];return {text:'',table:{columns:cols,rows:rows.map(p=>cols.map(c=>String(c==='Amount'?p.amount:p[c]??''))),rowIndices:rows.map(()=>[]),modelGroupValues:rows.map(p=>plan.groups.map(c=>p[c]??null)),modelRawRows:rows.map(p=>cols.map(c=>c==='Amount'?p.amount:null)),modelResultComplete:!window.incomplete}}});},s=>window.saved=s,()=>window.cancelled++,t=>ui.table(t));window.open();`,resolveDir:'..',loader:'ts'},bundle:true,write:false,platform:'browser'});
const css=await less.render(await readFile('../style/visual.less','utf8'),{paths:['../style']});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1150,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setContent('<div id="root" class="askbics-host" style="position:relative;height:860px"></div>');await page.addStyleTag({content:css.css});await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.getByLabel('Currency',{exact:true}).fill('SAR');await page.getByRole('button',{name:'Show cash flow',exact:true}).click();
 await page.getByRole('button',{name:'View trace',exact:true}).first().waitFor();assert.equal(await page.getByRole('button',{name:'View trace',exact:true}).count(),2);
 assert.equal(await page.getByLabel('Starting posting',{exact:true}).isVisible(),false);assert.match(await page.locator('.askbics-cash-options > [role=status]').textContent(),/Starting postings selected automatically from your cash-flow filters/);
 const queries=await page.evaluate(()=>window.queries);const starts=queries.filter(q=>q.phase==='starts'),links=queries.filter(q=>q.phase==='links');assert.equal(starts.length,2);assert.deepEqual(starts.map(q=>q.company),['9720','9760']);assert.deepEqual(starts[0].filters[0].values,['Cash and cash equivalents','Petty cash']);assert.ok(links.length>0);assert.ok(links.every(q=>!q.filters&&!q.from));
 await page.getByRole('button',{name:'View trace',exact:true}).first().click();assert.match(await page.getByRole('dialog',{name:'Available document entries'}).textContent(),/Expense/);await page.getByRole('button',{name:'Close entries',exact:true}).click();
 await page.getByRole('button',{name:'Show cash flow',exact:true}).click();await page.getByRole('button',{name:'View trace',exact:true}).first().waitFor();assert.equal((await page.evaluate(()=>window.queries)).length,queries.length,'completed requests reused');
 await page.evaluate(()=>window.incomplete=true);await page.getByRole('button',{name:'Refresh data',exact:true}).click();await page.getByText('Incomplete trace',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Edit filters',exact:true}).click();await page.getByRole('button',{name:'Cash flow filter field 1: Input',exact:true}).click();await page.getByRole('listbox',{name:'Cash flow filter field 1',exact:true}).getByRole('option',{name:'document',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Cash flow filter values 1',exact:true}).textContent(),'Select values…');
 await page.getByRole('button',{name:'Show cash flow',exact:true}).click();assert.match(await page.locator('.askbics-cash-options > [role=status]').textContent(),/select at least one value/);
 await page.getByRole('button',{name:'Back',exact:true}).click();await page.evaluate(()=>{window.incomplete=false;window.slow=true;window.open();});await page.getByLabel('Currency',{exact:true}).fill('SAR');await page.getByRole('button',{name:'Show cash flow',exact:true}).click();await page.waitForFunction(()=>typeof window.release==='function');await page.getByRole('button',{name:'Back',exact:true}).click();await page.evaluate(()=>window.release());assert.equal(await page.getByRole('dialog',{name:'Cash flow',exact:true}).count(),0);
 assert.deepEqual(errors,[]);console.log('Cash-flow scope browser: companies, OR filters, older linked entries, caching, refresh, incomplete state, field resets and stale navigation passed.');
}finally{await browser.close();}
