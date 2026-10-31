import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const b=await build({stdin:{contents:"import {settingsColour} from './src/qna/settingsColour';window.c=settingsColour('Positive movements','#10b981');document.body.append(c.element);",resolveDir:'..',loader:'ts'},bundle:true,write:false});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
 const p=await browser.newPage();await p.setContent('<main></main>');await p.addScriptTag({content:b.outputFiles[0].text});
 await p.getByRole('button',{name:'Choose positive movements colour'}).click();
 await p.getByLabel('Positive movements hex colour',{exact:true}).fill('#123456');
 await p.getByRole('button',{name:'Apply colour'}).click();
 assert.equal(await p.evaluate(()=>c.input.value),'#123456');
 await p.getByRole('button',{name:'Choose positive movements colour'}).click();
 await p.getByLabel('Positive movements colour picker',{exact:true}).evaluate(el=>{el.value='#abcdef';el.dispatchEvent(new Event('input',{bubbles:true}));});
 assert.equal(await p.getByLabel('Positive movements hex colour',{exact:true}).inputValue(),'#ABCDEF');
 await p.getByRole('button',{name:'Apply colour'}).click();
 assert.equal(await p.evaluate(()=>c.input.value),'#abcdef');
 console.log('Colour text editing and picker synchronization passed.');
}finally{await browser.close();}
