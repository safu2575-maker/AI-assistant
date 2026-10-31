import {readFile} from 'node:fs/promises';
import less from '../../node_modules/less/dist/less-node.cjs';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const bundle=await build({entryPoints:['../src/qna/transactionCards.ts'],bundle:true,write:false,format:'iife',globalName:'Cards',platform:'browser'});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{const page=await browser.newPage();await page.setContent('<div id="cards"></div><table id="rows"><tbody><tr data-source-row="0"><td>A</td></tr><tr data-source-row="1"><td>B</td></tr></tbody></table>');await page.addStyleTag({content:(await less.render(await readFile('../style/visual.less','utf8'),{paths:['../style']})).css});await page.addScriptTag({content:bundle.outputFiles[0].text});await page.evaluate(async()=>{const table={summaryCards:{enabled:true,cards:[{field:'Group',title:'Groups',measure:'',sort:'Value',hideBlanks:true}]},columns:['Group','Amount'],rows:[['A','10'],['B','-5']],rowIndices:[[],[]],modelGroupValues:[['A'],['B']],modelSelections:[[{table:'T',column:'Group',value:'A'}],[{table:'T',column:'Group',value:'B'}]],drillScopes:[{question:'Amount',inheritedFilters:[]}]};window.selected=null;document.addEventListener('askbics-summary-selection',e=>window.selected=e.detail);await Cards.transactionCards(document.querySelector('#cards'),document.querySelector('#rows'),table,async()=>({table:{columns:['Group','Amount'],rows:[['A','10'],['B','-5']],modelGroupValues:[['A'],['B']],modelRawRows:[[null,10],[null,-5]],rowIndices:[[],[]]}}));});assert.equal(await page.locator('.askbics-summary-card-rows button').count(),2);await page.locator('.askbics-summary-card-rows button').first().click();assert.equal(await page.locator('#rows .askbics-summary-dim').count(),1);assert.equal(await page.evaluate(()=>window.selected[0][0].value),'A');await page.getByText('Clear selection',{exact:true}).click();assert.equal(await page.locator('.askbics-summary-dim').count(),0);assert.equal(await page.locator('.askbics-summary-bar.negative').count(),1);await page.getByRole('button',{name:'Summary card options'}).click();await page.getByRole('menuitemradio',{name:'Value: lowest first'}).click();assert.match(await page.locator('.askbics-summary-card-rows button').first().innerText(),/B/);assert.equal(await page.locator('.askbics-summary-zero').count(),2);await page.getByRole('button',{name:'Summary card options'}).click();await page.getByRole('menuitemradio',{name:'Show data bars'}).click();assert.equal(await page.locator('.askbics-summary-bar').count(),0);for(const scenario of [{members:[null,null],hide:true,cards:0,rows:0},{members:['A',null],hide:true,cards:1,rows:2},{members:[null],hide:false,cards:1,rows:1},{members:['   '],hide:true,cards:0,rows:0}]){
 await page.evaluate(async({members,hide})=>{document.querySelector('#cards').replaceChildren();await Cards.transactionCards(document.querySelector('#cards'),document.querySelector('#rows'),{summaryCards:{enabled:true,cards:[{field:'Group',title:'Groups',measure:'',sort:'Model order',hideBlanks:hide}]},columns:['Group','Amount'],rows:[],drillScopes:[{question:'Amount',inheritedFilters:[]}]},async()=>({table:{columns:['Group','Amount'],rows:members.map(m=>[m??'Unassigned','10']),modelGroupValues:members.map(m=>[m]),modelRawRows:members.map(()=>[null,10]),rowIndices:members.map(()=>[])}}));},scenario);
 assert.equal(await page.locator('.askbics-summary-card').count(),scenario.cards);
 assert.equal(await page.locator('.askbics-summary-card-rows button').count(),scenario.rows);
}
await page.evaluate(async()=>{
 document.querySelector('#cards').replaceChildren();
 const table={summaryCards:{enabled:true,cards:['Group','Tenant'].map(field=>({field,title:field,measure:'',sort:'Model order',hideBlanks:true}))},columns:['Group','Tenant','Amount'],rows:[['A','Alpha','10'],['B','Beta','20']],modelGroupValues:[['A','Alpha'],['B','Beta']],drillScopes:[{question:'Amount',inheritedFilters:[]}]};
 let call=0;await Cards.transactionCards(document.querySelector('#cards'),document.querySelector('#rows'),table,async()=>{const members=call++===0?['A','B']:['Alpha','Beta'];return {table:{rows:members.map(m=>[m,'10']),modelGroupValues:members.map(m=>[m]),modelRawRows:[[null,10],[null,10]]}};});
});
const groupRows=page.locator('[data-field="Group"] .askbics-summary-card-rows button');
const tenantRows=page.locator('[data-field="Tenant"] .askbics-summary-card-rows button');
await groupRows.first().click();
assert.match(await tenantRows.first().getAttribute('class'),/summary-related/);
assert.match(await tenantRows.last().getAttribute('class'),/summary-dim/);
assert.equal(await tenantRows.first().getAttribute('aria-pressed'),'false');
await tenantRows.last().click();
assert.equal(await page.locator('#rows .askbics-summary-dim').count(),2);
await page.getByText('Clear selection',{exact:true}).click();
assert.equal(await page.locator('.askbics-summary-related,.askbics-summary-dim').count(),0);
await tenantRows.last().click();
assert.match(await groupRows.last().getAttribute('class'),/summary-related/);
const layout=await page.evaluate(async()=>{
 document.querySelector('#cards').replaceChildren();let calls=0;
 const config={enabled:true,cards:[{field:'Group',title:'Short',measure:'',sort:'Model order',hideBlanks:true,icon:'people'},{field:'Group',title:'Repeat',measure:'',sort:'Model order',hideBlanks:true,icon:'money'},{field:'Other',title:'Long',measure:'',sort:'Model order',hideBlanks:true}]};
 await Cards.transactionCards(document.querySelector('#cards'),document.querySelector('#rows'),{summaryCards:config,columns:['Group','Amount'],rows:[],drillScopes:[{question:'Amount',inheritedFilters:[]}]},async()=>{calls++;const members=calls===1?['A','B']:['A','B','C','D','E','F'];return {table:{columns:['Group','Amount'],rows:members.map(m=>[m,'10']),modelGroupValues:members.map(m=>[m]),modelRawRows:members.map(()=>[null,10])}};});
 return {calls,heights:[...document.querySelectorAll('.askbics-summary-card')].map(c=>c.getBoundingClientRect().height),header:document.querySelector('.askbics-summary-card-head').getBoundingClientRect().height,scroll:[...document.querySelectorAll('.askbics-summary-card-rows')].map(r=>r.scrollHeight>r.clientHeight),footers:document.querySelectorAll('.askbics-summary-card-foot, .askbics-summary-heading-copy small').length};
});
assert.equal(layout.calls,2);assert.equal(new Set(layout.heights).size,1);assert.equal(layout.header,30);assert.deepEqual(layout.scroll,[false,false,true]);assert.equal(layout.footers,0);
const sizing=await page.evaluate(()=>{document.querySelector('#cards').style.width='780px';const strip=document.querySelector('.askbics-summary-strip');const cards=[...strip.children];const widths=cards.map(c=>c.getBoundingClientRect().width);const fits=strip.scrollWidth===strip.clientWidth;const rowHeight=cards[0].querySelector('.askbics-summary-card-rows button').getBoundingClientRect().height;strip.append(cards[0].cloneNode(true));return {widths,fits,rowHeight,overflow:strip.scrollWidth>strip.clientWidth,gap:getComputedStyle(strip).gap};});
assert.equal(sizing.fits,true);assert.equal(new Set(sizing.widths).size,1);assert.equal(sizing.rowHeight,24);assert.equal(sizing.overflow,true);assert.equal(sizing.gap,'8px');
await page.evaluate(()=>{
 document.querySelector('#cards').replaceChildren();
 window.loadingDone=Cards.transactionCards(document.querySelector('#cards'),document.querySelector('#rows'),{summaryCards:{enabled:true,cards:[{field:'Group',sort:'Model order'}]},columns:[],rows:[],drillScopes:[{question:'Amount'}]},()=>new Promise(resolve=>{window.finishCard=resolve;}));
});
assert.equal(await page.locator('#cards').getAttribute('aria-busy'),'true');
assert.match(await page.getByRole('status').innerText(),/0 of 1/);
assert.equal(await page.locator('.askbics-analysis-loading__spinner').count(),2);
await page.evaluate(async()=>{window.finishCard({table:{rows:[['A','10']],modelGroupValues:[['A']],modelRawRows:[[null,10]]}});await window.loadingDone;});
assert.equal(await page.locator('#cards').getAttribute('aria-busy'),'false');
assert.equal(await page.getByRole('status').count(),0);
assert.equal(await page.locator('.askbics-analysis-loading__spinner').count(),0);
console.log('Summary loading lifecycle, interactions, layout and request reuse passed.');}finally{await browser.close();}
