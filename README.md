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

## Arranque (`src/main.js`)
`main.js` implementa la máquina de estados `LOBBY → COUNTDOWN → RACE → RESULT`. La sección **ADAPTADORES** carga con `import()` dinámico `net/peer.js` (`createHost()`, `join(code)`), `net/host.js` (`createHostSession({link})`), `net/client.js` (`createClient({link,name})`), `render/renderer.js` (`createRenderer(canvas)`: `draw`, `getCameraToWorld`, `resetCamera`) e `input/input.js` (`createInput(canvas, getCameraToWorld)`: `sample`). El host gestiona internamente el handshake `hello/start` y la revancha; `main.js` solo reacciona a `onStart`, `onEvent` (`over`), `onRematch` y `onDisconnect`. Si el enlace se cae durante la carrera, gana por abandono el jugador que sigue conectado.

Enlace `…/#CODE`: si la URL trae un código válido, se une automáticamente al cargar.
