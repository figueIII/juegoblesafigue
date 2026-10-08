// Renderer Canvas 2D neón cenital. Convenciones: Y negativo = avance; angle 0 = coche apuntando arriba
// (vector adelante = (sin a, -cos a)). Cámara sin rotación, sigue al coche propio.
import { CONFIG } from '../config.js';
import { createParticles } from './particles.js';

const COL = {
  bg: '#05060f', grass: '#07140f', grid: 'rgba(40,255,160,0.07)', road: '#10121f', roadEdge: '#ff2bd6',
  edge2: '#18f0ff', lane: 'rgba(255,255,255,0.28)', obstacle: '#ff9d1c', pickup: '#6fff9c', oil: '#1b0b2e',
  car: ['#18f0ff', '#ff2bd6'], text: '#e8f6ff', hp: '#37ff8b', hpLow: '#ff3b5c',
  slot: { missile: '#ff9d1c', oil: '#b36bff', emp: '#18f0ff' },
};
const SLOT_NAME = { missile: 'MISIL', oil: 'ACEITE', emp: 'EMP' };
const VIEW_H = 900;          // alto de mundo visible (px)
const ANCHOR = 0.68;         // posición vertical del coche en pantalla
const font = (s, w = 'bold') => `${w} ${s}px "Segoe UI", system-ui, sans-serif`;

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const particles = createParticles();
  const cam = { x: 0, y: 0, scale: 1, init: false };
  const view = { w: 1, h: 1, dpr: 1 };
  const ptr = { x: -1, y: -1, inside: false };
  const last = { t: 0, hp: [100, 100], proj: new Set(), smokeAcc: [0, 0], taken: new Set(), over: null };
  const fx = { rings: [], flash: 0, shake: 0 };
  let hasTrackSegs = null;

  canvas.style.cursor = 'none';
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    ptr.x = e.clientX - r.left; ptr.y = e.clientY - r.top; ptr.inside = true;
  });
  canvas.addEventListener('pointerleave', () => { ptr.inside = false; });

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    view.w = w; view.h = h; view.dpr = dpr;
    cam.scale = Math.max(0.35, Math.min(1.6, h / VIEW_H));
  }

  // Conversión pantalla (px CSS del canvas) -> mundo, usada por input.js
  function screenToWorld(sx, sy) {
    return [(sx - view.w / 2) / cam.scale + cam.x, (sy - view.h * ANCHOR) / cam.scale + cam.y];
  }
  function worldToScreen(wx, wy) {
    return [(wx - cam.x) * cam.scale + view.w / 2, (wy - cam.y) * cam.scale + view.h * ANCHOR];
  }

  function centerAt(track, y) {
    const s = track.segments;
    if (!s || !s.length) return 0;
    if (s.length === 1) return s[0].cx;
    const y0 = s[0].y, step = s[1].y - s[0].y;
    let f = (y - y0) / step;
    f = Math.max(0, Math.min(s.length - 1.0001, f));
    const i = Math.floor(f), t = f - i;
    return s[i].cx + (s[i + 1].cx - s[i].cx) * t;
  }

  function bounds(track) {
    const top = cam.y - view.h * ANCHOR / cam.scale - 80;
    const bot = cam.y + view.h * (1 - ANCHOR) / cam.scale + 80;
    return { top, bot, left: cam.x - view.w / 2 / cam.scale - 80, right: cam.x + view.w / 2 / cam.scale + 80 };
  }

  function roadPath(track, b, inset = 0) {
    const half = track.width / 2 - inset, step = 40;
    const y0 = Math.max(b.top, track.finishY - 400), y1 = b.bot;
    ctx.beginPath();
    for (let y = y0; y <= y1; y += step) ctx.lineTo(centerAt(track, y) - half, y);
    for (let y = y1; y >= y0; y -= step) ctx.lineTo(centerAt(track, y) + half, y);
    ctx.closePath();
  }
  function edgeLine(track, b, side) {
    const half = track.width / 2, step = 40;
    ctx.beginPath();
    for (let y = Math.max(b.top, track.finishY - 400); y <= b.bot; y += step) {
      const x = centerAt(track, y) + side * half;
      y === Math.max(b.top, track.finishY - 400) ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function drawTrack(track, b) {
    // cuadrícula de hierba
    ctx.strokeStyle = COL.grid; ctx.lineWidth = 1;
    const g = 120;
    ctx.beginPath();
    for (let x = Math.floor(b.left / g) * g; x < b.right; x += g) { ctx.moveTo(x, b.top); ctx.lineTo(x, b.bot); }
    for (let y = Math.floor(b.top / g) * g; y < b.bot; y += g) { ctx.moveTo(b.left, y); ctx.lineTo(b.right, y); }
    ctx.stroke();

    // asfalto
    roadPath(track, b);
    ctx.fillStyle = COL.road; ctx.fill();
    // bordes neón
    ctx.save();
    ctx.lineWidth = 5; ctx.shadowBlur = 18;
    ctx.strokeStyle = COL.roadEdge; ctx.shadowColor = COL.roadEdge; edgeLine(track, b, -1);
    ctx.strokeStyle = COL.edge2; ctx.shadowColor = COL.edge2; edgeLine(track, b, 1);
    ctx.restore();
    // línea central discontinua
    ctx.strokeStyle = COL.lane; ctx.lineWidth = 3; ctx.setLineDash([36, 44]);
    ctx.beginPath();
    for (let y = Math.max(b.top, track.finishY - 400); y <= b.bot; y += 40) ctx.lineTo(centerAt(track, y), y);
    ctx.stroke(); ctx.setLineDash([]);

    // meta
    const fy = track.finishY;
    if (fy > b.top - 100 && fy < b.bot + 100) {
      const cx = centerAt(track, fy), half = track.width / 2, sq = 30, rows = 2;
      for (let r = 0; r < rows; r++) for (let x = -half, i = 0; x < half; x += sq, i++) {
        ctx.fillStyle = (i + r) % 2 ? '#fff' : '#111';
        ctx.fillRect(cx + x, fy - sq * (r + 1) + sq, Math.min(sq, half - x), sq);
      }
      ctx.save(); ctx.shadowColor = '#fff'; ctx.shadowBlur = 20; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
      ctx.strokeRect(cx - half, fy - sq + sq - sq, half * 2, sq * 2); ctx.restore();
    }
  }

  function drawObstacles(track, b) {
    ctx.save();
    ctx.shadowColor = COL.obstacle; ctx.shadowBlur = 14;
    for (const o of track.obstacles || []) {
      if (o.y + o.h < b.top || o.y - o.h > b.bot) continue;
      ctx.fillStyle = 'rgba(255,157,28,0.18)'; ctx.strokeStyle = COL.obstacle; ctx.lineWidth = 2.5;
      ctx.fillRect(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h);
      ctx.strokeRect(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h);
      ctx.beginPath(); // aspas de peligro
      ctx.moveTo(o.x - o.w / 2, o.y - o.h / 2); ctx.lineTo(o.x + o.w / 2, o.y + o.h / 2);
      ctx.moveTo(o.x + o.w / 2, o.y - o.h / 2); ctx.lineTo(o.x - o.w / 2, o.y + o.h / 2);
      ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawPickups(state, track, b, t) {
    const list = state && state.pickups ? state.pickups : (track.pickups || []).map((p) => ({ ...p, taken: false }));
    ctx.save();
    for (const p of list) {
      if (p.taken || p.y < b.top || p.y > b.bot) continue;
      const pulse = 1 + Math.sin(t * 5 + p.y) * 0.12, r = 17 * pulse;
      ctx.shadowColor = COL.pickup; ctx.shadowBlur = 18; ctx.strokeStyle = COL.pickup; ctx.lineWidth = 2.5;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(t * 1.5);
      ctx.strokeRect(-r / 1.4, -r / 1.4, r * 1.4, r * 1.4); ctx.restore();
      ctx.fillStyle = COL.pickup; ctx.font = font(18); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('?', p.x, p.y + 1);
    }
    ctx.restore();
  }

  function drawHazards(state, t) {
    for (const h of state.hazards || []) {
      const a = Math.min(1, (h.ttl ?? 1) / 0.8);
      ctx.save(); ctx.globalAlpha = 0.9 * a;
      const gr = ctx.createRadialGradient(h.x, h.y, 2, h.x, h.y, h.r);
      gr.addColorStop(0, '#000'); gr.addColorStop(0.7, COL.oil); gr.addColorStop(1, 'rgba(179,107,255,0.0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = COL.slot.oil; ctx.lineWidth = 2; ctx.shadowColor = COL.slot.oil; ctx.shadowBlur = 12;
      ctx.setLineDash([10, 8]); ctx.lineDashOffset = -t * 20;
      ctx.beginPath(); ctx.arc(h.x, h.y, h.r * 0.92, 0, 6.2832); ctx.stroke();
      ctx.restore();
    }
  }

  function drawMissiles(state) {
    for (const p of state.projectiles || []) {
      const a = Math.atan2(p.vx, -p.vy);
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(a);
      ctx.shadowColor = COL.slot.missile; ctx.shadowBlur = 16;
      ctx.fillStyle = '#fff3d6'; ctx.strokeStyle = COL.slot.missile; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffcf70'; ctx.beginPath(); ctx.moveTo(-3, 7); ctx.lineTo(0, 7 + 10 + Math.random() * 8); ctx.lineTo(3, 7); ctx.fill();
      ctx.restore();
    }
  }

  function drawCar(c, mine, t) {
    const W = CONFIG.CAR.W, H = CONFIG.CAR.H, col = COL.car[c.id] || '#fff';
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.angle || 0);
    // charco: ligera oscilación
    if (c.oilTimer > 0) ctx.rotate(Math.sin(t * 25) * 0.05);
    ctx.shadowColor = col; ctx.shadowBlur = mine ? 22 : 15;
    ctx.fillStyle = 'rgba(8,10,20,0.92)'; ctx.strokeStyle = col; ctx.lineWidth = mine ? 3 : 2.5;
    ctx.beginPath();
    ctx.moveTo(-W / 2 + 4, -H / 2); ctx.lineTo(W / 2 - 4, -H / 2); ctx.lineTo(W / 2, -H / 2 + 12);
    ctx.lineTo(W / 2, H / 2 - 4); ctx.lineTo(W / 2 - 3, H / 2); ctx.lineTo(-W / 2 + 3, H / 2);
    ctx.lineTo(-W / 2, H / 2 - 4); ctx.lineTo(-W / 2, -H / 2 + 12); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = col; ctx.globalAlpha = 0.85; // parabrisas
    ctx.fillRect(-W / 2 + 5, -H / 2 + 12, W - 10, 11);
    ctx.globalAlpha = 0.5; ctx.fillRect(-2, -H / 2 + 26, 4, 18); // franja
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff'; ctx.fillRect(-W / 2 + 3, -H / 2 + 1, 5, 3); ctx.fillRect(W / 2 - 8, -H / 2 + 1, 5, 3); // faros
    ctx.fillStyle = '#ff3b5c'; ctx.fillRect(-W / 2 + 3, H / 2 - 4, 6, 3); ctx.fillRect(W / 2 - 9, H / 2 - 4, 6, 3);
    ctx.restore();

    if (c.empTimer > 0) { // arcos eléctricos
      ctx.save(); ctx.translate(c.x, c.y); ctx.strokeStyle = COL.slot.emp; ctx.shadowColor = COL.slot.emp; ctx.shadowBlur = 14; ctx.lineWidth = 2;
      for (let k = 0; k < 4; k++) {
        const a0 = Math.random() * 6.28, r0 = 18, r1 = 42 + Math.random() * 10;
        ctx.beginPath(); ctx.moveTo(Math.cos(a0) * r0, Math.sin(a0) * r0);
        for (let s = 1; s <= 4; s++) {
          const r = r0 + (r1 - r0) * s / 4, a = a0 + (Math.random() - 0.5) * 0.7;
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
    if (mine) { // marca sobre el coche propio
      ctx.save(); ctx.fillStyle = col; ctx.globalAlpha = 0.9; ctx.font = font(11); ctx.textAlign = 'center';
      ctx.fillText('TÚ', c.x, c.y - H / 2 - 12); ctx.restore();
    }
  }

  function carEffects(state, myId, dt) {
    for (const c of state.cars || []) {
      const i = c.id === 1 ? 1 : 0;
      // chispas por pérdida de HP (fallback si no hubo evento 'hit')
      if (c.hp < last.hp[i] - 0.01) {
        const loss = last.hp[i] - c.hp;
        particles.sparks(c.x, c.y, Math.min(30, 6 + loss), Math.min(1.6, 0.6 + loss / 15));
        if (c.id === myId) fx.shake = Math.min(14, fx.shake + 3 + loss * 0.4);
      }
      last.hp[i] = c.hp;
      if (c.hp < 40 && c.hp > 0) { // humo
        const rate = (1 - c.hp / 40) * 25 + 6;
        last.smokeAcc[i] += rate * dt;
        while (last.smokeAcc[i] >= 1) {
          last.smokeAcc[i]--;
          const a = c.angle || 0, fx_ = Math.sin(a), fy_ = -Math.cos(a);
          particles.smoke(c.x + fx_ * 14, c.y + fy_ * 14, 1, 1 + (1 - c.hp / 40));
        }
        if (c.hp < 20 && Math.random() < dt * 8) particles.sparks(c.x, c.y, 3, 0.4, '#ff7a2a');
      }
    }
    // misiles: estela y explosión al desaparecer
    const cur = new Set();
    for (const p of state.projectiles || []) {
      cur.add(p.id);
      particles.trail(p.x - p.vx * 0.012, p.y - p.vy * 0.012);
    }
    last.proj = cur;
  }

  function handleEvents(events, state, myId) {
    for (const ev of events || []) {
      if (!ev) continue;
      const car = (state.cars || []).find((c) => c.id === (ev.id ?? ev.owner ?? ev.by));
      switch (ev.kind) {
        case 'hit': {
          const x = ev.x ?? car?.x, y = ev.y ?? car?.y;
          if (x == null) break;
          const strong = ev.what === 'missile' || ev.weapon === 'missile' || ev.kind2 === 'missile';
          if (strong) particles.explosion(x, y); else particles.sparks(x, y, 16, 1);
          if (ev.target === myId || ev.id === myId || ev.victim === myId) fx.shake = Math.min(18, fx.shake + 8);
          break;
        }
        case 'fire': {
          const w = ev.weapon || ev.what || ev.slot;
          if (car && w === 'emp') { particles.ring(car.x, car.y, CONFIG.SABOTAGE.EMP.RANGE * 0.5, COL.slot.emp, 0.5); fx.flash = 0.25; }
          else if (car && w === 'oil') particles.ring(car.x, car.y, 50, COL.slot.oil, 0.4);
          else if (car) particles.sparks(car.x, car.y, 5, 0.5, COL.slot.missile);
          break;
        }
        case 'pickup': {
          const x = ev.x ?? car?.x, y = ev.y ?? car?.y;
          if (x != null) particles.pickup(x, y);
          break;
        }
        default: break;
      }
    }
  }

  // ----- HUD -----
  function bar(x, y, w, h, frac, label, col, alignRight) {
    ctx.save();
    ctx.fillStyle = 'rgba(5,8,20,0.7)'; ctx.fillRect(x, y, w, h);
    const f = Math.max(0, Math.min(1, frac));
    const c = f < 0.3 ? COL.hpLow : COL.hp;
    ctx.fillStyle = c; ctx.shadowColor = c; ctx.shadowBlur = 10;
    const bw = (w - 4) * f;
    ctx.fillRect(alignRight ? x + 2 + (w - 4 - bw) : x + 2, y + 2, bw, h - 4);
    ctx.shadowBlur = 0; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = COL.text; ctx.font = font(12); ctx.textBaseline = 'bottom';
    ctx.textAlign = alignRight ? 'right' : 'left';
    ctx.fillText(label, alignRight ? x + w : x, y - 3);
    ctx.restore();
  }

  function drawHUD(state, track, myId, t) {
    const W = view.w, H = view.h, m = 14;
    const me = (state.cars || []).find((c) => c.id === myId);
    const rival = (state.cars || []).find((c) => c.id !== myId);
    const maxHp = CONFIG.CAR.MAX_HP;
    const bw = Math.min(240, W * 0.3);
    ctx.save();
    if (me) bar(m, m + 16, bw, 16, me.hp / maxHp, `TÚ  ${Math.ceil(me.hp)}`, COL.car[me.id], false);
    if (rival) bar(W - m - bw, m + 16, bw, 16, rival.hp / maxHp, `RIVAL  ${Math.ceil(rival.hp)}`, COL.car[rival.id], true);

    // indicador de remontada (sin temporizador: no hay límite de tiempo)
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    if ((me && me.turbo) || (rival && rival.turbo)) {
      const mine = !!(me && me.turbo);
      ctx.font = font(22); ctx.fillStyle = mine ? COL.hp : COL.hpLow;
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 12;
      ctx.globalAlpha = 0.75 + 0.25 * Math.sin(t * 8);
      ctx.fillText(mine ? '¡TURBO REMONTADA!' : 'Rival en turbo', W / 2, m);
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    }

    // posición y progreso
    if (me && rival) {
      const lead = me.y <= rival.y;
      ctx.font = font(16); ctx.fillStyle = lead ? COL.hp : COL.hpLow;
      ctx.fillText(lead ? '1º / 2' : '2º / 2', W / 2, m + 36);
      const gap = Math.abs(me.y - rival.y);
      ctx.font = font(11, 'normal'); ctx.fillStyle = 'rgba(232,246,255,0.7)';
      ctx.fillText(`${lead ? '+' : '-'}${Math.round(gap / 10)} m`, W / 2, m + 56);
    }
    // barra de progreso vertical a la derecha
    const px = W - 18, py0 = 90, ph = Math.max(80, H - 190), fin = track.finishY;
    ctx.strokeStyle = 'rgba(232,246,255,0.35)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, py0); ctx.lineTo(px, py0 + ph); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = font(10); ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText('META', px - 8, py0);
    for (const c of state.cars || []) {
      const f = Math.max(0, Math.min(1, c.y / fin)); // y=0 inicio, y=finishY (negativo) meta
      const yy = py0 + ph * (1 - f);
      ctx.fillStyle = COL.car[c.id]; ctx.shadowColor = COL.car[c.id]; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(px, yy, c.id === myId ? 6 : 4.5, 0, 6.2832); ctx.fill(); ctx.shadowBlur = 0;
    }

    // ranura de sabotaje
    const sw = 120, sh = 54, sx = W / 2 - sw / 2, sy = H - sh - m;
    const slot = me && me.slot;
    ctx.fillStyle = 'rgba(5,8,20,0.7)'; ctx.fillRect(sx, sy, sw, sh);
    ctx.strokeStyle = slot ? COL.slot[slot] : 'rgba(232,246,255,0.3)'; ctx.lineWidth = 2;
    if (slot) { ctx.shadowColor = COL.slot[slot]; ctx.shadowBlur = 14; }
    ctx.strokeRect(sx, sy, sw, sh); ctx.shadowBlur = 0;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (slot) {
      drawSlotIcon(slot, sx + 30, sy + sh / 2);
      ctx.fillStyle = COL.slot[slot]; ctx.font = font(15); ctx.fillText(SLOT_NAME[slot], sx + 78, sy + sh / 2 - 6);
      ctx.fillStyle = 'rgba(232,246,255,0.7)'; ctx.font = font(10, 'normal'); ctx.fillText('CLIC = USAR', sx + 78, sy + sh / 2 + 12);
      if (me.cooldown > 0) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(sx, sy, sw * Math.min(1, me.cooldown / CONFIG.SABOTAGE.COOLDOWN), sh); }
    } else {
      ctx.fillStyle = 'rgba(232,246,255,0.45)'; ctx.font = font(12, 'normal'); ctx.fillText('sin sabotaje', sx + sw / 2, sy + sh / 2);
    }
    ctx.restore();
  }

  function drawSlotIcon(slot, x, y) {
    ctx.save(); ctx.translate(x, y); ctx.strokeStyle = ctx.fillStyle = COL.slot[slot]; ctx.lineWidth = 2.5;
    ctx.shadowColor = COL.slot[slot]; ctx.shadowBlur = 10;
    if (slot === 'missile') { ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(6, 8); ctx.lineTo(0, 4); ctx.lineTo(-6, 8); ctx.closePath(); ctx.fill(); }
    else if (slot === 'oil') { ctx.beginPath(); ctx.ellipse(0, 0, 15, 11, 0, 0, 6.2832); ctx.fill(); }
    else { ctx.beginPath(); ctx.moveTo(4, -16); ctx.lineTo(-7, 2); ctx.lineTo(0, 2); ctx.lineTo(-4, 16); ctx.lineTo(8, -4); ctx.lineTo(1, -4); ctx.closePath(); ctx.stroke(); }
    ctx.restore();
  }

  function drawReticle(me, state, myId) {
    if (!ptr.inside) return;
    const slot = me && me.slot, col = slot ? COL.slot[slot] : '#e8f6ff';
    ctx.save(); ctx.translate(ptr.x, ptr.y); ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 8; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 11, 0, 6.2832); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(-6, 0); ctx.moveTo(18, 0); ctx.lineTo(6, 0);
    ctx.moveTo(0, -18); ctx.lineTo(0, -6); ctx.moveTo(0, 18); ctx.lineTo(0, 6); ctx.stroke();
    ctx.restore();
    if (me && slot === 'emp') { // radio de alcance
      const [cx, cy] = worldToScreen(me.x, me.y);
      ctx.save(); ctx.strokeStyle = COL.slot.emp; ctx.globalAlpha = 0.25; ctx.setLineDash([8, 10]); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, CONFIG.SABOTAGE.EMP.RANGE * cam.scale, 0, 6.2832); ctx.stroke(); ctx.restore();
    }
    if (me && slot === 'missile') { // línea de puntería tenue
      const [cx, cy] = worldToScreen(me.x, me.y);
      ctx.save(); ctx.strokeStyle = COL.slot.missile; ctx.globalAlpha = 0.2; ctx.setLineDash([4, 8]);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ptr.x, ptr.y); ctx.stroke(); ctx.restore();
    }
  }

  function drawCountdown(state) {
    let n = state.countdown;
    if (n == null) n = state.time < 0 ? -state.time : (state.phase === 'countdown' ? CONFIG.COUNTDOWN_SECONDS : null);
    if (n == null) return;
    const txt = n > 0 ? String(Math.ceil(n)) : 'GO!';
    const frac = n > 0 ? 1 - (n - Math.floor(n)) : 0.5;
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = font(Math.min(view.w, view.h) * (0.22 - frac * 0.04));
    ctx.fillStyle = '#fff'; ctx.shadowColor = COL.roadEdge; ctx.shadowBlur = 40; ctx.globalAlpha = 1 - frac * 0.5;
    ctx.fillText(txt, view.w / 2, view.h * 0.4); ctx.restore();
  }

  function drawGoBanner(state) {
    if (state.phase === 'race' && state.time >= 0 && state.time < 0.8) {
      ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = font(Math.min(view.w, view.h) * 0.16);
      ctx.fillStyle = COL.hp; ctx.shadowColor = COL.hp; ctx.shadowBlur = 40; ctx.globalAlpha = 1 - state.time / 0.8;
      ctx.fillText('GO!', view.w / 2, view.h * 0.4); ctx.restore();
    }
  }

  function drawResult(state, myId) {
    const w = state.winner;
    const win = w === myId, draw = w === 'draw';
    const title = draw ? 'EMPATE' : win ? '¡VICTORIA!' : 'DERROTA';
    const reasons = { finish: 'Cruzó la meta', destroyed: 'Coche destruido', time: 'Tiempo agotado', disconnect: 'Desconexión' };
    const col = draw ? COL.text : win ? COL.hp : COL.hpLow;
    ctx.save(); ctx.fillStyle = 'rgba(2,4,12,0.62)'; ctx.fillRect(0, 0, view.w, view.h);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = font(Math.min(view.w * 0.11, 90)); ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 30;
    // El panel de resultados (DOM) ocupa la parte inferior: el cartel va arriba para no solaparse.
    const ty = Math.min(view.h * 0.25, 190);
    ctx.fillText(title, view.w / 2, ty); ctx.shadowBlur = 0;
    ctx.font = font(18, 'normal'); ctx.fillStyle = COL.text;
    if (state.reason) ctx.fillText(reasons[state.reason] || state.reason, view.w / 2, ty + 50);
    ctx.restore();
  }

  function drawEMPFlicker(me) {
    if (!me || !(me.empTimer > 0)) return;
    ctx.save();
    ctx.globalAlpha = 0.12 + Math.random() * 0.12; ctx.fillStyle = COL.slot.emp; ctx.fillRect(0, 0, view.w, view.h);
    ctx.globalAlpha = 0.5; ctx.fillStyle = '#000';
    for (let i = 0; i < 4; i++) ctx.fillRect(0, Math.random() * view.h, view.w, 1 + Math.random() * 3);
    ctx.restore();
    ctx.save(); ctx.textAlign = 'center'; ctx.font = font(16); ctx.fillStyle = COL.slot.emp; ctx.shadowColor = COL.slot.emp; ctx.shadowBlur = 10;
    ctx.fillText('EMP – CONTROLES INVERTIDOS', view.w / 2, view.h * 0.2); ctx.restore();
  }

  // ----- Bucle principal de dibujo -----
  function draw(state, track, myId = 0, events = []) {
    resize();
    const now = performance.now() / 1000;
    const dt = last.t ? Math.min(0.1, now - last.t) : 1 / 60;
    last.t = now;
    const t = now;

    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.fillStyle = COL.grass; ctx.fillRect(0, 0, view.w, view.h);
    if (!state || !track) return;

    const me = (state.cars || []).find((c) => c.id === myId) || (state.cars || [])[0];
    if (me) {
      const look = Math.min(180, Math.hypot(me.vx || 0, me.vy || 0) * 0.25);
      const tx = me.x, ty = me.y - look;
      if (!cam.init) { cam.x = tx; cam.y = ty; cam.init = true; }
      else { const k = 1 - Math.exp(-dt * 9); cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k; }
    }

    carEffects(state, myId, dt);
    handleEvents(events, state, myId);
    particles.update(dt);
    fx.shake = Math.max(0, fx.shake - dt * 40);
    fx.flash = Math.max(0, fx.flash - dt);

    ctx.save();
    ctx.translate(view.w / 2, view.h * ANCHOR);
    ctx.scale(cam.scale, cam.scale);
    ctx.translate(-cam.x, -cam.y);
    if (fx.shake > 0) ctx.translate((Math.random() - 0.5) * fx.shake, (Math.random() - 0.5) * fx.shake);
    const b = bounds(track);
    drawTrack(track, b);
    drawHazards(state, t);
    drawObstacles(track, b);
    drawPickups(state, track, b, t);
    for (const c of state.cars || []) if (c.id !== myId) drawCar(c, false, t);
    for (const c of state.cars || []) if (c.id === myId) drawCar(c, true, t);
    drawMissiles(state);
    particles.draw(ctx);
    ctx.restore();

    if (fx.flash > 0) { ctx.save(); ctx.globalAlpha = fx.flash * 0.6; ctx.fillStyle = COL.slot.emp; ctx.fillRect(0, 0, view.w, view.h); ctx.restore(); }
    drawEMPFlicker(me);
    // viñeta
    const vg = ctx.createRadialGradient(view.w / 2, view.h / 2, Math.min(view.w, view.h) * 0.4, view.w / 2, view.h / 2, Math.max(view.w, view.h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, view.w, view.h);

    drawHUD(state, track, myId, t);
    if (state.phase === 'countdown') drawCountdown(state);
    drawGoBanner(state);
    if (state.phase === 'over') drawResult(state, myId);
    if (state.phase !== 'over') drawReticle(me, state, myId);
  }

  resize();
  return {
    draw,
    resize,
    /** (sx, sy) px CSS del canvas -> [wx, wy] mundo. Pasar a createInput como getCameraToWorld. */
    getCameraToWorld: screenToWorld,
    screenToWorld,
    worldToScreen,
    get camera() { return { x: cam.x, y: cam.y, scale: cam.scale }; },
    resetCamera() { cam.init = false; particles.clear(); last.hp = [100, 100]; },
    particles,
  };
}
