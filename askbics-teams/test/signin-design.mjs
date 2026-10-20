import express from 'express';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const app=express();
app.get('/ask/teams.js',(_,r)=>r.type('js').send(`window.microsoftTeams={app:{initialize:async()=>{},notifySuccess(){},getContext:async()=>({app:{theme:'default'}}),registerOnThemeChangeHandler(fn){window.changeTheme=fn}}}`));
app.use('/ask',express.static('tab'));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{const page=await browser.newPage({viewport:{width:1100,height:800}});await page.goto(`http://127.0.0.1:${server.address().port}/ask/`);await page.getByRole('button',{name:'Continue with Microsoft'}).waitFor();assert.equal(await page.locator('#reload-app').isVisible(),false);await page.screenshot({path:'test-output/signin-light.png'});await page.evaluate(()=>window.changeTheme('dark'));await page.screenshot({path:'test-output/signin-dark.png'});await page.setViewportSize({width:360,height:740});await page.screenshot({path:'test-output/signin-mobile.png'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));console.log('Sign-in light/dark/mobile and hidden recovery checks passed');}finally{await browser.close();server.close();}
