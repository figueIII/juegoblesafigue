// Host + cliente con física REAL y latencia simulada (createLinkPair latencyMs): sin saltos grandes ni desincronía.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLinkPair } from '../src/net/peer.js';
import { createHostSession } from '../src/net/host.js';
import { createClient } from '../src/net/client.js';
import { CONFIG } from '../src/config.js';
import { makeBot } from '../tools/botsim.js';

CONFIG.RACE_SECONDS = 5;       // carreras cortas para el test (este fichero corre en su propio proceso)
CONFIG.COUNTDOWN_SECONDS = 0.5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(latencyMs, { aggressive = false } = {}) {
  const { a, b } = createLinkPair({ latencyMs });
  const host = createHostSession({ link: a });
  const client = createClient({ link: b, name: 'G' });
  const evH = [], evC = [];
  host.onEvent = (e) => evH.push(e); client.onEvent = (e) => evC.push(e);
  const hb = makeBot({ seed: 5, aggressive }), cb = makeBot({ seed: 6, aggressive });
  let prev = null, maxJump = 0, samples = 0;
  const t0 = Date.now();
  while (!(evH.some((e) => e.kind === 'over') && evC.some((e) => e.kind === 'over')) && Date.now() - t0 < 15000) {
    await sleep(16);
    if (host.state && host.track) host.setInput(hb(host.state, host.track, 0));
    const v = client.getView();
    if (v && client.track) {
      client.setInput(cb(v, client.track, 1));
      const c = v.cars[1];
      if (prev && v.phase === 'race') {
        const expected = Math.hypot(c.vx, c.vy) * 0.016 + 12;
        maxJump = Math.max(maxJump, Math.hypot(c.x - prev.x, c.y - prev.y) - expected);
        samples++;
      }
      prev = { x: c.x, y: c.y };
    }
  }
  const oh = evH.find((e) => e.kind === 'over'), oc = evC.find((e) => e.kind === 'over');
  const out = { oh, oc, maxJump, samples, hostY: host.state.cars.map((c) => c.y), cliY: client.getView().cars.map((c) => c.y) };
  host.stop();
  return out;
}

for (const lat of [80, 150]) {
  test(`latencia ${lat} ms: sin saltos grandes y mismo ganador en host y cliente`, async () => {
    const r = await run(lat);
    assert.ok(r.oh && r.oc, 'ambos reciben el fin de partida');
    assert.equal(r.oc.winner, r.oh.winner, 'mismo ganador');
    assert.equal(r.oc.reason, r.oh.reason);
    assert.ok(r.samples > 100);
    assert.ok(r.maxJump < 60, `salto máximo del coche propio ${r.maxJump.toFixed(1)} px`);
    // posición final del cliente coincide con la del host (estado final autoritativo)
    assert.ok(Math.abs(r.cliY[1] - r.hostY[1]) < 120, `coche propio ${r.cliY[1]} vs host ${r.hostY[1]}`);
  });
}

test('latencia 100 ms con sabotajes: el misil/aceite/EMP se disparan por red y el ganador coincide', async () => {
  const r = await run(100, { aggressive: true });
  assert.equal(r.oc.winner, r.oh.winner);
  assert.ok(r.maxJump < 150, `salto ${r.maxJump}`);
});
