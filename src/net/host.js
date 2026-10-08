// Sesión autoritativa del anfitrión: simula a 60 Hz, envía snapshots a SNAPSHOT_HZ (30 Hz).
// La física se inyecta (`physics`, `generateTrack`) para poder probar con un stub.
import { CONFIG } from '../config.js';
import { MSG } from '../shared/protocol.js';
import { NEUTRAL_INPUT, sanitizeInput } from './peer.js';

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const r2 = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);
const r4 = (v) => (typeof v === 'number' ? Math.round(v * 10000) / 10000 : v);
/** Copia del estado con decimales recortados para reducir el tamaño del snapshot (no muta `s`). */
export function roundState(s) {
  const o = { ...s };
  if (typeof s.time === 'number') o.time = r4(s.time);
  if (Array.isArray(s.cars)) o.cars = s.cars.map((c) => { const q = { ...c }; for (const k in q) q[k] = k === 'angle' ? r4(q[k]) : r2(q[k]); return q; });
  if (Array.isArray(s.projectiles)) o.projectiles = s.projectiles.map((p) => { const q = { ...p }; for (const k in q) q[k] = r2(q[k]); return q; });
  if (Array.isArray(s.hazards)) o.hazards = s.hazards.map((h) => { const q = { ...h }; for (const k in q) q[k] = r2(q[k]); return q; });
  return o;
}

/** Carga la física/pista reales si no se inyectaron (import dinámico: no rompe tests con stub). */
export async function resolveShared(physics, generateTrack) {
  let p = physics, g = generateTrack || (physics && physics.generateTrack);
  if (!p) p = await import('../shared/physics.js');
  if (!g) g = (await import('../shared/track.js')).generateTrack;
  return { physics: p, generateTrack: g };
}

const randomSeed = () => (Math.floor(Math.random() * 0x100000000)) >>> 0;

/**
 * @param {object} o
 * @param {Link} o.link  enlace con el invitado
 * @param {object} [o.physics]  {createState, step, cloneState?}
 * @param {Function} [o.generateTrack]
 * Callbacks (también asignables después en el objeto devuelto):
 *   onState(state)  cada tick de física (para renderizar al anfitrión, id 0)
 *   onEvent(ev)     {kind:'hit'|'fire'|'pickup'|'over', ...}
 *   onStart({seed, track, state})  al empezar partida o revancha
 *   onGuestHello(name), onRematch(), onDisconnect(reason, message), onWarning(msg)
 */
export function createHostSession(o) {
  const { link, config = CONFIG } = o;
  const dt = 1 / config.PHYSICS_HZ;
  const snapEvery = Math.max(1, Math.round(config.PHYSICS_HZ / config.SNAPSHOT_HZ));
  const now = o.now || nowMs;
  const autoStart = o.autoStart !== false;

  let physics = o.physics, genTrack = o.generateTrack;
  let track = null, state = null;
  let hostInput = { ...NEUTRAL_INPUT }, guestInput = { ...NEUTRAL_INPUT };
  let lastSeq = -1;     // monotónico a través de revanchas
  let ackSeq = 0;
  let timer = null, lastT = 0, acc = 0;
  let started = false, finished = false;
  let hostRematch = false, guestRematch = false;
  let prev = null;
  let guestName = 'Invitado';

  const api = {
    guestName: () => guestName,
    get track() { return track; },
    get state() { return state; },
    get rtt() { return link.rtt; },
    get running() { return !!timer; },
    onState: o.onState, onEvent: o.onEvent, onStart: o.onStart, onGuestHello: o.onGuestHello,
    onRematch: o.onRematch, onDisconnect: o.onDisconnect, onWarning: o.onWarning,
    setInput(i) { hostInput = sanitizeInput(i); },
    startRace, requestRematch, stop,
  };

  const ready = resolveShared(physics, genTrack).then((r) => { physics = r.physics; genTrack = r.generateTrack; });
  const clone = (s) => (physics.cloneState ? physics.cloneState(s) : JSON.parse(JSON.stringify(s)));

  function emit(ev) {
    link.send(MSG.EVENT, ev, { reliable: true });
    if (api.onEvent) api.onEvent(ev);
  }

  function snapshotFacts(s) {
    return {
      hp: s.cars.map((c) => c.hp),
      proj: new Set((s.projectiles || []).map((p) => p.id)),
      taken: new Set((s.pickups || []).filter((p) => p.taken).map((p) => p.id)),
    };
  }

  function detectEvents(s) {
    if (prev) {
      s.cars.forEach((c, i) => { if (c.hp < prev.hp[i]) emit({ kind: 'hit', car: i, hp: c.hp, dmg: prev.hp[i] - c.hp, tick: s.tick }); });
      for (const p of s.projectiles || []) if (!prev.proj.has(p.id)) emit({ kind: 'fire', owner: p.owner, id: p.id, tick: s.tick });
      for (const p of s.pickups || []) if (p.taken && !prev.taken.has(p.id)) emit({ kind: 'pickup', id: p.id, tick: s.tick });
    }
    prev = snapshotFacts(s);
  }

  function sendSnap() {
    link.send(MSG.SNAP, { tick: state.tick, ackSeq, state: roundState(state) }, { reliable: false });
  }

  function finish() {
    if (finished) return;
    finished = true;
    if (timer) { clearInterval(timer); timer = null; }
    sendSnap();
    emit({ kind: 'over', winner: state.winner, reason: state.reason, state });
  }

  function stepOnce() {
    const r = physics.step(state, [hostInput, guestInput], dt, track);
    if (r && r !== state && Array.isArray(r.cars)) state = r;
    ackSeq = Math.max(0, lastSeq);
    detectEvents(state);
    if (state.tick % snapEvery === 0 && state.phase !== 'over') sendSnap();
    if (api.onState) api.onState(state);
    if (state.phase === 'over') finish();
  }

  function loop() {
    const t = now();
    acc += Math.min(t - lastT, 500) / 1000; // límite para no entrar en espiral tras pausas
    lastT = t;
    let n = 0;
    while (acc >= dt && n < 60 && timer && !finished) { acc -= dt; n++; stepOnce(); }
  }

  async function startRace(seed = o.seed != null ? o.seed : randomSeed()) {
    await ready;
    if (link.closed) return;
    if (timer) clearInterval(timer);
    track = genTrack(seed);
    state = physics.createState(track);
    guestInput = { ...NEUTRAL_INPUT };
    ackSeq = Math.max(0, lastSeq);
    started = true; finished = false; hostRematch = guestRematch = false; prev = snapshotFacts(state);
    link.send(MSG.START, { seed, countdown: config.COUNTDOWN_SECONDS }, { reliable: true });
    if (api.onStart) api.onStart({ seed, track, state });
    acc = 0; lastT = now();
    timer = setInterval(loop, Math.floor(1000 / (config.PHYSICS_HZ * 2)));
  }

  function requestRematch() {
    hostRematch = true;
    link.send(MSG.REMATCH, {}, { reliable: true });
    maybeRematch();
  }
  function maybeRematch() { if (hostRematch && guestRematch && finished) startRace(); }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    if (typeof document !== 'undefined' && onVis) document.removeEventListener('visibilitychange', onVis);
    link.close('closed', 'Partida terminada.');
  }

  // --- mensajes del invitado ---
  link.on(MSG.HELLO, (m) => {
    if (m.v !== config.VERSION) {
      link.send(MSG.EVENT, { kind: 'error', message: `Versión incompatible (anfitrión ${config.VERSION}, invitado ${m.v}). Recarga la página.` });
      return;
    }
    if (started) return; // hello repetido (el invitado reintenta hasta recibir start)
    guestName = String(m.name || 'Invitado').slice(0, 20);
    if (api.onGuestHello) api.onGuestHello(guestName);
    if (autoStart) startRace();
  });
  link.on(MSG.INPUT, (m) => {
    const i = sanitizeInput(m);
    if (i.seq > lastSeq) { lastSeq = i.seq; guestInput = i; }
  });
  link.on(MSG.REMATCH, () => { guestRematch = true; if (api.onRematch) api.onRematch(); maybeRematch(); });

  link.onClose((reason, message) => {
    if (timer) { clearInterval(timer); timer = null; }
    if (started && !finished && state) {
      state.phase = 'over'; state.winner = 0; state.reason = 'disconnect';
      finished = true;
      if (api.onEvent) api.onEvent({ kind: 'over', winner: 0, reason: 'disconnect', state });
      if (api.onState) api.onState(state);
    }
    if (api.onDisconnect) api.onDisconnect(reason, message);
  });

  // Aviso si la pestaña del anfitrión pasa a segundo plano (los timers se ralentizan).
  let onVis = null;
  if (typeof document !== 'undefined' && document.addEventListener) {
    onVis = () => { if (document.hidden && timer && api.onWarning) api.onWarning('La pestaña del anfitrión está en segundo plano: la partida puede ir lenta. Vuelve a esta pestaña.'); };
    document.addEventListener('visibilitychange', onVis);
  }

  return api;
}
