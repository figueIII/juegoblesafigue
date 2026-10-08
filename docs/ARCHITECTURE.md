# Arquitectura – Carrera 1v1 P2P (GitHub Pages)

## Decisiones cerradas
| Tema | Decisión |
|---|---|
| Red | PeerJS/WebRTC, **host autoritativo**. Host simula; invitado envía inputs y predice su coche |
| Stack | Canvas 2D puro + JS ES modules, **sin build**. PeerJS por CDN (versión fijada) |
| Pista | Procedural por `seed` (mulberry32) compartida en el handshake |
| Sabotajes | Misil, mancha de aceite, EMP. Se consiguen con pickups; apuntado con ratón |
| Arte | Cenital, vectorial, neón, sin assets externos |
| Victoria | Primero en cruzar meta (sin límite de tiempo); HP 0 = derrota, ambos a 0 = empate |

## Estructura
```
index.html
src/
  main.js            # arranque, máquina de estados (LOBBY→COUNTDOWN→RACE→RESULT)
  config.js          # TODAS las constantes de balance (única fuente)
  shared/            # código usado por host Y cliente (puro, sin DOM)
    rng.js           # mulberry32(seed)
    track.js         # generateTrack(seed) → {segments, obstacles, pickups, finishY}
    physics.js       # step(state, inputs, dt) – coches, SAT, daño, proyectiles
    protocol.js      # tipos de mensaje + (de)serialización
  net/
    peer.js          # wrapper PeerJS: host(), join(code), send/on, ping
    host.js          # bucle autoritativo 60 Hz, snapshots 30 Hz
    client.js        # input 60 Hz, predicción, reconciliación, interpolación del rival
  render/
    renderer.js      # cámara que sigue al propio coche, pista, coches, efectos, HUD
    particles.js
  input/input.js     # WASD/flechas + ratón (coords mundo, clic = disparo)
  ui/lobby.js        # crear sala, copiar enlace `#CODE`, unirse, estados de conexión
tests/               # node --test sobre shared/ (determinismo, colisiones)
```

## Modelo de juego
- Mundo vertical, la meta está en `y = finishY` (≈ 55 s a velocidad media). Eje Y negativo = avance.
- Coche: posición, ángulo, velocidad, HP (100), cooldown, ranura de sabotaje (1 slot).
- Colisión coche-coche: rectángulos orientados, SAT + impulso con masa igual y restitución `config.CAR_BOUNCE`; daño proporcional al impulso normal.
- Obstáculos y bordes de pista: daño + rebote. Fuera de pista (hierba) = fricción alta.
- Sabotajes (config): **Misil** (proyectil recto, empuje + daño), **Aceite** (charco ~4 s, pierde agarre), **EMP** (1.5 s controles invertidos al rival, alcance con ratón).
- Muerte súbita: HP 0 → derrota inmediata.

## Protocolo (JSON compacto sobre DataChannel fiable+ordenado; snapshots en canal no fiable si PeerJS `reliable:false`)
- `hello {v, name}` / `start {seed, t0}` (host→guest)
- `input {seq, throttle, steer, brake, aim:[x,y], fire}` (guest→host, 60 Hz)
- `snap {tick, ackSeq, cars:[…], proj:[…], hazards:[…], pickups:[…], hp}` (host→guest, 30 Hz)
- `event {kind, …}` (impacto, disparo, fin de carrera) – fiable
- `ping/pong` para RTT. Timeout de 5 s sin paquetes → derrota por desconexión.

## Cliente
- Predicción solo del coche propio con `physics.step`; reconciliar con `ackSeq`; suavizado de error < 1 frame de corrección visual.
- Rival: interpolación con ~100 ms de buffer.
- Host juega sin latencia; es la ventaja asumida del modelo.

## Conectividad / despliegue
- Sala: el host muestra `https://<user>.github.io/<repo>/#<code>`; abrir el enlace une automáticamente. Peer id = `jbf-<code>` (4–6 chars).
- ICE: STUN públicos (Google) + **TURN público de respaldo configurable** en `config.js` (≈10–15 % de NAT estrictos fallan sin TURN). Se documenta en README.
- Pages: workflow `.github/workflows/pages.yml` (Source: GitHub Actions), rutas **relativas**, `.nojekyll`. PeerJS 1.5.4 con SRI y copia local de respaldo en `vendor/`.

## Agentes y contratos (orden de ejecución)
**Fase 0 – Arquitecto (hecho):** este documento + `config.js` + firmas de `shared/protocol.js`.

**Fase 1 – en paralelo** (cada agente solo toca su carpeta):
1. **A. Física/Pista** `shared/*` + `tests/` — determinismo por semilla, SAT, daño, sabotajes. Entrega: `step()` y `generateTrack()` testeados con `node --test`.
2. **B. Red P2P** `net/*` — handshake, host loop, snapshots, ping/timeouts. Debe funcionar con un `physics` stub.
3. **C. Render/Input** `render/*`, `input/*` — dibujo desde un `state` mock; cámara, HUD (HP, slot, temporizador, posición), efectos.
4. **D. UI/Lobby** `ui/*`, `index.html`, `main.js` — máquina de estados, enlaces `#CODE`, pantalla de resultados y revancha.

**Fase 2 – Integración (Agente E):** cableado, predicción/reconciliación, pruebas con dos pestañas y latencia simulada (`Network conditions` de Chrome / Playwright).

**Fase 3 – QA y balance (Agente F):** tests e2e con Playwright (2 contextos), ajuste de `config.js`, README con instrucciones de despliegue y nota TURN.

## Riesgos
1. NAT estricto sin TURN → mensaje de error claro + reintento.
2. Broker público de PeerJS (0.peerjs.com) puede caer → permitir `peerjs` host propio configurable.
3. Desincronía visual en choques → el host es la verdad; el cliente solo corrige.
4. Pestaña en segundo plano ralentiza `requestAnimationFrame` → el host usa `setInterval` + delta acumulado y avisa si pierde foco.
