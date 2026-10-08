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

  TRACK: { WIDTH: 600, LENGTH: 32000, SEGMENT: 200, MAX_CURVE: 140, OBSTACLE_DENSITY: 0.35, PICKUP_EVERY: 1800 },

  CAR: { W: 28, H: 52, MAX_HP: 100, ACCEL: 520, BRAKE: 700, MAX_SPEED: 620, TURN_RATE: 2.6,
         DRAG: 0.6, GRASS_DRAG: 3.0, MASS: 1, BOUNCE: 0.45, COLLISION_DAMAGE: 0.02, WALL_DAMAGE: 0.015, OBSTACLE_DAMAGE: 0.015 },

  SABOTAGE: {
    MISSILE: { SPEED: 900, LIFETIME: 1.6, DAMAGE: 18, PUSH: 380 },
    OIL: { RADIUS: 60, DURATION: 4, GRIP: 0.15 },
    EMP: { RANGE: 700, DURATION: 1.5 },
    COOLDOWN: 0.5,
  },

  // Servidores ICE. Añadir aquí un TURN propio/gratuito para NAT estrictos.
  // OJO: pasar `config.iceServers` a PeerJS REEMPLAZA sus servidores por defecto.
  // Los TURN públicos gratuitos de PeerJS y Open Relay ya no resuelven (comprobado con diag.html), así que
  // para jugar entre redes distintas hace falta un TURN propio: añade aquí las credenciales (ver README).
  ICE_SERVERS: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.relay.metered.ca:80' },
    { urls: 'turn:global.relay.metered.ca:80', username: 'f1f78e3f73dc62acb26fe514', credential: 'k4zDBnPy4I8k7b3T' },
    { urls: 'turn:global.relay.metered.ca:80?transport=tcp', username: 'f1f78e3f73dc62acb26fe514', credential: 'k4zDBnPy4I8k7b3T' },
    { urls: 'turn:global.relay.metered.ca:443', username: 'f1f78e3f73dc62acb26fe514', credential: 'k4zDBnPy4I8k7b3T' },
    { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: 'f1f78e3f73dc62acb26fe514', credential: 'k4zDBnPy4I8k7b3T' },
  ],
  PEER_OPTIONS: {}, // p.ej. { host, port, path } para un broker PeerJS propio
  PEER_PREFIX: 'jbf-',
};
