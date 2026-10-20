export const model = { name: 'Fixture · Retail', datasetId: '11111111-1111-1111-1111-111111111111', measures: [{name:'Rent Measure',modelName:'Rent Measure',aliases:['rent']},{name:'Sales Measure',modelName:'Sales Measure',aliases:['sales']}], dimensions: ['Assigned Group','Assigned Tenant Name','City','Year','Date'].map(name => ({name,table:'Retail',column:name,type:name==='Year'?'number':name==='Date'?'date':'text'})),year:{table:'Retail',column:'Year'},time:{dateField:'Date',yearField:'Year'}};
const data = [
 {'Assigned Group':'Furniture','Assigned Tenant Name':'Home Living',City:'Doha',Year:2025,Date:'2025-01-15',rent:100,sales:10},
 {'Assigned Group':'Furniture','Assigned Tenant Name':'Home Living',City:'Doha',Year:2026,Date:'2026-01-15',rent:200,sales:20},
 {'Assigned Group':'Furniture','Assigned Tenant Name':'Bright Home',City:'Riyadh',Year:2026,Date:'2026-02-15',rent:300,sales:60},
 {'Assigned Group':'Fashion','Assigned Tenant Name':'Style',City:'Doha',Year:2026,Date:'2026-02-15',rent:400,sales:90}
];
export function fixture(token = 'fixture-token') {
 const queries = [];
 const fetcher = async (url, init) => {
  if (String(url) !== `https://api.powerbi.com/v1.0/myorg/datasets/${model.datasetId}/executeQueries`) throw Error('Unexpected endpoint');
  if (init.headers.Authorization !== `Bearer ${token}`) throw Error('Wrong user token');
  const dax = JSON.parse(init.body).queries[0].query; queries.push(dax);
  const response = rows => new Response(JSON.stringify({results:[{tables:[{rows}]}]}));
  if (dax.includes('"V",')) { const field = /VALUES\('Retail'\[([^\]]+)\]\)/.exec(dax)?.[1]; return response([...new Set(data.map(row=>row[field]))].map(value=>({'[V]':value}))); }
  let filtered = data;
  for (const filter of dax.matchAll(/TREATAS\(\{([^}]+)\},\s*'Retail'\[([^\]]+)\]\)/g)) {
   const values = JSON.parse('['+filter[1].replace(/""/g,'\\"')+']'); filtered = filtered.filter(row=>values.includes(row[filter[2]]));
  }
  const groups = [...dax.matchAll(/"G\d+", 'Retail'\[([^\]]+)\]/g)].map(m=>m[1]);
  const measures = [...dax.matchAll(/"M\d+", (?:CALCULATE\()?\[(Rent Measure|Sales Measure)\]/g)].map(m=>m[1]);
  const aggregate = rows => Object.fromEntries(measures.map((m,i)=>[`[M${i}]`,rows.length?m==='Rent Measure'?rows.reduce((s,r)=>s+r.rent,0):rows.reduce((s,r)=>s+r.sales,0)/rows.length:null]));
  if (dax.startsWith('EVALUATE ROW(')) return response([aggregate(filtered)]);
  const buckets = new Map();
  for (const row of filtered) {const key=JSON.stringify(groups.map(g=>row[g])); if(!buckets.has(key)) buckets.set(key,[]); buckets.get(key).push(row);}
  let rows = [...buckets].map(([key,values])=>({...Object.fromEntries(JSON.parse(key).map((v,i)=>[`[G${i}]`,v])),...aggregate(values)}));
  if (/\[M0\], DESC/.test(dax)) rows.sort((a,b)=>b['[M0]']-a['[M0]']);
  const limit=Number(/TOPN\((\d+)/.exec(dax)?.[1]||10001); rows=rows.slice(0,limit);
  return response(rows);
 };
 return {fetcher,queries};
}
