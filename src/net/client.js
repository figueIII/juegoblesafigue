// Cliente (invitado, id 1): envía input a 60 Hz, predice su coche con la física compartida,
// reconcilia con ackSeq e interpola al rival con INTERP_DELAY_MS.
import { CONFIG } from '../config.js';
import { MSG } from '../shared/protocol.js';
import { NEUTRAL_INPUT, sanitizeInput } from './peer.js';
import { resolveShared } from './host.js';

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return a + d * t; };

/** Interpola dos estados de coche (alpha 0..1). Los campos discretos vienen de `b`. */
export function interpolateCar(a, b, alpha) {
  return { ...b, x: lerp(a.x, b.x, alpha), y: lerp(a.y, b.y, alpha), vx: lerp(a.vx || 0, b.vx || 0, alpha), vy: lerp(a.vy || 0, b.vy || 0, alpha), angle: lerpAngle(a.angle, b.angle, alpha) };
}

/**
 * Muestrea el coche `idx` en el instante `serverMs` a partir del buffer ordenado
 * [{t (ms de servidor), state}]. Extrapola ≤ maxExtrapMs con la velocidad si falta futuro.
 */
export function sampleCar(snaps, serverMs, idx, maxExtrapMs = 150) {
  if (!snaps.length) return null;
  const first = snaps[0], last = snaps[snaps.length - 1];
  if (serverMs <= first.t) return { ...first.state.cars[idx] };
  if (serverMs >= last.t) {
    const c = { ...last.state.cars[idx] };
    const e = Math.min(serverMs - last.t, maxExtrapMs) / 1000;
    c.x += (c.vx || 0) * e; c.y += (c.vy || 0) * e;
    return c;
  }
  for (let i = snaps.length - 1; i > 0; i--) {
    const a = snaps[i - 1], b = snaps[i];
    if (a.t <= serverMs && serverMs <= b.t) {
      const alpha = b.t === a.t ? 1 : (serverMs - a.t) / (b.t - a.t);
      return interpolateCar(a.state.cars[idx], b.state.cars[idx], alpha);
    }
  }
  return { ...last.state.cars[idx] };
}

/**
 * @param {object} o  {link, physics?, generateTrack?, name?, now?}
 * Callbacks (también asignables en el objeto devuelto):
 *   onStart({seed, countdown, track})  onState(view) a 60 Hz  onEvent(ev)  onRematch()  onDisconnect(reason, message)
 */
export function createClient(o) {
  const { link, config = CONFIG } = o;
  const MY = 1, RIVAL = 0;
  const dt = 1 / config.INPUT_HZ;
  const now = o.now || nowMs;
  const errTau = 0.1;       // s: constante de decaimiento de la corrección visual
  const errSnap = 150;      // px: error mayor => teleport sin suavizar
  let physics = o.physics, genTrack = o.generateTrack;

  let track = null, pred = null, latest = null, overState = null;
  let pending = [], seq = 0, curInput = { ...NEUTRAL_INPUT };
  let snaps = [], offset = null, lastTick = -1;
  let err = { x: 0, y: 0, angle: 0 };
  let timer = null, lastT = 0, acc = 0, started = false, over = false, helloTimer = null;
  let ackSeqSeen = 0;

  const api = {
    myId: MY,
    get track() { return track; },
    get rtt() { return link.rtt; },
    get lastAck() { return ackSeqSeen; },
    get pendingInputs() { return pending.length; },
    onStart: o.onStart, onState: o.onState, onRematch: o.onRematch, onDisconnect: o.onDisconnect,
    setInput(i) { curInput = sanitizeInput(i); },
    getView, requestRematch, stop,
  };

  // Eventos que llegan antes de que main.js asigne onEvent (p.ej. 'sala llena') se guardan y se entregan al asignarlo.
  let evHandler = o.onEvent || null; const earlyEvents = [];
  Object.defineProperty(api, 'onEvent', {
    enumerable: true,
    get: () => evHandler,
    set: (fn) => { evHandler = fn; if (fn) while (earlyEvents.length) fn(earlyEvents.shift()); },
  });

  const ready = resolveShared(physics, genTrack).then((r) => { physics = r.physics; genTrack = r.generateTrack; });
  const clone = (s) => (physics.cloneState ? physics.cloneState(s) : JSON.parse(JSON.stringify(s)));

  function stepPred(input) {
    if (!pred || pred.phase === 'over') return;
    const r = physics.step(pred, [NEUTRAL_INPUT, input], dt, track);
    if (r && r !== pred && Array.isArray(r.cars)) pred = r;
  }

  function resetRace(seed) {
    track = genTrack(seed);
    pred = physics.createState(track);
    latest = null; overState = null; over = false;
    pending = []; snaps = []; offset = null; lastTick = -1;
    err = { x: 0, y: 0, angle: 0 };
    ackSeqSeen = 0;
  }

  function displayedOwn() {
    const c = pred.cars[MY];
    return { x: c.x + err.x, y: c.y + err.y, angle: c.angle + err.angle };
  }

  function onSnap(m) {
    if (!started || !m.state || m.tick <= lastTick) return; // descarta desordenados/duplicados
    lastTick = m.tick;
    const S = m.state;
    const t = (m.tick * 1000) / config.PHYSICS_HZ, tNow = now();
    const sample = tNow - t;
    offset = offset == null ? sample : sample < offset ? sample : offset + (sample - offset) * 0.02;
    snaps.push({ t, state: S });
    if (snaps.length > 40) snaps.shift();
    latest = S;
    ackSeqSeen = m.ackSeq | 0;

    // Reconciliación: reiniciar desde la verdad del host y reaplicar inputs no confirmados.
    const before = pred ? displayedOwn() : null;
    pred = clone(S);
    pending = pending.filter((i) => i.seq > ackSeqSeen);
    for (const i of pending) stepPred(i);
    if (before) {
      const c = pred.cars[MY];
      const ex = before.x - c.x, ey = before.y - c.y;
      if (Math.hypot(ex, ey) > errSnap) err = { x: 0, y: 0, angle: 0 };
      else {
        let da = (before.angle - c.angle) % (Math.PI * 2);
        if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2;
        err = { x: ex, y: ey, angle: da };
      }
    }
  }

  function tick() {
    const t = now();
    acc += Math.min(t - lastT, 500) / 1000;
    lastT = t;
    let n = 0;
    while (acc >= dt && n < 30) {
      acc -= dt; n++;
      seq++;
      const input = { ...curInput, seq };
      link.send(MSG.INPUT, input, { reliable: false });
      if (!over && pred) {
        pending.push(input);
        if (pending.length > 240) pending.shift();
        stepPred(input);
      }
      const k = Math.exp(-dt / errTau);
      err.x *= k; err.y *= k; err.angle *= k;
    }
    if (n && api.onState) { const v = getView(); if (v) api.onState(v); }
  }

  /** Vista para renderizar: cars[1] = propio (predicho), cars[0] = rival (interpolado). */
  function getView() {
    if (!pred) return null;
    const base = latest || pred;
    const cars = [];
    const own = { ...pred.cars[MY], ...displayedOwn() };
    cars[MY] = own;
    let rival = latest && offset != null ? sampleCar(snaps, now() - offset - config.INTERP_DELAY_MS, RIVAL) : null;
    cars[RIVAL] = rival || { ...pred.cars[RIVAL] };
    const src = over && overState ? overState : base;
    return {
      ...src,
      time: over ? src.time : pred.time, timeLeft: over ? src.timeLeft : pred.timeLeft,
      phase: over ? 'over' : pred.phase,
      cars,
      winner: over ? src.winner : null, reason: over ? src.reason : null,
    };
  }

  function requestRematch() { link.send(MSG.REMATCH, {}, { reliable: true }); }

  function stop() {
    if (timer) clearInterval(timer);
    if (helloTimer) clearInterval(helloTimer);
    timer = helloTimer = null;
    link.close('closed', 'Has salido de la partida.');
  }

  link.on(MSG.START, async (m) => {
    await ready;
    if (helloTimer) { clearInterval(helloTimer); helloTimer = null; }
    resetRace(m.seed);
    started = true;
    acc = 0; lastT = now();
    if (!timer) timer = setInterval(tick, Math.floor(1000 / (config.INPUT_HZ * 2)));
    if (api.onStart) api.onStart({ seed: m.seed, countdown: m.countdown, track });
  });
  link.on(MSG.SNAP, (m) => { ready.then(() => onSnap(m)); });
  link.on(MSG.EVENT, (m) => {
    if (m.kind === 'over') {
      over = true; overState = m.state || latest;
      if (m.state) latest = m.state;
    }
    if (api.onEvent) api.onEvent(m); else if (earlyEvents.length < 20) earlyEvents.push(m);
  });
  link.on(MSG.REMATCH, () => { if (api.onRematch) api.onRematch(); });

  link.onClose((reason, message) => {
    if (timer) clearInterval(timer);
    if (helloTimer) clearInterval(helloTimer);
    timer = helloTimer = null;
    if (api.onDisconnect) api.onDisconnect(reason, message);
  });

  // Saludo con reintento hasta recibir `start` (el anfitrión ignora los repetidos).
  const hello = () => link.send(MSG.HELLO, { v: config.VERSION, name: o.name || 'Invitado' }, { reliable: true });
  hello();
  helloTimer = setInterval(hello, 1000);
  if (helloTimer.unref) helloTimer.unref();

  return api;
}
