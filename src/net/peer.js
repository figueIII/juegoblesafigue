// Capa de transporte P2P. PeerJS se carga por CDN como global `Peer` (no se importa).
// Expone un `Link` (enlace lógico con 1 canal fiable "ctrl" + 1 canal no fiable opcional "fast"),
// createHost() / join(code) y utilidades para tests (canales en memoria).
import { CONFIG } from '../config.js';
import { MSG, encode, decode } from '../shared/protocol.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I
const CODE_LEN = 5;
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const NEUTRAL_INPUT = Object.freeze({ seq: 0, throttle: 0, steer: 0, aim: [0, 0], fire: false });

const clampNum = (v, lo, hi) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);
/** Sanea un input recibido por red (no confiar en el par). */
export function sanitizeInput(i) {
  const o = i || {};
  const aim = Array.isArray(o.aim) && Number.isFinite(o.aim[0]) && Number.isFinite(o.aim[1]) ? [o.aim[0], o.aim[1]] : [0, 0];
  return { seq: Number.isFinite(o.seq) ? o.seq | 0 : 0, throttle: clampNum(o.throttle, -1, 1), steer: clampNum(o.steer, -1, 1), aim, fire: !!o.fire };
}

export function generateCode(rand = Math.random) {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return s;
}
export const normalizeCode = (c) => String(c || '').trim().toUpperCase();
export const isValidCode = (c) => /^[A-Z0-9]{4,6}$/.test(normalizeCode(c));

/** Mensaje en español para un error de PeerJS. */
export function peerErrorMessage(err) {
  const type = err && err.type;
  switch (type) {
    case 'peer-unavailable': return 'No existe ninguna sala con ese código (o el anfitrión ya la cerró).';
    case 'unavailable-id': return 'El código de sala ya está en uso. Inténtalo de nuevo.';
    case 'network': return 'Sin conexión con el servidor de señalización. Revisa tu conexión a Internet.';
    case 'server-error': return 'El servidor de señalización de PeerJS no responde. Inténtalo más tarde.';
    case 'socket-error':
    case 'socket-closed': return 'Se perdió la conexión con el servidor de señalización.';
    case 'webrtc': return 'Fallo WebRTC: tu red puede bloquear conexiones directas (NAT estricto). Prueba con otra red o configura un servidor TURN.';
    case 'browser-incompatible': return 'Tu navegador no soporta WebRTC.';
    case 'invalid-id': return 'Código de sala no válido.';
    case 'ssl-unavailable': return 'Se necesita HTTPS para conectar.';
    default: return 'Error de red: ' + ((err && (err.message || err.type)) || 'desconocido');
  }
}

const PEERJS_MISSING = 'No se pudo cargar PeerJS (la librería de conexión P2P). Comprueba tu conexión a Internet, desactiva el bloqueador de anuncios/scripts para este sitio o prueba otra red, y recarga la página.';

/** Espera a que el global `Peer` exista (el <script> del CDN o su copia local de ./vendor puede tardar). */
export async function waitForPeerJS(timeoutMs = 8000) {
  const t0 = nowMs();
  while (!globalThis.Peer) {
    if (nowMs() - t0 > timeoutMs) throw Object.assign(new Error(PEERJS_MISSING), { kind: 'generic' });
    await new Promise((r) => setTimeout(r, 100));
  }
  return globalThis.Peer;
}

// ---------------------------------------------------------------------------
// Link: enlace lógico entre los dos jugadores.
// Canal (interfaz mínima): { send(str), close(), isOpen(), onData: fn(str), onClose: fn() }
// ---------------------------------------------------------------------------
export class Link {
  constructor({ timeoutMs = CONFIG.DISCONNECT_TIMEOUT_MS, pingMs = 1000, onDispose = null } = {}) {
    this.timeoutMs = timeoutMs;
    this.pingMs = pingMs;
    this.onDispose = onDispose;
    this.ctrl = null;
    this.fast = null;
    this.rtt = null; // ms, suavizado
    this.closed = false;
    this.closeReason = null;
    this.lastRx = nowMs();
    this._handlers = new Map();
    this._closeFns = [];
    this._timers = [];
  }

  addChannel(name, ch) {
    if (this.closed) { try { ch.close(); } catch {} return; }
    ch.onData = (raw) => this._rx(raw);
    ch.onClose = () => {
      if (name === 'ctrl') this.close('closed', 'El rival cerró la conexión.');
      else if (this.fast === ch) this.fast = null;
    };
    this[name] = ch;
    if (name === 'ctrl') this._startTimers();
  }

  get isOpen() { return !this.closed && !!this.ctrl && this.ctrl.isOpen(); }
  get hasFastChannel() { return !!(this.fast && this.fast.isOpen()); }

  /** Registra handler por tipo ('*' = todos). Devuelve función para desuscribir. */
  on(type, fn) {
    if (!this._handlers.has(type)) this._handlers.set(type, new Set());
    this._handlers.get(type).add(fn);
    return () => this._handlers.get(type)?.delete(fn);
  }

  onClose(fn) {
    if (this.closed) { fn(this.closeReason.reason, this.closeReason.message); return () => {}; }
    this._closeFns.push(fn);
    return () => { this._closeFns = this._closeFns.filter((f) => f !== fn); };
  }

  /** reliable=false usa el canal no fiable si existe; si no, cae al fiable. */
  send(type, data = {}, { reliable = true } = {}) {
    if (this.closed) return false;
    const ch = !reliable && this.fast && this.fast.isOpen() ? this.fast : this.ctrl;
    if (!ch || !ch.isOpen()) return false;
    try { ch.send(encode(type, data)); return true; } catch { return false; }
  }

  close(reason = 'closed', message = 'Conexión cerrada.') {
    if (this.closed) return;
    this.closed = true;
    this.closeReason = { reason, message };
    this._timers.forEach((t) => clearInterval(t));
    this._timers = [];
    for (const ch of [this.ctrl, this.fast]) { if (ch) { ch.onClose = null; try { ch.close(); } catch {} } }
    const fns = this._closeFns; this._closeFns = [];
    for (const fn of fns) { try { fn(reason, message); } catch (e) { console.error(e); } }
    if (this.onDispose) { try { this.onDispose(); } catch {} }
  }

  _startTimers() {
    this.lastRx = nowMs();
    const ping = setInterval(() => this.send(MSG.PING, { t: nowMs() }), this.pingMs);
    const check = setInterval(() => {
      if (nowMs() - this.lastRx > this.timeoutMs) {
        this.close('timeout', `El rival dejó de responder (${Math.round(this.timeoutMs / 1000)} s sin paquetes).`);
      }
    }, Math.max(20, Math.min(500, this.timeoutMs / 4)));
    for (const t of [ping, check]) { if (t.unref) t.unref(); }
    this._timers.push(ping, check);
    this.send(MSG.PING, { t: nowMs() });
  }

  _rx(raw) {
    let msg;
    try { msg = decode(raw); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;
    this.lastRx = nowMs();
    if (msg.type === MSG.PING) { this.send(MSG.PONG, { t: msg.t }); return; }
    if (msg.type === MSG.PONG) {
      const sample = nowMs() - msg.t;
      if (Number.isFinite(sample) && sample >= 0) this.rtt = this.rtt == null ? sample : this.rtt * 0.7 + sample * 0.3;
      return;
    }
    for (const key of [msg.type, '*']) {
      const set = this._handlers.get(key);
      if (!set) continue;
      for (const fn of [...set]) { try { fn(msg); } catch (e) { console.error(e); } }
    }
  }
}

// ---------------------------------------------------------------------------
// Adaptador de DataConnection de PeerJS a la interfaz de canal.
// ---------------------------------------------------------------------------
function wrapConn(conn) {
  const ch = {
    conn,
    onData: null,
    onClose: null,
    isOpen: () => !!conn.open,
    send: (s) => conn.send(s),
    close: () => { try { conn.close(); } catch {} },
  };
  conn.on('data', (d) => ch.onData && ch.onData(d));
  conn.on('close', () => ch.onClose && ch.onClose());
  conn.on('error', () => ch.onClose && ch.onClose());
  return ch;
}

const peerBaseOptions = () => ({ ...CONFIG.PEER_OPTIONS, config: { iceServers: CONFIG.ICE_SERVERS, ...(CONFIG.PEER_OPTIONS.config || {}) } });
const connOptions = (ch) => ({ reliable: ch === 'ctrl', serialization: 'raw', metadata: { ch } });

/**
 * Crea una sala. Resuelve cuando el broker ha registrado el id.
 * @returns {Promise<{code, peerId, onGuest(fn), onError(fn), close()}>}
 * onGuest(fn) recibe un Link cuando el invitado conecta (se reenvía si ya conectó). Solo se admite 1 invitado.
 */
export async function createHost({ PeerCtor, linkOptions = {}, maxAttempts = 6 } = {}) {
  if (!PeerCtor) PeerCtor = await waitForPeerJS();
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = generateCode();
    const peerId = CONFIG.PEER_PREFIX + code;
    try {
      return await openHostPeer(PeerCtor, code, peerId, linkOptions);
    } catch (e) {
      lastErr = e;
      if (!e.retry) break;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function openHostPeer(PeerCtor, code, peerId, linkOptions) {
  return new Promise((resolve, reject) => {
    let peer;
    try { peer = new PeerCtor(peerId, peerBaseOptions()); } catch (e) { return reject(new Error(peerErrorMessage(e))); }
    let opened = false;
    let link = null;
    let guestPeerId = null;
    const guestFns = [];
    const errFns = [];
    const pendingFast = new Map();

    const timeout = setTimeout(() => {
      if (!opened) { try { peer.destroy(); } catch {} reject(new Error('El servidor de señalización tarda demasiado en responder. Inténtalo de nuevo.')); }
    }, 15000);

    const api = {
      code, peerId, peer,
      onGuest(fn) { guestFns.push(fn); if (link) fn(link); },
      onError(fn) { errFns.push(fn); },
      close() { if (link) link.close('closed', 'Sala cerrada.'); try { peer.destroy(); } catch {} },
    };

    peer.on('open', () => { opened = true; clearTimeout(timeout); resolve(api); });
    peer.on('disconnected', () => { try { peer.reconnect(); } catch {} });
    peer.on('error', (err) => {
      const msg = peerErrorMessage(err);
      if (!opened) {
        clearTimeout(timeout);
        try { peer.destroy(); } catch {}
        const e = new Error(msg); e.retry = err && err.type === 'unavailable-id';
        reject(e);
      } else {
        errFns.forEach((f) => f(msg, err));
      }
    });
    peer.on('connection', (conn) => {
      const chName = (conn.metadata && conn.metadata.ch) || 'ctrl';
      if (guestPeerId && conn.peer !== guestPeerId) { // sala llena
        conn.on('open', () => {
          // Solo el canal de control avisa (el cliente muestra el mensaje); da tiempo a que el invitado cargue sus módulos.
          if (chName === 'ctrl') { try { conn.send(encode(MSG.EVENT, { kind: 'error', message: 'La sala ya está llena: ya hay otro jugador conectado.' })); } catch {} }
          setTimeout(() => { try { conn.close(); } catch {} }, chName === 'ctrl' ? 1500 : 100);
        });
        return;
      }
      guestPeerId = conn.peer;
      const attach = () => {
        const ch = wrapConn(conn);
        if (chName === 'fast') {
          if (link) link.addChannel('fast', ch); else pendingFast.set('fast', ch);
          return;
        }
        link = new Link({ ...linkOptions, onDispose: () => { guestPeerId = null; link = null; } });
        link.addChannel('ctrl', ch);
        const f = pendingFast.get('fast');
        if (f) { pendingFast.delete('fast'); link.addChannel('fast', f); }
        guestFns.forEach((fn) => fn(link));
      };
      if (conn.open) attach(); else conn.on('open', attach);
    });
  });
}

/**
 * Se une a una sala por código. Resuelve con un Link ya abierto.
 */
export async function join(rawCode, opts = {}) {
  return joinWith(rawCode, { ...opts, PeerCtor: opts.PeerCtor || (await waitForPeerJS()) });
}

function joinWith(rawCode, { PeerCtor, linkOptions = {}, connectTimeoutMs = 15000, fastWaitMs = 4000 } = {}) {
  const code = normalizeCode(rawCode);
  return new Promise((resolve, reject) => {
    if (!PeerCtor) return reject(new Error(PEERJS_MISSING));
    if (!isValidCode(code)) return reject(new Error('Código de sala no válido.'));
    let peer;
    try { peer = new PeerCtor(undefined, peerBaseOptions()); } catch (e) { return reject(new Error(peerErrorMessage(e))); }
    let link = null;
    let settled = false;
    const fail = (msg) => {
      if (settled) { if (link) link.close('error', msg); return; }
      settled = true; clearTimeout(timer);
      try { peer.destroy(); } catch {}
      reject(new Error(msg));
    };
    let ctrlConn = null;
    const iceState = () => { try { return ctrlConn && ctrlConn.peerConnection ? ` (ICE: ${ctrlConn.peerConnection.iceConnectionState})` : ''; } catch { return ''; } };
    const timer = setTimeout(() => fail('No se pudo conectar con el anfitrión. Si ambos estáis en redes estrictas (NAT), puede hacer falta un servidor TURN.' + iceState()), connectTimeoutMs);

    peer.on('error', (err) => fail(peerErrorMessage(err)));
    peer.on('disconnected', () => { try { peer.reconnect(); } catch {} });
    peer.on('open', () => {
      const target = CONFIG.PEER_PREFIX + code;
      ctrlConn = peer.connect(target, connOptions('ctrl'));
      ctrlConn.on('error', () => fail('Error de conexión con el anfitrión.'));
      ctrlConn.on('close', () => { if (!settled) fail('El anfitrión cerró la conexión.'); });
      ctrlConn.on('open', () => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        link = new Link({ ...linkOptions, onDispose: () => { try { peer.destroy(); } catch {} } });
        link.addChannel('ctrl', wrapConn(ctrlConn));
        // Canal no fiable opcional para input/snap.
        try {
          const fastConn = peer.connect(target, connOptions('fast'));
          const ft = setTimeout(() => { try { if (!fastConn.open) fastConn.close(); } catch {} }, fastWaitMs);
          fastConn.on('open', () => { clearTimeout(ft); if (link && !link.closed) link.addChannel('fast', wrapConn(fastConn)); });
        } catch { /* se queda con el canal fiable */ }
        resolve(link);
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Utilidades para tests / modo local: canales en memoria.
// ---------------------------------------------------------------------------
class MemChannel {
  constructor(latencyMs) { this.latencyMs = latencyMs; this.open = true; this.onData = null; this.onClose = null; this.other = null; this.blackhole = false; }
  isOpen() { return this.open; }
  send(s) {
    if (!this.open || this.blackhole) return;
    const o = this.other;
    const deliver = () => { if (o.open && o.onData) o.onData(s); };
    if (this.latencyMs > 0) setTimeout(deliver, this.latencyMs); else queueMicrotask(deliver);
  }
  close() {
    if (!this.open) return;
    this.open = false;
    const o = this.other;
    if (o && o.open) setTimeout(() => { o.open = false; if (o.onClose) o.onClose(); }, this.latencyMs);
  }
}

export function createMemoryChannelPair({ latencyMs = 0 } = {}) {
  const a = new MemChannel(latencyMs), b = new MemChannel(latencyMs);
  a.other = b; b.other = a;
  return [a, b];
}

/** Dos Links conectados en memoria (host=a, guest=b), con canal fiable y no fiable. */
export function createLinkPair({ latencyMs = 0, ...linkOptions } = {}) {
  const [ca, cb] = createMemoryChannelPair({ latencyMs });
  const [fa, fb] = createMemoryChannelPair({ latencyMs });
  const a = new Link(linkOptions), b = new Link(linkOptions);
  a.addChannel('ctrl', ca); b.addChannel('ctrl', cb);
  a.addChannel('fast', fa); b.addChannel('fast', fb);
  return { a, b, channels: { ctrlA: ca, ctrlB: cb, fastA: fa, fastB: fb } };
}
