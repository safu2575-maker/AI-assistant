import {readFile} from 'node:fs/promises';
import less from 'less';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';

const {css}=await less.render(await readFile('../style/visual.less','utf8'),{filename:'../style/visual.less'});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
 const page=await browser.newPage();
 await page.setContent('<div class="askbics-transactions-overlay">Transactions</div><div class="askbics-clearing-overlay"><section class="askbics-clearing-panel"><header>Details<button>×</button></header><div>Related rows</div></section></div>');
 await page.addStyleTag({content:css});
 const close=page.locator('.askbics-clearing-panel button');
 await close.click({trial:true});
 assert.equal(await page.evaluate(()=>{
  const panel=document.querySelector('.askbics-clearing-panel');
  const r=panel.getBoundingClientRect();
  return panel.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
 }),true);
 console.log('Shared clearing/document popup remains visible and clickable above transaction overlay.');
 await page.evaluate(()=>{const pdf=document.createElement('div');pdf.className='askbics-qna__config-overlay askbics-qna__pdf-overlay';pdf.innerHTML='<section class="askbics-qna__config-panel"><button>Close PDF</button></section>';document.body.append(pdf);});
 await page.getByRole('button',{name:'Close PDF'}).click({trial:true});
 assert.equal(await page.locator('.askbics-qna__pdf-overlay button').evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true);
 console.log('PDF preview stays above transaction and linked-document windows.');
} finally {await browser.close();}

