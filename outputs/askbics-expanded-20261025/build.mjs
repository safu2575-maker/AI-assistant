import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {Workbook, SpreadsheetFile} from '@oai/artifact-tool';
const dir=new URL('./',import.meta.url);
const original=JSON.parse((await fs.readFile(new URL('original-rows.json',dir),'utf8')).replace(/^\uFEFF/,''));
const baseline=JSON.parse(await fs.readFile(new URL('../askbics-sample-data/sample-data.json',dir),'utf8')).rows;
const templates=baseline.filter(r=>r.Year===2024 && r.Month==='2024-01');
assert.equal(templates.length,36);
const headers=Object.keys(original[0]);
for(const name of ['MonthIndex','Month Number'])if(!headers.includes(name))headers.push(name);
const sourceById=new Map(original.map(r=>[r['Record ID'],r]));
const rows=[];
const season=[0.86,0.91,1.08,1.02,0.96,0.92,0.88,0.97,1.06,1.1,1.19,1.28];
for(let year=2023;year<=2027;year++)for(let month=1;month<=12;month++)for(const [i,t] of templates.entries()){
 const cat=Math.floor((i%12)/3), y=year-2024;
 const growth=[-0.045,0.11,0.065,0.025][cat];
 const pulse=1+(((month*3+i*5+year)%13)-6)/100;
 const sales=Math.round(t.Sales/season[0]*season[month-1]*Math.pow(1+growth,y)*pulse);
 const cost=Math.round(sales*([0.59,0.72,0.42,0.61][cat]+((month+i)%5-2)/100));
 let rent=Math.round(t.Rent*Math.pow(1+[-0.025,0.075,0.04,0.015][cat],y)*(1+((month+i)%7-3)/100));
 if(year===2026 && month===9 && i===0)rent=0;
 const target=Math.round(sales/(1+((month+i+year)%9-4)*0.035));
 const id=`R${year}${String(month).padStart(2,'0')}-${Math.floor(i/12)+1}-${String(i%12+1).padStart(2,'0')}`;
 const override=sourceById.get(id);
 const r={...t,'Record ID':id,Date:`${year}-${String(month).padStart(2,'0')}-01`,Year:year,Month:`${year}-${String(month).padStart(2,'0')}`,Quarter:`${year}-Q${Math.ceil(month/3)}`,
 Sales:sales,Cost:cost,Rent:rent,Transactions:Math.round(sales/[280,950,65,420][cat]),Currency:'QAR',Profit:sales-cost,Variance:sales-target,Target:target,MonthIndex:year*12+month,'Month Number':month};
 for(const field of ['Assigned Tenant Name','Assigned Group','Assigned Sales Category','City','Region','Mall','Floor','Zone'])if(override)r[field]=override[field];
 if(year===2026 && month===9 && i===1)r['Assigned Tenant Name']='';
 r['Items Sold']=Math.round(r.Transactions*(1.3+i%3*0.25));r.Footfall=Math.round(r.Transactions*(3.4+i%4*0.3));delete r['Sales Target'];rows.push(r);
}
const sum=(rs,key)=>rs.reduce((n,r)=>n+r[key],0);
const waterfall=[];
for(let year=2023;year<=2027;year++)for(let month=1;month<=12;month++)for(const city of ['Riyadh','Jeddah','Dammam']){
 const selected=rows.filter(r=>r.Year===year&&r['Month Number']===month&&r.City===city);
 const revenue=sum(selected,'Sales'),cost=-sum(selected,'Cost'),rent=-sum(selected,'Rent');
 const gross=revenue+cost,payroll=-Math.round(revenue*0.11),utilities=-Math.round(revenue*(month>=6&&month<=9?0.035:0.025));
 const other=month===9?0:-Math.round(revenue*0.012),recovery=Math.round(revenue*0.008),operating=gross+rent+payroll+utilities+other+recovery;
 const steps=[['Revenue',revenue,'Total'],['Cost of sales',cost,'Movement'],['Gross profit',gross,'Total'],['Rent expense',rent,'Movement'],['Payroll',payroll,'Movement'],['Utilities',utilities,'Movement'],['Other expense',other,'Movement'],['Expense recovery',recovery,'Movement'],['Operating profit',operating,'Total']];
 let balance=0;
 steps.forEach(([name,amount,role],i)=>{
  if(role==='Total'){if(i>0)assert.equal(balance,amount);balance=amount;}else balance+=amount;
  waterfall.push({Date:`${year}-${String(month).padStart(2,'0')}-01`,Year:year,Month:`${year}-${String(month).padStart(2,'0')}`,MonthIndex:year*12+month,City:city,'Waterfall Step':`${String(i+1).padStart(2,'0')} ${name}`,'Step Order':i+1,'Step Role':role,Amount:amount,Currency:'QAR'});
 });
}
const checks=[];
for(const year of [2023,2024,2025,2026,2027])for(const mode of ['September','YTD September','TTM September']){
 const end=year*12+9,start=mode==='September'?end:mode==='YTD September'?year*12+1:end-11;
 if(start<2023*12+1)continue;
 const selected=rows.filter(r=>r.MonthIndex>=start&&r.MonthIndex<=end);
 checks.push({Year:year,Period:mode,Rows:selected.length,Sales:sum(selected,'Sales'),Rent:sum(selected,'Rent'),Profit:sum(selected,'Profit'),Variance:sum(selected,'Variance')});
}
assert.equal(rows.length,2160);assert.equal(new Set(rows.map(r=>r['Record ID'])).size,2160);
assert.equal(waterfall.length,1620);
assert(rows.some(r=>r.Variance<0)&&rows.some(r=>r.Variance>0));
assert(rows.every(r=>r.Profit===r.Sales-r.Cost&&r.Variance===r.Sales-r.Target&&Number.isInteger(r.MonthIndex)));
for(const month of [1,9,12])assert.notEqual(sum(rows.filter(r=>r.Year===2025&&r['Month Number']===month),'Rent'),sum(rows.filter(r=>r.Year===2026&&r['Month Number']===month),'Rent'));
const csv=(data,keys=Object.keys(data[0]))=>'\uFEFF'+[keys,...data.map(r=>keys.map(k=>r[k]??''))].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n';
await fs.copyFile(new URL('../askbics-sample-data/askBICS_Sample_Retail_Data.csv',dir),new URL('original-retail-backup.csv',dir));
await fs.writeFile(new URL('askBICS_Sample_Retail_Data.csv',dir),csv(rows,headers));
await fs.writeFile(new URL('askBICS_Waterfall_Data.csv',dir),csv(waterfall));
await fs.writeFile(new URL('Expected_Results.csv',dir),csv(checks));
console.log('Creating workbook');const wb=Workbook.create();
function sheet(name,data,keys=Object.keys(data[0])){
 const s=wb.worksheets.add(name);s.showGridLines=false;
 const grid=[keys,...data.map(r=>keys.map(k=>k==='Date'?new Date(r[k]+'T00:00:00Z'):r[k]??''))];
 s.getRangeByIndexes(0,0,grid.length,keys.length).values=grid;
 s.getRangeByIndexes(0,0,Math.min(20,grid.length),keys.length).format.font={name:'Arial',size:10};
 s.getRangeByIndexes(0,0,1,keys.length).format={fill:'#17365D',font:{color:'#FFFFFF',bold:true},rowHeight:30};
 keys.forEach((key,i)=>{s.getRangeByIndexes(0,i,1,1).format.columnWidth=key.length>17?28:19;if(key==='Date')s.getRangeByIndexes(1,i,data.length,1).setNumberFormat('yyyy-mm-dd');else if(typeof data[0][key]==='number')s.getRangeByIndexes(1,i,data.length,1).setNumberFormat(key==='Year'||key.includes('Index')?'0':'#,##0;[Red](#,##0);0');});
 s.freezePanes.freezeRows(1);console.log('Prepared '+name);return s;
}
sheet('Retail',rows,headers);sheet('Waterfall',waterfall);sheet('Expected results',checks);
const notes=[
 ['Source','Synthetic test data generated from the existing askBICS retail sample. All years, including 2027, are fictional.'],
 ['Retail import','Replace the existing retail CSV source with the expanded retail CSV, retaining the existing Power BI table name and measures.'],
 ['Time setup','Use Date as Date; MonthIndex as Whole number. MonthIndex = Year * 12 + month number (one-based).'],
 ['Existing columns','Existing column names retained. Month remains YYYY-MM text. Month Number and MonthIndex are added.'],
 ['Refresh','Refresh Power BI after updating the source, then Clear askBICS to reload its data and suggestions.'],
 ['Waterfall import','Import Waterfall as a separate table. Create Waterfall Amount = SUM(\'Waterfall\'[Amount]). Do not append these rows to Retail.'],
 ['Waterfall setup','Category: Waterfall Step. Measure: Waterfall Amount. Sort by Step Order ascending (labels are also numbered).'],
 ['Total ticks','Tick 01 Revenue, 03 Gross profit and 09 Operating profit as totals, using Loaded value. Other steps are movements.'],
 ['Do not double count','SUM of every waterfall row is not profit because totals are included. Closing profit is only 09 Operating profit.'],
 ['Filtering','Try City = Riyadh, then multiple cities. Keep all steps included for the reconciliation check.'],
 ['Period test','Compare September 2026, YTD September 2026 and TTM September 2026. TTM includes October 2025 to September 2026.'],
 ['Variance test','Ask Explain Rent Measure for September 2026 versus September 2025. Rent differs by year and month.'],
 ['Blank test','Original blank tenant rows retained. September 2026 U102 is also blank. September 2026 U101 has zero rent.'],
 ['Expected results','Expected results assume no report, page, Always, group or KPI filters. September 2023 TTM omitted because 2022 is absent.'],
 ['Waterfall UI','This updates data only. Model bindings, date settings and waterfall configuration must still be set in Power BI.']
].map(([Topic,Instructions])=>({Topic,Instructions}));
const guide=sheet('Read me',notes);guide.getRange('B1:B16').format.columnWidth=110;guide.getRange('B2:B16').format.wrapText=true;guide.getRange('A2:B16').format.rowHeight=36;
console.log('Recalculating');wb.recalculate();console.log('Rendering');
for(const [name,range] of [['Retail','A1:G8'],['Waterfall','E1:J10'],['Expected results','A1:G8'],['Read me','A1:B8']]){
 console.log('Render '+name);const image=await wb.render({sheetName:name,range,scale:1,format:'png'});
 await fs.writeFile(new URL(name.replaceAll(' ','-')+'.png',dir),new Uint8Array(await image.arrayBuffer()));
}
await (await SpreadsheetFile.exportXlsx(wb)).save(new URL('askBICS_Expanded_Test_Data.xlsx',dir).pathname.replace(/^\/(\w:)/,'$1'));
console.log(JSON.stringify({retail:rows.length,waterfall:waterfall.length,months:60,checks:checks.filter(r=>r.Year===2026)},null,2));


