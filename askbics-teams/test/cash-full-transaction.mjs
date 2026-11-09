import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import less from 'less';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const bundle=await build({stdin:{contents:`
import {fullTransaction} from './src/qna/cashFullTransaction';
import {GlobalQnaUi} from './src/qna/ui';import {GlobalQnaEngine} from './src/qna/engine';import {cashKey} from './src/cashFlow';
const ui=new GlobalQnaUi(document.getElementById('root'),new GlobalQnaEngine({fields:[],measures:[],rowCount:0,selectedIndices:[],formatValue:(_,v)=>String(v)}));
ui.copyTextAsTsv=async rows=>{window.copied=rows;return true;};ui.previewPdf=async report=>{window.pdf=report;};
const p=(document,item,account,amount,clearing='')=>({company:'9720',year:'2026',currency:'SAR',date:'2026-01-01',document,item,account,amount,clearing});
const rows=[p('P','1','BANK',-100),p('P','2','VENDOR',100,'C'),p('I','1','VENDOR',-100,'C'),p('I','2','EXP',100)];
const a={root:cashKey(rows[0]),amount:-100,account:'VENDOR',category:'Unresolved',status:'Allocation unclear',path:rows.slice(0,2)};
window.loads=0;window.openFull=()=>fullTransaction(document.querySelector('.askbics-qna'),document.getElementById('open'),rows[0],[a],rows,{fields:{},measure:'Amount',rules:[],displayColumns:['Amount']},t=>ui.table(t),{paths:[{root:a.root,path:rows,status:'Destination found'}],diagnostics:()=>'{"run":"test"}',load:async(root,active)=>{window.loads++;await new Promise(resolve=>window.release=resolve);if(!active())throw Error('cancelled');return {rows:[...rows,p('J','1','GRIR',-20),p('J','2','EXP',20),{...rows[0],company:'OTHER'}],complete:false,reason:'Test limit'};}});
document.getElementById('open').onclick=window.openFull;
`,resolveDir:'..',loader:'ts'},bundle:true,write:false,platform:'browser'});
const css=await less.render(await readFile('../style/visual.less','utf8'),{paths:['../style']});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1100,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<button id="open">Open</button><div id="root" class="askbics-host" style="position:relative;height:850px"></div>');await page.addStyleTag({content:css.css});await page.addScriptTag({content:bundle.outputFiles[0].text});await page.getByRole('button',{name:'Open',exact:true}).click();
 let dialog=page.getByRole('dialog',{name:'Full transaction',exact:true});
 assert.equal(await page.evaluate(()=>window.loads),0);assert.equal(await dialog.locator('[data-full-document]').count(),2);
 assert.match(await dialog.innerText(),/Stopped at Document P.*Allocation unclear/);assert.match(await dialog.innerText(),/Possible connection—not a confirmed allocation/);
 const invoice=dialog.locator('[data-full-document]').last();assert.match(await invoice.innerText(),/EXP/); // blank-clearing balancing line retained
 await invoice.getByRole('button',{name:'Copy table data for Excel'}).click();assert.equal((await page.evaluate(()=>window.copied)).length,4);
 await invoice.getByRole('button',{name:'View table PDF preview'}).click();assert.deepEqual(await page.evaluate(()=>window.pdf.rows),await page.evaluate(()=>window.copied.slice(1)));
 await dialog.getByRole('button',{name:'Next issue'}).click();assert.match(await dialog.getByRole('status').innerText(),/Issue 1 of 1/);
 await dialog.getByText('Document journey · Confirmed and possible connections',{exact:true}).click();assert.match(await dialog.innerText(),/Possible connection—not a confirmed allocation/);
 await dialog.getByRole('button',{name:'Load missing entries'}).click();assert.equal(await page.evaluate(()=>window.loads),1);await page.evaluate(()=>window.release());
 await dialog.getByText(/Available entries—trace incomplete. Test limit/).waitFor();assert.equal(await dialog.locator('[data-full-document]').count(),3);assert.doesNotMatch(await dialog.innerText(),/Company OTHER/);
 await dialog.getByRole('button',{name:'Close full transaction'}).click();assert.equal(await page.locator('.askbics-qna').evaluate(e=>e.inert),false);
 await page.getByRole('button',{name:'Open',exact:true}).click();dialog=page.getByRole('dialog',{name:'Full transaction',exact:true});await dialog.getByRole('button',{name:'Load missing entries'}).click();await dialog.getByRole('button',{name:'Close full transaction'}).click();await page.evaluate(()=>window.release());assert.equal(await page.getByRole('dialog',{name:'Full transaction',exact:true}).count(),0);assert.deepEqual(errors,[]);
 console.log('Full transaction: cached documents, blank-clearing lines, stopping point, candidate labels, exports, explicit bounded loading, company isolation and stale-close cancellation passed.');
}finally{await browser.close();}
