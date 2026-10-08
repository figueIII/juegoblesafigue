// Sistema de partículas simple en coordenadas de mundo. Sin DOM salvo el ctx recibido en draw().
const MAX = 1500;

export function createParticles() {
  const list = [];
  const rnd = (a, b) => a + Math.random() * (b - a);

  function push(p) {
    if (list.length >= MAX) list.shift();
    list.push(p);
  }

  return {
    get count() { return list.length; },
    clear() { list.length = 0; },

    sparks(x, y, n = 14, power = 1, color = '#ffd24a') {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = rnd(80, 420) * power;
        push({ k: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, ttl: rnd(0.2, 0.55), size: rnd(1.2, 2.6), color, drag: 3 });
      }
    },
    smoke(x, y, n = 1, intensity = 1) {
      for (let i = 0; i < n; i++) {
        push({ k: 'smoke', x: x + rnd(-6, 6), y: y + rnd(-6, 6), vx: rnd(-25, 25), vy: rnd(-25, 25), life: 0, ttl: rnd(0.7, 1.4), size: rnd(5, 9) * intensity, color: '#9aa', drag: 1.2 });
      }
    },
    explosion(x, y, color = '#ff7a2a') {
      this.sparks(x, y, 26, 1.4, color);
      this.sparks(x, y, 10, 0.8, '#fff');
      for (let i = 0; i < 8; i++) push({ k: 'smoke', x, y, vx: rnd(-90, 90), vy: rnd(-90, 90), life: 0, ttl: rnd(0.6, 1.1), size: rnd(8, 14), color: '#667', drag: 2 });
      push({ k: 'ring', x, y, vx: 0, vy: 0, life: 0, ttl: 0.35, size: 70, color });
    },
    ring(x, y, radius = 80, color = '#7ff', ttl = 0.4) {
      push({ k: 'ring', x, y, vx: 0, vy: 0, life: 0, ttl, size: radius, color });
    },
    trail(x, y, color = '#ff9a3a') {
      push({ k: 'glow', x, y, vx: 0, vy: 0, life: 0, ttl: 0.25, size: 5, color, drag: 0 });
    },
    pickup(x, y, color = '#6fff9c') {
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        push({ k: 'spark', x, y, vx: Math.cos(a) * 160, vy: Math.sin(a) * 160, life: 0, ttl: 0.5, size: 2.2, color, drag: 3 });
      }
      push({ k: 'ring', x, y, vx: 0, vy: 0, life: 0, ttl: 0.4, size: 50, color });
    },

    update(dt) {
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.life += dt;
        if (p.life >= p.ttl) { list.splice(i, 1); continue; }
        const d = Math.max(0, 1 - (p.drag || 0) * dt);
        p.vx *= d; p.vy *= d;
        p.x += p.vx * dt; p.y += p.vy * dt;
      }
    },

    draw(ctx) {
      ctx.save();
      for (const p of list) {
        const t = p.life / p.ttl, a = 1 - t;
        if (p.k === 'smoke') {
          ctx.globalAlpha = 0.35 * a;
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 + t * 1.5), 0, 6.2832); ctx.fill();
        } else if (p.k === 'ring') {
          ctx.globalAlpha = a;
          ctx.strokeStyle = p.color; ctx.lineWidth = 3 * a + 1;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.2 + t * 0.8), 0, 6.2832); ctx.stroke();
        } else if (p.k === 'glow') {
          ctx.globalAlpha = 0.7 * a;
          ctx.fillStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = 10;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * a + 1, 0, 6.2832); ctx.fill();
          ctx.shadowBlur = 0;
        } else {
          ctx.globalAlpha = a;
          ctx.strokeStyle = p.color; ctx.lineWidth = p.size; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); ctx.stroke();
        }
      }
      ctx.restore();
    },
  };
}
