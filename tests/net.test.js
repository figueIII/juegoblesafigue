// Tests de red con transporte falso en memoria y física stub. Ejecutar: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLinkPair, generateCode, isValidCode, sanitizeInput, createHost, join } from '../src/net/peer.js';
import { createHostSession } from '../src/net/host.js';
import { createClient, sampleCar, interpolateCar } from '../src/net/client.js';
import { CONFIG } from '../src/config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 3000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout esperando condición'); await sleep(5); } };

// --- física stub: coche i avanza -throttle*400 px/s en Y, steer mueve X ---
const generateTrack = (seed) => ({ seed, width: 600, finishY: -300, segments: [], obstacles: [], pickups: [] });
const mkCar = (id, x) => ({ id, x, y: 0, angle: 0, vx: 0, vy: 0, hp: 100, slot: null, cooldown: 0, oilTimer: 0, empTimer: 0 });
const physics = {
  createState: () => ({ tick: 0, time: 0, phase: 'race', cars: [mkCar(0, -50), mkCar(1, 50)], projectiles: [], hazards: [], pickups: [], winner: null, reason: null }),
  step(s, inputs, dt, track) {
    s.tick++; s.time += dt;
    s.cars.forEach((c, i) => { c.vy = -inputs[i].throttle * 400; c.vx = inputs[i].steer * 50; c.y += c.vy * dt; c.x += c.vx * dt; });
    if (s.phase === 'race') {
      const w = s.cars.findIndex((c) => c.y <= track.finishY);
      if (w >= 0) { s.phase = 'over'; s.winner = w; s.reason = 'finish'; }
    }
    return s;
  },
  cloneState: (s) => JSON.parse(JSON.stringify(s)),
};

function setup(linkOpts = {}) {
  const { a, b, channels } = createLinkPair(linkOpts);
  const host = createHostSession({ link: a, physics, generateTrack });
  const client = createClient({ link: b, physics, generateTrack, name: 'Pepe' });
  return { a, b, channels, host, client };
}

test('códigos de sala y sanitizado', () => {
  const c = generateCode();
  assert.equal(c.length, 5);
  assert.ok(isValidCode(c));
  assert.ok(!isValidCode('ab'));
  assert.deepEqual(sanitizeInput({ seq: 3, throttle: 9, steer: NaN, aim: [1, 'x'], fire: 1 }), { seq: 3, throttle: 1, steer: 0, aim: [0, 0], fire: true });
});

test('handshake: hello/start con misma seed', async () => {
  const { host, client, a } = setup();
  let hostStart, clientStart, helloName;
  host.onGuestHello = (n) => { helloName = n; };
  host.onStart = (s) => { hostStart = s; };
  client.onStart = (s) => { clientStart = s; };
  await until(() => hostStart && clientStart);
  assert.equal(helloName, 'Pepe');
  assert.equal(hostStart.seed, clientStart.seed);
  assert.deepEqual(hostStart.track, clientStart.track);
  host.stop();
});

test('input -> ackSeq -> reconciliación; el cliente predice cerca del host', async () => {
  const { host, client } = setup({ latencyMs: 20 });
  await until(() => client.getView());
  client.setInput({ throttle: 0.5, steer: 0 });
  await sleep(400);
  assert.ok(client.lastAck > 0, 'ackSeq debe avanzar');
  assert.ok(client.pendingInputs < 60, 'inputs confirmados se descartan');
  const view = client.getView();
  const hostCar = host.state.cars[1];
  assert.ok(hostCar.y < -10, 'el host aplicó el input del invitado');
  // el propio coche predicho va por delante o igual que el host (compensa latencia), nunca muy lejos
  assert.ok(Math.abs(view.cars[1].y - hostCar.y) < 80, `desvío ${view.cars[1].y} vs ${hostCar.y}`);
  assert.equal(view.cars[1].id, 1);
  assert.ok(client.rtt > 20 && client.rtt < 200 || client.rtt === null);
  host.stop();
});

test('interpolación del rival', () => {
  const car = (x, y, angle) => ({ id: 0, x, y, vx: 0, vy: -100, angle, hp: 100 });
  const snaps = [{ t: 0, state: { cars: [car(0, 0, 0)] } }, { t: 50, state: { cars: [car(100, -50, 1)] } }];
  const mid = sampleCar(snaps, 25, 0);
  assert.equal(mid.x, 50); assert.equal(mid.y, -25); assert.equal(mid.angle, 0.5);
  const ext = sampleCar(snaps, 100, 0);          // extrapola 50 ms * vy
  assert.ok(Math.abs(ext.y - (-50 - 5)) < 1e-9);
  const wrap = interpolateCar(car(0, 0, 3.0), car(0, 0, -3.0), 0.5);
  assert.ok(Math.abs(Math.abs(wrap.angle) - Math.PI) < 0.2, 'ángulo por el camino corto');
});

test('el rival (host) llega al cliente interpolado, con el retardo configurado', async () => {
  const { host, client } = setup();
  await until(() => client.getView());
  host.setInput({ throttle: 1, steer: 0 });
  await sleep(300);
  const v = client.getView();
  const real = host.state.cars[0];
  assert.ok(v.cars[0].y < 0, 'el rival se mueve');
  assert.ok(v.cars[0].y > real.y, 'el rival se ve retrasado respecto al host');
  assert.ok(CONFIG.INTERP_DELAY_MS >= 100 && CONFIG.INTERP_DELAY_MS <= 120);
  host.stop();
});

test('fin de partida por meta, evento over y revancha', async () => {
  const { host, client } = setup();
  const hostEv = [], cliEv = [];
  host.onEvent = (e) => hostEv.push(e);
  client.onEvent = (e) => cliEv.push(e);
  await until(() => client.getView());
  const seed1 = client.track.seed;
  host.setInput({ throttle: 1, steer: 0 });
  await until(() => cliEv.some((e) => e.kind === 'over'));
  const over = cliEv.find((e) => e.kind === 'over');
  assert.equal(over.winner, 0); assert.equal(over.reason, 'finish');
  assert.equal(client.getView().phase, 'over');
  assert.equal(client.getView().winner, 0);

  let rematchSeen = false, started2 = null;
  host.onRematch = () => { rematchSeen = true; };
  client.onStart = (s) => { started2 = s; };
  host.setInput({ throttle: 0, steer: 0 });
  client.requestRematch();
  await until(() => rematchSeen);
  assert.equal(started2, null, 'no empieza hasta que ambos acepten');
  host.requestRematch();
  await until(() => started2);
  assert.notEqual(started2.seed, seed1);
  assert.equal(client.getView().phase, 'race');
  host.stop();
});

test('hp baja -> evento hit (diff de estado)', async () => {
  const hitPhysics = { ...physics, step(s, i, dt, t) { physics.step(s, i, dt, t); if (s.tick === 30) s.cars[1].hp -= 10; return s; } };
  const { a, b } = createLinkPair();
  const host = createHostSession({ link: a, physics: hitPhysics, generateTrack });
  const client = createClient({ link: b, physics: hitPhysics, generateTrack });
  const evs = [];
  client.onEvent = (e) => evs.push(e);
  await until(() => evs.some((e) => e.kind === 'hit'));
  assert.deepEqual([evs[0].car, evs[0].dmg], [1, 10]);
  host.stop();
});

test('desconexión por timeout sin paquetes: host gana', async () => {
  const { host, client, channels } = setup({ timeoutMs: 250, pingMs: 50 });
  await until(() => client.getView());
  let dc, hostOver;
  host.onDisconnect = (reason, msg) => { dc = { reason, msg }; };
  host.onEvent = (e) => { if (e.kind === 'over') hostOver = e; };
  channels.ctrlB.blackhole = true; channels.fastB.blackhole = true; // el invitado deja de emitir
  await until(() => dc, 2000);
  assert.equal(dc.reason, 'timeout');
  assert.match(dc.msg, /dejó de responder/);
  assert.equal(hostOver.reason, 'disconnect');
  assert.equal(host.state.winner, 0);
});

test('cierre limpio notifica al cliente', async () => {
  const { host, client } = setup();
  await until(() => client.getView());
  let dc;
  client.onDisconnect = (r) => { dc = r; };
  host.stop();
  await until(() => dc);
  assert.equal(dc, 'closed');
});

// --- PeerJS falso mínimo para probar createHost / join y mensajes de error ---
function makeFakePeer() {
  const peers = new Map();
  class Ev { constructor() { this.h = {}; } on(e, f) { (this.h[e] ||= []).push(f); } emit(e, ...a) { (this.h[e] || []).forEach((f) => f(...a)); } }
  class Conn extends Ev {
    constructor(peer, metadata) { super(); this.peer = peer; this.metadata = metadata; this.open = false; this.other = null; }
    send(d) { const o = this.other; queueMicrotask(() => o.emit('data', d)); }
    close() { if (!this.open) return; this.open = false; const o = this.other; o.open = false; queueMicrotask(() => { this.emit('close'); o.emit('close'); }); }
  }
  class FakePeer extends Ev {
    constructor(id) {
      super(); this.id = id || 'anon-' + Math.random().toString(36).slice(2);
      queueMicrotask(() => { if (peers.has(this.id)) return this.emit('error', { type: 'unavailable-id' }); peers.set(this.id, this); this.emit('open', this.id); });
    }
    connect(target, opts) {
      const mine = new Conn(target, opts.metadata);
      const t = peers.get(target);
      if (!t) { queueMicrotask(() => this.emit('error', { type: 'peer-unavailable' })); return mine; }
      const theirs = new Conn(this.id, opts.metadata);
      mine.other = theirs; theirs.other = mine;
      queueMicrotask(() => { t.emit('connection', theirs); mine.open = theirs.open = true; theirs.emit('open'); mine.emit('open'); });
      return mine;
    }
    destroy() { peers.delete(this.id); }
    reconnect() {}
  }
  return FakePeer;
}

test('createHost/join con PeerJS falso: código de 5 chars, conexión y error claro', async () => {
  const PeerCtor = makeFakePeer();
  const host = await createHost({ PeerCtor });
  assert.equal(host.code.length, 5);
  assert.equal(host.peerId, CONFIG.PEER_PREFIX + host.code);
  const guestLinkP = new Promise((res) => host.onGuest(res));
  const link = await join(host.code.toLowerCase(), { PeerCtor });
  const hostLink = await guestLinkP;
  const got = new Promise((res) => hostLink.on('hello', res));
  link.send('hello', { v: 1, name: 'x' });
  assert.equal((await got).name, 'x');
  await assert.rejects(join('ZZZZZ', { PeerCtor }), /No existe ninguna sala/);
  await assert.rejects(join('!', { PeerCtor }), /no válido/);
  link.close(); host.close();
});
