// PeerJS falso (mismo contrato mínimo que usa src/net/peer.js) sobre BroadcastChannel: permite probar
// dos pestañas del mismo contexto de navegador sin broker ni WebRTC. Latencia opcional: window.__FAKE_LATENCY_MS.
(() => {
  const bc = new BroadcastChannel('fakepeer');
  const peers = new Map();
  const lat = () => Number(window.__FAKE_LATENCY_MS) || 0;
  const post = (m) => { const l = lat(); if (m.t === 'data' && l > 0) setTimeout(() => bc.postMessage(m), l); else bc.postMessage(m); };
  class Em { constructor() { this._h = {}; } on(e, f) { (this._h[e] = this._h[e] || []).push(f); return this; } emit(e, ...a) { (this._h[e] || []).slice().forEach((f) => f(...a)); } }
  class Conn extends Em {
    constructor(peer, remote, cid, metadata) { super(); this.peerObj = peer; this.peer = remote; this.cid = cid; this.metadata = metadata; this.open = false; }
    send(d) { if (this.open) post({ t: 'data', to: this.peer, from: this.peerObj.id, cid: this.cid, d }); }
    close() { if (!this.open) return; this.open = false; bc.postMessage({ t: 'close', to: this.peer, from: this.peerObj.id, cid: this.cid }); this.emit('close'); }
  }
  window.Peer = class Peer extends Em {
    constructor(id) {
      super(); this.id = id || 'g' + Math.random().toString(36).slice(2, 8); this.conns = new Map();
      if (peers.has(this.id)) { setTimeout(() => this.emit('error', { type: 'unavailable-id' }), 20); return; }
      peers.set(this.id, this); setTimeout(() => this.emit('open', this.id), 20);
    }
    connect(target, opts = {}) {
      const cid = Math.random().toString(36).slice(2); const c = new Conn(this, target, cid, opts.metadata); this.conns.set(cid, c);
      bc.postMessage({ t: 'conn', to: target, from: this.id, cid, metadata: opts.metadata });
      c._to = setTimeout(() => { if (!c.open) this.emit('error', { type: 'peer-unavailable' }); }, 1500); return c;
    }
    destroy() { peers.delete(this.id); for (const c of this.conns.values()) c.close(); }
    reconnect() {}
  };
  bc.onmessage = (ev) => {
    const m = ev.data; const p = peers.get(m.to); if (!p) return;
    if (m.t === 'conn') {
      const c = new Conn(p, m.from, m.cid, m.metadata); p.conns.set(m.cid, c); p.emit('connection', c);
      setTimeout(() => { c.open = true; bc.postMessage({ t: 'ack', to: m.from, from: p.id, cid: m.cid }); c.emit('open'); }, 5);
    } else {
      const c = p.conns.get(m.cid); if (!c) return;
      if (m.t === 'ack') { clearTimeout(c._to); c.open = true; c.emit('open'); }
      else if (m.t === 'data') c.emit('data', m.d);
      else if (m.t === 'close') { if (c.open) { c.open = false; c.emit('close'); } }
    }
  };
})();
