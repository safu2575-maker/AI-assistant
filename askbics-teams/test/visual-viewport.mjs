import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const bundle=await build({stdin:{contents:"import {fitVisualViewport} from './src/visualViewport';window.fit=fitVisualViewport(document.getElementById('root'));window.fit.update({width:1900,height:1200});",resolveDir:'..',loader:'ts'},bundle:true,write:false,platform:'browser'});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{const page=await browser.newPage({viewport:{width:1280,height:800}});await page.setContent('<style>html,body{margin:0}#parent{width:1900px;height:1200px}#root{box-sizing:border-box}</style><div id="parent"><div id="root"></div></div>');await page.addScriptTag({content:bundle.outputFiles[0].text});
const size=()=>page.locator('#root').evaluate(e=>[e.clientWidth,e.clientHeight]);assert.deepEqual(await size(),[1280,800]);
await page.setViewportSize({width:900,height:600});await page.waitForTimeout(100);assert.deepEqual(await size(),[900,600]);
await page.locator('#parent').evaluate(e=>{e.style.width='650px';e.style.height='450px'});await page.waitForTimeout(100);assert.deepEqual(await size(),[650,450]);
await page.evaluate(()=>window.fit.update({width:500,height:300}));assert.deepEqual(await size(),[500,300]);
await page.evaluate(()=>window.fit.update({width:1900,height:1200}));await page.locator('#parent').evaluate(e=>{e.style.width='1600px';e.style.height='1000px'});await page.setViewportSize({width:1400,height:900});await page.waitForTimeout(100);assert.deepEqual(await size(),[1400,900]);
await page.evaluate(()=>window.fit.destroy());console.log('Visual viewport: oversized host, focus resize, parent resize, normal view and restoration passed.');}finally{await browser.close();}
