// Contrato de mensajes y del estado de juego. Compartido por host y cliente.
/**
 * GameState (producido por physics.createState / physics.step, consumido por render y snapshots):
 * {
 *   tick: number, time: number,            // segundos desde "GO"
 *   phase: 'countdown'|'race'|'over',
 *   timeLeft: number,
 *   cars: [ { id:0|1, x,y,angle,vx,vy, hp, slot:null|'missile'|'oil'|'emp', cooldown, oilTimer, empTimer } , ... ] // id 0 = host, 1 = invitado
 *   projectiles: [ { id, owner, x,y,vx,vy, ttl } ],
 *   hazards: [ { id, kind:'oil', x,y,r, ttl } ],
 *   pickups: [ { id, x,y, taken:boolean } ],
 *   winner: null|0|1|'draw', reason: null|'finish'|'destroyed'|'time'|'disconnect'
 * }
 * Input: { seq, throttle:-1..1 (−1 = freno/marcha atrás), steer:-1..1, aim:[wx,wy] mundo, fire:boolean }
 * Track: { width, finishY, segments:[{y,cx}], obstacles:[{x,y,w,h}], pickups:[{x,y}] }  // Y negativo = avance
 */
export const MSG = {
  HELLO: 'hello',     // {v, name}               guest→host
  START: 'start',     // {seed, countdown}       host→guest
  INPUT: 'input',     // Input                   guest→host (no fiable)
  SNAP: 'snap',       // {tick, ackSeq, state}   host→guest (no fiable)
  EVENT: 'event',     // {kind, ...}             host→guest (fiable): 'hit','fire','pickup','over'
  PING: 'ping', PONG: 'pong', // {t}
  REMATCH: 'rematch', // {}                      ambos
};
export const encode = (type, data = {}) => JSON.stringify({ type, ...data });
export const decode = (raw) => (typeof raw === 'string' ? JSON.parse(raw) : raw);
