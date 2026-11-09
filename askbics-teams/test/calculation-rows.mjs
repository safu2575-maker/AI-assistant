import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const bundle=await build({stdin:{contents:`
import {GlobalQnaUi} from './src/qna/ui';
import {GlobalQnaEngine} from './src/qna/engine';
import {calculationItemsAsRows, calculationYearsAsColumns, calculationFieldsAsColumns} from './src/calculationRows';
const engine=new GlobalQnaEngine({fields:[],measures:[],rowCount:0,selectedIndices:[],formatValue:(_,v)=>String(v)});
window.selectionCalls=0;const ui=new GlobalQnaUi(document.getElementById('host'),engine,()=>window.selectionCalls++);
const table=calculationItemsAsRows({columns:['Year','Yield','Revenue'],rows:[['2026','20.00%','100.00']],rowIndices:[[3]],modelRawRows:[[2026,.2,100]],modelTotals:['Grand Total','20.00%','100.00'],modelRawTotals:[null,.2,100],modelEditor:{rows:['Year'],columns:[],measures:['Yield','Revenue'],filters:[]},calculationNotes:{'0:1':['Rental = 100','Context: Year = 2026','EBITDA = 500','Context: Year = 2025','/ → 0.2','  Rental → 100','  EBITDA → 500','Result: 0.2']}},['Yield','Revenue']);
document.getElementById('result').append(ui.table(calculationYearsAsColumns(table,'Year')));
const multi=calculationItemsAsRows({columns:['Company Code','Year','Yield'],rows:[['2238','2025','10%'],['2238','2026','20%'],['2396','2025','30%']],rowIndices:[[1],[2],[3]],modelRawRows:[[2238,2025,.1],[2238,2026,.2],[2396,2025,.3]],modelEditor:{rows:['Company Code','Year'],columns:[],measures:['Yield'],filters:[]}},['Yield']);
const subtotal=calculationItemsAsRows({columns:['Company Code','Yield'],rows:[['2238','15%'],['2396','30%']],rowIndices:[[1,2],[3]],modelRawRows:[[2238,.15],[2396,.3]]},['Yield']);
window.multi=calculationFieldsAsColumns(multi,['Year'],subtotal);
document.getElementById('multi').append(ui.table(window.multi));

`,resolveDir:'..',loader:'ts'},bundle:true,write:false,platform:'browser'});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<div id="host"></div><div id="result"></div><div id="multi"></div>');
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 const result=page.locator('#result');
 assert.match(await result.textContent(),/Calculation/);
 assert.match(await result.textContent(),/Grand Total/);
 assert.match(await result.textContent(),/2026/);
 assert.match(await result.textContent(),/20.00%/);
 assert.match(await result.textContent(),/Revenue/);
 assert.equal(await result.locator('tr.askbics-qna__table-total').count(),0);
 assert.equal(await result.locator('button').filter({hasText:/^Copy for Excel$/}).count(),1);
 assert.equal(await result.locator('button').filter({hasText:/^View PDF$/}).count(),1);
 assert(!await result.textContent().then(t=>t.includes('Value % of grand total')));
 assert.deepEqual(await page.evaluate(()=>window.multi.columns),['Calculation','Company Code','2025','2026','Grand Total']);
 assert.deepEqual(await page.evaluate(()=>window.multi.rows),[['Yield','2238','10%','20%','15%'],['Yield','2396','30%','—','30%']]);
 assert.deepEqual(await page.evaluate(()=>window.multi.cellIndices[0][3]),[2]);
 const action=page.getByRole('button',{name:'View calculation details for Yield · 2026',exact:true});
 await action.locator('..').hover();const tooltip=page.locator('#host .askbics-qna__tooltip');await tooltip.waitFor({state:'visible'});
 assert.match(await tooltip.textContent(),/Numerator: Rental = 100/);assert.match(await tooltip.textContent(),/Denominator: EBITDA = 500/);assert(!(await tooltip.textContent()).includes('Result: 0.2'));
 await action.click();const dialog=page.getByRole('dialog',{name:'Calculation details',exact:true});await dialog.waitFor({state:'visible'});assert.match(await dialog.textContent(),/Result: 0.2/);assert.match(await dialog.textContent(),/Context: Year = 2025/);
 await page.getByRole('button',{name:'Close calculation details',exact:true}).click();assert.equal(await dialog.count(),0);assert.equal(await page.evaluate(()=>window.selectionCalls),0,'Details must not select or filter the report');assert.equal(await action.evaluate(el=>document.activeElement===el),true);
 assert.deepEqual(errors,[]);
 console.log('Calculation rows: shared table rendering, per-item totals, formatting and export toolbar passed.');
}finally{await browser.close();}
