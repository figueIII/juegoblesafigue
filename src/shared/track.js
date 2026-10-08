// Generación procedural de pista, determinista por semilla.
// Track = { width, finishY, segments:[{y,cx}], obstacles:[{x,y,w,h}], pickups:[{x,y}] }
//   - Y negativo = avance. segments[i].y = -i*SEGMENT; cx = centro de la pista en esa y.
//   - obstacles: rectángulos alineados a ejes, (x,y) = CENTRO, w/h = tamaño.
//   - segments se extiende unos segmentos más allá de finishY.
import { CONFIG } from '../config.js';
import { mulberry32 } from './rng.js';

export function generateTrack(seed) {
  const T = CONFIG.TRACK;
  const rng = mulberry32(seed);
  const finishY = -T.LENGTH;
  const count = Math.ceil(T.LENGTH / T.SEGMENT) + 6;

  // Curvas: suma de dos senos con fase/longitud de onda aleatorias, |cx| <= MAX_CURVE.
  const ph1 = rng() * Math.PI * 2, ph2 = rng() * Math.PI * 2;
  const l1 = T.SEGMENT * (4 + rng() * 2), l2 = T.SEGMENT * (1.8 + rng() * 0.8);
  const segments = [];
  for (let i = 0; i < count; i++) {
    const y = -i * T.SEGMENT;
    const taper = Math.min(1, i / 5); // salida recta
    const cx = taper * T.MAX_CURVE * (0.6 * Math.sin(-y / l1 + ph1) + 0.4 * Math.sin(-y / l2 + ph2));
    segments.push({ y, cx });
  }
  const track = { width: T.WIDTH, finishY, segments, obstacles: [], pickups: [] };

  // Pickups cada PICKUP_EVERY.
  for (let py = -T.PICKUP_EVERY; py > finishY + T.SEGMENT; py -= T.PICKUP_EVERY) {
    const x = trackCenterAt(track, py) + (rng() - 0.5) * T.WIDTH * 0.6;
    track.pickups.push({ x, y: py });
  }

  // Obstáculos: como mucho uno por segmento, sin tocar la salida ni la meta ni los pickups.
  for (let i = 6; i < count - 6; i++) {
    if (rng() >= T.OBSTACLE_DENSITY) continue;
    const w = 40 + rng() * 60, h = 30 + rng() * 40;
    const y = -i * T.SEGMENT - rng() * T.SEGMENT;
    const x = trackCenterAt(track, y) + (rng() - 0.5) * (T.WIDTH - w - 60);
    if (y < finishY + T.SEGMENT) continue;
    if (track.pickups.some((p) => Math.abs(p.y - y) < 120)) continue;
    track.obstacles.push({ x, y, w, h });
  }
  return track;
}

/** Centro x de la pista en la coordenada y (interpolación lineal entre segmentos). */
export function trackCenterAt(track, y) {
  const segs = track.segments;
  const step = segs.length > 1 ? segs[0].y - segs[1].y : 1;
  let f = -y / step;
  if (f <= 0) return segs[0].cx;
  if (f >= segs.length - 1) return segs[segs.length - 1].cx;
  const i = Math.floor(f);
  const t = f - i;
  return segs[i].cx + (segs[i + 1].cx - segs[i].cx) * t;
}
