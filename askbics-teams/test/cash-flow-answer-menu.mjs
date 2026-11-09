import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const bundle=await build({stdin:{contents:`
import {GlobalQnaUi} from './src/qna/ui';
import {GlobalQnaEngine} from './src/qna/engine';
import {bindTransactions} from './src/qna/transactionView';
const engine=new GlobalQnaEngine({fields:[],measures:[],rowCount:0,selectedIndices:[],formatValue:(_,v)=>String(v)});
const ui=new GlobalQnaUi(document.getElementById('host'),engine);
window.requests=0;ui.prepareQuestion=async()=>{window.requests++;};
const answer=document.createElement('button');answer.textContent='Test answer';document.querySelector('.askbics-qna').append(answer);
ui.transactionMenu(answer,()=>[{question:'Show Rent by Year'}]);
const holder=document.createElement('table');holder.innerHTML='<tbody><tr data-source-row="0"><td data-column-index="0">Analysis member</td></tr></tbody>';document.querySelector('.askbics-qna').append(holder);
bindTransactions(document.querySelector('.askbics-qna'),holder,{columns:['Year'],rows:[['2026']],rowIndices:[[]]},{mode:'breakdown',period:'2026'},[],false,async()=>{window.requests++;},()=>document.createElement('div'),['Year']);
`,resolveDir:'..',loader:'ts'},bundle:true,write:false,platform:'browser'});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<div id="host"></div>');await page.addScriptTag({content:bundle.outputFiles[0].text});
 for(const label of ['Test answer','Analysis member']){
  await page.getByText(label,{exact:true}).click({button:'right'});
  const menu=page.locator('.askbics-transactions-menu');
  assert.deepEqual(await menu.locator(':scope > button').allTextContents(),['Configure transaction fields in settings','Summarize by›','Cash flow for this selection']);
  await menu.getByRole('menuitem',{name:'Cash flow for this selection',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Cash flow',exact:true});await dialog.waitFor();
  assert.match(await dialog.textContent(),/Cash flow for selected cell/);
  assert.equal(await page.evaluate(()=>window.requests),0,'invalid saved cashflow mappings must block queries');
  const setup=page.getByRole('button',{name:'Close cash-flow panel'});if(await setup.isVisible())await setup.click();
  await dialog.getByRole('button',{name:'Back',exact:true}).click();
  assert.equal(await page.getByText(label,{exact:true}).count(),1);
 }
 assert.deepEqual(errors,[]);console.log('Cash flow answer/analysis menu: third action, explicit scope, no queries, Back preserves answer passed.');
}finally{await browser.close();}
