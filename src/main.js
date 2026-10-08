// Arranque y máquina de estados: LOBBY → COUNTDOWN → RACE → RESULT.
// La capa de ADAPTADORES es la única zona que toca los módulos de red/render/input.
// El host (net/host.js) gestiona internamente hello/start y la revancha; el cliente (net/client.js) igual.
import { CONFIG } from './config.js';
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
  // → Promise<{code, onGuest(fn(link)), onError(fn(msg)), close()}>
  async createHost() { return need(await load('peer'), 'createHost', 'net/peer.js')(); },
  // → Promise<Link>
  async join(code) { return need(await load('peer'), 'join', 'net/peer.js')(code); },
  async createHostSession(link) { return need(await load('host'), 'createHostSession', 'net/host.js')({ link }); },
  async createClient(link) { return need(await load('client'), 'createClient', 'net/client.js')({ link, name: 'Invitado' }); },
  async createRenderer(canvas) { return need(await load('renderer'), 'createRenderer', 'render/renderer.js')(canvas); },
  async createInput(canvas, getCameraToWorld) {
    return need(await load('input'), 'createInput', 'input/input.js')(canvas, getCameraToWorld);
  },
  async probe() { await Promise.allSettled(Object.keys(MODULES).map((n) => load(n))); return [...missing]; },
};

/* ===================== Estado ===================== */
const S = { LOBBY: 'LOBBY', COUNTDOWN: 'COUNTDOWN', RACE: 'RACE', RESULT: 'RESULT' };
const canvas = document.getElementById('game');
const uiRoot = document.getElementById('ui');
const lobby = createLobby(uiRoot, {
  onCreate: () => createRoom(),
  onJoin: (code) => joinRoom(code),
  onRematch: () => requestRematch(),
  onMenu: () => toMenu(),
  onCancel: () => toMenu(),
});

let state = S.LOBBY;
let role = null;        // 'host' | 'guest'
let hostRoom = null;    // handle de createHost()
let link = null;
let sess = null;        // HostSession | Client
let renderer = null;
let input = null;
let inputTimer = null;
let events = [];        // eventos pendientes para el renderer
let session = 0;        // invalida callbacks de sesiones anteriores
let rivalWantsRematch = false;
let resultTimer = null;

const JOIN_TIMEOUT_MS = 15000;
const myId = () => (role === 'host' ? 0 : 1);
const roomUrl = (code) => `${location.origin}${location.pathname}#${code}`;

/* ===================== Navegación ===================== */
function teardown() {
  session++;
  clearInterval(inputTimer); inputTimer = null;
  clearTimeout(resultTimer);
  try { sess && sess.stop && sess.stop(); } catch (e) { console.warn(e); }
  try { input && input.destroy && input.destroy(); } catch (e) { console.warn(e); }
  try { link && link.close && link.close(); } catch (e) { console.warn(e); }
  try { hostRoom && hostRoom.close && hostRoom.close(); } catch (e) { console.warn(e); }
  sess = null; input = null; link = null; hostRoom = null; role = null; events = [];
  rivalWantsRematch = false;
  uiRoot.classList.remove('result');
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

/* ===================== Crear / unirse ===================== */
async function createRoom() {
  teardown();
  const my = session;
  role = 'host';
  lobby.showConnecting('Creando sala…');
  try {
    const room = await adapters.createHost();
    if (my !== session) { try { room.close(); } catch {} return; }
    hostRoom = room;
    if (!room.code) throw new Error('createHost() no devolvió un código de sala.');
    room.onError((msg) => { if (my === session) fail(new Error(msg), 'nat'); });
    room.onGuest((l) => { if (my === session && !sess) onGuestLink(l, my); });
    history.replaceState(null, '', '#' + room.code);
    lobby.showWaiting(room.code, roomUrl(room.code));
  } catch (e) { if (my === session) fail(e, 'nat', () => createRoom()); }
}

async function onGuestLink(l, my) {
  link = l;
  lobby.showConnecting('Rival encontrado, preparando…');
  try {
    sess = await adapters.createHostSession(l);
  } catch (e) { if (my === session) fail(e, 'generic'); return; }
  if (my !== session) return;
  sess.onStart = () => { if (my === session) beginRound(my); };
  sess.onEvent = (ev) => { if (my === session) onGameEvent(ev); };
  sess.onRematch = () => { if (my === session) onRivalRematch(); };
  sess.onDisconnect = (reason, msg) => { if (my === session) onDisconnect(reason, msg); };
  sess.onWarning = (msg) => { if (my === session) lobby.toast(msg); };
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
    const l = await Promise.race([adapters.join(code), timeout]);
    clearTimeout(timer);
    if (my !== session) { try { l.close(); } catch {} return; }
    link = l;
    sess = await adapters.createClient(l);   // envía hello y reintenta hasta recibir start
    if (my !== session) return;
    sess.onStart = () => { if (my === session) beginRound(my); };
    sess.onEvent = (ev) => { if (my === session) onGameEvent(ev); };
    sess.onRematch = () => { if (my === session) onRivalRematch(); };
    sess.onDisconnect = (reason, msg) => { if (my === session) onDisconnect(reason, msg); };
    lobby.showConnecting('Conectado, esperando al anfitrión…');
  } catch (e) {
    clearTimeout(timer);
    if (my !== session) return;
    if (e && e.type === 'peer-unavailable') {
      e = Object.assign(new Error(`No existe la sala ${code}. Revisa el código o pide un enlace nuevo.`), { kind: 'notfound' });
    }
    fail(e, 'nat', () => joinRoom(code));
  }
}

/* ===================== Eventos de partida ===================== */
function onGameEvent(ev) {
  if (!ev) return;
  if (ev.kind === 'error') return fail(new Error(ev.message || 'Error del anfitrión.'), 'generic');
  events.push(ev);
  if (events.length > 200) events.shift();
  if (ev.kind === 'over') scheduleResult({ winner: ev.winner, reason: ev.reason });
}

function onRivalRematch() {
  rivalWantsRematch = true;
  if (state === S.RESULT) lobby.setRematchStatus('El rival quiere revancha.');
}

function onDisconnect(reason, msg) {
  if (state === S.LOBBY) {
    if (role === 'host') return;
    return fail(new Error(msg || 'Se perdió la conexión con la sala.'), 'nat');
  }
  if (state === S.RESULT) { lobby.setRematchStatus('El rival se ha desconectado.'); const b = document.getElementById('btn-rematch'); if (b) b.disabled = true; return; }
  // En carrera/cuenta atrás: victoria por abandono
  showResult({ winner: myId(), reason: 'disconnect' });
}

/* ===================== Partida ===================== */
async function beginRound(my) {
  clearTimeout(resultTimer);
  uiRoot.classList.remove('result');
  rivalWantsRematch = false;
  events = [];
  state = S.COUNTDOWN;
  lobby.hideCountdown();
  lobby.hideAll();
  try {
    if (!renderer) renderer = await adapters.createRenderer(canvas);
    if (my !== session) return;
    renderer.resetCamera && renderer.resetCamera();
    if (!input) {
      input = await adapters.createInput(canvas, (sx, sy) => renderer.getCameraToWorld(sx, sy));
      if (my !== session) { input.destroy && input.destroy(); input = null; return; }
    }
  } catch (e) { if (my === session) fail(e, 'generic'); return; }
  clearInterval(inputTimer);
  inputTimer = setInterval(() => { if (input && sess) sess.setInput(input.sample(0)); }, 1000 / CONFIG.INPUT_HZ);
  canvas.focus();
  if (!looping) { looping = true; requestAnimationFrame(frame); }
}

function scheduleResult(r) {
  if (state === S.RESULT) return;
  clearTimeout(resultTimer);
  const my = session;
  // Pequeña pausa para que se vea el cartel de fin del renderer antes del panel.
  resultTimer = setTimeout(() => { if (my === session) showResult(r); }, 900);
}

function showResult(r) {
  if (state === S.RESULT) return;
  clearTimeout(resultTimer);
  state = S.RESULT;
  const me = myId();
  const outcome = r.winner === 'draw' || r.winner == null ? 'draw' : (r.winner === me ? 'win' : 'lose');
  uiRoot.classList.add('result');
  lobby.showResult({ outcome, reason: r.reason || '' });
  if (rivalWantsRematch && r.reason !== 'disconnect') lobby.setRematchStatus('El rival quiere revancha.');
}

function requestRematch() {
  if (!sess) return;
  sess.requestRematch();
  lobby.setRematchStatus(rivalWantsRematch ? 'Empezando…' : 'Esperando al rival…');
}

/* ===================== Bucle de render ===================== */
let looping = false;
function frame() {
  if (!sess || !renderer || (state !== S.COUNTDOWN && state !== S.RACE && state !== S.RESULT)) { looping = false; return; }
  try {
    const st = role === 'host' ? sess.state : sess.getView();
    if (st && state === S.COUNTDOWN && st.phase === 'race') state = S.RACE;
    if (st && sess.track) renderer.draw(st, sess.track, myId(), events.splice(0));
  } catch (e) { console.error('[main] render', e); looping = false; return fail(e, 'generic'); }
  requestAnimationFrame(frame);
}

/* ===================== Arranque ===================== */
(async function boot() {
  await adapters.probe();
  const hash = normalizeCode(location.hash.slice(1));
  if (hash && isValidCode(hash)) return joinRoom(hash);
  toMenu();
})();
window.addEventListener('hashchange', () => {
  const code = normalizeCode(location.hash.slice(1));
  if (state === S.LOBBY && isValidCode(code) && role == null) joinRoom(code);
});

// Gancho de depuración/QA de solo lectura (usado por tests/e2e).
Object.defineProperty(window, '__game', { value: { get role() { return role; }, get uiState() { return state; }, get sess() { return sess; } } });
