// Entrada: WASD/flechas (throttle/steer), ratón (aim en mundo, clic izq = fire).
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
  const clear = () => { keys.clear(); mouseDown = false; };
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

  const has = (...ks) => ks.some((k) => keys.has(k));

  return {
    /** Muestra el input actual: { seq, throttle, steer, aim:[wx,wy], fire } */
    sample(seq) {
      const throttle = (has('w', 'ArrowUp') ? 1 : 0) - (has('s', 'ArrowDown') ? 1 : 0);
      const steer = (has('d', 'ArrowRight') ? 1 : 0) - (has('a', 'ArrowLeft') ? 1 : 0);
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
    },
  };
}
