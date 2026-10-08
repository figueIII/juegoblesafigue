// Entrada: WASD/flechas (throttle/steer), ratón (aim en mundo, clic izq = fire).
// Táctil (pantallas con puntero "coarse", o ?touch=1): botones ◀ ▶ (girar) y ▲ ▼ (acelerar/frenar);
// tocar el canvas apunta hacia ese punto y dispara (pointer events = igual que el ratón).
// getCameraToWorld(sx, sy) -> [wx, wy] con (sx, sy) en píxeles CSS relativos al canvas.
export function createInput(canvas, getCameraToWorld) {
  const keys = new Set();
  let mouseDown = false;
  let sx = canvas.clientWidth / 2, sy = canvas.clientHeight / 3;

  const norm = (k) => k.length === 1 ? k.toLowerCase() : k;
  const GAME_KEYS = new Set(['w', 'a', 's', 'd', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

  const onKeyDown = (e) => {
    const k = norm(e.key);
    if (GAME_KEYS.has(k)) { keys.add(k); e.preventDefault(); }
  };
  const onKeyUp = (e) => keys.delete(norm(e.key));
  const clampUnit = (v) => Math.max(-1, Math.min(1, v));
  const clear = () => { keys.clear(); mouseDown = false; if (pad) { for (const k of Object.keys(touch)) touch[k] = false; pad.querySelectorAll('.on').forEach((b) => b.classList.remove('on')); } };
  const onMove = (e) => {
    const r = canvas.getBoundingClientRect();
    sx = e.clientX - r.left; sy = e.clientY - r.top;
  };
  const onDown = (e) => { if (e.button === 0) { mouseDown = true; onMove(e); e.preventDefault(); } };
  const onUp = (e) => { if (e.button === 0) mouseDown = false; };
  const onCtx = (e) => e.preventDefault();
  const onVis = () => { if (document.hidden) clear(); };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', clear);
  document.addEventListener('visibilitychange', onVis);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointerup', onUp);
  canvas.addEventListener('contextmenu', onCtx);

  // --- controles táctiles ---
  const touch = { left: false, right: false, gas: false, brake: false };
  let pad = null;
  const wantTouch = (() => {
    try { return /[?&]touch=1/.test(location.search) || (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches); } catch { return false; }
  })();
  if (wantTouch && typeof document !== 'undefined') {
    pad = document.createElement('div');
    pad.className = 'touch-pad';
    const mk = (cls, label, key, aria) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'touch-btn ' + cls; b.textContent = label; b.setAttribute('aria-label', aria); b.dataset.key = key;
      const on = (e) => { touch[key] = true; try { b.setPointerCapture(e.pointerId); } catch {} b.classList.add('on'); e.preventDefault(); };
      const off = () => { touch[key] = false; b.classList.remove('on'); };
      b.addEventListener('pointerdown', on);
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, off);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      return b;
    };
    pad.append(mk('t-left', '◀', 'left', 'Girar a la izquierda'), mk('t-right', '▶', 'right', 'Girar a la derecha'),
      mk('t-brake', '▼', 'brake', 'Frenar'), mk('t-gas', '▲', 'gas', 'Acelerar'));
    document.body.append(pad);
  }

  const has = (...ks) => ks.some((k) => keys.has(k));

  return {
    /** Muestra el input actual: { seq, throttle, steer, aim:[wx,wy], fire } */
    sample(seq) {
      const throttle = clampUnit((has('w', 'ArrowUp') || touch.gas ? 1 : 0) - (has('s', 'ArrowDown') || touch.brake ? 1 : 0));
      const steer = clampUnit((has('d', 'ArrowRight') || touch.right ? 1 : 0) - (has('a', 'ArrowLeft') || touch.left ? 1 : 0));
      const aim = getCameraToWorld(sx, sy);
      return { seq, throttle, steer, aim: [aim[0], aim[1]], fire: mouseDown || keys.has(' ') };
    },
    /** Posición del puntero en píxeles CSS del canvas. */
    get pointer() { return [sx, sy]; },
    clear,
    destroy() {
      clear();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('contextmenu', onCtx);
      if (pad) { pad.remove(); pad = null; }
    },
  };
}
