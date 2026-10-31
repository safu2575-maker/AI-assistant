import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import less from 'less';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const bundle=await build({stdin:{contents:`
import {GlobalQnaUi} from './src/qna/ui';
import {GlobalQnaEngine} from './src/qna/engine';
const names=['Company','Document','Clearing','Account','Account description',...Array.from({length:8},(_,i)=>'Extra '+i)];
const engine=new GlobalQnaEngine({rowCount:0,fields:names.map(name=>({key:name,name,values:[],uniqueValues:[]})),measures:[{key:'Amount',name:'Amount',values:[],formatHint:'number'}],selectedIndices:[],formatValue:(_,v)=>String(v)});
const ui=new GlobalQnaUi(document.getElementById('root'),engine);ui.hostMode='teams';
window.openSettings=()=>ui.showLayoutSettings();window.saved=()=>engine.getLayoutSettings().cashFlow;
window.openSettings();`,resolveDir:'..',loader:'ts'},bundle:true,write:false,platform:'browser'});
const css=await less.render(await readFile('../style/visual.less','utf8'),{paths:['../style']});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1100,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<div id="root" class="askbics-host" style="position:relative;height:860px"></div>');await page.addStyleTag({content:css.css});await page.addScriptTag({content:bundle.outputFiles[0].text});
 const openTab=async()=>{await page.getByRole('button',{name:'Filters & transactions',exact:true}).click();await page.getByRole('tab',{name:'Cash flow',exact:true}).click();};
 await openTab();
 assert.equal(await page.locator('.askbics-cash-settings').isVisible(),true);
 await page.getByRole('button',{name:'Company code *: Choose…',exact:true}).click();await page.getByRole('option',{name:'Company',exact:true}).click();
 await page.getByRole('button',{name:'Save settings',exact:true}).click();
 assert.match(await page.locator('.askbics-cash-settings [role=alert]').textContent(),/Document number/);
 assert.equal(await page.evaluate(()=>window.saved()),undefined);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.evaluate(()=>window.openSettings());await openTab();
 for(const [name,value] of [['Company code *','Company'],['Document number *','Document'],['Clearing document *','Clearing'],['Signed posting amount *','Amount']]){
  await page.getByRole('button',{name:name+': Choose…',exact:true}).click();await page.getByRole('option',{name:value,exact:true}).click();
 }
 await page.getByRole('button',{name:'Starting-posting columns (maximum 10)',exact:true}).click();
 const checks=page.locator('.askbics-cash-settings .askbics-settings-multiselect input[type=checkbox]');await checks.first().waitFor();for(let i=0;i<10;i++)await checks.nth(i).check();
 assert.equal(await page.locator('.askbics-cash-settings input[type=checkbox]:checked').count(),10);
 assert.ok(await page.locator('.askbics-cash-settings input[type=checkbox]:disabled').count()>0);await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Save settings',exact:true}).click();
 const saved=await page.evaluate(()=>window.saved());assert.equal(saved.fields.company,'Company');assert.equal(saved.measure,'Amount');assert.equal(saved.displayColumns.length,10);assert.deepEqual(saved.rules,[]);
 await page.evaluate(()=>window.openSettings());await openTab();assert.equal(await page.locator('.askbics-cash-settings select[aria-label="Company code *"]').inputValue(),'Company');
 assert.ok(await page.locator('.askbics-cash-settings .askbics-settings-help-icon').count()>0);
 await page.getByRole('button',{name:'Starting-posting columns (maximum 10)',exact:true}).click();await checks.first().uncheck();await page.keyboard.press('Escape');await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.saved()),saved);
 await page.evaluate(()=>window.openSettings());await page.getByRole('button',{name:'Saved reports & backup',exact:true}).click();await page.getByRole('tab',{name:'Settings backup',exact:true}).click();
 await page.getByRole('button',{name:'Copy settings',exact:true}).click();const popup=page.locator('.askbics-backup-popup');await popup.waitFor({state:'visible'});
 const backup=JSON.parse(await page.getByRole('textbox',{name:'Settings backup JSON'}).inputValue());assert.deepEqual(backup.layout.cashFlow,saved);
 assert.ok(await popup.evaluate(el=>{const toolbar=document.querySelector('.askbics-settings-sticky-toolbar');return Number(getComputedStyle(el).zIndex)>Number(getComputedStyle(toolbar).zIndex);}));
 const box=await page.locator('.askbics-backup-dialog').boundingBox();assert.ok(await page.evaluate(({x,y})=>!!document.elementFromPoint(x,y)?.closest('.askbics-backup-dialog'),{x:box.x+box.width/2,y:box.y+30}));
 backup.layout.cashFlow.fields.company='Old Company';backup.layout.cashFlow.displayColumns=backup.layout.cashFlow.displayColumns.map(v=>v==='Company'?'Old Company':v);backup.fields.push('Old Company');
 await page.getByRole('textbox',{name:'Settings backup JSON'}).fill(JSON.stringify(backup));await popup.getByText('Import and export options',{exact:true}).click();await popup.getByRole('button',{name:'Map renamed fields',exact:true}).click();
 await popup.locator('select[aria-label="Replacement for Old Company"]').selectOption('Company',{force:true});await popup.getByRole('button',{name:'Apply settings',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.saved()),saved);
 assert.deepEqual(errors,[]);console.log('Cash-flow settings: navigation, shared selectors, validation, save/cancel, persistence, 10-column limit and help passed.');
}finally{await browser.close();}
