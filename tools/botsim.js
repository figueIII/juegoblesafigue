// Simulación de balance con bots simples (Node, sin DOM). Usada por tests/balance.test.js y `npm run balance`.
import { CONFIG } from '../src/config.js';
import { generateTrack, trackCenterAt } from '../src/shared/track.js';
import { createState, step } from '../src/shared/physics.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Bot: sigue el centro de pista con lookahead, esquiva obstáculos, usa sabotajes. skill 0..1 ajusta errores. */
export function makeBot({ skill = 1, aggressive = true, seed = 1 } = {}) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  let wobble = 0, stuck = 0;
  return function bot(state, track, id) {
    const me = state.cars[id], other = state.cars[1 - id];
    const look = 120 + Math.hypot(me.vx, me.vy) * 0.35;
    let tx = trackCenterAt(track, me.y - look) + (id === 0 ? -70 : 70);
    if (Math.abs(other.y - me.y) < 120 && Math.abs(other.x - me.x) < 60) tx += Math.sign(me.x - other.x || 1) * 60;
    if (!me.slot) { // busca el pickup más cercano por delante
      let best = null;
      for (const p of state.pickups) if (!p.taken && p.y < me.y && me.y - p.y < look * 3 && (!best || p.y > best.y)) best = p;
      if (best) tx = best.x;
    }
    for (const o of track.obstacles) {
      const dy = me.y - o.y;
      if (dy > -o.h && dy < look * 2.2 && Math.abs(o.x - me.x) < o.w / 2 + 34) {
        const cx = trackCenterAt(track, o.y), half = track.width / 2 - 30;
        let side = me.x >= o.x ? 1 : -1;
        const tryX = o.x + side * (o.w / 2 + 40);
        if (Math.abs(tryX - cx) > half) side = -side;
        tx = o.x + side * (o.w / 2 + 40);
        break;
      }
    }
    wobble += (rnd() - 0.5) * (1 - skill) * 0.6; wobble *= 0.97;
    const fx = Math.sin(me.angle), fy = -Math.cos(me.angle);
    const want = Math.atan2(tx - me.x, look);
    let da = want - me.angle; da = Math.atan2(Math.sin(da), Math.cos(da));
    const steer = clamp(da * 2.5 + wobble, -1, 1) * (stuck > 30 ? -1 : 1);
    const speed = me.vx * fx + me.vy * fy;
    stuck = speed < 60 ? stuck + 1 : 0;
    let throttle = Math.abs(da) > 0.8 && speed > 300 ? 0.2 : 1;
    if (stuck > 30) { throttle = -1; if (stuck > 90) stuck = 0; }
    let fireNow = false, aim = null;
    if (aggressive && me.slot && me.cooldown <= 0) {
      const dist = Math.hypot(other.x - me.x, other.y - me.y);
      if (me.slot === 'missile') { fireNow = dist < 600 && other.y < me.y + 50; aim = [other.x, other.y]; }
      else if (me.slot === 'emp') fireNow = dist < CONFIG.SABOTAGE.EMP.RANGE * 0.9;
      else if (me.slot === 'oil') fireNow = other.y > me.y && other.y - me.y < 250;
    }
    return { throttle, steer, aim: aim || [me.x, me.y - 100], fire: fireNow };
  };
}

/** Corre una carrera completa. Devuelve { time, winner, reason, y:[..], hp:[..], used:{...} }. */
export function simulate({ seed = 1, bots = [makeBot({ seed: 11 }), makeBot({ seed: 22 })], dt = 1 / CONFIG.PHYSICS_HZ, maxTicks = 60 * 120 } = {}) {
  const track = generateTrack(seed);
  const st = createState(track);
  const used = { missile: 0, oil: 0, emp: 0 };
  let hits = { missile: 0 }, firstFinishT = null;
  for (let i = 0; i < maxTicks && st.phase !== 'over'; i++) {
    const before = st.cars.map((c) => c.slot);
    const inputs = [bots[0](st, track, 0), bots[1](st, track, 1)];
    step(st, inputs, dt, track);
    st.cars.forEach((c, k) => { if (before[k] && !c.slot) used[before[k]]++; });
  }
  return { time: st.time, winner: st.winner, reason: st.reason, y: st.cars.map((c) => c.y), hp: st.cars.map((c) => c.hp), used, state: st, track };
}

export function summarize(n = 20, mk = (k) => ({ seed: k + 1, bots: [makeBot({ seed: k * 2 + 1, skill: 0.9 }), makeBot({ seed: k * 2 + 2, skill: 0.8 })] })) {
  const rs = [];
  for (let k = 0; k < n; k++) rs.push(simulate(mk(k)));
  return rs;
}

if (process.argv[1] && process.argv[1].endsWith('botsim.js')) {
  const rs = summarize(+process.argv[2] || 20);
  const by = {}; rs.forEach((r) => { by[r.reason] = (by[r.reason] || 0) + 1; });
  const times = rs.map((r) => r.time);
  console.log('reasons', by, 'time min/avg/max', Math.min(...times).toFixed(1), (times.reduce((a, b) => a + b) / times.length).toFixed(1), Math.max(...times).toFixed(1));
  console.log('distance avg', (rs.reduce((a, r) => a + Math.max(-r.y[0], -r.y[1]), 0) / rs.length).toFixed(0), 'min hp avg', (rs.reduce((a, r) => a + Math.min(...r.hp), 0) / rs.length).toFixed(0));
  console.log('sabotages used', rs.reduce((a, r) => a + r.used.missile + r.used.oil + r.used.emp, 0) / rs.length);
}
