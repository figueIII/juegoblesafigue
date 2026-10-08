// Física determinista compartida host/cliente. Sin DOM, sin Math.random.
// Convenciones: angle 0 = apunta a -Y (avance); forward = (sin a, -cos a); right = (cos a, sin a).
// steer > 0 gira a la derecha. Durante la cuenta atrás state.time < 0 (empieza en -COUNTDOWN_SECONDS).
import { CONFIG } from '../config.js';
import { mulberry32 } from './rng.js';
import { trackCenterAt } from './track.js';

const { CAR, SABOTAGE, TRACK, CATCHUP } = CONFIG;

// Constantes DERIVADAS de CONFIG (no hay valor propio en config para ellas).
const LAT_GRIP = CAR.TURN_RATE * 3;          // amortiguación lateral (1/s) con agarre normal
const REVERSE_MAX = CAR.MAX_SPEED * 0.3;     // velocidad máx. marcha atrás
const WALL_MARGIN = TRACK.WIDTH * 0.4;       // hierba entre el borde de pista y el muro
const PICKUP_RADIUS = CAR.H * 0.75;
const OIL_LINGER = SABOTAGE.COOLDOWN;        // s de pérdida de agarre tras salir del charco
const MISSILE_SPAWN = CAR.H * 0.5;
const HIT_MARGIN = 4;
const KINDS = ['missile', 'oil', 'emp'];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function createState(track) {
  const cx = track.segments[0].cx;
  const off = track.width * 0.12;
  const mk = (id, x) => ({ id, x, y: 0, angle: 0, vx: 0, vy: 0, hp: CAR.MAX_HP, slot: null, cooldown: 0, oilTimer: 0, empTimer: 0, boost: 0, turbo: false, turboCd: 0 });
  return {
    tick: 0,
    time: -CONFIG.COUNTDOWN_SECONDS,
    phase: 'countdown',
    cars: [mk(0, cx - off), mk(1, cx + off)],
    projectiles: [],
    hazards: [],
    pickups: track.pickups.map((p, i) => ({ id: i, x: p.x, y: p.y, taken: false })),
    winner: null,
    reason: null,
  };
}

export function cloneState(s) {
  return {
    tick: s.tick, time: s.time, phase: s.phase,
    cars: s.cars.map((c) => ({ ...c })),
    projectiles: s.projectiles.map((p) => ({ ...p })),
    hazards: s.hazards.map((h) => ({ ...h })),
    pickups: s.pickups.map((p) => ({ ...p })),
    winner: s.winner, reason: s.reason,
  };
}

/** Termina la carrera por abandono/desconexión del jugador loserId. */
export function forfeit(state, loserId, reason = 'disconnect') {
  if (state.phase === 'over') return state;
  state.phase = 'over';
  state.winner = 1 - loserId;
  state.reason = reason;
  return state;
}

// ---------- SAT sobre rectángulos orientados ----------
// box = { x, y, hw, hh, a }. Devuelve null o { nx, ny, depth } con la normal apuntando de A a B.
export function satOBB(A, B) {
  const axes = [
    [Math.cos(A.a), Math.sin(A.a)], [Math.sin(A.a), -Math.cos(A.a)],
    [Math.cos(B.a), Math.sin(B.a)], [Math.sin(B.a), -Math.cos(B.a)],
  ];
  const dx = B.x - A.x, dy = B.y - A.y;
  let best = Infinity, bn = null;
  for (const [ax, ay] of axes) {
    const ra = A.hw * Math.abs(ax * Math.cos(A.a) + ay * Math.sin(A.a)) + A.hh * Math.abs(ax * Math.sin(A.a) - ay * Math.cos(A.a));
    const rb = B.hw * Math.abs(ax * Math.cos(B.a) + ay * Math.sin(B.a)) + B.hh * Math.abs(ax * Math.sin(B.a) - ay * Math.cos(B.a));
    const d = dx * ax + dy * ay;
    const overlap = ra + rb - Math.abs(d);
    if (overlap <= 0) return null;
    if (overlap < best) { best = overlap; bn = d < 0 ? [-ax, -ay] : [ax, ay]; }
  }
  return { nx: bn[0], ny: bn[1], depth: best };
}

const carBox = (c) => ({ x: c.x, y: c.y, hw: CAR.W / 2, hh: CAR.H / 2, a: c.angle });
const rectBox = (o) => ({ x: o.x, y: o.y, hw: o.w / 2, hh: o.h / 2, a: 0 });

function pointInBox(px, py, b, m) {
  const dx = px - b.x, dy = py - b.y;
  const c = Math.cos(b.a), s = Math.sin(b.a);
  return Math.abs(dx * c + dy * s) <= b.hw + m && Math.abs(dx * s - dy * c) <= b.hh + m;
}

function normInput(i) {
  i = i || {};
  const aim = Array.isArray(i.aim) && Number.isFinite(i.aim[0]) && Number.isFinite(i.aim[1]) ? i.aim : null;
  return { throttle: clamp(+i.throttle || 0, -1, 1), steer: clamp(+i.steer || 0, -1, 1), aim, fire: !!i.fire };
}

// ---------- coches ----------
function fire(state, car, inp) {
  if (!inp.fire || !car.slot || car.cooldown > 0) return;
  const fx = Math.sin(car.angle), fy = -Math.cos(car.angle);
  const kind = car.slot;
  car.slot = null;
  car.cooldown = SABOTAGE.COOLDOWN;
  if (kind === 'missile') {
    let dx = fx, dy = fy;
    if (inp.aim) {
      const ax = inp.aim[0] - car.x, ay = inp.aim[1] - car.y, l = Math.hypot(ax, ay);
      if (l > 1e-6) { dx = ax / l; dy = ay / l; }
    }
    const M = SABOTAGE.MISSILE;
    state.projectiles.push({
      id: state.tick * 2 + car.id, owner: car.id,
      x: car.x + dx * MISSILE_SPAWN, y: car.y + dy * MISSILE_SPAWN,
      vx: dx * M.SPEED, vy: dy * M.SPEED, ttl: M.LIFETIME,
    });
  } else if (kind === 'oil') {
    state.hazards.push({
      id: state.tick * 2 + car.id, kind: 'oil',
      x: car.x - fx * CAR.H, y: car.y - fy * CAR.H, r: SABOTAGE.OIL.RADIUS, ttl: SABOTAGE.OIL.DURATION,
    });
  } else if (kind === 'emp') {
    const other = state.cars[1 - car.id];
    if (Math.hypot(other.x - car.x, other.y - car.y) <= SABOTAGE.EMP.RANGE) other.empTimer = SABOTAGE.EMP.DURATION;
  }
}

function drive(state, car, inp, dt, track) {
  let { throttle, steer } = inp;
  if (car.empTimer > 0) { throttle = -throttle; steer = -steer; }
  for (const h of state.hazards) {
    if (h.kind === 'oil' && Math.hypot(car.x - h.x, car.y - h.y) <= h.r) car.oilTimer = OIL_LINGER;
  }
  const onGrass = Math.abs(car.x - trackCenterAt(track, car.y)) > track.width / 2;

  // Velocidad actual en ejes del coche (con el ángulo anterior), giro, y recomposición con el nuevo
  // ángulo: la parte que no se alinea se convierte en derrape y la amortigua el agarre lateral.
  let fx = Math.sin(car.angle), fy = -Math.cos(car.angle);
  let vf = car.vx * fx + car.vy * fy;
  const topSpeed = CAR.MAX_SPEED * (1 + car.boost), accel = CAR.ACCEL * (1 + car.boost);
  car.angle += steer * CAR.TURN_RATE * dt * clamp(vf / (CAR.MAX_SPEED * 0.15), -1, 1);
  fx = Math.sin(car.angle); fy = -Math.cos(car.angle);
  const rx = Math.cos(car.angle), ry = Math.sin(car.angle);
  vf = car.vx * fx + car.vy * fy;
  let vl = car.vx * rx + car.vy * ry;

  if (throttle > 0) vf += accel * throttle * dt;
  else if (throttle < 0) {
    if (vf > 0) vf = Math.max(0, vf + CAR.BRAKE * throttle * dt);
    else vf = Math.max(-REVERSE_MAX, vf + CAR.ACCEL * throttle * dt);
  }
  vf -= vf * Math.min(1, CAR.DRAG * dt);
  const grip = LAT_GRIP * (car.oilTimer > 0 ? SABOTAGE.OIL.GRIP : 1);
  vl *= Math.exp(-grip * dt);
  vf = clamp(vf, -REVERSE_MAX, topSpeed);

  car.vx = fx * vf + rx * vl;
  car.vy = fy * vf + ry * vl;
  if (onGrass) { const k = Math.exp(-CAR.GRASS_DRAG * dt); car.vx *= k; car.vy *= k; }
  car.x += car.vx * dt;
  car.y += car.vy * dt;
}

function carVsCar(c0, c1) {
  const hit = satOBB(carBox(c0), carBox(c1));
  if (!hit) return;
  const { nx, ny, depth } = hit;
  c0.x -= nx * depth / 2; c0.y -= ny * depth / 2;
  c1.x += nx * depth / 2; c1.y += ny * depth / 2;
  const rel = (c1.vx - c0.vx) * nx + (c1.vy - c0.vy) * ny;
  if (rel >= 0) return;
  const j = (-(1 + CAR.BOUNCE) * rel) / (2 / CAR.MASS);
  c0.vx -= (j / CAR.MASS) * nx; c0.vy -= (j / CAR.MASS) * ny;
  c1.vx += (j / CAR.MASS) * nx; c1.vy += (j / CAR.MASS) * ny;
  c0.hp -= CAR.COLLISION_DAMAGE * j;
  c1.hp -= CAR.COLLISION_DAMAGE * j;
}

function carVsWorld(car, track) {
  // Muro: hacia fuera del borde de pista + margen de hierba.
  const cx = trackCenterAt(track, car.y);
  const limit = track.width / 2 + WALL_MARGIN;
  const c = Math.cos(car.angle), s = Math.sin(car.angle);
  const ext = Math.abs(c) * CAR.W / 2 + Math.abs(s) * CAR.H / 2; // semiancho en X del rectángulo girado
  const dx = car.x - cx;
  if (Math.abs(dx) + ext > limit) {
    const side = dx < 0 ? -1 : 1;
    car.x = cx + side * (limit - ext);
    const vn = car.vx * side; // velocidad hacia el muro
    if (vn > 0) {
      car.vx -= (1 + CAR.BOUNCE) * vn * side;
      car.hp -= CAR.WALL_DAMAGE * vn;
    }
  }
}

function carVsObstacles(car, track) {
  for (const o of track.obstacles) {
    if (Math.abs(o.y - car.y) > 100) continue;
    const hit = satOBB(carBox(car), rectBox(o));
    if (!hit) continue;
    const { nx, ny, depth } = hit; // de coche a obstáculo
    car.x -= nx * depth; car.y -= ny * depth;
    const vn = car.vx * nx + car.vy * ny;
    if (vn > 0) {
      car.vx -= (1 + CAR.BOUNCE) * vn * nx;
      car.vy -= (1 + CAR.BOUNCE) * vn * ny;
      car.hp -= CAR.OBSTACLE_DAMAGE * vn;
    }
  }
}

function stepProjectiles(state, dt, track) {
  const M = SABOTAGE.MISSILE;
  const alive = [];
  for (const p of state.projectiles) {
    const target = state.cars[1 - p.owner];
    const box = carBox(target);
    let dead = false;
    const N = 3; // sub-muestreo anti-tunneling
    for (let k = 1; k <= N && !dead; k++) {
      const px = p.x + (p.vx * dt * k) / N, py = p.y + (p.vy * dt * k) / N;
      if (pointInBox(px, py, box, HIT_MARGIN)) {
        const l = Math.hypot(p.vx, p.vy) || 1;
        target.vx += (p.vx / l) * M.PUSH;
        target.vy += (p.vy / l) * M.PUSH;
        target.hp -= M.DAMAGE;
        dead = true;
      } else if (track.obstacles.some((o) => pointInBox(px, py, rectBox(o), 0))) dead = true;
    }
    p.x += p.vx * dt; p.y += p.vy * dt; p.ttl -= dt;
    if (!dead && p.ttl > 0) alive.push(p);
  }
  state.projectiles = alive;
}

/** Tipo de pickup determinista: uniforme si va parejo; sesgado a favor del rezagado (misil) o del líder (aceite/EMP). */
function pickKind(id, car, other) {
  const r = mulberry32(id + 1)();
  const d = car.y - other.y; // >0: el coche va por detrás
  if (Math.abs(d) <= CATCHUP.PICKUP_BIAS_GAP) return KINDS[Math.floor(r * KINDS.length)];
  const w = CATCHUP.PICKUP_WEIGHTS[d > 0 ? 'behind' : 'ahead'];
  let acc = 0;
  for (const k of KINDS) { acc += w[k]; if (r < acc) return k; }
  return KINDS[KINDS.length - 1];
}

/** Remontada: bonus de velocidad al rezagado (proporcional a la distancia) y turbo (sabotaje automático) si la ventaja es enorme. */
function applyCatchUp(state, dt) {
  const [a, b] = state.cars;
  const gap = Math.abs(a.y - b.y);
  const f = clamp((gap - CATCHUP.START) / (CATCHUP.FULL - CATCHUP.START), 0, 1);
  const behind = a.y > b.y ? a : a.y < b.y ? b : null;
  for (const c of state.cars) {
    c.turboCd = Math.max(0, c.turboCd - dt);
    c.boost = behind === c ? f * CATCHUP.MAX_BONUS : behind ? 0 - f * CATCHUP.LEADER_PENALTY : 0;
    c.turbo = behind === c && gap >= CATCHUP.TURBO_GAP;
    if (c.turbo && !c.slot && c.turboCd <= 0) { c.slot = CATCHUP.TURBO_KIND; c.turboCd = CATCHUP.TURBO_COOLDOWN; }
  }
}

function finish(state, winner, reason) {
  state.phase = 'over';
  state.winner = winner;
  state.reason = reason;
}

/** Avanza la simulación dt segundos. Muta `state` y lo devuelve. inputs = [Input0, Input1]. */
export function step(state, inputs, dt, track) {
  if (state.phase === 'over') return state;
  state.tick++;
  state.time += dt;
  if (state.phase === 'countdown') {
    if (state.time < 0) return state;
    state.phase = 'race';
  }
  const cars = state.cars;
  const inp = [normInput(inputs && inputs[0]), normInput(inputs && inputs[1])];

  state.hazards = state.hazards.filter((h) => (h.ttl -= dt) > 0);
  for (const c of cars) {
    c.cooldown = Math.max(0, c.cooldown - dt);
    c.oilTimer = Math.max(0, c.oilTimer - dt);
    c.empTimer = Math.max(0, c.empTimer - dt);
  }
  applyCatchUp(state, dt);
  for (const c of cars) fire(state, c, inp[c.id]);
  for (const c of cars) drive(state, c, inp[c.id], dt, track);
  carVsCar(cars[0], cars[1]);
  for (const c of cars) {
    carVsWorld(c, track);
    carVsObstacles(c, track);
    if (!c.slot) {
      for (const p of state.pickups) {
        if (!p.taken && Math.hypot(c.x - p.x, c.y - p.y) <= PICKUP_RADIUS) { p.taken = true; c.slot = pickKind(p.id, c, cars[1 - c.id]); break; }
      }
    }
  }
  stepProjectiles(state, dt, track);
  for (const c of cars) if (c.hp < 0) c.hp = 0;

  // Condiciones de fin.
  const dead0 = cars[0].hp <= 0, dead1 = cars[1].hp <= 0;
  if (dead0 || dead1) return finish(state, dead0 && dead1 ? 'draw' : dead0 ? 1 : 0, 'destroyed'), state;
  const f0 = cars[0].y <= track.finishY, f1 = cars[1].y <= track.finishY;
  if (f0 || f1) {
    const w = f0 && f1 ? (cars[0].y === cars[1].y ? 'draw' : cars[0].y < cars[1].y ? 0 : 1) : f0 ? 0 : 1;
    return finish(state, w, 'finish'), state;
  }
  return state;
}
