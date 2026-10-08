// UI del lobby: solo DOM, sin conocer la red. main.js la controla con handlers.
// createLobby(root, { onCreate, onJoin(code), onRematch, onMenu, onCancel }) → API de pantallas.

const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v);
  }
  for (const kid of kids) if (kid != null) n.append(kid);
  return n;
};

export const normalizeCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
export const isValidCode = (s) => /^[A-Z0-9]{4,6}$/.test(s);

async function copyText(text, inputEl) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fallback */ }
  try { inputEl.focus(); inputEl.select(); return document.execCommand('copy'); } catch { return false; }
}

export function createLobby(root, h) {
  const clear = () => root.replaceChildren();
  const panel = (...kids) => { const p = el('div', { class: 'panel' }, ...kids); clear(); root.append(p); return p; };
  let countdownEl = null;

  const api = {
    hideAll() { clear(); },

    showMenu({ warnings = [], prefill = '', notice = '' } = {}) {
      api.hideCountdown();
      const input = el('input', { class: 'text', type: 'text', maxlength: '6', placeholder: 'CÓDIGO',
        autocomplete: 'off', autocapitalize: 'characters', 'aria-label': 'Código de sala', value: prefill });
      const joinBtn = el('button', { class: 'btn alt', type: 'button' }, 'Unirse');
      const submit = () => {
        const code = normalizeCode(input.value);
        if (!isValidCode(code)) { input.focus(); api.toast('El código tiene 4 a 6 letras o números'); return; }
        h.onJoin(code);
      };
      joinBtn.addEventListener('click', submit);
      input.addEventListener('input', () => { input.value = normalizeCode(input.value); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      const p = panel(
        el('h1', { class: 'title' }, 'Neon Rivals'),
        el('p', { class: 'sub' }, 'Carrera 1v1 con sabotajes. Sin servidores: directo entre navegadores.'),
        el('button', { class: 'btn', type: 'button', id: 'btn-create', onClick: () => h.onCreate() }, 'Crear sala'),
        el('div', { class: 'divider' }, 'o'),
        el('div', { class: 'row' }, input, joinBtn),
        notice ? el('p', { class: 'muted' }, notice) : null,
        el('p', { class: 'muted' }, 'WASD / flechas para conducir. Ratón para apuntar, clic para disparar. En móvil: botones en pantalla y toca para apuntar y disparar.'),
      );
      if (warnings.length) {
        p.append(el('div', { class: 'warn' }, 'Módulos no disponibles: ' + warnings.join(', ')));
      }
    },

    showWaiting(code, url) {
      const link = el('input', { class: 'text link', type: 'text', readonly: '', value: url, 'aria-label': 'Enlace de la sala' });
      const copyBtn = el('button', { class: 'btn', type: 'button' }, 'Copiar');
      copyBtn.addEventListener('click', async () => {
        const ok = await copyText(url, link);
        copyBtn.textContent = ok ? 'Copiado' : 'Copia a mano';
        setTimeout(() => { copyBtn.textContent = 'Copiar'; }, 1800);
      });
      link.addEventListener('focus', () => link.select());
      panel(
        el('h2', {}, 'Esperando rival'),
        el('span', { class: 'code', id: 'room-code' }, code),
        el('p', { class: 'muted' }, 'Comparte este enlace con tu rival:'),
        el('div', { class: 'row' }, link, copyBtn),
        el('div', { class: 'spinner' }),
        el('button', { class: 'btn ghost', type: 'button', onClick: () => h.onCancel() }, 'Cancelar'),
      );
    },

    showConnecting(text = 'Conectando…') {
      panel(el('h2', {}, text), el('div', { class: 'spinner' }),
        el('button', { class: 'btn ghost', type: 'button', onClick: () => h.onCancel() }, 'Cancelar'));
    },

    // kind: 'nat' | 'notfound' | 'missing' | 'generic'
    showError(message, { kind = 'generic', retry = null } = {}) {
      api.hideCountdown();
      const p = panel(el('h2', { class: 'error' }, 'No se pudo continuar'), el('p', {}, message));
      if (kind === 'nat') {
        p.append(el('div', { class: 'error-box' },
          'Puede que uno de los dos esté detrás de una red estricta (NAT simétrico, wifi de empresa o 4G) y se necesite un servidor TURN. ' +
          'Prueba con otra red o un hotspot móvil. Quien aloje el juego puede añadir un TURN en CONFIG.ICE_SERVERS (ver README).'));
      }
      if (retry) p.append(el('button', { class: 'btn alt', type: 'button', onClick: retry }, 'Reintentar'));
      p.append(el('button', { class: 'btn ghost', type: 'button', onClick: () => h.onMenu() }, 'Volver al menú'));
    },

    showCountdown(n) {
      if (!countdownEl) { countdownEl = el('div', { id: 'countdown' }); document.body.append(countdownEl); }
      clear();
      countdownEl.classList.remove('pop');
      void countdownEl.offsetWidth; // reinicia animación
      countdownEl.classList.add('pop');
      countdownEl.replaceChildren(el('span', {}, String(n)));
    },
    hideCountdown() { if (countdownEl) { countdownEl.remove(); countdownEl = null; } },

    // outcome: 'win' | 'lose' | 'draw'
    showResult({ outcome, reason = '', detail = '' }) {
      api.hideCountdown();
      const titles = { win: 'Victoria', lose: 'Derrota', draw: 'Empate' };
      const reasons = {
        finish: 'Cruzó la meta primero', destroyed: 'Coche destruido', time: 'Se acabó el tiempo',
        disconnect: 'El rival se desconectó',
      };
      const status = el('p', { class: 'muted', id: 'rematch-status' }, detail);
      const rematch = el('button', { class: 'btn', type: 'button', id: 'btn-rematch' }, 'Revancha');
      rematch.addEventListener('click', () => { rematch.disabled = true; h.onRematch(); });
      if (reason === 'disconnect') rematch.disabled = true;
      panel(
        el('h2', { class: 'result-' + outcome }, titles[outcome] || 'Fin'),
        el('p', {}, reasons[reason] || ''),
        status, rematch,
        el('button', { class: 'btn ghost', type: 'button', onClick: () => h.onMenu() }, 'Volver al menú'),
      );
    },
    setRematchStatus(text) {
      const s = document.getElementById('rematch-status');
      if (s) s.textContent = text;
    },

    toast(text) {
      let t = document.getElementById('toast');
      if (!t) { t = el('div', { id: 'toast' }); document.body.append(t); }
      t.textContent = text;
      clearTimeout(api._toastT);
      api._toastT = setTimeout(() => t.remove(), 2600);
    },
  };
  return api;
}
