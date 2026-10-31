import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {Workbook,SpreadsheetFile} from '@oai/artifact-tool';
const require=createRequire(import.meta.url);
const {traceCash,cashKey}=require('../../.tmp/test/cashFlow.js');
const {cashPostings}=require('../../.tmp/test/cashFlowQuery.js');
const dir=new URL('.',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1');
const headers=['Company','Document number','Type','Amount','Account','Account description','Clearing document'];
const rows=[['9720','1','Payment',-100,'120','Bank',null],['9720','1','Payment',100,'121','Vendor','201'],['9720','2','Invoice',-100,'121','Vendor','201'],['9720','2','Invoice',100,'122','GR/IR','202'],['9720','3','Expense',-100,'122','GR/IR','202'],['9720','3','Expense',100,'130','Expense',null]];
const setup={fields:{company:'Company',document:'Document number',clearing:'Clearing document'},measure:'Signed Amount',rules:[]};
const table={columns:[...headers,'Signed Amount'],rows:rows.map(r=>[...r.map(v=>v==null?'':String(v)),String(r[3])]),rowIndices:rows.map(()=>[]),modelRawRows:rows.map(r=>[...headers.map(()=>null),r[3]])};
const postings=cashPostings(table,setup);
const result=traceCash(postings,[],{company:'9720',currency:'',from:'',to:'',allDates:true,startKeys:[cashKey(postings[0])],complete:true});
assert.equal(result.payments,100);assert.equal(result.receipts,0);assert.equal(result.unresolved,0);assert.equal(result.allocations[0].path.length,6);assert.equal(result.allocations[0].category,'Ending document 3');
const wb=Workbook.create(),data=wb.worksheets.add('SampleData'),guide=wb.worksheets.add('TestGuide');
for(const [sheet,range] of [[data,'A1:G7'],[guide,'A1:B16']]){sheet.showGridLines=false;sheet.getRange(range).format.font={name:'Arial',size:11,color:'#193550'};sheet.getRange(range).format.rowHeight=25;sheet.getRange(range).format.columnWidth=23;}
const head=(sheet,range)=>{sheet.getRange(range).format.fill='#193550';sheet.getRange(range).format.font={name:'Arial',size:11,bold:true,color:'#FFFFFF'};sheet.getRange(range).format.rowHeight=30;};
data.getRange('A1:G7').values=[headers,...rows];data.getRange('A2:C7').setNumberFormat('@');data.getRange('E2:G7').setNumberFormat('@');data.getRange('D2:D7').setNumberFormat('#,##0.00;(#,##0.00);"-"');data.tables.add('A1:G7',true,'CashFlowSample');head(data,'A1:G1');data.freezePanes.freezeRows(1);
const instructions=[
 ['Step','Simple clearing test'],
 ['Source','Synthetic six-posting example matching your screenshot. Single company and currency.'],
 ['Import','Power BI > Get data > Excel > select the CashFlowSample table.'],
 ['Data types','Keep Company, Document number and Clearing document as Text. Amount must be numeric.'],
 ['Create measure','Signed Amount = SUM(CashFlowSample[Amount])'],
 ['Field parameter','Make Company, Document number and Clearing document available in the visual grouping field parameter.'],
 ['Setup','Map Company code to Company; Document number to Document number; Clearing document to Clearing document.'],
 ['Amount mapping','Select the Signed Amount measure. Do not use Count of Amount.'],
 ['Advanced','Leave all Advanced mappings empty. Account, description and Type are reference columns only for this test.'],
 ['Load','Enter company 9720 and click Show cash flow.'],
 ['Select start','Choose the Document 1 posting with amount -100. Click Show cash flow again.'],
 ['Expected path','Document 1 > clearing 201 > Document 2 > clearing 202 > Document 3.'],
 ['Expected result','Receipts 0; payments 100; net -100; unresolved 0. Endpoint: Ending document 3.'],
 ['Clearing blanks','Bank start and Expense endpoint have truly blank clearing cells. Do not replace blanks with 0.'],
 ['Posting total',null],
 ['Scope','This file tests only the basic chain. It contains no split payments, partial payments or cross-year cases.']
];
guide.getRange('A1:B16').values=instructions;head(guide,'A1:B1');guide.getRange('A1:A16').format.columnWidth=23;guide.getRange('B1:B16').format.columnWidth=100;guide.getRange('B2:B16').format.wrapText=true;guide.getRange('A2:B16').format.rowHeight=40;guide.getRange('B15').formulas=[["=SUM('SampleData'!D2:D7)"]];guide.getRange('B15').setNumberFormat('0.00');
wb.recalculate();assert.equal(guide.getRange('B15').values[0][0],0);
console.log((await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?',options:{useRegex:true,maxResults:10},maxChars:800})).ndjson);
for(const sheetName of ['SampleData','TestGuide']){const blob=await wb.render({sheetName,range:sheetName==='SampleData'?'A1:G7':'A1:B16',scale:1,format:'png'});await fs.writeFile(dir+sheetName+'.png',new Uint8Array(await blob.arrayBuffer()));}
await (await SpreadsheetFile.exportXlsx(wb)).save(dir+'CashFlow_Simple_Test.xlsx');
console.log('Verified the actual four-field engine: 100 outflow, 0 unresolved, 6 posting steps, endpoint document 3.');
