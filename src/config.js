// Única fuente de constantes de balance y red. Unidades: píxeles de mundo, segundos.
export const CONFIG = {
  VERSION: 1,
  RACE_SECONDS: 60,
  COUNTDOWN_SECONDS: 3,
  PHYSICS_HZ: 60,
  SNAPSHOT_HZ: 20,
  INPUT_HZ: 60,
  INTERP_DELAY_MS: 100,
  DISCONNECT_TIMEOUT_MS: 5000,

  TRACK: { WIDTH: 600, LENGTH: 40000, SEGMENT: 200, MAX_CURVE: 140, OBSTACLE_DENSITY: 0.35, PICKUP_EVERY: 1800 },

  CAR: { W: 28, H: 52, MAX_HP: 100, ACCEL: 520, BRAKE: 700, MAX_SPEED: 620, TURN_RATE: 2.6,
         DRAG: 0.6, GRASS_DRAG: 3.0, MASS: 1, BOUNCE: 0.45, COLLISION_DAMAGE: 0.02, WALL_DAMAGE: 0.015, OBSTACLE_DAMAGE: 0.03 },

  SABOTAGE: {
    MISSILE: { SPEED: 900, LIFETIME: 1.6, DAMAGE: 18, PUSH: 380 },
    OIL: { RADIUS: 60, DURATION: 4, GRIP: 0.15 },
    EMP: { RANGE: 700, DURATION: 1.5 },
    COOLDOWN: 0.5,
  },

  // Servidores ICE. Añadir aquí un TURN propio/gratuito para NAT estrictos.
  ICE_SERVERS: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }],
  PEER_OPTIONS: {}, // p.ej. { host, port, path } para un broker PeerJS propio
  PEER_PREFIX: 'jbf-',
};
