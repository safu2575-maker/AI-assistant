// Isolated local UI verification: synthetic Power BI data and simulated sign-in only.
import express from 'express';
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { model, fixture } from './visual-fixture.mjs';
const {ModelSession}=createRequire(import.meta.url)('../dist/visual-server.cjs');
const f=fixture(), session=new ModelSession(model,'fixture-token',f.fetcher);
const app=express(); app.use(express.json()); let stored=null; let analysisDelay=0; let blankFixture=false;
app.get('/ask/teams.js',(_q,r)=>r.type('js').send('window.microsoftTeams={app:{initialize:async()=>{},notifySuccess:()=>{}},authentication:{authenticate:async()=>{}}};'));
app.post('/ask/api/:method',async(q,r)=>{try{
 const {method}=q.params;
 if(method==='login')return r.json({state:'test',proof:'test',url:'about:blank'});
 if(method==='login-result')return r.json({session:'synthetic-session'});
 if(method==='model')return r.json(model);
 if(method==='state'){if(q.body.state)stored=q.body.state;return r.json({state:stored});}
 if(method==='dictionary')return r.json(await session.dictionary(q.body.field));
 if(method==='visual-query' && analysisDelay){const delay=analysisDelay;analysisDelay=0;await new Promise(resolve=>setTimeout(resolve,delay));}
 if(method==='visual-query'){
  const answer=await session.answer(q.body.question,q.body.settings,q.body.time);
  // Deliberate UI fixture: exercise blank visibility independently of model arithmetic.
  if(blankFixture && answer.analysis?.sections?.length){const section=answer.analysis.sections[0];section.answer.analysis.blankRows=[0];section.answer.table.rows[0][0]='Unassigned';section.answer.analysis.includingBlanks={table:structuredClone(section.answer.table),rowQuestions:section.answer.analysis.rowQuestions.slice(),blankRows:[0]};}
  return r.json(answer);
 }
 return r.json({ok:true});
}catch(e){r.status(400).json({error:e.message});}});
if(process.env.TEST_POWERBI_SETTINGS) app.get('/ask/visual.js',async(_q,r)=>{const code=await readFile('tab/visual.js','utf8'); assert.ok(code.includes('.hostMode="teams"')); r.type('js').send(code.replace('.hostMode="teams"','.hostMode="powerbi"'));});
app.use('/ask',express.static('tab'));
const server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}), errors=[];
page.on('pageerror',e=>errors.push(e.message));
await mkdir('test-output',{recursive:true});
try{
 await page.goto(`http://127.0.0.1:${server.address().port}/ask/`);
 await page.getByRole('button',{name:'Continue with Microsoft'}).click();
 await page.locator('.askbics-qna__input').waitFor();

 await page.getByRole('button',{name:'Open Q&A, autocomplete, table, and matrix settings'}).click();
 await page.getByRole('button',{name:'Custom KPIs',exact:true}).click();
 const form=page.locator('.askbics-custom-kpis');
 await form.getByRole('button',{name:'Add KPI',exact:true}).click();
 await form.getByLabel('KPI name',{exact:true}).fill('Riyadh ratio');
 await form.getByLabel('KPI formula',{exact:true}).fill('DIVIDE([Rent Measure], [Sales Measure])');
 await form.getByRole('button',{name:'Add filter',exact:true}).click();
 await form.getByRole('button',{name:/KPI filter field 1:/}).click();
 await form.getByRole('option',{name:'City',exact:true}).click();
 const filterHeight=await form.locator('.askbics-kpi-filters .askbics-group-member').first().evaluate(e=>e.getBoundingClientRect().height);
 await form.getByRole('button',{name:'KPI filter values 1',exact:true}).click();
 assert.ok(Math.abs((await form.locator('.askbics-kpi-filters .askbics-group-member').first().evaluate(e=>e.getBoundingClientRect().height))-filterHeight)<2,'opening dropdown must not enlarge filter row');
 const valuePicker=form.locator('.askbics-settings-multiselect').filter({has:page.getByRole('button',{name:'KPI filter values 1',exact:true})});
 await valuePicker.getByRole('checkbox',{name:'Riyadh',exact:true}).waitFor();
 await valuePicker.getByRole('searchbox').fill('Unloaded exact value');
 await valuePicker.getByRole('button',{name:'Add exact value “Unloaded exact value”',exact:true}).click();
 assert.equal(await valuePicker.getByRole('checkbox',{name:'Unloaded exact value',exact:true}).isChecked(),true);
 await valuePicker.getByRole('button',{name:'Clear selection',exact:true}).click();

 await valuePicker.getByRole('checkbox',{name:'Riyadh',exact:true}).check();
 await valuePicker.getByRole('checkbox',{name:'Doha',exact:true}).check();
 await valuePicker.getByRole('button',{name:'KPI filter values 1',exact:true}).getByText('2 values selected').waitFor();
 await valuePicker.getByRole('checkbox',{name:'Doha',exact:true}).uncheck();
 await valuePicker.getByRole('searchbox').press('Escape');
 await page.screenshot({path:'test-output/kpi-filters.png'});

 await page.getByRole('button',{name:'Save all & close',exact:true}).click();
 for(let n=0;n<100&&!stored?.layoutSettings.customKpis?.length;n++)await new Promise(r=>setTimeout(r,50));
 assert.deepEqual(stored.layoutSettings.customKpis[0].filters,[{field:'City',values:['Riyadh']}]);
 const input=page.locator('.askbics-qna__input');await input.fill('Show Rent Measure and Riyadh ratio by Assigned Group');await input.press('Escape');
 await page.locator('.askbics-qna__form button[type=submit]').click();await page.locator('.askbics-qna__request-status').waitFor({state:'hidden'});
 assert.match(await page.locator('.askbics-qna__table').first().innerText(),/Riyadh ratio/);
 assert.match(await page.locator('.askbics-qna__table-total').first().innerText(),/1,000/);
 await page.getByRole('button',{name:'Open Q&A, autocomplete, table, and matrix settings',exact:true}).click();
 await page.getByRole('button',{name:'Custom KPIs',exact:true}).click();
 await form.getByRole('button',{name:'Edit',exact:true}).click();
 assert.equal(await form.getByLabel('KPI formula',{exact:true}).inputValue(),'DIVIDE([Rent Measure], [Sales Measure])');
 await form.getByRole('button',{name:'KPI filter values 1',exact:true}).click();
 assert.equal(await form.getByRole('checkbox',{name:'Riyadh',exact:true}).isChecked(),true);
 await form.getByLabel('KPI name',{exact:true}).click();
 assert.equal(await form.locator('.askbics-settings-multiselect .askbics-settings-select__popup').isVisible(),false);
 await page.screenshot({path:'test-output/kpi-edit-compact.png'});
 await page.getByRole('button',{name:'Data setup',exact:true}).click();
 const always=page.locator('.askbics-always-filter');
 for(const [index,field,value] of [[1,'City','Riyadh'],[2,'Assigned Group','Furniture']]){
  await always.getByRole('button',{name:'Add filter',exact:true}).click();
  await always.getByRole('button',{name:new RegExp('Always filter field '+index+':')}).click();
  await always.getByRole('option',{name:field,exact:true}).click();
  await always.getByRole('button',{name:'Always filter values '+index,exact:true}).click();
  const choice=always.locator('.askbics-settings-multiselect').filter({has:page.getByRole('button',{name:'Always filter values '+index,exact:true})});
  await choice.getByRole('searchbox').fill(value);
  const check=choice.getByRole('checkbox',{name:value,exact:true});
  if(await check.count())await check.check();else await choice.getByRole('button',{name:'Add exact value “'+value+'”',exact:true}).click();
  await choice.getByRole('searchbox').press('Escape');
 }
 await page.getByRole('button',{name:'Save all & close',exact:true}).click();
 for(let n=0;n<100&&!stored?.layoutSettings.alwaysFilter;n++)await new Promise(r=>setTimeout(r,50));
 await page.screenshot({path:'test-output/always-filters.png'});
 assert.deepEqual(stored.layoutSettings.alwaysFilter,[{field:'City',values:['Riyadh']},{field:'Assigned Group',values:['Furniture']}]);
 await input.fill('Show Rent Measure by Assigned Group');await input.press('Escape');
 await page.locator('.askbics-qna__form button[type=submit]').click();await page.locator('.askbics-qna__request-status').waitFor({state:'hidden'});
 assert.match(await page.locator('.askbics-qna__table-total').last().innerText(),/300/);
 assert.deepEqual(errors,[]);console.log('KPI filter editor, save and mixed-measure answer browser checks passed.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
