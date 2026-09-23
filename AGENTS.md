# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Authentication

Every page (`/`, `/overlay.html`, `/overlay-cast.html`, `/recall.html`, and all of `express.static`) sits behind a Keycloak OIDC login (`server.js`, guard registered before `express.static`). `/login`, `/callback` and `/logout` are the only unauthenticated routes. The server will not start without `SESSION_SECRET`; it starts without `KEYCLOAK_ISSUER`/`KEYCLOAK_CLIENT_ID`/`KEYCLOAK_CLIENT_SECRET` but every page then 503s at `/login` until they're set and the process is restarted (Keycloak discovery only runs once, at boot). One shared Keycloak client is used across every venue, unlike the per-venue `EOS_HOST`/`EOS_PORT` vars.

`note.userId`/`comment.userId` are the Keycloak `sub` claim (stable per account), not `socket.id` — this is what makes identity survive a page refresh or reconnect. The Socket.IO handshake is authenticated via `io.engine.use(sessionMiddleware)` + an `io.use(...)` guard that reads `socket.request.session.user`; there is no separate per-socket login.

`openid-client` is on v6, which is ESM-only and has a very different functional API from v4/v5 (`discovery()`, `buildAuthorizationUrl()`, `authorizationCodeGrant()`, etc. — no more `Issuer`/`Client` classes). `server.js` is CommonJS, so it's loaded via a dynamic `import('openid-client')` inside the async `initKeycloak()` startup function rather than `require()`. It also refuses non-HTTPS issuers by default; `initKeycloak()` passes `{ execute: [oidc.allowInsecureRequests] }` to `discovery()` automatically when `KEYCLOAK_ISSUER` starts with `http://`, since a venue-LAN Keycloak instance may not have TLS.

## Eos OSC input

LX cue text arrives two ways, both routed through `handleOscMessage()` in `server.js`: the TCP connection to the desk (`EOS_PORT`, 3037) and the UDP OSC server (`OSC_PORT`). Port 3037 is OSC 1.1 SLIP-framed, and one TCP `data` chunk routinely holds several packets, so never parse raw chunks as strings; decode with `eos-osc.js`. Cue text is `<list>/<label> <time> [<percent>]`, and labels can contain `/` (e.g. `1/1899 B/O 3.0 100%`); during a fade Eos resends it with a falling time and rising percentage. `npm test` runs regression tests built from captured desk traffic. Set `DEBUG_EOS=1` to log every decoded TCP message.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
