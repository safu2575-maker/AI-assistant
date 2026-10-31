import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import less from 'less';
import {readFile} from 'node:fs/promises';
const css=(await less.render(await readFile('../style/visual.less','utf8'),{paths:['../style']})).css;
const bundle=await build({entryPoints:['../src/qna/summaryCardSettings.ts'],bundle:true,write:false,format:'iife',globalName:'Settings',platform:'browser'});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
 const page=await browser.newPage();await page.setContent('<main></main>');await page.addStyleTag({content:css});await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.evaluate(()=>{window.editor=Settings.summaryCardSettings({enabled:true,cards:[{field:'Group',title:'Test',measure:'',sort:'Model order',hideBlanks:true}]},['Group'],['Amount']);document.querySelector('main').append(window.editor.element);});
 await page.getByRole('button',{name:'Edit card 1',exact:true}).click();await page.getByRole('button',{name:'Icon for card 1: Bar chart',exact:true}).click();
 assert.equal(await page.locator('[role=option] svg').count(),45);
 assert.equal(await page.locator('.askbics-icon-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),6);
 assert.equal(await page.getByRole('option',{name:'Amount',exact:true}).getAttribute('title'),'Amount');
 await page.locator('input[type=search]').last().press('ArrowDown');
 await page.keyboard.press('ArrowRight');
 assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Growth');
 await page.keyboard.press('ArrowDown');
 assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Transfer');
 await page.locator('input[type=search]').last().fill('Shopping bag');
 await page.getByRole('option',{name:'Shopping bag',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Icon for card 1: Shopping bag',exact:true}).locator('svg').count(),1);
 assert.equal(await page.evaluate(()=>window.editor.read().cards[0].icon),'bag');
 console.log('45 icon previews, selected preview and saved icon passed.');
} finally {await browser.close();}
