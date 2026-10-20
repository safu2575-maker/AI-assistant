import { readFileSync, writeFileSync } from 'node:fs';
import { tabOrigin } from './tab.js';
process.env.TAB_ORIGIN = tabOrigin(process.env.TAB_ORIGIN || '');
process.env.TAB_HOST = new URL(process.env.TAB_ORIGIN).hostname;
const required = ['CLIENT_ID', 'WEBSITE_URL', 'PRIVACY_URL', 'TERMS_URL'] as const;
for (const key of required) {
  const value = process.env[key];
  if (!value) throw new Error(`Configure ${key} in .env first.`);
  if (key === 'CLIENT_ID') { if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value)) throw new Error('CLIENT_ID must be a GUID.'); }
  else if (new URL(value).protocol !== 'https:') throw new Error(`${key} must be an HTTPS URL.`);
}
const template = readFileSync('appPackage/manifest.template.json', 'utf8');
// JSON string escaping prevents configuration values from breaking the manifest.
const output = template.replace(/\$\{(\w+)\}/g, (_, name: string) => JSON.stringify(process.env[name]).slice(1, -1));
JSON.parse(output);
writeFileSync('appPackage/manifest.json', output);
console.log('Created appPackage/manifest.json. Validate it in Teams Developer Portal before installing. No package was created or uploaded.');
