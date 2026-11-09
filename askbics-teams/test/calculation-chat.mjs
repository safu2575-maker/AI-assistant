import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const bundle=await build({stdin:{contents:`
import {GlobalQnaUi} from './src/qna/ui';
import {GlobalQnaEngine} from './src/qna/engine';
import {settingsBackupView} from './src/qna/settingsBackupView';
const measure={id:'ratio',name:'Rental ratio',description:'',formula:"('Rental') / ('EBITDA')",enabled:true,format:'number',decimals:2,total:'recalculate'};
const groups=[{version:1,id:'finance',name:'Finance',description:'',enabled:true,measures:[measure]}];
const engine=new GlobalQnaEngine({fields:[],measures:[],rowCount:0,selectedIndices:[],formatValue:(_,v)=>String(v)});
engine.setLayoutSettings({calculationGroups:groups});const ui=new GlobalQnaUi(document.getElementById('host'),engine);window.ui=ui;
ui.prepareQuestion=async q=>{window.question=q;return {text:'Test answer'};};
window.backup={format:'askBICS-settings',version:1,host:'powerbi',layout:{calculationGroups:groups}};
document.getElementById('backup').append(settingsBackupView('powerbi',[],['Rental','EBITDA','Rental ratio'],()=>structuredClone(window.backup),()=>{},v=>window.applied=v,()=>{},false));
`,resolveDir:'..',loader:'ts'},bundle:true,write:false,platform:'browser'});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<div id="host"></div><div id="backup"></div>');await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.evaluate(()=>{window.ui.input.value='#';window.ui.showMeasureAutocomplete();});
 await page.evaluate(()=>{window.ui.input.value='show rent';window.ui.input.setSelectionRange(9,9);window.ui.showAutocomplete();});
 const kpiSuggestion=page.locator('.askbics-qna__suggestion').filter({hasText:'(Calculation KPI)'});
 assert.match(await kpiSuggestion.textContent(),/Rental ratio/);
 await kpiSuggestion.click();assert.equal(await page.evaluate(()=>window.ui.input.value),'show #Rental ratio');
 await page.evaluate(()=>{window.ui.suggestionsDismissed=false;window.ui.input.value='#';window.ui.input.setSelectionRange(1,1);window.ui.showMeasureAutocomplete();});
 assert.match(await page.locator('.askbics-qna__suggestions').textContent(),/Finance/);
 const items=page.locator('.askbics-qna__suggestion');assert.equal(await items.count(),2);
 await items.first().click();assert.equal(await page.evaluate(()=>window.ui.input.value.trim()),'#Finance');
 assert.equal(await page.locator('.askbics-calculation-selections').count(),0);
 assert.equal(await page.evaluate(()=>window.ui.editableQuestion('#calc[finance] rent measure')),'#Finance rent measure');
 assert.equal(await page.evaluate(()=>window.ui.editableQuestion('#metric[ratio]')),'#Rental ratio');
 await page.evaluate(()=>{window.ui.input.value='#Finance';window.ui.renderInputHighlight();});
 await page.evaluate(()=>window.ui.submit());assert.equal(await page.evaluate(()=>window.question),'#calc[finance]');
 await page.evaluate(()=>{window.ui.suggestionsDismissed=false;window.ui.input.value='#Rental';window.ui.showMeasureAutocomplete();});
 await page.locator('.askbics-qna__suggestion').first().click();
 await page.evaluate(()=>window.ui.submit());assert.equal(await page.evaluate(()=>window.question),'#metric[ratio]');
 // Host restoration must keep stable IDs internal, including legacy drafts.
 await page.evaluate(()=>{window.question=undefined;window.ui.restoreState({questions:['#calc[finance] by year']});});
 assert.equal(await page.evaluate(()=>window.ui.input.value),'#Finance by year');
 assert.equal(await page.evaluate(()=>window.question),undefined);
 await page.evaluate(()=>window.ui.submit());assert.equal(await page.evaluate(()=>window.question),'#calc[finance] by year');
 await page.evaluate(()=>window.ui.restoreState({draft:'#metric[ratio] by year'}));
 assert.equal(await page.evaluate(()=>window.ui.input.value),'#Rental ratio by year');
 await page.evaluate(()=>window.ui.resumeLatestQuestion({questions:[],draft:'#calc[finance] year'}));
 assert.equal(await page.evaluate(()=>window.ui.input.value),'#Finance year');
 await page.evaluate(()=>window.ui.restoreState({draft:'Rental by year'}));
 assert.equal(await page.evaluate(()=>window.ui.input.value),'Rental by year');
 await page.getByRole('button',{name:'Paste settings',exact:true}).click();
 await page.getByRole('textbox',{name:'Settings backup JSON'}).fill(await page.evaluate(()=>JSON.stringify(window.backup)));
 await page.getByRole('button',{name:'Apply settings',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.applied?.layout.calculationGroups[0].id),'finance');
 // A completed hash group must release ordinary completion, wherever it appears.
 await page.evaluate(()=>{window.ui.fieldSuggestions=(query)=>[{label:'Assigned Tenant Name',detail:'Field'},{label:'South',detail:'Zone'},{label:'Rent Measure',detail:'Measure'}].filter(x=>x.label.toLowerCase().startsWith(query.toLowerCase()));});
 for(const [text,expected] of [['#Finance Assigned','Assigned Tenant Name'],['Show #Finance South','South'],['#Finance Rent','Rent Measure']]){
  await page.evaluate(text=>{const u=window.ui;u.suggestionsDismissed=false;u.input.value=text;u.input.setSelectionRange(text.length,text.length);if(!u.showMeasureAutocomplete())u.showAutocomplete();},text);
  assert.match(await page.locator('.askbics-qna__suggestions').textContent(),new RegExp(expected));
 }
 for(const [text,caret,expected] of [['#Fi by year',3,'#Finance by year'],['Show #Fi by year',8,'Show #Finance by year'],['Show by year #Fi',16,'Show by year #Finance']]){
  await page.evaluate(({text,caret})=>{const u=window.ui;u.suggestionsDismissed=false;u.input.value=text;u.input.setSelectionRange(caret,caret);u.showMeasureAutocomplete();},{text,caret});
  await page.locator('.askbics-qna__suggestion').first().click();assert.equal(await page.evaluate(()=>window.ui.input.value),expected);
 }
 await page.evaluate(()=>{const u=window.ui;u.suggestionsDismissed=false;u.input.value='Assigned #Finance';u.input.setSelectionRange(8,8);if(!u.showMeasureAutocomplete())u.showAutocomplete();});
 await page.locator('.askbics-qna__suggestion').first().click();assert.equal(await page.evaluate(()=>window.ui.input.value),'Assigned Tenant Name #Finance');
 assert.deepEqual(errors,[]);console.log('Calculation chat group/member selection, stable tokens and copying settings into an already configured visual passed.');
}finally{await browser.close();}
