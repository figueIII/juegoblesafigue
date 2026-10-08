// Utilidades e2e: servidor estático (con subruta, como GitHub Pages), Playwright, PeerJS falso y overrides de config.
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../..');
export const OUT = path.join(here, 'out');
export const BASE = '/juegoblesafigue/'; // se sirve bajo subruta para comprobar que las rutas son relativas
fs.mkdirSync(OUT, { recursive: true });

function loadPlaywright() {
  const tried = [];
  for (const dir of [process.cwd() + '/', ROOT + '/', '/opt/node-tools/node_modules/', process.env.PW_NODE_MODULES && process.env.PW_NODE_MODULES + '/']) {
    if (!dir) continue;
    try { return createRequire(dir)('playwright'); } catch (e) { tried.push(dir); }
  }
  throw new Error('No se encontró "playwright" (probado: ' + tried.join(', ') + '). Instálalo (npm i -D playwright) o define PW_NODE_MODULES.');
}
export const pw = loadPlaywright();

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
export function serve(port = 0) {
  const srv = http.createServer((q, s) => {
    const u = decodeURIComponent(q.url.split('?')[0]);
    if (!u.startsWith(BASE)) { s.writeHead(404); return s.end('fuera de la subruta ' + BASE); }
    const rel = u.slice(BASE.length) || 'index.html';
    const p = path.join(ROOT, rel.endsWith('/') ? rel + 'index.html' : rel);
    if (!p.startsWith(ROOT)) { s.writeHead(403); return s.end(); }
    fs.readFile(p, (e, d) => {
      if (e) { s.writeHead(404); s.end(); } else { s.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); s.end(d); }
    });
  });
  return new Promise((res) => srv.listen(port, '127.0.0.1', () => res({ srv, url: `http://127.0.0.1:${srv.address().port}${BASE}` })));
}

export async function launch() {
  try { return await pw.chromium.launch(); } catch (e) {
    const exe = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
    return pw.chromium.launch({ executablePath: exe });
  }
}

const fake = fs.readFileSync(path.join(here, 'fakepeer.js'), 'utf8');
/**
 * Contexto con PeerJS falso. overrides: valores de src/config.js a reescribir, p.ej. { RACE_SECONDS: 6, LENGTH: 2500 }.
 * latencyMs: latencia unidireccional simulada entre pestañas.
 */
export async function newCtx(browser, { overrides = {}, latencyMs = 0, viewport = { width: 900, height: 600 }, ...rest } = {}) {
  const ctx = await browser.newContext({ viewport, ...rest });
  // El CDN se aborta (como sin red) => index.html cae a ./vendor/peerjs.min.js, que sustituimos por el PeerJS falso.
  await ctx.route('https://unpkg.com/**', (r) => r.abort());
  await ctx.route('**/vendor/peerjs.min.js', (r) => r.fulfill({ contentType: 'text/javascript', body: fake }));
  if (latencyMs) await ctx.addInitScript(`window.__FAKE_LATENCY_MS = ${latencyMs};`);
  if (Object.keys(overrides).length) {
    await ctx.route('**/src/config.js', async (r) => {
      let body = fs.readFileSync(path.join(ROOT, 'src/config.js'), 'utf8');
      for (const [k, v] of Object.entries(overrides)) {
        const re = new RegExp(`\\b${k}: [0-9.]+`);
        if (!re.test(body)) throw new Error('override desconocido: ' + k);
        body = body.replace(re, `${k}: ${v}`);
      }
      r.fulfill({ contentType: 'text/javascript', body });
    });
  }
  const logs = [];
  ctx.logs = logs;
  ctx.mk = async (name) => {
    const pg = await ctx.newPage();
    pg.name = name;
    pg.on('console', (m) => { if (m.type() === 'error') logs.push(`${name} console.error: ${m.text()}`); });
    pg.on('pageerror', (e) => logs.push(`${name} PAGEERROR ${e.message}`));
    return pg;
  };
  return ctx;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function waitFor(fn, ms = 20000, what = 'condición') {
  const t = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t > ms) throw new Error('timeout esperando ' + what);
    await sleep(100);
  }
}
/** Host crea sala y el invitado se une por enlace #CODE. Devuelve el código. */
export async function createAndJoin(base, H, G) {
  await H.goto(base);
  await H.click('#btn-create');
  await H.waitForSelector('#room-code');
  const code = (await H.textContent('#room-code')).trim();
  await G.goto(base + '#' + code);
  return code;
}
/** Estado de la sesión del host (autoritativo) serializado. */
export const hostState = (H) => H.evaluate(() => { const s = window.__game && window.__game.sess && window.__game.sess.state; return s ? JSON.parse(JSON.stringify(s)) : null; });
export const guestView = (G) => G.evaluate(() => { const s = window.__game && window.__game.sess && window.__game.sess.getView && window.__game.sess.getView(); return s ? JSON.parse(JSON.stringify(s)) : null; });
