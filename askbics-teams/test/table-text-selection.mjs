import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import less from 'less';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const bundle=await build({stdin:{contents:`
import {GlobalQnaUi} from './src/qna/ui';
import {GlobalQnaEngine} from './src/qna/engine';
const ui=new GlobalQnaUi(document.getElementById('root'),new GlobalQnaEngine({rowCount:1,fields:[],measures:[],selectedIndices:[],formatValue:(_,v)=>String(v)}));
window.clicks=0;ui.onSelect=()=>window.clicks++;
const card=ui.table({columns:['Account','Amount'],defaultDataBarColumns:['Amount'],rows:[['Vendor account','12345.67']],rowIndices:[[0]]});
document.getElementById('root').append(card);
`,resolveDir:'..',loader:'ts'},bundle:true,write:false,platform:'browser'});
const css=await less.render(await readFile('../style/visual.less','utf8'),{paths:['../style']});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
 const page=await browser.newPage();await page.setContent('<div id="root" style="height:500px;user-select:none"></div>');await page.addStyleTag({content:css.css});await page.addScriptTag({content:bundle.outputFiles[0].text});
 assert.equal(await page.locator('tbody .askbics-qna__data-bar').count(),1);
 const cell=page.locator('td').first();await cell.scrollIntoViewIfNeeded();
 const box=await cell.boundingBox();await page.mouse.move(box.x+10,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+85,box.y+box.height/2,{steps:12});await page.mouse.up();
 assert.match(await page.evaluate(()=>getSelection().toString()),/Vendor/);assert.equal(await page.evaluate(()=>window.clicks),0);
 await page.evaluate(()=>getSelection().removeAllRanges());await cell.click();assert.equal(await page.evaluate(()=>window.clicks),1);
 await page.evaluate(()=>getSelection().removeAllRanges());
 const amount=page.locator('td').nth(1);const numberBox=await amount.locator('.askbics-qna__cell-value').boundingBox();
 await page.mouse.move(numberBox.x,numberBox.y+numberBox.height/2);await page.mouse.down();await page.mouse.move(numberBox.x+numberBox.width,numberBox.y+numberBox.height/2,{steps:10});await page.mouse.up();
 assert.match(await page.evaluate(()=>getSelection().toString()),/12345/);assert.equal(await page.evaluate(()=>window.clicks),1);
 console.log('Table text selection: native drag survives host user-select:none; drag does not filter; ordinary click still filters.');
} finally {await browser.close();}
