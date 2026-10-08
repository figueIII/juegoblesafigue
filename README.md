# Neon Rivals (juegoblesafigue)

Carrera 1v1 cenital con sabotajes (misil, aceite, EMP), directa entre navegadores (WebRTC con PeerJS, sin servidor propio). Canvas 2D + ES modules, sin build.

## Cómo jugar
1. Un jugador pulsa **Crear sala** y copia el enlace `https://<usuario>.github.io/<repo>/#CODE` (botón *Copiar*).
2. El rival abre el enlace (se une solo) o entra en el menú, escribe el código y pulsa **Unirse**.
3. Cuenta atrás de 3 s y a correr. Gana quien cruza la meta primero; no hay límite de tiempo. Con 0 de HP pierdes (si los dos caen a la vez, empate). Si te quedas muy atrás, el juego te ayuda a remontar (ver Balance).
4. Recoge los pickups para obtener un sabotaje (1 hueco) y úsalo contra el rival. Al terminar: **Revancha** (los dos deben aceptar) o **Volver al menú**.

## Controles
| Acción | Tecla |
|---|---|
| Acelerar / frenar | `W` `S` o flechas arriba/abajo |
| Girar | `A` `D` o flechas izquierda/derecha |
| Apuntar | Ratón |
| Disparar sabotaje | Clic |

## Desarrollo local y tests
Los módulos ES requieren servidor HTTP (no `file://`):
```
python3 -m http.server 8080   # y abrir http://localhost:8080
```
- `npm test`: física, red (con latencia simulada, `createLinkPair({latencyMs, jitterMs, lossRate})`; jitter y pérdida solo afectan al canal no fiable) y balance con bots. No necesita dependencias.
- `npm run balance`: resumen de balance por consola (`tools/botsim.js`).
- `npm run test:e2e`: navegador real (Playwright + Chromium) con PeerJS falso; ver `tests/e2e/README.md`. Playwright **no** es dependencia del proyecto.

## Balance (`src/config.js`)
Ajustado con simulaciones de bots simples (`tools/botsim.js`, comprobadas en `tests/balance.test.js`).

| Parámetro | Valor | Efecto |
|---|---|---|
| `TRACK.LENGTH` | 32000 px | Sin límite de tiempo (la pista siempre termina en `finishY`); un bot competente tarda ~50-57 s y la carrera dura de media ~52-57 s |
| `CAR.MAX_HP` | 100 | |
| `CAR.COLLISION_DAMAGE` | 0.02 | Empujón fuerte coche-coche: 5-6 HP a cada uno |
| `CAR.OBSTACLE_DAMAGE` | 0.015 | Obstáculo de frente a máxima velocidad: ~9 HP (antes 0.03: un bot mediano moría el 50 % de las veces) |
| `CAR.WALL_DAMAGE` | 0.015 | Rozar el muro casi no daña |
| `SABOTAGE.MISSILE` | 18 HP + empuje 380 | Unos 5-6 misiles para matar: nunca es letal por sí solo |
| `SABOTAGE.OIL` | radio 60, 4 s, agarre 15 % | |
| `SABOTAGE.EMP` | alcance 700, 1.5 s invertido | |
| `TRACK.PICKUP_EVERY` | 1500 px | ~21 pickups por carrera |
| `CATCHUP.START` / `FULL` / `MAX_BONUS` | 600 / 1800 px / +12 % | Rubber-band: el rezagado gana velocidad máx. y aceleración proporcional a la distancia (0 a 600 px, tope a 1800). El líder no se frena (`LEADER_PENALTY` 0) |
| `CATCHUP.PICKUP_BIAS_GAP` + `PICKUP_WEIGHTS` | 300 px | Con más de 300 px de diferencia, el pickup del rezagado es misil 60 % / aceite 20 % / EMP 20 %; el del líder 15 / 45 / 40 %. Parejo: uniforme. Determinista (según el id del pickup y las posiciones) |
| `CATCHUP.TURBO_GAP` / `TURBO_COOLDOWN` | 1500 px / 7 s | «¡Turbo remontada!» (indicador en el HUD): el rezagado recibe un misil automático si tiene la ranura vacía, como mucho cada 7 s |

Remontada (`comebackStats` en `tools/botsim.js`; coche 0 sale con ventaja inicial, bots idénticos de habilidad 0,95, 80 carreras): con 1000 px el líder gana ~71 %, con 1500 px ~65 % (el rezagado remonta ~35 %), con 2000 px ~75 %. `npm run balance` lo imprime y `tests/balance.test.js` exige 55-82 % para el líder a 1500 px.

Resultado en simulación (60 carreras con bots de habilidad 0,95): el bot que usa sabotajes gana ~68 % frente a otro idéntico que no los usa (útiles, no decisivos); las muertes por impactos son una minoría y tardan más de 30 s.

## Fluidez de red
Snapshots a 30 Hz (`SNAPSHOT_HZ`) con decimales recortados (menor tamaño). El rival se interpola con retardo `INTERP_DELAY_MS` (110 ms) + 2×jitter medido (hasta `INTERP_MAX_DELAY_MS`), con reloj monótono que corrige con pendiente limitada y extrapolación corta (≤200 ms) si falta un snapshot. El coche propio se predice y la corrección del host se reparte con decaimiento exponencial (solo hay teletransporte con error >220 px).

## Despliegue en GitHub Pages (Actions)
El repositorio incluye `.github/workflows/pages.yml` (push a `main` o ejecución manual: `npm test` y publicación del sitio con `upload-pages-artifact` + `deploy-pages`). Pasos exactos:
1. Sube el repo a GitHub y haz merge/push a la rama `main`.
2. En GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Ve a la pestaña **Actions**, comprueba que *Deploy to GitHub Pages* termina en verde (si ya hiciste el push antes de activar Pages, lánzalo con **Run workflow**).
4. La URL aparece en el job *deploy* y en Settings → Pages: `https://<usuario>.github.io/juegoblesafigue/`.

Todas las rutas son relativas y hay un `.nojekyll`, así que funciona bajo la subruta `/juegoblesafigue/`. PeerJS se carga de `unpkg.com` con versión fija (1.5.4) y SRI; si el CDN falla o el hash no coincide, se usa la copia local `vendor/peerjs.min.js`. Si tampoco carga, la UI muestra un error explícito sobre PeerJS (bloqueadores, red). No hay build.

## Jugar con un amigo
1. Abre la URL pública, pulsa **Crear sala** y envía el enlace (`…/juegoblesafigue/#CODE`) por chat, o dicta el código de 5 caracteres.
2. Tu amigo abre el enlace (se une solo) o escribe el código en **Unirse**. La sala admite solo 2 jugadores: un tercero verá «La sala ya está llena».
3. Quien crea la sala es el anfitrión: mantén esa pestaña visible (si pasa a segundo plano el navegador ralentiza la simulación). Si el anfitrión cierra la sala antes de que alguien entre, el enlace muestra «No existe ninguna sala…».
4. En móvil aparecen botones ◀ ▶ (girar) y ▲ ▼ (acelerar/frenar); tocar la pantalla apunta y dispara. Con `?touch=1` se fuerzan en cualquier dispositivo.

## Conectividad y TURN (`CONFIG.ICE_SERVERS`)

> Si dos ordenadores en redes distintas no conectan, abre `diag.html` (p. ej. `…/juegoblesafigue/diag.html`) en ambos: lista qué STUN/TURN responden desde cada red.

> Nota: los TURN públicos gratuitos antiguos (PeerJS, Open Relay) ya no existen. Crea una cuenta gratuita en Metered (metered.ca) u otro proveedor TURN, copia usuario, clave y host en el ejemplo comentado de `CONFIG.ICE_SERVERS` y vuelve a lanzar `diag.html` para comprobar que aparece un candidato `relay`.
Por defecto se usan STUN públicos de Google, que bastan en la mayoría de redes. Con NAT simétrico, wifi corporativo o algunas redes 4G (~10-15 % de casos) la conexión directa falla y la UI muestra un aviso de NAT/TURN. Solución: añadir un servidor TURN en `src/config.js`:
```js
ICE_SERVERS: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'turn:turn.ejemplo.com:3478', username: 'usuario', credential: 'clave' },
],
```
En `src/config.js` el bloque completo queda así (sustituye host y credenciales por los de tu proveedor, p. ej. un TURN de pago por uso o uno propio con coturn; añade también la variante `turns:` en el puerto 443 para redes que solo dejan salir HTTPS):
```js
ICE_SERVERS: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: ['turn:turn.ejemplo.com:3478?transport=udp', 'turn:turn.ejemplo.com:3478?transport=tcp', 'turns:turn.ejemplo.com:443?transport=tcp'], username: 'usuario', credential: 'clave' },
],
```
Atención: las credenciales de un TURN en un sitio estático son públicas; usa un servicio con cuota gratuita y credenciales desechables. Si el broker público de PeerJS (0.peerjs.com) cae, puedes apuntar a uno propio con `CONFIG.PEER_OPTIONS = { host, port, path }`.

## Arranque (`src/main.js`)
`main.js` implementa la máquina de estados `LOBBY → COUNTDOWN → RACE → RESULT`. La sección **ADAPTADORES** carga con `import()` dinámico `net/peer.js` (`createHost()`, `join(code)`), `net/host.js` (`createHostSession({link})`), `net/client.js` (`createClient({link,name})`), `render/renderer.js` (`createRenderer(canvas)`: `draw`, `getCameraToWorld`, `resetCamera`) e `input/input.js` (`createInput(canvas, getCameraToWorld)`: `sample`). El host gestiona internamente el handshake `hello/start` y la revancha; `main.js` solo reacciona a `onStart`, `onEvent` (`over`), `onRematch` y `onDisconnect`. Si el enlace se cae durante la carrera, gana por abandono el jugador que sigue conectado.

Enlace `…/#CODE`: si la URL trae un código válido, se une automáticamente al cargar.
