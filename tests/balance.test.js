// Balance con bots simples (tools/botsim.js). Umbrales holgados: detectan regresiones de config.js, no ruido.
import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, makeBot } from '../tools/botsim.js';
import { CONFIG } from '../src/config.js';

const N = 24;
const runs = [];
for (let k = 0; k < N; k++) {
  const aggSide = k % 2;
  const bots = [0, 1].map((i) => makeBot({ seed: k * 2 + i + 1, skill: 0.95, aggressive: i === aggSide }));
  runs.push({ aggSide, r: simulate({ seed: k + 1, bots }) });
}

test('nadie llega a meta antes de 45 s y la carrera dura cerca de 60 s', () => {
  const finishes = runs.filter((x) => x.r.reason === 'finish').map((x) => x.r.time);
  if (finishes.length) assert.ok(Math.min(...finishes) >= 45, `meta demasiado pronto: ${Math.min(...finishes)}`);
  const avg = runs.reduce((a, x) => a + x.r.time, 0) / N;
  assert.ok(avg >= 45 && avg <= CONFIG.RACE_SECONDS, `duración media ${avg}`);
  assert.ok(runs.every((x) => x.r.time <= CONFIG.RACE_SECONDS + 0.1));
});

test('bots competentes casi nunca mueren solos; los sabotajes son útiles pero no decisivos', () => {
  const killed = runs.filter((x) => x.r.reason === 'destroyed').length;
  assert.ok(killed / N <= 0.35, `demasiadas muertes: ${killed}/${N}`);
  const wins = runs.filter((x) => x.r.winner === x.aggSide).length / N;
  assert.ok(wins >= 0.5 && wins <= 0.85, `ventaja del que sabotea: ${wins}`);
});
