# Tests e2e (Playwright, opcional)

Dos pestañas del mismo contexto de Chromium hablan por un **PeerJS falso** (`fakepeer.js`, sobre `BroadcastChannel`, con latencia opcional), así que no hace falta Internet ni WebRTC. El sitio se sirve bajo la subruta `/juegoblesafigue/` como en GitHub Pages, y `src/config.js` se reescribe al vuelo (meta cercana, carrera corta, sin obstáculos) para que cada escenario dure segundos.

```
npm run test:e2e              # todos
node tests/e2e/run.mjs meta latencia   # algunos
```
Requiere `playwright` resoluble (global o `PW_NODE_MODULES=/ruta/node_modules`) y Chromium ya instalado; si `launch()` falla se usa `PW_CHROMIUM` o `/opt/pw-browsers/chromium`. No se añade como dependencia ni se ejecuta en `npm test`. Capturas en `tests/e2e/out/` (ignorado por git).

Escenarios: `sabotajes` (pickup, misil/aceite/EMP de ambos jugadores con ratón real), `meta`, `tiempo`, `sala_llena`, `host_cierra_sala`, `desconexion`, `latencia` (120 ms por sentido), `movil` (390x844, botones táctiles), `peerjs_no_carga`. La meta/tiempo también comprueban que el panel de resultados no pisa el cartel del canvas y la revancha.

Nota: `window.__game` (solo lectura) lo expone `src/main.js` para que los tests lean el estado del host.
