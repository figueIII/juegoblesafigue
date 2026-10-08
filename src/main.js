// Arranque y máquina de estados: LOBBY → COUNTDOWN → RACE → RESULT.
// Los módulos de otros agentes se cargan dinámicamente a través de la capa de ADAPTADORES
// (más abajo). Las APIs asumidas están documentadas en README.md ("Contratos asumidos").
import { CONFIG } from './config.js';
import { MSG, encode, decode } from './shared/protocol.js';
import { createLobby, normalizeCode, isValidCode } from './ui/lobby.js';

/* ===================== ADAPTADORES (única zona que toca módulos ajenos) ===================== */
const MODULES = {
  peer: './net/peer.js',
  host: './net/host.js',
  client: './net/client.js',
  renderer: './render/renderer.js',
  input: './input/input.js',
};
const loaded = {};
const missing = new Set();

async function load(name) {
  if (loaded[name]) return loaded[name];
  try {
    loaded[name] = await import(MODULES[name]);
    missing.delete(name);
    return loaded[name];
  } catch (e) {
    missing.add(name);
    const err = new Error(`Falta o falla el módulo src/${MODULES[name].slice(2)} (${e.message}).`);
    err.kind = 'missing';
    throw err;
  }
}

function need(mod, fn, file) {
  if (typeof mod[fn] !== 'function') {
    const err = new Error(`El módulo ${file} no exporta la función esperada "${fn}".`);
    err.kind = 'missing';
    throw err;
  }
  return mod[fn];
}

const adapters = {
  // → Promise<Link> con .code. Link: on(evt, cb) evt ∈ 'open'|'message'|'close'|'error', send(obj), close()
  async createHost() { return need(await load('peer'), 'createHost', 'net/peer.js')(); },
  // → Promise<Link> resuelta cuando el canal está abierto
  async join(code) { return need(await load('peer'), 'join', 'net/peer.js')(code); },
  // → Game { track, myId, getState(), drainEvents(), onOver(cb), stop() }
  async createGame({ role, link, seed, input }) {
    if (role === 'host') {
      return need(await load('host'), 'createHostGame', 'net/host.js')({ link, seed, input, config: CONFIG });
    }
    return need(await load('client'), 'createClientGame', 'net/client.js')({ link, seed, input, config: CONFIG });
  },
  async createRenderer(canvas) { return need(await load('renderer'), 'createRenderer', 'render/renderer.js')(canvas); },
  async createInput(canvas, getCameraToWorld) {
    return need(await load('input'), 'createInput', 'input/input.js')(canvas, getCameraToWorld);
  },
  async probe() { await Promise.allSettled(Object.keys(MODULES).map((n) => load(n))); return [...missing]; },
};

/* ===================== Estado ===================== */
const S = { LOBBY: 'LOBBY', COUNTDOWN: 'COUNTDOWN', RACE: 'RACE', RESULT: 'RESULT' };
const canvas = document.getElementById('game');
const lobby = createLobby(document.getElementById('ui'), {
  onCreate: () => createRoom(),
  onJoin: (code) => joinRoom(code),
  onRematch: () => requestRematch(),
  onMenu: () => toMenu(),
  onCancel: () => toMenu(),
});

let state = S.LOBBY;
let role = null;        // 'host' | 'guest'
let link = null;
let game = null;
let renderer = null;
let input = null;
let session = 0;        // invalida callbacks de sesiones anteriores
let rematch = { me: false, rival: false };
let countdownTimer = null;
let result = null;

const JOIN_TIMEOUT_MS = 15000;
const roomUrl = (code) => `${location.origin}${location.pathname}#${code}`;
const send = (type, data) => { try { link && link.send(JSON.parse(encode(type, data))); } catch (e) { console.warn('[main] send', e); } };

/* ===================== Navegación ===================== */
function teardown() {
  session++;
  clearInterval(countdownTimer);
  try { game && game.stop && game.stop(); } catch (e) { console.warn(e); }
  try { input && input.destroy && input.destroy(); } catch (e) { console.warn(e); }
  try { link && link.close && link.close(); } catch (e) { console.warn(e); }
  game = null; input = null; link = null; role = null; result = null;
  rematch = { me: false, rival: false };
}

function toMenu(opts = {}) {
  teardown();
  state = S.LOBBY;
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  lobby.showMenu({ warnings: [...missing].map((n) => 'src/' + MODULES[n].slice(2)), ...opts });
}

function fail(err, kind, retry) {
  console.error('[main]', err);
  const k = err.kind || kind || 'generic';
  const msg = k === 'missing' ? err.message : (err.userMessage || err.message || 'Error desconocido.');
  teardown();
  state = S.LOBBY;
  lobby.showError(msg, { kind: k, retry });
}

function wireLink(mySession) {
  link.on('message', (raw) => { if (mySession === session) onMessage(decode(raw)); });
  link.on('close', () => { if (mySession === session) onDisconnect(); });
  link.on('error', (e) => { if (mySession === session) onLinkError(e); });
}

/* ===================== Crear / unirse ===================== */
async function createRoom() {
  teardown();
  const my = session;
  role = 'host';
  lobby.showConnecting('Creando sala…');
  try {
    link = await adapters.createHost();
    if (my !== session) return;
    if (!link.code) throw new Error('createHost() no devolvió un código de sala.');
    wireLink(my);
    history.replaceState(null, '', '#' + link.code);
    lobby.showWaiting(link.code, roomUrl(link.code));
    link.on('open', () => {
      if (my !== session) return;
      lobby.showConnecting('Rival encontrado, preparando…');
    });
  } catch (e) { if (my === session) fail(e, 'nat', () => createRoom()); }
}

async function joinRoom(rawCode) {
  const code = normalizeCode(rawCode);
  if (!isValidCode(code)) return toMenu({ notice: 'Código no válido.' });
  teardown();
  const my = session;
  role = 'guest';
  lobby.showConnecting(`Conectando a la sala ${code}…`);
  let timer;
  try {
    const timeout = new Promise((_, rej) => {
      timer = setTimeout(() => rej(Object.assign(new Error(
        'La conexión tardó demasiado. Puede que la sala ya no exista o que la red bloquee la conexión directa.'), { kind: 'nat' })), JOIN_TIMEOUT_MS);
    });
    link = await Promise.race([adapters.join(code), timeout]);
    clearTimeout(timer);
    if (my !== session) { try { link.close(); } catch {} return; }
    wireLink(my);
    send(MSG.HELLO, { v: CONFIG.VERSION, name: 'Invitado' });
    lobby.showConnecting('Conectado, esperando al anfitrión…');
  } catch (e) {
    clearTimeout(timer);
    if (my !== session) return;
    const t = e && (e.type || e.kind);
    if (t === 'peer-unavailable') {
      e = Object.assign(new Error(`No existe la sala ${code}. Revisa el código o pide un enlace nuevo.`), { kind: 'notfound' });
    } else if (t === 'webrtc' || t === 'network' || t === 'socket-error' || t === 'server-error') {
      e = Object.assign(new Error('No se pudo contactar con el servicio de conexión (PeerJS). Revisa tu internet.'), { kind: 'generic' });
    }
    fail(e, 'nat', () => joinRoom(code));
  }
}

/* ===================== Mensajes de red ===================== */
function onMessage(m) {
  if (!m || !m.type) return;
  switch (m.type) {
    case MSG.HELLO:
      if (role !== 'host') return;
      if (m.v !== CONFIG.VERSION) return fail(new Error('Tu rival usa otra versión del juego. Recarga la página.'), 'generic');
      startRace();
      break;
    case MSG.START:
      if (role !== 'guest') return;
      beginCountdown(m.seed, m.countdown ?? CONFIG.COUNTDOWN_SECONDS);
      break;
    case MSG.REMATCH:
      rematch.rival = true;
      if (state === S.RESULT) {
        lobby.setRematchStatus(rematch.me ? 'Empezando…' : 'El rival quiere revancha.');
        maybeRestart();
      }
      break;
    default: break; // snap/input/event/ping/pong los gestionan host.js y client.js
  }
}

function onDisconnect() {
  if (state === S.LOBBY) {
    if (role === 'host') return; // la sala sigue abierta hasta que se cancele
    return fail(new Error('Se perdió la conexión con la sala.'), 'nat');
  }
  if (state === S.RESULT) { lobby.setRematchStatus('El rival se ha desconectado.'); const b = document.getElementById('btn-rematch'); if (b) b.disabled = true; return; }
  // En carrera/cuenta atrás: victoria por abandono
  showResult({ winner: role === 'host' ? 0 : 1, reason: 'disconnect' });
}

function onLinkError(e) {
  console.warn('[main] link error', e);
  if (state === S.LOBBY || state === S.COUNTDOWN) {
    const t = e && e.type;
    if (t === 'webrtc' || t === 'negotiation') fail(Object.assign(new Error('No se pudo establecer la conexión directa entre navegadores.'), { kind: 'nat' }), 'nat');
  }
}

/* ===================== Partida ===================== */
function startRace() { // solo host
  if (!link) return;
  const seed = (Math.random() * 0xffffffff) >>> 0;
  send(MSG.START, { seed, countdown: CONFIG.COUNTDOWN_SECONDS });
  beginCountdown(seed, CONFIG.COUNTDOWN_SECONDS);
}

async function beginCountdown(seed, seconds) {
  const my = session;
  clearInterval(countdownTimer);
  try { game && game.stop && game.stop(); } catch {}
  rematch = { me: false, rival: false };
  result = null;
  state = S.COUNTDOWN;
  try {
    if (!renderer) renderer = await adapters.createRenderer(canvas);
    if (my !== session) return;
    input = await adapters.createInput(canvas, () => (renderer.getCameraToWorld ? renderer.getCameraToWorld() : null));
    game = await adapters.createGame({ role, link, seed, input });
    if (my !== session) return;
    game.onOver && game.onOver((r) => { if (my === session) showResult(r); });
  } catch (e) { if (my === session) fail(e, 'generic'); return; }

  let n = Math.max(1, Math.round(seconds));
  lobby.showCountdown(n);
  countdownTimer = setInterval(() => {
    if (my !== session) return clearInterval(countdownTimer);
    n--;
    if (n > 0) return lobby.showCountdown(n);
    clearInterval(countdownTimer);
    lobby.showCountdown('GO');
    state = S.RACE;
    setTimeout(() => { if (my === session && state === S.RACE) lobby.hideCountdown(); }, 700);
  }, 1000);
  requestAnimationFrame(frame);
}

function showResult(r) {
  if (state === S.RESULT) return;
  state = S.RESULT;
  result = r;
  const myId = role === 'host' ? 0 : 1;
  const outcome = r.winner === 'draw' || r.winner == null ? 'draw' : (r.winner === myId ? 'win' : 'lose');
  lobby.showResult({ outcome, reason: r.reason || '' });
}

function requestRematch() {
  rematch.me = true;
  send(MSG.REMATCH, {});
  lobby.setRematchStatus(rematch.rival ? 'Empezando…' : 'Esperando al rival…');
  maybeRestart();
}

function maybeRestart() {
  if (role === 'host' && rematch.me && rematch.rival) startRace();
}

/* ===================== Bucle de render ===================== */
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(window.innerWidth * dpr), h = Math.floor(window.innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  renderer && renderer.resize && renderer.resize(w, h, dpr);
}
window.addEventListener('resize', resize);

function frame() {
  if (!game || (state !== S.COUNTDOWN && state !== S.RACE && state !== S.RESULT)) return;
  try {
    const st = game.getState();
    if (st && st.phase === 'over' && state === S.RACE) {
      showResult({ winner: st.winner, reason: st.reason });
    }
    renderer.draw(st, game.track, game.myId, game.drainEvents ? game.drainEvents() : []);
  } catch (e) { console.error('[main] render', e); return fail(e, 'generic'); }
  requestAnimationFrame(frame);
}

/* ===================== Arranque ===================== */
(async function boot() {
  resize();
  await adapters.probe();
  const hash = normalizeCode(location.hash.slice(1));
  if (hash) {
    if (isValidCode(hash)) return joinRoom(hash);
  }
  toMenu();
})();
window.addEventListener('hashchange', () => {
  const code = normalizeCode(location.hash.slice(1));
  if (state === S.LOBBY && isValidCode(code) && role == null) joinRoom(code);
});
