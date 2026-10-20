import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { demoAnswer } from './demo-data.js';
import { UserError } from './model.js';

const files: Record<string, [string, string]> = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/logo.png': ['logo.png', 'image/png'] };
export function createDemoServer() {
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    const localHost = /^127\.0\.0\.1:\d+$/.test(req.headers.host || '');
    if (!localHost) { res.writeHead(403); res.end(); return; }
    try {
      const asset = files[req.url || ''];
      if (req.method === 'GET' && asset) {
        res.setHeader('Content-Type', asset[1]);
        res.end(await readFile(new URL(`../../public/${asset[0]}`, import.meta.url))); return;
      }
      if (req.method !== 'POST' || req.url !== '/api/demo') { res.writeHead(404); res.end(); return; }
      if (req.headers.origin !== `http://${req.headers.host}` || !req.headers['content-type']?.startsWith('application/json')) { res.writeHead(403); res.end(); return; }
      let body = '';
      for await (const part of req) { body += part.toString(); if (Buffer.byteLength(body) > 4096) { res.writeHead(413); res.end(); return; } }
      let payload: { question?: unknown };
      try { payload = JSON.parse(body); } catch { throw new UserError('Send a valid question.'); }
      if (!payload || typeof payload.question !== 'string') throw new UserError('Enter a question.');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(demoAnswer(payload.question)));
    } catch (error) {
      res.writeHead(error instanceof UserError ? 400 : 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error instanceof UserError ? error.message : 'The demo could not complete this request.' }));
    }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createDemoServer().listen(3980, '127.0.0.1', () => console.log('askBICS demo: http://127.0.0.1:3980 — fictional data only; no Microsoft sign-in or live data connection.'));
}
