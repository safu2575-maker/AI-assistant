const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const out = path.resolve('outputs/askbics-sample-data');
fs.mkdirSync(out, { recursive: true });
const tenants = [
  ['Nova Fashion', 'Fashion', 130000], ['Urban Style', 'Fashion', 110000], ['Linen House', 'Fashion', 90000],
  ['Tech Hub', 'Electronics', 240000], ['Digital World', 'Electronics', 200000], ['Smart Corner', 'Electronics', 170000],
  ['Fresh Table', 'Food and Beverage', 100000], ['Bean Street', 'Food and Beverage', 75000], ['Sweet Spot', 'Food and Beverage', 60000],
  ['Home Living', 'Home and Lifestyle', 145000], ['Comfort Store', 'Home and Lifestyle', 125000], ['Decor Lane', 'Home and Lifestyle', 95000]
];
const cities = [['Riyadh', 'Central', 'Palm Mall', 1.2], ['Jeddah', 'West', 'Coast Mall', 1.05], ['Dammam', 'East', 'Oasis Mall', 0.9]];
const season = [0.82, 0.86, 1.08, 1.02, 0.94, 0.9, 0.88, 0.98, 1.05, 1.08, 1.2, 1.3];
const rows = [];
for (let year = 2024; year <= 2025; year++) for (let month = 1; month <= 12; month++) {
  cities.forEach(([city, region, mall, factor], ci) => tenants.forEach(([tenant, category, base], ti) => {
    const sales = Math.round(base * factor * season[month - 1] * (year === 2025 ? 1.12 : 1) * (1 + ((month + ti * 3 + ci) % 7 - 3) / 100));
    const cost = Math.round(sales * [0.57, 0.71, 0.39, 0.60][Math.floor(ti / 3)]);
    const rent = Math.round(base * factor * 0.095);
    const target = Math.round(base * factor * season[month - 1] * (year === 2025 ? 1.16 : 1.03));
    const transactions = Math.round(sales / [280, 950, 65, 420][Math.floor(ti / 3)]);
    rows.push({ 'Record ID': `R${year}${String(month).padStart(2, '0')}-${ci + 1}-${String(ti + 1).padStart(2, '0')}`,
      Date: `${year}-${String(month).padStart(2, '0')}-01`, Year: year, Month: `${year}-${String(month).padStart(2, '0')}`,
      Quarter: `${year}-Q${Math.ceil(month / 3)}`, 'Assigned Tenant Name': tenant, Unit: `U${ci + 1}${String(ti + 1).padStart(2, '0')}`,
      'Assigned Sales Category': category, 'Assigned Group': ['Retail Group A', 'Retail Group B', 'Retail Group C'][ti % 3],
      City: city, Region: region, Mall: mall, Floor: ['Ground', 'First', 'Second'][ti % 3], Zone: ['North', 'South', 'East', 'West'][ti % 4],
      Sales: sales, Cost: cost, Rent: rent, 'Sales Target': target, Transactions: transactions, 'Items Sold': Math.round(transactions * (1.3 + ti % 3 * 0.25)),
      Footfall: Math.round(transactions * (3.4 + ti % 4 * 0.3))
    });
  }));
}
const total = key => rows.reduce((sum, row) => sum + row[key], 0);
const group = key => Object.entries(rows.reduce((s, r) => {s[r[key]] = (s[r[key]] || 0) + r.Sales; return s;}, {})).sort((a,b)=>b[1]-a[1]);
assert.equal(rows.length, 864); assert.equal(new Set(rows.map(r=>r['Record ID'])).size, 864);
assert.equal(new Set(rows.map(r=>r.Unit)).size, 36);
assert(rows.every(r => r.Sales > 0 && r.Cost < r.Sales && r.Transactions > 0));
const checks = { rows: rows.length, tenantCount: 12, storeCount: 36, totalSales: total('Sales'), totalCost:total('Cost'), totalProfit:total('Sales')-total('Cost'), totalRent:total('Rent'), totalSalesTarget:total('Sales Target'), tenants:group('Assigned Tenant Name'), categories:group('Assigned Sales Category'), cities:group('City'), years:group('Year'), months:group('Month') };
fs.writeFileSync(path.join(out, 'sample-data.json'), JSON.stringify({rows,checks}, null, 2));
console.log(JSON.stringify({rows:rows.length, totalSales:checks.totalSales, highestTenant:checks.tenants[0], lowestTenant:checks.tenants.at(-1), out}));
