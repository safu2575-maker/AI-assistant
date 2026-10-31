import {readFile} from 'node:fs/promises';
import less from 'less';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const {css}=await less.render(await readFile('../style/visual.less','utf8'),{filename:'../style/visual.less'});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
 const page=await browser.newPage();
 await page.setContent(`<div id="scroll" style="width:600px;height:200px;overflow:auto"><table class="askbics-qna__table" style="width:1000px;table-layout:fixed"><tbody>${Array.from({length:12},()=>'<tr>'+Array.from({length:6},()=>'<td>Value</td>').join('')+'</tr>').join('')}<tr class="askbics-qna__table-total"><td id="total-label">Grand Total</td><td></td><td></td><td></td><td></td><td id="amount">211,653</td></tr></tbody></table></div>`);
 await page.addStyleTag({content:css});
 for (const offset of [1,40,100,250,400,100,1]) {
  await page.locator('#scroll').evaluate((el,x)=>{el.scrollLeft=x;},offset);
  const edge=await page.locator('tbody tr:first-child td:first-child').evaluate(el=>{
   const r=el.getBoundingClientRect(),w=document.querySelector('#scroll').getBoundingClientRect();
   return {gap:r.left-w.left,hit:el.contains(document.elementFromPoint(w.left+1,r.top+r.height/2))};
  });
  assert(Math.abs(edge.gap)<1,JSON.stringify(edge));
  assert(edge.hit, 'Frozen cell must cover the left viewport edge');
 }
 await page.locator('#scroll').evaluate(el=>{el.scrollLeft=el.scrollWidth;});
 await page.waitForTimeout(100);
 assert.equal(await page.locator('#amount').evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true);
 assert.equal(await page.locator('#total-label').evaluate(el=>{const r=el.getBoundingClientRect(),w=document.querySelector('#scroll').getBoundingClientRect();return Math.abs(r.left-w.left)<1;}),true);
 assert.equal(await page.locator('#total-label').evaluate(el=>getComputedStyle(el).bottom),'0px');
 console.log('Narrow transaction table: amount total visible after horizontal scroll; total remains vertically sticky.');
} finally {await browser.close();}
