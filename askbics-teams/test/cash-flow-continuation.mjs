import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import less from 'less';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const bundle=await build({stdin:{contents:`
import {cashFlowWorkspace} from './src/qna/cashFlowWorkspace';
import {answerCashFlow} from './src/cashFlowQuery';
import {GlobalQnaUi} from './src/qna/ui';import {GlobalQnaEngine} from './src/qna/engine';
const fields=['company','document','item','account','clearing','Input'];
const setup={fields:Object.fromEntries(fields.filter(f=>f!=='Input').map(f=>[f,f])),measure:'Amount',rules:[],displayColumns:['document','account','Amount'],scope:{companies:['T'],filters:[{field:'Input',values:['Cash']}]}};
const data=Array.from({length:50},(_,i)=>[{document:'D'+i,item:'1',account:i?'A'+(i-1):'BANK',amount:-100,clearing:i?'C'+(i-1):'',Input:i?'Other':'Cash'},{document:'D'+i,item:'2',account:i===49?'END':'A'+i,amount:100,clearing:i===49?'':'C'+i,Input:'Other'}]).flat().map(p=>({company:'T',...p}));
const config={fields:fields.map(name=>({name,table:'Journal',column:name,type:'text'}))};
const ui=new GlobalQnaUi(document.createElement('div'),new GlobalQnaEngine({fields:[],measures:[],rowCount:0,selectedIndices:[],formatValue:(_,v)=>String(v)}));
window.queries=[];window.open=()=>cashFlowWorkspace(document.getElementById('root'),setup,fields,['Amount'],async q=>{window.queries.push(q);await new Promise(r=>setTimeout(r,10));return answerCashFlow(q,config,['Amount'],async plan=>{const rows=data.filter(p=>plan.filters.every(f=>f.values.includes(p[f.target.column]))),cols=[...plan.groups,...plan.measures];return {text:'',table:{columns:cols,rows:rows.map(p=>cols.map(c=>String(c==='Amount'?p.amount:p[c]??''))),rowIndices:rows.map(()=>[]),modelGroupValues:rows.map(p=>plan.groups.map(c=>p[c]??null)),modelRawRows:rows.map(p=>cols.map(c=>c==='Amount'?p.amount:null)),modelResultComplete:true}}});},()=>{},()=>{},t=>ui.table(t));window.open();`,resolveDir:'..',loader:'ts'},bundle:true,write:false,platform:'browser'});
const css=await less.render(await readFile('../style/visual.less','utf8'),{paths:['../style']});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1150,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setContent('<div id="root" class="askbics-host" style="position:relative;height:860px"></div>');await page.addStyleTag({content:css.css});await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.getByRole('button',{name:'Show cash flow',exact:true}).click();
 await page.locator('.askbics-cash-loading').waitFor();assert.equal(await page.getByRole('button',{name:'Continue tracing',exact:true}).count(),0);
 await page.getByText('Traced',{exact:true}).waitFor();assert.match(await page.locator('.askbics-cash-trace').textContent(),/END/);assert.equal(await page.locator('.askbics-cash-loading').isVisible(),false);
 const queries=await page.evaluate(()=>window.queries);assert.equal(new Set(queries).size,queries.length,'Continuation never restarts completed queries');
 await page.getByRole('button',{name:'Troubleshooting',exact:true}).click();const report=JSON.parse(await page.getByRole('textbox',{name:'Cash-flow diagnostic report'}).inputValue());assert.ok(report.checkpoints.length>=3);assert.ok(report.checkpoints.some(c=>c.phase==='loading'));assert.ok(report.checkpoints.some(c=>c.phase==='tracing'));await page.getByRole('button',{name:'Close cash-flow panel',exact:true}).click();
 await page.getByRole('button',{name:'Refresh data',exact:true}).click();await page.locator('.askbics-cash-loading').waitFor();await page.getByRole('button',{name:'Stop tracing',exact:true}).click();assert.equal(await page.locator('.askbics-cash-loading').isVisible(),false);assert.match(await page.locator('.askbics-cash-options > [role=status]').textContent(),/Tracing stopped/);
 await page.getByRole('button',{name:'Show cash flow',exact:true}).click();await page.locator('.askbics-cash-loading').waitFor();await page.getByRole('button',{name:'Remove starting filter Input',exact:true}).click();assert.equal(await page.locator('.askbics-cash-loading').isVisible(),false);assert.equal(await page.locator('.askbics-cash-trace').count(),0);
 await page.getByRole('button',{name:'Back',exact:true}).click();await page.evaluate(()=>window.open());await page.getByRole('button',{name:'Show cash flow',exact:true}).click();await page.locator('.askbics-cash-loading').waitFor();await page.getByRole('button',{name:'Back',exact:true}).click();assert.equal(await page.getByRole('dialog',{name:'Cash flow',exact:true}).count(),0);assert.deepEqual(errors,[]);
 console.log('Automatic continuation UI: 50-document trace, saved progress, diagnostics, Stop, scope invalidation and Back cancellation passed.');
}finally{await browser.close();}
