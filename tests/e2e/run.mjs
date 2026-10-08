// Pruebas e2e con Playwright (Chromium) y PeerJS falso. Uso: node tests/e2e/run.mjs [escenario ...]
import assert from 'node:assert/strict';
import path from 'node:path';
import { serve, launch, newCtx, waitFor, sleep, createAndJoin, hostState, guestView, OUT } from './lib.mjs';

const { srv, url: BASE } = await serve();
const browser = await launch();
const shot = (pg, name) => pg.screenshot({ path: path.join(OUT, name + '.png') }).catch(() => {});
const title = (pg) => pg.textContent('#ui h2');
const phaseIs = (H, ph) => async () => (await hostState(H))?.phase === ph;
const resultShown = (pg) => async () => (await pg.$('#btn-rematch')) !== null;

async function mouseFire(pg, x, y) {
  await pg.bringToFront();
  await pg.mouse.move(x, y);
  await pg.mouse.down(); await sleep(150); await pg.mouse.up();
}
/** Comprueba que el panel de resultados (DOM) no pisa el cartel del canvas (título arriba: y = min(25 % alto, 190)). */
async function assertNoOverlap(pg) {
  const r = await pg.evaluate(() => { const b = document.querySelector('#ui .panel').getBoundingClientRect(); return { top: b.top, bottom: b.bottom, h: innerHeight, w: innerWidth, left: b.left, right: b.right }; });
  const titleY = Math.min(r.h * 0.25, 190);
  assert.ok(r.top >= titleY + 62, `el panel (top=${r.top}) pisa el cartel del canvas (hasta y=${titleY + 62}) en ${r.w}x${r.h}`);
  assert.ok(r.bottom <= r.h && r.left >= 0 && r.right <= r.w, 'panel dentro del viewport');
}

const scenarios = {
  // Flujo completo + sabotajes efectivos (misil/aceite/EMP, ambos jugadores) + pickups, todo por entrada real (ratón).
  async sabotajes() {
    const ctx = await newCtx(browser, { overrides: { OBSTACLE_DENSITY: 0 } });
    const H = await ctx.mk('H'), G = await ctx.mk('G');
    await createAndJoin(BASE, H, G);
    await waitFor(phaseIs(H, 'race'), 15000, 'carrera');
    // Pickup: teleport del coche del host al primer pickup => slot lleno y pickup tomado.
    const p0 = (await hostState(H)).pickups[0];
    await H.evaluate(({ x, y }) => { const c = window.__game.sess.state.cars[0]; c.x = x; c.y = y; c.vx = c.vy = 0; }, p0);
    await waitFor(async () => { const s = await hostState(H); return s.cars[0].slot && s.pickups[0].taken; }, 5000, 'recogida de pickup');
    // Alineamos coches: host detrás (y=+400), invitado delante (y=0), misma x, ángulo 0.
    const align = () => H.evaluate(() => { const s = window.__game.sess.state; Object.assign(s.cars[0], { x: 70, y: 400, vx: 0, vy: 0, angle: 0, cooldown: 0, hp: 100, empTimer: 0 }); Object.assign(s.cars[1], { x: 70, y: 0, vx: 0, vy: 0, angle: 0, hp: 100, empTimer: 0 }); s.projectiles = []; s.hazards = []; });
    const setSlot = (id, kind) => H.evaluate(({ id, kind }) => { const c = window.__game.sess.state.cars[id]; c.slot = kind; c.cooldown = 0; }, { id, kind });
    await H.bringToFront();
    await align(); await setSlot(0, 'missile'); await sleep(1500); // la cámara tarda en alcanzar al coche teletransportado
    await mouseFire(H, 450, 40); // arriba = hacia -Y
    await waitFor(async () => (await hostState(H)).cars[1].hp < 100, 4000, 'misil del host impacta al invitado');
    await align(); await setSlot(0, 'oil'); await sleep(1500);
    await mouseFire(H, 450, 40);
    await waitFor(async () => (await hostState(H)).hazards.length > 0, 3000, 'mancha de aceite');
    await waitFor(async () => ((await guestView(G))?.hazards || []).length > 0, 3000, 'el invitado ve el aceite (snapshot)');
    await align(); await setSlot(0, 'emp'); await sleep(1500);
    await mouseFire(H, 450, 40);
    await waitFor(async () => (await hostState(H)).cars[1].empTimer > 0, 3000, 'EMP al invitado');
    // El invitado dispara hacia atrás (el host está 400 px detrás).
    await align(); await setSlot(1, 'missile'); await sleep(1500);
    await mouseFire(G, 450, 590);
    await waitFor(async () => (await hostState(H)).cars[0].hp < 100, 4000, 'misil del invitado impacta al host');
    await shot(H, 'sabotajes-host');
    return ctx;
  },

  // Victoria por meta (host gana), sin solapamiento del panel, revancha, y todo bajo subruta.
  async meta() {
    const ctx = await newCtx(browser, { overrides: { LENGTH: 2200, OBSTACLE_DENSITY: 0 } });
    const H = await ctx.mk('H'), G = await ctx.mk('G');
    await G.setViewportSize({ width: 390, height: 844 });
    await createAndJoin(BASE, H, G);
    await waitFor(phaseIs(H, 'race'), 15000, 'carrera');
    await G.bringToFront(); await G.keyboard.down('d');       // el invitado se desvía y no avanza
    await H.bringToFront(); await H.keyboard.down('w');
    await waitFor(async () => (await resultShown(H)()) && (await resultShown(G)()), 30000, 'panel de resultados');
    console.log('    meta:', await title(H), '|', await H.textContent('#ui p'));
    assert.match(await title(H), /Victoria/); assert.match(await title(G), /Derrota/);
    assert.match(await H.textContent('#ui'), /meta/i);
    await assertNoOverlap(H); await assertNoOverlap(G);
    await shot(H, 'meta-host'); await shot(G, 'meta-guest-390x844');
    await H.keyboard.up('w'); await G.keyboard.up('d');
    await H.click('#btn-rematch'); await G.click('#btn-rematch');
    await waitFor(async () => !(await H.$('#btn-rematch')) && !(await G.$('#btn-rematch')), 8000, 'revancha');
    await waitFor(async () => { const s = await hostState(H); return s && s.time < 3 && s.phase !== 'over'; }, 8000, 'nueva carrera');
    return ctx;
  },

  // Victoria por tiempo: gana el más adelantado (aquí el invitado).
  async tiempo() {
    const ctx = await newCtx(browser, { overrides: { RACE_SECONDS: 5, LENGTH: 40000, OBSTACLE_DENSITY: 0 } });
    const H = await ctx.mk('H'), G = await ctx.mk('G');
    await createAndJoin(BASE, H, G);
    await waitFor(phaseIs(H, 'race'), 15000, 'carrera');
    await G.bringToFront(); await G.keyboard.down('w');
    await waitFor(async () => (await resultShown(H)()) && (await resultShown(G)()), 20000, 'panel de resultados');
    assert.match(await title(G), /Victoria/); assert.match(await title(H), /Derrota/);
    assert.match(await G.textContent('#ui'), /tiempo/i);
    await assertNoOverlap(H);
    await shot(G, 'tiempo-guest');
    return ctx;
  },

  // Sala llena: el tercer jugador recibe un mensaje claro y la partida en curso no se ve afectada.
  async sala_llena() {
    const ctx = await newCtx(browser);
    const H = await ctx.mk('H'), G = await ctx.mk('G'), X = await ctx.mk('X');
    const code = await createAndJoin(BASE, H, G);
    await waitFor(phaseIs(H, 'race'), 15000, 'carrera');
    await X.goto(BASE + '#' + code);
    await waitFor(async () => /llena/i.test((await X.textContent('#ui')) || ''), 10000, 'mensaje de sala llena');
    await shot(X, 'sala-llena');
    assert.notEqual((await hostState(H)).phase, 'over', 'la partida en curso sigue');
    assert.ok(await G.$('canvas'), 'el invitado original sigue en juego');
    return ctx;
  },

  // El host cancela la sala durante la espera: quien abre el enlace ve un error claro.
  async host_cierra_sala() {
    const ctx = await newCtx(browser);
    const H = await ctx.mk('H'), G = await ctx.mk('G');
    await H.goto(BASE); await H.click('#btn-create'); await H.waitForSelector('#room-code');
    const code = (await H.textContent('#room-code')).trim();
    await H.click('text=Cancelar');
    await H.waitForSelector('#btn-create');
    await G.goto(BASE + '#' + code);
    await waitFor(async () => /No existe/i.test((await G.textContent('#ui')) || ''), 10000, 'error de sala inexistente');
    await shot(G, 'sala-cerrada');
    return ctx;
  },

  // Desconexión del invitado en plena carrera: gana el host.
  async desconexion() {
    const ctx = await newCtx(browser);
    const H = await ctx.mk('H'), G = await ctx.mk('G');
    await createAndJoin(BASE, H, G);
    await waitFor(phaseIs(H, 'race'), 15000, 'carrera');
    await G.close();
    await waitFor(resultShown(H), 15000, 'resultado por abandono');
    assert.match(await title(H), /Victoria/); assert.match(await H.textContent('#ui'), /desconect/i);
    assert.equal(await H.$eval('#btn-rematch', (e) => e.disabled), true);
    return ctx;
  },

  // Latencia simulada 120 ms por sentido: sin saltos grandes del coche propio del invitado y mismo resultado en ambos.
  async latencia() {
    const ctx = await newCtx(browser, { overrides: { LENGTH: 3000, OBSTACLE_DENSITY: 0 }, latencyMs: 120 });
    const H = await ctx.mk('H'), G = await ctx.mk('G');
    await createAndJoin(BASE, H, G);
    await waitFor(phaseIs(H, 'race'), 15000, 'carrera');
    await G.evaluate(() => {
      window.__samp = { max: 0, n: 0 }; let prev = null, pt = 0;
      const f = (t) => {
        const v = window.__game.sess && window.__game.sess.getView && window.__game.sess.getView();
        if (v && v.phase === 'race') {
          const c = v.cars[1];
          if (prev && t > pt) { const j = Math.hypot(c.x - prev.x, c.y - prev.y) - (Math.hypot(c.vx, c.vy) * (t - pt) / 1000 + 10); if (j > window.__samp.max) window.__samp.max = j; window.__samp.n++; }
          prev = { x: c.x, y: c.y }; pt = t;
        }
        requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
    await G.bringToFront(); await G.keyboard.down('w');
    await H.bringToFront(); await H.keyboard.down('w'); await H.keyboard.down('d');
    await waitFor(async () => (await resultShown(H)()) && (await resultShown(G)()), 40000, 'resultados con latencia');
    const s = await G.evaluate(() => window.__samp);
    const tH = await title(H), tG = await title(G);
    console.log(`    latencia: ${s.n} muestras, salto máx ${s.max.toFixed(1)} px; H=${tH} G=${tG}`);
    const ok = (a, b) => (/Victoria/.test(a) && /Derrota/.test(b)) || (/Derrota/.test(a) && /Victoria/.test(b)) || (/Empate/.test(a) && /Empate/.test(b));
    assert.ok(ok(tH, tG), `ganador desincronizado: ${tH} / ${tG}`);
    assert.ok(s.n > 50, 'muestras insuficientes');
    assert.ok(s.max < 60, `salto de predicción demasiado grande: ${s.max}`);
    return ctx;
  },

  // Móvil 390x844: menú usable, sin scroll horizontal; en carrera aparecen y funcionan los botones táctiles.
  async movil() {
    const mctx = await newCtx(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const M = await mctx.mk('M');
    await M.goto(BASE);
    await M.waitForSelector('#btn-create');
    const m = await M.evaluate(() => {
      const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, h: b.height }; };
      return { sw: document.documentElement.scrollWidth, iw: innerWidth, create: r('#btn-create'), input: r('input.text'), join: r('.row .btn'), coarse: matchMedia('(pointer: coarse)').matches };
    });
    assert.ok(m.sw <= m.iw, `scroll horizontal: ${m.sw} > ${m.iw}`);
    for (const k of ['create', 'input', 'join']) { assert.ok(m[k].l >= 0 && m[k].r <= m.iw && m[k].t >= 0 && m[k].b <= 844, `${k} fuera de pantalla`); assert.ok(m[k].h >= 40, `${k} demasiado pequeño para tocar`); }
    await shot(M, 'movil-menu');
    await M.tap('#btn-create');
    await M.waitForSelector('#room-code');
    const w = await M.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
    assert.ok(w.sw <= w.iw, 'sala de espera sin scroll horizontal');
    await shot(M, 'movil-espera');
    const code = (await M.textContent('#room-code')).trim();
    await mctx.close();

    // Controles táctiles forzados con ?touch=1 en un contexto de escritorio (host con viewport móvil).
    const ctx = await newCtx(browser);
    const H = await ctx.mk('H'), G = await ctx.mk('G');
    await H.setViewportSize({ width: 390, height: 844 });
    await H.goto(BASE + '?touch=1'); await H.click('#btn-create'); await H.waitForSelector('#room-code');
    const code2 = (await H.textContent('#room-code')).trim();
    await G.goto(BASE + '#' + code2);
    await waitFor(phaseIs(H, 'race'), 15000, 'carrera');
    await H.waitForSelector('.touch-pad .t-gas');
    const boxes = await H.$$eval('.touch-btn', (bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }));
    assert.equal(boxes.length, 4);
    for (const [l, t, r, b] of boxes) assert.ok(l >= 0 && t >= 0 && r <= 390 && b <= 844, 'botón táctil dentro de pantalla');
    await H.dispatchEvent('.t-gas', 'pointerdown', { pointerId: 7, pointerType: 'touch' });
    await sleep(1000);
    const s = await hostState(H);
    assert.ok(s.cars[0].vy < -100, `el botón de acelerar mueve el coche (vy=${s.cars[0].vy})`);
    await H.dispatchEvent('.t-right', 'pointerdown', { pointerId: 8, pointerType: 'touch' });
    await sleep(300);
    await H.dispatchEvent('.t-right', 'pointerup', { pointerId: 8, pointerType: 'touch' });
    assert.ok((await hostState(H)).cars[0].angle > 0.2, 'el botón derecho gira a la derecha');
    await shot(H, 'movil-carrera');
    await H.dispatchEvent('.t-gas', 'pointerup', { pointerId: 7, pointerType: 'touch' });
    return ctx;
  },

  // PeerJS no carga (CDN y copia local bloqueados): mensaje claro, no un fallo de NAT.
  async peerjs_no_carga() {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 600 } });
    await ctx.route('**/vendor/peerjs.min.js', (r) => r.abort());
    await ctx.route('https://unpkg.com/**', (r) => r.abort());
    const pg = await ctx.newPage();
    await pg.goto(BASE);
    await pg.click('#btn-create');
    await waitFor(async () => /PeerJS/.test((await pg.textContent('#ui')) || ''), 20000, 'mensaje de PeerJS');
    assert.ok(!/NAT/.test(await pg.textContent('#ui')), 'no debe culpar al NAT');
    await shot(pg, 'peerjs-no-carga');
    return ctx;
  },
};

const only = process.argv.slice(2);
let failed = 0;
for (const [name, fn] of Object.entries(scenarios)) {
  if (only.length && !only.includes(name)) continue;
  const t0 = Date.now();
  let ctx;
  try {
    ctx = await fn();
    const fatal = (ctx.logs || []).filter((l) => /PAGEERROR/.test(l));
    assert.equal(fatal.length, 0, 'errores de página: ' + fatal.join(' | '));
    console.log(`ok   ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    const errs = (ctx.logs || []).filter((l) => !/PAGEERROR/.test(l) && !/Failed to load resource|ERR_FAILED|net::/.test(l));
    if (errs.length) console.log('     console.error:', errs.join(' | '));
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e.message}`);
  } finally {
    try { await ctx?.close(); } catch {}
  }
}
await browser.close(); srv.close();
console.log(failed ? `\n${failed} escenario(s) fallaron` : '\nTodos los escenarios e2e pasan');
process.exit(failed ? 1 : 0);
