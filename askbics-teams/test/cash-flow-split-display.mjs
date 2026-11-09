import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import less from 'less';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const bundle=await build({stdin:{contents:`
import {cashFlowTable} from './src/cashFlowTable';
import {GlobalQnaUi} from './src/qna/ui';
import {GlobalQnaEngine} from './src/qna/engine';
const ui=new GlobalQnaUi(document.getElementById('root'),new GlobalQnaEngine({rowCount:1,fields:[],measures:[],selectedIndices:[],formatValue:(_,v)=>String(v)}));
window.clicks=0;ui.onSelect=()=>window.clicks++;
const root={company:'2396',year:'2026',document:'1',item:'1',currency:'',amount:-100,account:'Bank'};
const model=cashFlowTable([70,30].map((n,i)=>({root:'root',amount:-n,account:'Expense'+i,category:'Expense',status:'Resolved',path:[root,{...root,document:'2',account:'Expense'+i}]})),{fields:{document:'document'},measure:'Amount',displayColumns:['document','Amount']});
ui.copyTextAsTsv=async rows=>{window.copied=rows;return true;};ui.previewPdf=async report=>{window.pdf=report;};
const rows=[...model.rows,model.total([0,1])];
const card=ui.table({columns:model.columns,rows,rowIndices:rows.map(()=>[]),totalRowIndices:[2],filteredTotals:model.total,presentRows:model.presentRows,defaultDataBarColumns:['Variance']});
document.getElementById('root').append(card);
`,resolveDir:'..',loader:'ts'},bundle:true,write:false,platform:'browser'});
const css=await less.render(await readFile('../style/visual.less','utf8'),{paths:['../style']});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
 const page=await browser.newPage();await page.setContent('<div id="root" style="height:500px;user-select:none"></div>');await page.addStyleTag({content:css.css});await page.addScriptTag({content:bundle.outputFiles[0].text});

 const actual=()=>page.locator('tbody tr[data-source-row] td[data-column-index="1"]').allTextContents();
 assert.deepEqual((await actual()).slice(0,2),['-100.00','']);
 await page.getByRole('button',{name:'Copy table data for Excel',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>window.copied.slice(1,3).map(r=>[r[1],r.at(-2)])),[['-100.00','-30.00'],['','30.00']]);
 await page.locator('[aria-label="Sort Destination amount ascending"]').evaluate(e=>e.click());
 // Second activation sorts descending: the other destination now carries Actual.
 await page.locator('th[data-column-index="4"] .askbics-qna__column-actions button').first().evaluate(e=>e.click());
 await page.getByRole('button',{name:'Copy table data for Excel',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>window.copied.slice(1,3).map(r=>[r[1],r.at(-2)])),[['-100.00','-70.00'],['','70.00']]);
 await page.getByRole('button',{name:'View table PDF preview',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>window.pdf.rows),await page.evaluate(()=>window.copied.slice(1)));
 assert.equal(await page.locator('.askbics-qna__data-bar.is-negative').count(),1);
 console.log('Cash-flow split display: Actual once, signed variance, sorting and Excel passed.');
} finally {await browser.close();}
