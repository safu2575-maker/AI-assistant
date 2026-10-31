import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const code=await build({stdin:{contents:`
import {openTransactions} from './src/qna/transactionView';
import {transactionCards} from './src/qna/transactionCards';
import {transactionQuestion} from './src/answerTransactions';
const root=document.querySelector('#root');window.loads=0;window.cancels=0;
root.addEventListener('askbics-cancel-transactions',()=>window.cancels++);
const table={columns:['Group','City','Amount'],analysisGroupCount:2,modelResultComplete:true,summaryAdditiveMeasures:['Amount'],
 rows:[['A','X','10'],['B','X','20'],['B','Y','30']],rowIndices:[[0],[1],[2]],
 modelGroupValues:[['A','X'],['B','X'],['B','Y']],modelRawRows:[[null,null,10],[null,null,20],[null,null,30]],
 drillScopes:[{question:'Amount for 2026',measure:'Amount'}],summaryCards:{enabled:true,cards:['Group','City'].map(field=>({field,sort:'Model order',measure:'Amount'}))}};
const render=t=>{const div=document.createElement('div');div.dataset.testTable='true';div.textContent=JSON.stringify(t.rows);return div;};
window.openView=()=>openTransactions(root,'initial',document.querySelector('#anchor'),async()=>{window.loads++;return {text:'Details',table};},render);
window.openSlow=()=>openTransactions(root,'slow',document.querySelector('#anchor'),()=>new Promise(resolve=>window.finish=resolve),render);
window.openRule=()=>{window.ruleLoads=0;return openTransactions(root,transactionQuestion([{question:'Amount for 2026',measure:'Amount'}]),document.querySelector('#anchor'),async q=>{
 window.ruleLoads++;const scope=JSON.parse(decodeURIComponent(q.slice(14)))[0];
 return {text:'Rule details',transactionRule:{name:'Rule',view:scope.transactionRuleView||'included'},table:{...table,summaryCards:undefined}};
},render);};
window.startMixed=()=>{
 const host=document.createElement('div'),holder=document.createElement('div');root.append(host,holder);window.summaryCalls=[];
 window.mixed=transactionCards(host,holder,{...table,summaryCards:{enabled:true,cards:[{field:'Group',measure:'Ratio',title:'Ratio'},{field:'Group',measure:'Amount',title:'Amount'}]}},q=>{
  window.summaryCalls.push(JSON.parse(decodeURIComponent(q.slice(14))));
  return new Promise(resolve=>window.finishMixed=resolve);
 });
};
`,resolveDir:'..',loader:'ts'},bundle:true,write:false,platform:'browser'});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<div id="root"><button id="anchor">Answer</button></div>');await page.addScriptTag({content:code.outputFiles[0].text});
 await page.evaluate(()=>window.openView());
 const group=()=>page.locator('[data-field="Group"] .askbics-summary-card-rows button');
 const city=()=>page.locator('[data-field="City"] .askbics-summary-card-rows button');
 assert.equal(await page.evaluate(()=>window.loads),1,'table and cards share loaded rows');
 await group().filter({hasText:'A'}).click();
 await page.waitForFunction(()=>document.querySelector('[data-test-table]').textContent.includes('Grand Total'));
 assert.equal(await page.locator('.askbics-transaction-filter-chips .askbics-qna__filter-chip button').count(),1);
 assert.match(await page.locator('[data-test-table]').textContent(),/\["A","X","10"\]/);
 assert.doesNotMatch(await page.locator('[data-test-table]').textContent(),/\["B"/);
 await group().filter({hasText:'B'}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.askbics-transaction-filter-chips .askbics-qna__filter-chip button').length===2);
 assert.match(await page.locator('[data-test-table]').textContent(),/\["B","Y","30"\]/);
 await city().filter({hasText:'X'}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.askbics-transaction-filter-chips .askbics-qna__filter-chip button').length===3);
 assert.doesNotMatch(await page.locator('[data-test-table]').textContent(),/\["B","Y"/);
 await page.getByRole('button',{name:'Remove City: X',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.askbics-transaction-filter-chips .askbics-qna__filter-chip button').length===2);
 assert.match(await page.locator('[data-test-table]').textContent(),/\["B","Y"/);
 assert.equal(await page.evaluate(()=>window.loads),1,'all local selections avoid model calls');
 await page.getByRole('button',{name:'Back to answer',exact:true}).click();
 assert.equal(await page.locator('.askbics-transactions-overlay').count(),0);
 await page.evaluate(()=>{window.slow=window.openSlow();});
 await page.getByRole('button',{name:'Back to answer',exact:true}).click();
 await page.evaluate(async()=>{window.finish({text:'Late',table:{columns:[],rows:[],rowIndices:[]}});await window.slow;});
 assert.equal(await page.locator('.askbics-transactions-overlay').count(),0,'late response cannot restore exited view');
 await page.evaluate(()=>window.openRule());
 await page.locator('select[aria-label="Transaction rule view"]').selectOption('all',{force:true});
 await page.waitForFunction(()=>window.ruleLoads===2);
 await page.locator('select[aria-label="Transaction rule view"]').selectOption('included',{force:true});
 await page.waitForFunction(()=>document.querySelector('select[aria-label="Transaction rule view"]').value==='included');
 assert.equal(await page.evaluate(()=>window.ruleLoads),2,'returning to a cached reversal view avoids a model request');
 await page.getByRole('button',{name:'Back to answer',exact:true}).click();
 await page.evaluate(()=>window.startMixed());
 await page.waitForFunction(()=>typeof window.finishMixed==='function');
 assert.equal(await page.locator('[data-measure="Amount"] .askbics-summary-card-rows button').count(),2,'local cards paint before slow model cards');
 assert.deepEqual(await page.evaluate(()=>window.summaryCalls[0][0].summaryMeasures),['Ratio','Amount']);
 await page.evaluate(async()=>{window.finishMixed({table:{columns:['Group','Ratio','Amount'],rows:[['A','—','10']],modelGroupValues:[['A']],modelRawRows:[[null,null,10]],rowIndices:[[]],modelResultComplete:true}});await window.mixed;});
 assert.equal(await page.locator('[data-measure="Ratio"]').count(),0,'completely blank card is hidden');
 assert.equal(await page.evaluate(()=>window.summaryCalls.length),1);
 assert.ok(await page.evaluate(()=>window.cancels)>0);assert.deepEqual(errors,[]);
 console.log('Transactions browser: no extra local queries, OR/AND, chips, Back and stale-response suppression passed.');
} finally {await browser.close();}
