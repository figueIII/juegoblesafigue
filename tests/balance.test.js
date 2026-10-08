// Balance con bots simples (tools/botsim.js). Umbrales holgados: detectan regresiones de config.js, no ruido.
import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, makeBot, comebackStats } from '../tools/botsim.js';

const N = 24;
const runs = [];
for (let k = 0; k < N; k++) {
  const aggSide = k % 2;
  const bots = [0, 1].map((i) => makeBot({ seed: k * 2 + i + 1, skill: 0.95, aggressive: i === aggSide }));
  runs.push({ aggSide, r: simulate({ seed: k + 1, bots }) });
}

test('sin límite de tiempo: toda carrera termina y dura de media 40-75 s', () => {
  const avg = runs.reduce((a, x) => a + x.r.time, 0) / N;
  assert.ok(avg >= 40 && avg <= 75, `duración media ${avg}`);
  assert.ok(runs.every((x) => x.r.state.phase === 'over'), 'todas terminan');
  const finishes = runs.filter((x) => x.r.reason === 'finish').map((x) => x.r.time);
  if (finishes.length) assert.ok(Math.min(...finishes) >= 40, `meta demasiado pronto: ${Math.min(...finishes)}`);
});

test('remontada: con 1500 px de ventaja el líder gana la mayoría (55-82 %) pero el rezagado remonta con frecuencia', () => {
  const st = comebackStats(40, 1500);
  assert.ok(st.leaderWins >= 0.55 && st.leaderWins <= 0.82, `líder gana ${st.leaderWins}`);
  assert.ok(st.comebacks >= 0.18, `remontadas ${st.comebacks}`);
  assert.ok(st.avgTime >= 40 && st.avgTime <= 75, `duración ${st.avgTime}`);
});

test('bots competentes casi nunca mueren solos; los sabotajes son útiles pero no decisivos', () => {
  const killed = runs.filter((x) => x.r.reason === 'destroyed').length;
  assert.ok(killed / N <= 0.35, `demasiadas muertes: ${killed}/${N}`);
  const wins = runs.filter((x) => x.r.winner === x.aggSide).length / N;
  assert.ok(wins >= 0.5 && wins <= 0.85, `ventaja del que sabotea: ${wins}`);
});
