import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const bundle=await build({stdin:{contents:`import {appendSummarizeMenu} from './src/qna/transactionView';const menu=document.querySelector('#menu');appendSummarizeMenu(menu,['Company','Year'],()=>window.chosen=true);const cash=document.createElement('button');cash.textContent='Cash flow';menu.append(cash);`,resolveDir:'..',loader:'ts'},bundle:true,write:false,platform:'browser'});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
 const page=await browser.newPage();await page.setContent('<style>#menu{position:absolute;left:100px;top:100px;width:160px}button{display:block;width:160px;height:32px}.askbics-summary-submenu{position:fixed;width:160px;background:white}[hidden]{display:none}</style><div id="menu"><button>Show transactions</button></div>');await page.addScriptTag({content:bundle.outputFiles[0].text});
 const trigger=page.getByRole('menuitem',{name:/Summarize by/}),flyout=page.getByRole('menu',{name:'Summarize by field'});
 await trigger.hover();assert.equal(await flyout.isVisible(),true);
 await page.getByRole('button',{name:'Cash flow',exact:true}).hover();assert.equal(await flyout.isVisible(),false);assert.equal(await trigger.getAttribute('aria-expanded'),'false');
 await trigger.hover();await flyout.getByRole('menuitem',{name:'Company'}).hover();assert.equal(await flyout.isVisible(),true);
 await trigger.hover();assert.equal(await flyout.isVisible(),true);
 await page.getByRole('button',{name:'Show transactions'}).hover();assert.equal(await flyout.isVisible(),false);
 await trigger.focus();await page.keyboard.press('ArrowRight');assert.equal(await flyout.isVisible(),true);
 await page.keyboard.press('ArrowDown');assert.equal(await flyout.getByRole('menuitem',{name:'Year'}).evaluate(e=>e===document.activeElement),true);
 await page.keyboard.press('Escape');assert.equal(await flyout.isVisible(),false);assert.equal(await trigger.evaluate(e=>e===document.activeElement),true);
 await trigger.hover();await page.mouse.move(20,20);assert.equal(await flyout.isVisible(),false);
 console.log('Summarize hover region, sibling dismissal, pointer exit and keyboard navigation passed.');
} finally {await browser.close();}
