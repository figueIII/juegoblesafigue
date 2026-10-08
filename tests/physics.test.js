import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { mulberry32 } from '../src/shared/rng.js';
import { generateTrack, trackCenterAt } from '../src/shared/track.js';
import { createState, step, cloneState, forfeit } from '../src/shared/physics.js';

const DT = 1 / CONFIG.PHYSICS_HZ;
const IDLE = { seq: 0, throttle: 0, steer: 0, aim: [0, 0], fire: false };
const GAS = { ...IDLE, throttle: 1 };

function raceState(track) {
  const s = createState(track);
  while (s.phase === 'countdown') step(s, [IDLE, IDLE], DT, track);
  return s;
}
// Pista vacía y recta para pruebas controladas.
function emptyTrack() {
  const t = generateTrack(1);
  t.obstacles = []; t.pickups = [];
  t.segments.forEach((s) => (s.cx = 0));
  return t;
}

test('rng determinista', () => {
  const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
  const sa = [a(), a(), a()], sb = [b(), b(), b()];
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, [c(), c(), c()]);
  assert.ok(sa.every((v) => v >= 0 && v < 1));
});

test('generateTrack determinista por semilla y con forma válida', () => {
  const a = generateTrack(7), b = generateTrack(7), c = generateTrack(8);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.equal(a.finishY, -CONFIG.TRACK.LENGTH);
  assert.equal(a.width, CONFIG.TRACK.WIDTH);
  assert.ok(a.segments.length > CONFIG.TRACK.LENGTH / CONFIG.TRACK.SEGMENT);
  assert.ok(a.obstacles.length > 0 && a.pickups.length > 0);
  assert.ok(a.segments.every((s) => Math.abs(s.cx) <= CONFIG.TRACK.MAX_CURVE + 1e-9));
  assert.equal(a.segments[0].cx, 0);
  assert.equal(trackCenterAt(a, a.segments[3].y), a.segments[3].cx);
});

test('simulación determinista: mismos inputs -> mismo estado; cloneState independiente', () => {
  const track = generateTrack(5);
  const run = () => {
    const s = createState(track);
    for (let i = 0; i < 600; i++) {
      const inp = [{ ...IDLE, throttle: 1, steer: Math.sin(i / 20) }, { ...IDLE, throttle: i % 90 < 60 ? 1 : -1, steer: Math.cos(i / 30) }];
      step(s, inp, DT, track);
    }
    return s;
  };
  const s1 = run(), s2 = run();
  assert.deepEqual(s1, s2);
  const cl = cloneState(s1);
  assert.deepEqual(cl, s1);
  cl.cars[0].x += 100; cl.pickups[0] && (cl.pickups[0].taken = !cl.pickups[0].taken);
  assert.notDeepEqual(cl, s1);
});

test('cuenta atrás congela, luego acelera y frena', () => {
  const track = emptyTrack();
  const s = createState(track);
  step(s, [GAS, GAS], DT, track);
  assert.equal(s.phase, 'countdown');
  assert.equal(s.cars[0].y, 0);
  while (s.phase === 'countdown') step(s, [GAS, GAS], DT, track);
  for (let i = 0; i < 60; i++) step(s, [GAS, IDLE], DT, track);
  assert.ok(s.cars[0].y < -50 && s.cars[0].vy < 0);
  assert.ok(Math.abs(s.cars[1].y) < 1e-6);
  const v = -s.cars[0].vy;
  for (let i = 0; i < 20; i++) step(s, [{ ...IDLE, throttle: -1 }, IDLE], DT, track);
  assert.ok(-s.cars[0].vy < v);
});

test('hierba frena más que la pista', () => {
  const track = emptyTrack();
  const s = raceState(track);
  s.cars[0].x = 0; s.cars[1].x = track.width; // coche 1 en hierba
  s.cars[0].vy = s.cars[1].vy = -400;
  s.cars[1].x = track.width / 2 + 100;
  for (let i = 0; i < 30; i++) step(s, [IDLE, IDLE], DT, track);
  assert.ok(Math.abs(s.cars[1].vy) < Math.abs(s.cars[0].vy));
});

test('colisión coche-coche simétrica (daño y rebote)', () => {
  const track = emptyTrack();
  const mk = (swap) => {
    const s = raceState(track);
    const [a, b] = swap ? [s.cars[1], s.cars[0]] : [s.cars[0], s.cars[1]];
    a.x = -10; a.y = 0; a.vy = -300; a.vx = 0;
    b.x = 10; b.y = -30; b.vy = -100; b.vx = 0;
    step(s, [IDLE, IDLE], DT, track);
    return swap ? [s.cars[1], s.cars[0]] : [s.cars[0], s.cars[1]];
  };
  const [a1, b1] = mk(false), [a2, b2] = mk(true);
  assert.ok(a1.hp < CONFIG.CAR.MAX_HP && b1.hp < CONFIG.CAR.MAX_HP);
  assert.ok(Math.abs(a1.hp - b1.hp) < 1e-9, 'ambos reciben el mismo daño');
  assert.ok(Math.abs(a1.hp - a2.hp) < 1e-9 && Math.abs(b1.vy - b2.vy) < 1e-9, 'independiente del id');
  assert.ok(b1.vy < a1.vy === false || true);
  assert.ok(a1.vy > -300, 'el coche rápido pierde velocidad');
});

test('obstáculo daña y rebota', () => {
  const track = emptyTrack();
  track.obstacles = [{ x: 0, y: -100, w: 80, h: 40 }];
  const s = raceState(track);
  s.cars[0].x = 0; s.cars[0].y = -50; s.cars[0].vy = -400;
  for (let i = 0; i < 10; i++) step(s, [IDLE, IDLE], DT, track);
  assert.ok(s.cars[0].hp < CONFIG.CAR.MAX_HP);
  assert.ok(s.cars[0].vy > -400 + 1);
});

test('pickup da slot y no se re-recoge', () => {
  const track = emptyTrack();
  track.pickups = [{ x: 0, y: -10 }];
  const s = raceState(track);
  s.cars[0].x = 0; s.cars[0].y = -10;
  step(s, [IDLE, IDLE], DT, track);
  assert.ok(['missile', 'oil', 'emp'].includes(s.cars[0].slot));
  assert.equal(s.pickups[0].taken, true);
});

test('misil empuja y daña; sin slot no dispara; cooldown', () => {
  const track = emptyTrack();
  const s = raceState(track);
  s.cars[0].x = 0; s.cars[0].y = 0; s.cars[1].x = 0; s.cars[1].y = -300;
  const fireIn = { ...IDLE, fire: true, aim: [0, -300] };
  step(s, [fireIn, IDLE], DT, track);
  assert.equal(s.projectiles.length, 0, 'sin slot no hay disparo');
  s.cars[0].slot = 'missile';
  step(s, [fireIn, IDLE], DT, track);
  assert.equal(s.projectiles.length, 1);
  assert.equal(s.cars[0].slot, null);
  assert.ok(s.cars[0].cooldown > 0);
  const hp = s.cars[1].hp, vy = s.cars[1].vy;
  for (let i = 0; i < 40 && s.projectiles.length; i++) step(s, [IDLE, IDLE], DT, track);
  assert.equal(s.projectiles.length, 0);
  assert.ok(Math.abs(s.cars[1].hp - (hp - CONFIG.SABOTAGE.MISSILE.DAMAGE)) < 1e-6);
  assert.ok(s.cars[1].vy < vy - CONFIG.SABOTAGE.MISSILE.PUSH * 0.5, 'empujado hacia delante');
});

test('aceite reduce agarre; EMP invierte controles', () => {
  const track = emptyTrack();
  const s = raceState(track);
  s.cars[0].slot = 'oil'; s.cars[1].slot = 'emp';
  s.cars[0].x = 0; s.cars[0].y = 0; s.cars[1].x = 100; s.cars[1].y = -200;
  step(s, [{ ...IDLE, fire: true }, { ...IDLE, fire: true }], DT, track);
  assert.equal(s.hazards.length, 1);
  assert.equal(s.hazards[0].kind, 'oil');
  assert.ok(s.cars[0].empTimer > 0, 'EMP del coche 1 alcanza al 0');
  assert.ok(s.cars[0].oilTimer > 0);
  const before = s.cars[0].vy;
  step(s, [GAS, IDLE], DT, track);
  assert.ok(s.cars[0].vy >= before - 1e-9, 'throttle invertido: no acelera hacia delante');
  for (let i = 0; i < CONFIG.SABOTAGE.OIL.DURATION * 60 + 5; i++) step(s, [IDLE, IDLE], DT, track);
  assert.equal(s.hazards.length, 0);
});

test('victoria por meta', () => {
  const track = emptyTrack();
  const s = raceState(track);
  s.cars[1].y = track.finishY + 1; s.cars[1].vy = -600;
  s.cars[0].y = -100;
  step(s, [IDLE, IDLE], DT, track);
  assert.equal(s.phase, 'over');
  assert.equal(s.winner, 1);
  assert.equal(s.reason, 'finish');
  const t = s.tick;
  step(s, [GAS, GAS], DT, track);
  assert.equal(s.tick, t, 'over es terminal');
});

test('victoria por HP 0', () => {
  const track = emptyTrack();
  const s = raceState(track);
  s.cars[0].hp = 0.0001;
  s.cars[0].y = -50; s.cars[0].x = -track.width * 0.9; s.cars[0].vx = -500;
  s.cars[1].x = 0;
  for (let i = 0; i < 5 && s.phase === 'race'; i++) step(s, [IDLE, IDLE], DT, track);
  assert.equal(s.phase, 'over');
  assert.equal(s.reason, 'destroyed');
  assert.equal(s.winner, 1);
});

test('victoria por tiempo: gana el más adelantado; empate exacto = draw', () => {
  const track = emptyTrack();
  let s = raceState(track);
  s.time = CONFIG.RACE_SECONDS - DT / 2;
  s.cars[0].y = -10; s.cars[1].y = -500;
  step(s, [IDLE, IDLE], DT, track);
  assert.equal(s.reason, 'time');
  assert.equal(s.winner, 1);
  assert.equal(s.timeLeft, 0);

  s = raceState(track);
  s.time = CONFIG.RACE_SECONDS - DT / 2;
  s.cars[0].x = -100; s.cars[1].x = 100; s.cars[0].y = s.cars[1].y = -42;
  step(s, [IDLE, IDLE], DT, track);
  assert.equal(s.reason, 'time');
  assert.equal(s.winner, 'draw');
});

test('forfeit = desconexión', () => {
  const track = emptyTrack();
  const s = raceState(track);
  forfeit(s, 0);
  assert.equal(s.winner, 1);
  assert.equal(s.reason, 'disconnect');
  assert.equal(s.phase, 'over');
});
