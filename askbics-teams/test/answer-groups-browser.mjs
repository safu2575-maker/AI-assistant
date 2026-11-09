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
 if(method==='visual-query' && q.body.question==='Show sparse matrix fixture')return r.json({modelQuery:true,text:'Sparse matrix totals fixture',table:{
 columns:['City','Jan','Feb','Mar','Total'],rows:[['A','10','—','—','10'],['B','—','20','—','20'],['C','—','—','30','30'],['D','—','—','—','—']],rowIndices:[[],[],[],[]],
 modelTotals:['Grand Total','7','15','22','33'],modelPivot:{rowFields:['City'],columnField:'Month',columnValues:['Jan','Feb','Mar'],measures:['Rent Measure']},modelEditor:{rows:['City'],columns:['Month'],measures:['Rent Measure'],filters:[]}}});
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
 const questionInput=page.locator('.askbics-qna__input');
 await questionInput.fill('Assigned');
 const suggestionItems=page.locator('.askbics-qna__suggestions button');
 await suggestionItems.first().waitFor();
 await suggestionItems.first().click();
 assert.equal(await suggestionItems.count(),0);
 await questionInput.blur();await questionInput.focus();
 await page.waitForTimeout(700);
 assert.equal(await suggestionItems.count(),0,'focus and asynchronous dictionary updates must not reopen accepted suggestions');
 await questionInput.press('ArrowDown');await suggestionItems.first().waitFor();
 await questionInput.press('Enter');assert.equal(await suggestionItems.count(),0);
 await questionInput.fill('Assigned');await suggestionItems.first().waitFor();
 await questionInput.fill('Rent Measure 2030');
 await page.locator('.askbics-qna__suggestions button').filter({hasText:'2030'}).first().waitFor();
 assert.equal(await page.locator('.askbics-qna__input-highlight .askbics-qna__token--value').filter({hasText:'2030'}).count(),1,'bare year has recognized-value styling');
 await questionInput.fill('');
 await page.getByRole('button',{name:'Open Q&A, autocomplete, table, and matrix settings'}).click();
 await page.getByRole('button',{name:'Field & measure groups',exact:true}).click();
 const groupsForm=page.locator('.askbics-answer-groups');
 await groupsForm.getByRole('button',{name:'Add group',exact:true}).click();
 await groupsForm.getByLabel('Group name',{exact:true}).fill('Tenant details');
 await groupsForm.getByLabel('Synonyms (comma-separated)',{exact:true}).fill('tenant profile');
 for(const member of ['Assigned Tenant Name','City'])await groupsForm.locator('select').nth(1).selectOption(member,{force:true});
 const handles=groupsForm.locator('.is-drag-handle');
 await handles.first().focus();await handles.first().press('ArrowDown');
 assert.match(await handles.first().getAttribute('aria-label'),/City/);
 await handles.nth(1).press('ArrowUp');
 assert.match(await handles.first().getAttribute('aria-label'),/Assigned Tenant Name/);
 await groupsForm.locator('[data-member-index="1"]').scrollIntoViewIfNeeded();
 const from=await handles.first().boundingBox(),to=await groupsForm.locator('[data-member-index="1"]').boundingBox();
 await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(to.x+30,to.y+20,{steps:8});await page.mouse.up();
 assert.match(await handles.first().getAttribute('aria-label'),/City/);
 await handles.nth(1).press('ArrowUp');
 await groupsForm.getByRole('button',{name:'Filter values for City',exact:true}).click();
 const valuePicker=groupsForm.locator('.askbics-settings-multiselect').filter({has:page.getByRole('button',{name:'Filter values for City',exact:true})});
 await valuePicker.getByRole('checkbox',{name:'Riyadh',exact:true}).check();
 await valuePicker.getByRole('checkbox',{name:'Doha',exact:true}).check();
 await valuePicker.getByRole('button',{name:'Filter values for City',exact:true}).getByText('2 values selected').waitFor();
 await valuePicker.getByRole('checkbox',{name:'Doha',exact:true}).uncheck();
 await valuePicker.getByRole('searchbox').press('Escape');
 await groupsForm.getByLabel('Show City in answers',{exact:true}).uncheck();
 await page.getByRole('button',{name:'Save all & close',exact:true}).click();
 await page.getByRole('button',{name:'Open Q&A, autocomplete, table, and matrix settings'}).click();
 await page.getByRole('button',{name:'Field & measure groups',exact:true}).click();
 await groupsForm.getByRole('button',{name:'Edit',exact:true}).click();
 assert.equal(await groupsForm.getByLabel('Show City in answers',{exact:true}).isChecked(),false);
 assert.match(await groupsForm.getByRole('button',{name:'Filter values for City',exact:true}).innerText(),/Riyadh/);
 await page.screenshot({path:'test-output/group-filters.png'});
 await groupsForm.getByRole('button',{name:'Cancel edit',exact:true}).click();
 await page.getByRole('button',{name:'Save all & close',exact:true}).click();
 for(let n=0;n<100&&!stored?.layoutSettings.answerGroups?.length;n++)await new Promise(r=>setTimeout(r,50));
 assert.equal(stored.layoutSettings.answerGroups[0].name,'Tenant details');

 const input=page.locator('.askbics-qna__input');
 await input.fill('Show Rent Measure by tenant profile'); await input.press('Escape');
 await page.locator('.askbics-qna__form button[type=submit]').click();
 await page.locator('.askbics-qna__request-status').waitFor({state:'hidden'});
 assert.match(await page.locator('.askbics-qna__table').first().innerText(),/Assigned Tenant Name/);
 assert.doesNotMatch(await page.locator('.askbics-qna__table thead').first().innerText(),/City/);
 assert.match(await page.locator('.askbics-qna__table').first().innerText(),/300/);
 assert.deepEqual(stored.layoutSettings.answerGroups[0].filters,[{field:'City',values:['Riyadh']}]);

 await page.getByRole('button',{name:'Open Q&A, autocomplete, table, and matrix settings'}).click();
 await page.getByRole('button',{name:'Explain & investigate',exact:true}).click();
 await page.locator('select[aria-label="Transaction field 1"]').evaluate(el=>{el.value='Assigned Tenant Name';el.dispatchEvent(new Event('change',{bubbles:true}));});
 await page.getByRole('button',{name:'Suggestions',exact:true}).click();
 await page.locator('summary').filter({hasText:'Show in Summarize by'}).click();
 const visibility=page.locator('.askbics-summary-visibility');
 await page.screenshot({path:'test-output/summary-visibility-theme.png'});
 assert.equal(await visibility.getByRole('checkbox',{name:'City',exact:true}).isChecked(),true);
 assert.equal(await visibility.getByRole('checkbox',{name:'Tenant details',exact:true}).isChecked(),true);
 await visibility.getByRole('button',{name:'Clear all',exact:true}).click();
 assert.equal(await visibility.getByRole('checkbox',{name:'City',exact:true}).isChecked(),false);
 await visibility.getByRole('checkbox',{name:'Select all',exact:true}).check();
 await visibility.getByRole('checkbox',{name:'City',exact:true}).uncheck();
 await visibility.getByRole('checkbox',{name:'Tenant details',exact:true}).uncheck();
 await page.getByRole('button',{name:'Save all & close',exact:true}).click();
 await page.getByRole('button',{name:'Open Q&A, autocomplete, table, and matrix settings'}).click();
 await page.getByRole('button',{name:'Suggestions',exact:true}).click();
 await page.locator('summary').filter({hasText:'Show in Summarize by'}).click();
 assert.equal(await visibility.getByRole('checkbox',{name:'City',exact:true}).isChecked(),false);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.locator('.askbics-qna__table td.askbics-qna__numeric-cell:visible').first().click({button:'right'});
 await page.getByRole('menuitem',{name:/Summarize by/}).click();
 assert.equal(await page.locator('.askbics-summary-submenu').getByRole('menuitem',{name:'City',exact:true}).count(),0);
 assert.equal(await page.locator('.askbics-summary-submenu').getByRole('menuitem',{name:'Tenant details',exact:true}).count(),0);
 assert(await page.locator('.askbics-summary-submenu').getByRole('menuitem',{name:'Assigned Group',exact:true}).count()>0);
 await page.locator('.askbics-summary-submenu').getByRole('menuitem',{name:'Assigned Group',exact:true}).click();
 const drill=page.locator('.askbics-transactions-overlay:visible');
 await drill.locator('td.askbics-qna__numeric-cell:visible').first().click({button:'right'});
 await page.getByRole('menuitem',{name:/Summarize by/}).click();
 await page.locator('.askbics-summary-submenu').getByRole('menuitem',{name:'Assigned Tenant Name',exact:true}).click();
 await drill.locator('td.askbics-qna__numeric-cell:visible').first().waitFor();
 assert.match(await drill.innerText(),/Bright Home/);
 assert.match(await drill.innerText(),/300/);
 await drill.getByRole('button',{name:'Back to answer',exact:true}).click();
 assert.match(await drill.innerText(),/Summarize by Assigned Group/);
 await drill.locator('td.askbics-qna__numeric-cell:visible').first().click({button:'right'});
 await page.getByRole('menuitem',{name:'Show transactions',exact:true}).click();
 await drill.locator('td.askbics-qna__numeric-cell:visible').first().waitFor();
 assert.match(await drill.innerText(),/Transaction details/);
 assert.match(await drill.innerText(),/Bright Home/);
 assert.match(await drill.innerText(),/300/);
 await drill.locator('td.askbics-qna__numeric-cell:visible').first().click({button:'right'});
 assert.equal(await page.getByRole('menuitem',{name:'Show transactions',exact:true}).count(),0);
 await page.getByRole('menuitem',{name:/Summarize by/}).click();
 await page.locator('.askbics-summary-submenu').getByRole('menuitem',{name:'Assigned Group',exact:true}).click();
 await drill.locator('td.askbics-qna__numeric-cell:visible').first().waitFor();
 assert.match(await drill.innerText(),/300/);
 while(await page.locator('.askbics-transactions-overlay:visible').count())await page.locator('.askbics-transactions-overlay:visible').getByRole('button',{name:'Back to answer',exact:true}).click();
 await input.fill('Show sparse matrix fixture');await input.press('Escape');await page.locator('.askbics-qna__form button[type=submit]').click();
 await page.locator('.askbics-qna__request-status').waitFor({state:'hidden'});
 const sparse=page.locator('.askbics-qna__table').last();
 const grand=sparse.locator('tr.askbics-qna__table-total');
 assert.deepEqual(await grand.locator('td:visible').allTextContents(),['Grand Total','7','15','22','33']);
 assert.equal(await grand.locator('td').first().getAttribute('colspan'),null);
 await page.screenshot({path:'test-output/sparse-matrix-totals.png'});
 assert.deepEqual(errors,[]); console.log('Group settings creation, persistence and grouped answer browser checks passed.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}


