# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Authentication

Every page (`/`, `/config.html`, `/overlay.html`, `/overlay-cast.html`, `/recall.html`, and all of `express.static`) sits behind a Keycloak OIDC login (`server.js`, guard registered before `express.static`). `/login`, `/callback` and `/logout` are the only unauthenticated routes. The server will not start without `SESSION_SECRET`; it starts without `KEYCLOAK_ISSUER`/`KEYCLOAK_CLIENT_ID`/`KEYCLOAK_CLIENT_SECRET` but every page then 503s at `/login` until they're set and the process is restarted (Keycloak discovery only runs once, at boot). One shared Keycloak client is used across every venue, unlike the per-venue `EOS_HOST`/`EOS_PORT` vars.

`note.userId`/`comment.userId` are the Keycloak `sub` claim (stable per account), not `socket.id` — this is what makes identity survive a page refresh or reconnect. The Socket.IO handshake is authenticated via `io.engine.use(sessionMiddleware)` + an `io.use(...)` guard that reads `socket.request.session.user`; there is no separate per-socket login.

Sessions persist across restarts in git-ignored `local-sessions.json` via the in-repo `session-store.js` (no external session service, by design).

The main page keeps a submitted note as pending until the `note-submit` ack arrives and resends every unacknowledged note on each connect; the server dedupes resends by the note's `clientId` (`public/index.js` pending-notes section).

`openid-client` is on v6, which is ESM-only and has a very different functional API from v4/v5 (`discovery()`, `buildAuthorizationUrl()`, `authorizationCodeGrant()`, etc. — no more `Issuer`/`Client` classes). `server.js` is CommonJS, so it's loaded via a dynamic `import('openid-client')` inside the async `initKeycloak()` startup function rather than `require()`. It also refuses non-HTTPS issuers by default; `initKeycloak()` passes `{ execute: [oidc.allowInsecureRequests] }` to `discovery()` automatically when `KEYCLOAK_ISSUER` starts with `http://`, since a venue-LAN Keycloak instance may not have TLS.

A note resent after an outage carries `ageMs` (recomputed per send); the server stamps `timestamp` as its clock minus that age and inserts by stamp (`public/note-order.js`), so list order is write order, not arrival order. The browser's own timecode is kept; late notes still take the server's current act and LX fallback at arrival.

## Eos OSC input

LX cue text arrives two ways, both routed through `handleOscMessage()` in `server.js`: the TCP connection to the desk (`EOS_PORT`, 3037) and the UDP OSC server (`OSC_PORT`). Port 3037 is OSC 1.1 SLIP-framed, and one TCP `data` chunk routinely holds several packets, so never parse raw chunks as strings; decode with `eos-osc.js`. Cue text is `<list>/<label> <time> [<percent>]`, and labels can contain `/` (e.g. `1/1899 B/O 3.0 100%`); during a fade Eos resends it with a falling time and rising percentage. `npm test` runs regression tests built from captured desk traffic. Set `DEBUG_EOS=1` to log every decoded TCP message.

The Eos TCP socket is owned by `connectToEOS()` in `server.js`: opened at start and by the config page's "Reconnect to Eos" button (`eos-reconnect`), never retried automatically. State (`connecting`/`connected`/`failed`/`disconnected`) goes to every client as `eos-status`; a press while `connecting` is ignored, otherwise the old socket is destroyed first so only one is ever live. `test/eos-reconnect-e2e.test.js` uses a stand-in TCP console.

## Type to start a note

`public/type-to-note.js` decides (unit-tested in `test/type-to-note.test.js`) when a keydown anywhere on `/` focuses `noteInput`; focus is what runs `startTyping`, and the browser delivers that same keystroke to the box, so don't `preventDefault` or insert the character yourself.

## Timecode sources

`globalState.timeMode` is `midi`, `network` or `realtime`. MIDI and network timecode each have their own `createMtcDecoder()` (`mtc.js`) and state (`globalState.timecode` / `globalState.networkTimecode`); every `timecode-update` carries `source`, and clients display only the source matching the mode. Network timecode is the ETC Response MIDI gateway's ACN/SDT multicast (UDP 5568, shared with sACN), parsed by `acn-midi.js`; see the README for settings. The venue switch does IGMP snooping, so nothing arrives without a group join, and on Wi-Fi every packet arrived twice (hence the SDT sequence filter). `npm test` covers it with packets captured from the gateway.

The MIDI input and multicast interface are chosen on `/config.html` and saved to git-ignored `local-settings.json`, which beats `GATEWAY_IFACE` (env vars are only first-run defaults). With neither set, `net-iface.js` picks the interface on the gateway's subnet. `config.html` sockets are left out of the online users list (`listedUsers()`) but can still change settings, unlike overlays.

## Chat restore

Chat lives only in `globalState.chatMessages`, with no length cap; the hard ceilings are the browser's ~5 MB localStorage and the socket's `maxHttpBufferSize` (16 MB, `server.js`), and `public/chat-copy.js` cuts to the most recent messages when either is hit. New messages go out alone as `chat-message-added`; the full list (`chat-messages-update`) is only sent on connect and after a restore.

After a restart clients offer their copy (`chat-restore-offer`). `chat-restore.js` restores the fullest log that two distinct users vouch for (a log vouches for another that contains all its messages, same id and content), merging it into the messages already on the server by timestamp and id, so messages sent after the restart don't block it and a later, larger agreed log still adds to it. The window opens at start and closes `CHAT_RESTORE_WINDOW_MS` later (default 30 min); the server tells clients via `chat-restore-status` (sent before the log on connect). While it is open a browser only grows its copy; once closed it adopts the server's log.

The copy is kept in `localStorage` (2 h expiry), not page memory, so it survives reloads and `/login` bounces while the server is down. `test/chat-restore-e2e.test.js` runs the real `server.js` against a stub OIDC provider (`SESSIONS_FILE` overrides the session file) with logged-in users through restarts, reloads and a lost session.

## Notes backup, restore and reset

Notes live only in `globalState.notes`; `server.js` `backup()` writes them (with tags) to `backups/` every minute and on crash/SIGINT/SIGTERM, through a temp file and rename (`notes-backup.js`). On start `restoreNotes()` loads the newest backup under 2 hours old that passes `checkBackup()`, falling back to older ones; `backup()` refuses to run until that has happened so an empty server cannot outrank a good backup. Age and order come from the timestamp in the file name, not mtime. Restored tags stay in memory only (`tags.json` is a tracked file). The "Reset all notes and chat" button on `/config.html` sends `reset-all` (same non-overlay rule as the other settings); `resetNotesAndChat()` clears both, closes the chat restore window, tells browsers (`all-reset`: drop chat copy and unsent notes) and writes a backup at once so a restart stays empty. Tags are kept. `BACKUPS_DIR` and `BACKUP_INTERVAL_MS` exist for the tests (`test/e2e-harness.js` is shared by the e2e tests).

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
