import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import less from 'less';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const bundle=await build({stdin:{contents:`
import {GlobalQnaUi} from './src/qna/ui';
import {GlobalQnaEngine} from './src/qna/engine';
import {tableExports} from './src/qna/tableExport';
const ui=new GlobalQnaUi(document.getElementById('root'),new GlobalQnaEngine({rowCount:0,fields:[],measures:[],selectedIndices:[],formatValue:(_,v)=>String(v)}));
const rows=Array.from({length:600},(_,i)=>['Account '+i,String(i)]);
const keys=rows.map((_,i)=>i<300?'a':'b');
const card=ui.table({columns:['Account','Debit'],rows,rowIndices:rows.map(()=>[]),documentGroups:{keys,labels:{a:'Document A',b:'Document B'},totals:(ids,filtered)=>[filtered?'Visible lines total':'Available lines total',String(ids.reduce((n,i)=>n+i,0))]}});
document.getElementById('root').append(card);window.exportAll=()=>tableExports.get(card).rows(true);
`,resolveDir:'..',loader:'ts'},bundle:true,write:false,platform:'browser'});
const css=await less.render(await readFile('../style/visual.less','utf8'),{paths:['../style']});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const page=await browser.newPage();await page.setContent('<div id="root" style="height:500px"></div>');await page.addStyleTag({content:css.css});await page.addScriptTag({content:bundle.outputFiles[0].text});
 assert.ok(await page.locator('tbody tr[data-source-row]').count()<200,'long groups virtualize');
 assert.equal((await page.evaluate(()=>window.exportAll())).length,605);
 await page.getByRole('button',{name:'Collapse all',exact:true}).click();
 assert.equal(await page.locator('.askbics-document-group').count(),2);
 assert.equal(await page.locator('tbody tr[data-source-row]').count(),0);
 assert.equal((await page.evaluate(()=>window.exportAll())).length,605,'combined export retains collapsed rows');
 await page.getByRole('button',{name:'Expand all',exact:true}).click();
 await page.getByRole('button',{name:'More options for Debit',exact:true}).click();await page.getByRole('button',{name:'Sort',exact:true}).click();await page.getByRole('button',{name:'Descending',exact:true}).click();
 const exported=await page.evaluate(()=>window.exportAll());
 assert.equal(exported[1][0],'Document A');assert.equal(exported[2][1],'299');assert.equal(exported[303][0],'Document B');assert.equal(exported[304][1],'599');
 console.log('Grouped documents: virtualization, collapsing, complete export and within-document sorting passed.');
}finally{await browser.close();}
