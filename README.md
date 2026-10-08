# Neon Rivals (juegoblesafigue)

Carrera 1v1 cenital con sabotajes (misil, aceite, EMP), directa entre navegadores (WebRTC con PeerJS, sin servidor propio). Canvas 2D + ES modules, sin build.

## Cómo jugar
1. Un jugador pulsa **Crear sala** y copia el enlace `https://<usuario>.github.io/<repo>/#CODE` (botón *Copiar*).
2. El rival abre el enlace (se une solo) o entra en el menú, escribe el código y pulsa **Unirse**.
3. Cuenta atrás de 3 s y a correr. Gana quien cruza la meta primero. A los 60 s gana el más adelantado. Con 0 de HP pierdes.
4. Recoge los pickups para obtener un sabotaje (1 hueco) y úsalo contra el rival. Al terminar: **Revancha** (los dos deben aceptar) o **Volver al menú**.

## Controles
| Acción | Tecla |
|---|---|
| Acelerar / frenar | `W` `S` o flechas arriba/abajo |
| Girar | `A` `D` o flechas izquierda/derecha |
| Apuntar | Ratón |
| Disparar sabotaje | Clic |

## Desarrollo local
Los módulos ES requieren servidor HTTP (no `file://`):
```
python3 -m http.server 8080   # y abrir http://localhost:8080
```
Tests de física: `node --test tests/`.

## Despliegue en GitHub Pages
1. Sube el repo a GitHub (rama `main`).
2. *Settings → Pages → Build and deployment*: Source **Deploy from a branch**, Branch `main`, carpeta `/ (root)`.
3. Espera a que publique y comparte `https://<usuario>.github.io/<repo>/`. Todas las rutas son relativas, así que funciona en subcarpeta. No hay Actions ni build.

## Conectividad y TURN (`CONFIG.ICE_SERVERS`)
Por defecto se usan STUN públicos de Google, que bastan en la mayoría de redes. Con NAT simétrico, wifi corporativo o algunas redes 4G (~10-15 % de casos) la conexión directa falla y la UI muestra un aviso de NAT/TURN. Solución: añadir un servidor TURN en `src/config.js`:
```js
ICE_SERVERS: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'turn:turn.ejemplo.com:3478', username: 'usuario', credential: 'clave' },
],
```
Atención: las credenciales de un TURN en un sitio estático son públicas; usa un servicio con cuota gratuita y credenciales desechables. Si el broker público de PeerJS (0.peerjs.com) cae, puedes apuntar a uno propio con `CONFIG.PEER_OPTIONS = { host, port, path }`.

## Arranque (`src/main.js`) y contratos asumidos
`main.js` implementa la máquina de estados `LOBBY → COUNTDOWN → RACE → RESULT`. Todo lo que toca módulos de otros agentes está en la sección **ADAPTADORES**; los carga con `import()` dinámico y, si falta alguno o no exporta lo esperado, muestra un error claro (y un aviso en el menú). Estas APIs son **supuestos** del Agente D; si difieren, solo hay que ajustar esa sección:

- `net/peer.js`
  - `createHost(): Promise<Link>` con `Link.code` (código de sala, 4-6 caracteres A-Z0-9; peer id `PEER_PREFIX + code`).
  - `join(code): Promise<Link>` resuelta cuando el canal está abierto. Si falla, rechaza con `Error` (con `.type` de PeerJS, p. ej. `peer-unavailable`).
  - `Link.on(evt, cb)` con `evt` = `'open'` (en el host: el invitado se ha conectado), `'message'` (objeto ya decodificado o string JSON), `'close'`, `'error'`; `Link.send(obj)` (objeto con `type`, ver `shared/protocol.js`); `Link.close()`. Debe admitir varios listeners por evento (main.js y host/client.js escuchan el mismo Link).
- `net/host.js`: `createHostGame({ link, seed, input, config }): Game`.
- `net/client.js`: `createClientGame({ link, seed, input, config }): Game`.
  - `Game = { track, myId (0 host, 1 invitado), getState() → GameState, drainEvents() → events[], onOver(cb({winner, reason})), stop() }`. El Game se crea al recibir/enviar `start`; es quien envía/consume `input`, `snap`, `event`, `ping/pong`. `main.js` solo gestiona `hello`, `start` y `rematch`.
- `render/renderer.js`: `createRenderer(canvas)` → `{ draw(state, track, myId, events), resize?(w,h,dpr), getCameraToWorld?() }`. `main.js` fija el tamaño del canvas (DPR ≤ 2) y llama a `draw` en cada `requestAnimationFrame`.
- `input/input.js`: `createInput(canvas, getCameraToWorld)` → `{ sample(seq), destroy?() }`. `getCameraToWorld` devuelve lo que exponga `renderer.getCameraToWorld()` (o `null`).

Flujo de red gestionado por main: invitado → `hello {v,name}`; host → `start {seed, countdown}` (también tras revancha, con nueva semilla); revancha = ambos envían `rematch`, el host lanza el nuevo `start`. Si el enlace se cae durante la carrera, gana por abandono el jugador que sigue conectado.

Enlace `…/#CODE`: si la URL trae un código válido, se une automáticamente al cargar.
