const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const net = require('net');
const dgram = require('dgram');
const session = require('express-session');
const { Server, Message, encode } = require('node-osc');
const { createSlipDecoder, decodeOscPacket, extractCueLabel } = require('./eos-osc');
const { extractMidi, wrapperSequence, createSequenceFilter, senderCid } = require('./acn-midi');
const { createMtcDecoder } = require('./mtc');
const { listIpv4Interfaces, resolveInterface } = require('./net-iface');
const { createGatewayLock } = require('./gateway-lock');
const { loadSettings, saveSettings } = require('./settings');
const { FileSessionStore } = require('./session-store');
const { authorsOf, applyAuthors, backupFilename, backupTime, checkBackup, findRestorableBackup, writeBackupFile } = require('./notes-backup');
const savedShows = require('./saved-shows');
const resetNotes = require('./reset-notes');
const RESETS_DIR = process.env.RESETS_DIR || path.join(__dirname, 'reset-notes');
const RESET_KEEP_MS = Number(process.env.RESET_KEEP_MS) || resetNotes.KEEP_MS;
const SAVED_SHOWS_DIR = process.env.SAVED_SHOWS_DIR || path.join(__dirname, 'saved-shows');
const PLAYBACK_DEMO = process.env.PLAYBACK_DEMO === '1';
const recordings = require('./recordings');
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || path.join(__dirname, 'recordings');
// One uploaded part at most; a full dress from Vor is a few GB.
const RECORDING_MAX_BYTES = Number(process.env.RECORDING_MAX_BYTES) || 32 * 1024 ** 3;
const { sanitizeAge, insertionIndex } = require('./public/note-order');
const { canEditNote } = require('./public/note-author');
const input = require('./note-input');
const showLog = require('./show-log');
const crypto = require('crypto');
const helmet = require('helmet');
const { createChatRestore, boundChatMessage, mergeChatLogs, DEFAULT_WINDOW_MS } = require('./chat-restore');

const app = express();
const server = http.createServer(app);
// Node ends any request after 5 minutes; a video upload over venue Wi-Fi can take far longer.
server.requestTimeout = 6 * 60 * 60 * 1000;
// A restarted server is offered chat copies of up to ~5 MB (the browser's
// localStorage quota), well above the 1 MB default for one incoming message.
// A socket is only accepted from this app's own pages: a browser sends its
// page's Origin on the handshake, and one from another site is refused (on top
// of the SameSite=Lax login cookie, which such a handshake does not carry).
// Clients that send no Origin (scripts, the tests) are not browsers on another site.
function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    try {
        return new URL(origin).host === host;
    } catch (error) {
        return false;
    }
}
const io = socketIo(server, {
    maxHttpBufferSize: 16e6,
    allowRequest: (req, callback) => callback(null, sameOrigin(req))
});

const eosHost = process.env.EOS_HOST || '10.10.160.143';
const eosPort = process.env.EOS_PORT || 3037;
const oscPort = process.env.OSC_PORT || 8001;

// Network timecode from the ETC Response MIDI gateway (ACN/SDT multicast).
// The group address is chosen by the gateway; 239.194.242.66 has held across
// gateway and Eos restarts, but it stays configurable.
const gatewayGroup = process.env.GATEWAY_MCAST || '239.194.242.66';
const gatewayIp = process.env.GATEWAY_IP || null; // optional source filter
const ACN_PORT = 5568;
const NETWORK_STOP_MS = 250; // the gateway sends no stop message; quarter-frames just cease
const NETWORK_RETRY_MS = 5000; // the venue interface may not be up yet when the service starts
// Automatic interface mode: silence after which the locked gateway counts as
// gone and the group is joined on every interface again. The gateway sends
// keepalives even with no timecode running, so this only trips when it's gone.
const NETWORK_LOST_MS = 10000;

// MIDI input and network interface chosen on the config page. Env vars
// (GATEWAY_IFACE) are only the defaults until something is saved here.
const SETTINGS_FILE = path.join(__dirname, 'local-settings.json');
const settings = loadSettings(SETTINGS_FILE);
if (settings.networkInterface === undefined) {
    settings.networkInterface = process.env.GATEWAY_IFACE || 'auto';
}

function persistSettings() {
    try {
        saveSettings(SETTINGS_FILE, settings);
    } catch (error) {
        console.log(`Settings: could not save ${SETTINGS_FILE}: ${error.message}`);
    }
}

// Keycloak SSO configuration - one shared client used across every venue,
// unlike EOS_HOST/EOS_PORT above which are per-venue.
const SESSION_SECRET = process.env.SESSION_SECRET;
const KEYCLOAK_ISSUER = process.env.KEYCLOAK_ISSUER;
const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID;
const KEYCLOAK_CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET;

if (!SESSION_SECRET) {
    console.error('SESSION_SECRET environment variable is required to start the server.');
    process.exit(1);
}

app.set('trust proxy', true);
io.engine.trustProxy = true;

const PORT = process.env.PORT || 80;

// Session cookie is signed by this app. The venue LAN serves this app over
// plain HTTP, and the goal is to minimize dependence on anything outside the
// venue LAN (see captain's decision), so the cookie is only marked Secure when
// the request itself came over HTTPS.
// Sessions are kept in git-ignored local-sessions.json so logins survive a
// server restart.
// The login lasts SESSION_IDLE_MS since the browser last talked to the server
// (rolling), not since login: open pages keep it alive (see /session), so a
// long tech day does not log everyone out mid-show.
// Cookies are shared by every port on a host, so the default name carries the
// port: two instances (or another Express app's connect.sid) on one machine
// would otherwise overwrite each other's login.
const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
const sessionStore = new FileSessionStore({ file: process.env.SESSIONS_FILE || path.join(__dirname, 'local-sessions.json') });
const sessionMiddleware = session({
    name: process.env.SESSION_COOKIE_NAME || `bts-notes.sid.${PORT}`,
    store: sessionStore,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
        secure: 'auto', // only when the request came over HTTPS (directly or via a trusted proxy)
        httpOnly: true,
        sameSite: 'lax',
        maxAge: SESSION_IDLE_MS
    }
});
app.disable('x-powered-by');

function originOf(url) {
    try {
        return url ? [new URL(url).origin] : [];
    } catch (error) {
        return [];
    }
}

// Security headers. The Content-Security-Policy only lets the pages run
// scripts served from this app (no inline scripts or event handlers, which is
// what an injected note would need), so keep all JavaScript in .js files.
// Inline style attributes are still allowed: the templates use them, and tag
// colours are checked before they go into one (public/safe-html.js).
// The app is served over plain HTTP on the venue LAN, so nothing may push
// browsers to HTTPS: no HSTS and no upgrade-insecure-requests.
// form-action also lists Keycloak, where /logout redirects the logout form.
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            'script-src': ["'self'"],
            'style-src': ["'self'", "'unsafe-inline'"],
            'img-src': ["'self'", 'data:'],
            'connect-src': ["'self'"],
            // playback.html plays uploaded videos, or one opened locally through a blob: URL.
            'media-src': ["'self'", 'blob:'],
            'form-action': ["'self'", ...originOf(KEYCLOAK_ISSUER)],
            'upgrade-insecure-requests': null
        }
    },
    strictTransportSecurity: false
}));

app.use(sessionMiddleware);

// openid-client v6 is ESM-only; loaded once via dynamic import at startup.
let oidc = null;
let oidcConfig = null;

async function initKeycloak() {
    if (!KEYCLOAK_ISSUER || !KEYCLOAK_CLIENT_ID || !KEYCLOAK_CLIENT_SECRET) {
        console.error('Keycloak SSO is not configured: set KEYCLOAK_ISSUER, KEYCLOAK_CLIENT_ID and KEYCLOAK_CLIENT_SECRET. Login will be unavailable until this is set and the server is restarted.');
        return;
    }
    try {
        oidc = await import('openid-client');
        const issuerUrl = new URL(KEYCLOAK_ISSUER);
        // openid-client refuses non-HTTPS issuers by default. Keycloak on a
        // venue LAN may only be reachable over plain HTTP, matching the same
        // "minimize dependence outside the LAN" tradeoff as the app's own
        // cookie - so allow it when (and only when) the issuer URL is HTTP.
        const discoveryOptions = issuerUrl.protocol === 'http:'
            ? { execute: [oidc.allowInsecureRequests] }
            : undefined;
        oidcConfig = await oidc.discovery(
            issuerUrl,
            KEYCLOAK_CLIENT_ID,
            KEYCLOAK_CLIENT_SECRET,
            undefined,
            discoveryOptions
        );
        console.log('Keycloak SSO ready (issuer: %s)', KEYCLOAK_ISSUER);
    } catch (error) {
        oidcConfig = null;
        console.error('Failed to reach Keycloak issuer for SSO discovery:', error.message);
        console.error('Login will be unavailable until the issuer is reachable and the server is restarted.');
    }
}

function currentUrlFor(req) {
    return new URL(req.originalUrl, `${req.protocol}://${req.get('host')}`);
}

function isLoggedIn(req) {
    return !!(req.session && req.session.user && req.session.user.sub);
}

// Only a path on this site may be returned to after login (no open redirect).
function safeReturnTo(value) {
    return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')
        ? value
        : '/';
}

// Logins in progress, keyed by their OAuth state. Kept here rather than in the
// session: the session is saved whole, last write wins, so two tabs bounced to
// /login at once (or a stale request finishing after /callback) used to
// overwrite each other's login, failing it or dropping the user who had just
// logged in. Lost on restart, which only means that login starts again.
const LOGIN_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_LOGINS = 1000;
const pendingLogins = new Map(); // state -> { codeVerifier, returnTo, browserKey, createdAt }

// Each login is also tied to the browser that started it, by a cookie named
// for its state (one per login, so parallel tabs don't overwrite each other).
// Without it, someone could start a login, sign in as themselves and hand
// their /callback URL to someone else, whose browser would then be signed in
// as them, and what they wrote would be stored under the wrong name.
const loginCookieName = (state) => `bts-notes.login.${PORT}.${state}`;
function loginCookieOf(req, state) {
    const prefix = `${loginCookieName(state)}=`;
    const found = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(prefix));
    return found ? found.slice(prefix.length) : '';
}

function prunePendingLogins(now = Date.now()) {
    for (const [state, pending] of pendingLogins) {
        if (now - pending.createdAt > LOGIN_TTL_MS || pendingLogins.size > MAX_PENDING_LOGINS) {
            pendingLogins.delete(state); // oldest first: a Map keeps insertion order
        } else {
            break;
        }
    }
}

// Authorization Code + PKCE redirect to Keycloak.
app.get('/login', async (req, res, next) => {
    try {
        const returnTo = safeReturnTo(req.query.returnTo);
        if (isLoggedIn(req)) return res.redirect(returnTo);
        if (!oidcConfig) {
            return res.status(503).send('Keycloak SSO is not configured or unreachable. Set KEYCLOAK_ISSUER, KEYCLOAK_CLIENT_ID, KEYCLOAK_CLIENT_SECRET and SESSION_SECRET, then restart the server.');
        }
        const codeVerifier = oidc.randomPKCECodeVerifier();
        const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
        const state = oidc.randomState();
        prunePendingLogins();
        const browserKey = crypto.randomBytes(18).toString('base64url');
        pendingLogins.set(state, { codeVerifier, returnTo, browserKey, createdAt: Date.now() });
        res.cookie(loginCookieName(state), browserKey, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/callback', maxAge: LOGIN_TTL_MS });
        const redirectUri = `${req.protocol}://${req.get('host')}/callback`;
        const authUrl = oidc.buildAuthorizationUrl(oidcConfig, {
            redirect_uri: redirectUri,
            scope: 'openid profile email',
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
            state
        });
        res.redirect(authUrl.href);
    } catch (error) {
        next(error);
    }
});

// Exchanges the authorization code, populates req.session.user from the
// Keycloak claims (sub is the stable per-account identifier we key notes on).
app.get('/callback', async (req, res) => {
    if (!oidcConfig) {
        return res.status(503).send('Keycloak SSO is not configured or unreachable.');
    }
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const pending = pendingLogins.get(state);
    if (!pending || Date.now() - pending.createdAt > LOGIN_TTL_MS || loginCookieOf(req, state) !== pending.browserKey) {
        pendingLogins.delete(state);
        // A reused or expired callback URL (back button, server restart mid-login),
        // or one from a login started in another browser.
        return res.redirect(isLoggedIn(req) ? '/' : '/login');
    }
    pendingLogins.delete(state); // single use
    res.clearCookie(loginCookieName(state), { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/callback' });
    try {
        const tokens = await oidc.authorizationCodeGrant(oidcConfig, currentUrlFor(req), {
            pkceCodeVerifier: pending.codeVerifier,
            expectedState: state
        });
        const claims = tokens.claims();
        if (!claims || !claims.sub) {
            throw new Error('Keycloak did not return identity claims');
        }
        // A fresh session id on login (no session fixation), saved before the
        // redirect so the next page load already sees the user.
        await new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
        req.session.user = {
            sub: claims.sub,
            name: claims.name || claims.preferred_username || claims.email || claims.sub,
            email: claims.email || null,
            idToken: tokens.id_token || null
        };
        await new Promise((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())));
        res.redirect(pending.returnTo);
    } catch (error) {
        console.error('Keycloak callback failed:', error.message);
        res.status(401).send('Login failed. <a href="/login">Try again</a>.');
    }
});

// Where a logout ends up (straight from /logout, or back from Keycloak's
// end-session page, so its URL must be one of the Keycloak client's "Valid post
// logout redirect URIs"), and where a page goes when its login was logged out
// elsewhere. Without it a logout went on to /login, and Keycloak (whose own
// login can outlive ours) could sign the person straight back in.
// `returnTo` is the page "Log in again" goes back to.
const loggedOutPage = fs.readFileSync(path.join(__dirname, 'views', 'logged-out.html'), 'utf8');
app.get('/logged-out', (req, res) => {
    const returnTo = safeReturnTo(req.query.returnTo);
    if (isLoggedIn(req)) return res.redirect(returnTo);
    const loginUrl = returnTo === '/' ? '/login' : `/login?returnTo=${encodeURIComponent(returnTo)}`;
    res.set('Cache-Control', 'no-store');
    res.type('html').send(loggedOutPage.replace('{{loginUrl}}', loginUrl));
});
// The page's stylesheet and icon, the only files served without a login.
for (const file of ['base.css', 'favicon.ico']) {
    app.get(`/${file}`, (req, res) => res.sendFile(path.join(__dirname, 'public', file)));
}

// Destroys the local session and redirects to Keycloak's end-session endpoint.
// POST only (the pages use a form), so a link or image on another site cannot
// log anyone out; the SameSite=Lax cookie is not sent on a cross-site POST.
app.get('/logout', (req, res) => res.redirect('/'));
app.post('/logout', (req, res) => {
    const idToken = req.session && req.session.user && req.session.user.idToken;
    const finish = () => {
        if (oidcConfig) {
            try {
                const endSessionUrl = oidc.buildEndSessionUrl(oidcConfig, {
                    post_logout_redirect_uri: `${req.protocol}://${req.get('host')}/logged-out`,
                    ...(idToken ? { id_token_hint: idToken } : {})
                });
                return res.redirect(endSessionUrl.href);
            } catch (error) {
                // Issuer has no end_session_endpoint configured - only our login ends.
            }
        }
        res.redirect('/logged-out');
    };
    if (!req.session) return finish();
    // Pages of this login still open on a socket are logged out too (they
    // were authenticated at their handshake) and go to /logged-out.
    for (const socket of io.sockets.sockets.values()) {
        if (socket.request.sessionID !== req.sessionID) continue;
        socket.emit('logged-out');
        socket.disconnect(true);
    }
    req.session.destroy(finish);
});

// Auth guard - no page is exempt, including static assets, overlay/cast
// pages and the recall/backup-viewer page. /login, /callback, /logout and
// /logged-out (with base.css and the favicon) above are registered before
// this and stay reachable without a session.
// It never writes the session: a page navigation is sent to /login with the
// page to come back to in the URL, and anything else (scripts, fetches) just
// gets a 401, so a stray asset request cannot become the post-login page.
function requireAuth(req, res, next) {
    if (isLoggedIn(req)) {
        return next();
    }
    if (req.method === 'GET' && req.accepts(['json', 'html']) === 'html') {
        return res.redirect(`/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
    }
    res.status(401).json({ error: 'unauthorized' });
}

app.use(requireAuth);

// Open pages call this every few minutes. Every response renews the rolling
// session cookie, and a page on a WebSocket otherwise makes no HTTP requests.
app.get('/session', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ name: req.session.user.name, sub: req.session.user.sub });
});

// Saved shows for Past notes (saved from the config page, see saved-shows.js).
app.get('/shows', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const counts = recordings.partCounts(RECORDINGS_DIR);
    res.json((await savedShows.listShows(SAVED_SHOWS_DIR)).map(show => ({ ...show, recordingParts: counts.get(show.id) || 0 })));
});
app.get('/shows/:id', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const show = await savedShows.readShow(SAVED_SHOWS_DIR, req.params.id);
    if (!show) return res.status(404).json({ error: 'not found' });
    res.json(show);
});

// Recordings uploaded for the live notes (`live`) or a saved show (its id),
// played on playback.html by everyone who opens those notes (recordings.js).
// Uploads are the raw file as the request body, details in the query; any
// logged-in person may add, retime or remove a part, like the config page.
const isCollection = (collection) => collection === 'live' || savedShows.isShowId(collection);
const collectionExists = async (collection) => collection === 'live'
    || (isCollection(collection) && !!(await savedShows.readShow(SAVED_SHOWS_DIR, collection)));
const recordingsOf = (collection) => recordings.listParts(RECORDINGS_DIR, collection).map(part => ({
    id: part.id, name: part.name, type: part.type, size: part.size, startAt: part.startAt,
    duration: part.duration, uploadedAt: part.uploadedAt, uploadedBy: part.uploadedBy,
    url: `/recordings/${collection}/${part.id}`
}));
function recordingsChanged(collection) {
    io.emit('recordings-update', { collection, recordings: recordingsOf(collection) });
}

app.get('/recordings/:collection', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!isCollection(req.params.collection)) return res.status(404).json({ error: 'not found' });
    res.json({ recordings: recordingsOf(req.params.collection) });
});

app.get('/recordings/:collection/:id', (req, res) => {
    const file = isCollection(req.params.collection) && recordings.partFile(RECORDINGS_DIR, req.params.collection, req.params.id);
    if (!file) return res.status(404).json({ error: 'not found' });
    // A part's file never changes under its id. sendFile answers Range requests.
    res.type(file.type);
    res.sendFile(file.path, { headers: { 'Cache-Control': 'private, max-age=31536000, immutable' } }, (error) => {
        if (error && !res.headersSent) res.status(404).json({ error: 'not found' });
    });
});

// Express 4 doesn't catch a rejected async handler, and an unhandled rejection
// stops the server; anything unexpected becomes a 500 instead.
app.post('/recordings/:collection', (req, res) => uploadRecording(req, res).catch((error) => {
    console.log('Error saving an uploaded video:', error.message);
    if (!res.headersSent && !req.socket.destroyed) res.status(500).json({ error: 'The video couldn\'t be saved.' });
}));

async function uploadRecording(req, res) {
    const { collection } = req.params;
    if (!sameOrigin(req)) return res.status(403).json({ error: 'forbidden' });
    if (!(await collectionExists(collection))) return res.status(404).json({ error: 'Those notes no longer exist.' });
    const info = recordings.cleanPartInfo({
        name: req.query.name, type: req.get('content-type'), startAt: req.query.startAt, duration: req.query.duration
    });
    if (info.error) return res.status(400).json({ error: info.error });
    const tooLarge = () => res.status(413).set('Connection', 'close').json({ error: 'The video is too large to upload.' });
    if (Number(req.get('content-length')) > RECORDING_MAX_BYTES) return tooLarge();
    let part;
    try {
        part = await recordings.addPart(RECORDINGS_DIR, collection, req, info, {
            maxBytes: RECORDING_MAX_BYTES, uploadedBy: req.session.user.name
        });
    } catch (error) {
        // req.destroyed is also true once the body has been read in full, so
        // ask whether the connection itself is gone.
        if (res.headersSent || req.socket.destroyed) return;
        if (error.status === 413) return tooLarge();
        if (error.status) return res.status(error.status).json({ error: error.message });
        console.log('Error saving an uploaded video:', error.message);
        return res.status(500).json({ error: 'The video couldn\'t be saved.' });
    }
    console.log(`Video "${part.name}" (${Math.round(part.size / 1e6)} MB) uploaded to ${collection} by ${req.session.user.name}`);
    recordingsChanged(collection);
    res.status(201).json(recordingsOf(collection).find(p => p.id === part.id));
}

app.patch('/recordings/:collection/:id', express.json({ limit: '1kb' }), (req, res) => {
    const { collection, id } = req.params;
    if (!sameOrigin(req)) return res.status(403).json({ error: 'forbidden' });
    if (!isCollection(collection)) return res.status(404).json({ error: 'not found' });
    const part = recordings.setPartStart(RECORDINGS_DIR, collection, id, req.body && req.body.startAt);
    if (part === undefined) return res.status(400).json({ error: 'That is not a time.' });
    if (!part) return res.status(404).json({ error: 'not found' });
    recordingsChanged(collection);
    res.json(recordingsOf(collection).find(p => p.id === id));
});

app.delete('/recordings/:collection/:id', (req, res) => {
    const { collection, id } = req.params;
    if (!sameOrigin(req)) return res.status(403).json({ error: 'forbidden' });
    if (!isCollection(collection) || !recordings.removePart(RECORDINGS_DIR, collection, id)) {
        return res.status(404).json({ error: 'not found' });
    }
    console.log(`Video part ${id} removed from ${collection} by ${req.session.user.name}`);
    recordingsChanged(collection);
    res.status(204).end();
});

// Render the shared icon sprite with each page: an external <use> would
// otherwise leave icons blank until another request finishes. Read the source
// files per request so frontend edits still work without a dev-server restart.
const htmlPages = {
    '/': 'index.html', '/index.html': 'index.html', '/recall.html': 'recall.html',
    '/config.html': 'config.html', '/overlay.html': 'overlay.html', '/overlay-cast.html': 'overlay-cast.html',
    '/playback.html': 'playback.html'
};
app.get(Object.keys(htmlPages), async (req, res, next) => {
    try {
        const page = htmlPages[req.path.toLowerCase().replace(/\/$/, '') || '/'];
        const [html, icons] = await Promise.all([
            fs.promises.readFile(path.join(__dirname, 'public', page), 'utf8'),
            fs.promises.readFile(path.join(__dirname, 'public', 'icons.svg'), 'utf8')
        ]);
        const sprite = icons.replace('<svg ', '<svg id="app-icons" class="icon-sprite" aria-hidden="true" ');
        const rendered = html.replaceAll('icons.svg#', '#').replace(/<body\b[^>]*>/,
            body => `${PLAYBACK_DEMO ? body.replace('>', ' data-playback-demo="true">') : body}\n${sprite}`);
        res.set('Cache-Control', 'private, no-cache');
        res.type('html').send(rendered);
    } catch (error) {
        next(error);
    }
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));
// Browser libraries, served from node_modules so they are pinned by package-lock.json.
app.get('/vendor/purify.min.js', (req, res) => {
    res.sendFile(require.resolve('dompurify/dist/purify.min.js'));
});

app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'favicon.ico'));
});

// Load tags from JSON file (TAGS_FILE is for the tests, which must not change the tracked one)
const TAGS_FILE = process.env.TAGS_FILE || path.join(__dirname, 'tags.json');
let tags = [];
try {
    const tagsData = fs.readFileSync(TAGS_FILE, 'utf8');
    const tagsConfig = JSON.parse(tagsData);
    tags = tagsConfig.tags;
    console.log(`Loaded ${tags.length} tags from tags.json`);
} catch (error) {
    console.log('Error loading tags.json, using default tags:', error.message);
    tags = [
        { id: 'safety', name: 'Safety/Show Critical', color: '#E63946' },
        { id: 'lighting', name: 'Lighting', color: '#00B4D8' },
        { id: 'sound', name: 'Sound', color: '#06D6A0' },
        { id: 'stage', name: 'Stage', color: '#118AB2' },
        { id: 'dsm', name: 'DSM', color: '#8AC926' },
        { id: 'set', name: 'Set', color: '#FF6f91' }
    ];
}

// Saves the current tags. globalState.tags, not the list loaded at start:
// deleting a tag or importing a backup replaces the array.
function saveTagsToFile() {
    try {
        fs.writeFileSync(TAGS_FILE, JSON.stringify({ tags: globalState.tags }, null, 2));
    } catch (error) {
        console.log('Error saving tags to file:', error.message);
    }
}

// Global state
const globalState = {
    timecode: {
        hours: 0,
        minutes: 0,
        seconds: 0,
        frames: 0,
        frameRate: 30,
        source: 'midi'
    },
    networkTimecode: {
        hours: 0,
        minutes: 0,
        seconds: 0,
        frames: 0,
        frameRate: 30,
        source: 'network'
    },
    notes: [],
    chatMessages: [],
    users: new Map(),
    timeMode: 'midi',
    tags: tags,
    currentLxCue: '1',
    currentAct: 'Preshow',
    showLog: [] // every scene change and LX cue, with the time (show-log.js)
};

// After a restart the chat is restored from client offers, but only while this
// window (opened at start) is open; see chat-restore.js. Clients are told when
// it closes so they can stop protecting their saved copy.
function emitToChatClients(event, payload) {
    for (const s of io.sockets.sockets.values()) {
        const u = globalState.users.get(s.id);
        if (u && !u.isOverlay) s.emit(event, payload);
    }
}
const chatRestore = createChatRestore({
    windowMs: Number(process.env.CHAT_RESTORE_WINDOW_MS) || DEFAULT_WINDOW_MS,
    onClose: () => emitToChatClients('chat-restore-status', { open: false })
});

// Try to use EasyMIDI
let easymidi = null;
let midiInput = null;
let openedPortName = 'None';
let mtcMessagesReceived = 0;

function getMidiInputs() {
    if (!easymidi) return [];
    try {
        return easymidi.getInputs();
    } catch (error) {
        console.log('Could not list MIDI inputs:', error.message);
        return [];
    }
}

function handleMidiMessage(msg) {
    if (msg._type === 'mtc' && typeof msg.type === 'number' && typeof msg.value === 'number') {
        parseEasyMIDIMTC(msg.type, msg.value);
    }
    else if (msg.bytes && Array.isArray(msg.bytes)) {
        const [status, data1] = msg.bytes;
        if (status === 0xF1) {
            const messageType = data1 >> 4;
            const value = data1 & 0x0F;
            parseEasyMIDIMTC(messageType, value);
        }
    }
}

// Close the current MIDI input and open `inputName` (null for none).
function openMidiInput(inputName) {
    if (midiInput) {
        midiInput.close();
        midiInput = null;
        openedPortName = 'None';
    }
    if (!inputName || !easymidi) return;
    try {
        midiInput = new easymidi.Input(inputName);
        midiInput.on('message', handleMidiMessage);
        openedPortName = inputName;
        globalState.timecode.source = 'midi';
        console.log(`MIDI input: listening on ${inputName}`);
    } catch (error) {
        midiInput = null;
        console.log(`MIDI input: could not open ${inputName}: ${error.message}`);
    }
}

try {
    easymidi = require('easymidi');
    console.log('EasyMIDI module loaded successfully');
} catch (error) {
    console.log('EasyMIDI not available:', error.message);
}

const startupMidiInputs = getMidiInputs();
console.log('Available MIDI inputs:', startupMidiInputs);
if (settings.midiInput !== undefined && (settings.midiInput === null || startupMidiInputs.includes(settings.midiInput))) {
    openMidiInput(settings.midiInput);
} else {
    if (settings.midiInput !== undefined) {
        console.log(`MIDI input: saved input ${settings.midiInput} is not connected, using the default`);
    }
    // Default: the second input when there is more than one, else the first.
    openMidiInput(startupMidiInputs[startupMidiInputs.length > 1 ? 1 : 0]);
    if (!midiInput) console.log('No MIDI inputs available. Running in demo mode.');
}

// Shared by the Eos TCP connection and the UDP OSC server.
// Messages we're interested in:
// /eos/out/active/cue/text,1/199 B/O 1.0 2%
// /eos/out/pending/cue/text,1/201 Start 1.0
function handleOscMessage(address, value) {
    if (address === '/eos/out/active/cue/text' && value) {
        // Extract cue name from value like "1/199 B/O 1.0 2%"
        const cueName = extractCueLabel(value);
        if (cueName) {
            console.log(`Extracted active LX cue: ${cueName}`);
            
            // Update global state
            globalState.currentLxCue = cueName;
            if (showLog.record(globalState.showLog, 'cue', cueName)) {
                scheduleBackup();
                io.emit('show-log-update', globalState.showLog);
            }
            
            // Notify all clients
            io.emit('lx-cue-update', cueName);
        }
    } else if (address === '/eos/out/pending/cue/text' && value) {
        // Optionally handle pending cues too
        const cueName = extractCueLabel(value);
        if (cueName) {
            console.log(`Extracted pending LX cue: ${cueName}`);
            
            // You could choose to update for pending cues too, or just log them
            // globalState.currentLxCue = `Pending: ${cueName}`;
            // io.emit('lx-cue-update', `Pending: ${cueName}`);
        }
    } else if (address.startsWith('/bts/')) {
        const act = value;
        if (act && act !== globalState.currentAct) {
            globalState.currentAct = act;
            if (showLog.record(globalState.showLog, 'scene', act)) {
                scheduleBackup();
                io.emit('show-log-update', globalState.showLog);
            }
            console.log(`Updated current act to: ${act}`);
            io.emit('act-update', act);
        }
    }
}

const connectMessage = new Message('/eos/subscribe=1');
const buffer = encode(connectMessage);

// Eos TCP connection. connectToEOS() is called at start and from the config
// page's reconnect button; there is never more than one socket, and each one
// gets its own stream decoder. No automatic retry.
const EOS_CONNECT_TIMEOUT_MS = Number(process.env.EOS_CONNECT_TIMEOUT_MS) || 10000;
const eosStatus = { state: 'disconnected', error: null, host: eosHost, port: Number(eosPort) };
let eosSocket = null;

function setEosStatus(state, error = null) {
    eosStatus.state = state;
    eosStatus.error = error;
    io.emit('eos-status', eosStatus);
}

function connectToEOS() {
    // A press while an attempt is in progress does not stack another.
    if (eosStatus.state === 'connecting') return;

    if (eosSocket) {
        const old = eosSocket;
        eosSocket = null; // its handlers ignore everything from now on
        old.removeAllListeners('data');
        old.on('error', () => {});
        old.destroy();
    }

    const sock = new net.Socket();
    eosSocket = sock;
    setEosStatus('connecting');
    let failed = false;
    const fail = (message) => {
        if (eosSocket !== sock) return;
        failed = true;
        console.log('Error connecting to EOS via TCP:', message);
        setEosStatus('failed', message);
        sock.destroy();
    };

    sock.setTimeout(EOS_CONNECT_TIMEOUT_MS);
    sock.on('timeout', () => {
        if (eosStatus.state === 'connecting') fail(`timed out after ${EOS_CONNECT_TIMEOUT_MS / 1000}s`);
    });

    sock.on('connect', function() {
        if (eosSocket !== sock) return;
        console.log('Connected to EOS');
        sock.setTimeout(0);
        sock.write(buffer);
        setEosStatus('connected');
    });

    const pushSlip = createSlipDecoder(function(packet) {
        for (const [address, value] of decodeOscPacket(packet)) {
            if (process.env.DEBUG_EOS) {
                console.log(`Received: ${address} ${value === undefined ? '' : JSON.stringify(value)}`);
            }
            handleOscMessage(address, value);
        }
    });
    sock.on('data', pushSlip);

    sock.on('error', (err) => fail(err.code || err.message));

    sock.on('close', () => {
        if (eosSocket !== sock) return;
        eosSocket = null;
        if (!failed) setEosStatus('disconnected');
    });

    sock.connect(eosPort, eosHost);
}

// OSC Server for LX Cues and scenes from qlab
let oscServer = null;
try {
    oscServer = new Server(oscPort, '0.0.0.0', () => {
        console.log(`OSC Server is listening on port ${oscPort} for LX cues and Scene info`);
    });

    oscServer.on('message', function (msg) {
        handleOscMessage(msg[0], msg[1]);
    });

    oscServer.on('error', (err) => {
        console.log('OSC Server error:', err);
    });

} catch (error) {
    console.log('OSC Server not available:', error.message);
    console.log('LX cues will need to be entered manually');
}

// MIDI Timecode parsing
const midiDecoder = createMtcDecoder('midi', (timecode) => {
    globalState.timecode = timecode;
    io.emit('timecode-update', globalState.timecode);
});

function parseEasyMIDIMTC(messageType, value) {
    mtcMessagesReceived++;
    midiDecoder.quarterFrame(messageType, value);
}

// Network timecode: the gateway re-sends each MIDI message as an ACN packet.
const networkStatus = {
    group: gatewayGroup,
    port: ACN_PORT,
    gatewayIp: gatewayIp,
    interfaceSelection: settings.networkInterface,
    interfaceAddress: null,
    interfaceReason: null,
    auto: null, // automatic mode: gateway-lock.js state()
    listening: false,
    running: false,
    source: null,
    error: null
};
let networkSocket = null;
let networkStopTimer = null;
let networkRetryTimer = null;
let gatewayLock = null; // automatic interface mode only
const ignoredGatewaySources = new Set();
const gatewaySequenceFilters = new Map(); // per source address

const networkDecoder = createMtcDecoder('network', (timecode) => {
    globalState.networkTimecode = timecode;
    io.emit('timecode-update', globalState.networkTimecode);
});

function emitNetworkStatus() {
    io.emit('network-timecode-status', networkStatus);
}

function networkStreamStopped() {
    networkStatus.running = false;
    networkDecoder.reset();
    console.log(`Network timecode: stopped (no quarter-frame for ${NETWORK_STOP_MS} ms)`);
    emitNetworkStatus();
}

function networkQuarterFrameReceived() {
    if (networkStopTimer) {
        networkStopTimer.refresh();
    } else {
        networkStopTimer = setTimeout(() => {
            networkStopTimer = null;
            networkStreamStopped();
        }, NETWORK_STOP_MS);
    }
    if (!networkStatus.running) {
        networkStatus.running = true;
        console.log(`Network timecode: running (from ${networkStatus.source})`);
        emitNetworkStatus();
    }
}

function handleGatewayPacket(buf, rinfo) {
    const messages = extractMidi(buf);
    if (gatewayIp && rinfo.address !== gatewayIp) {
        if (messages.length > 0 && !ignoredGatewaySources.has(rinfo.address)) {
            ignoredGatewaySources.add(rinfo.address);
            console.log(`Network timecode: ignoring MIDI from ${rinfo.address} (CID ${senderCid(buf)}) on ${gatewayGroup} - GATEWAY_IP is ${gatewayIp}`);
        }
        return;
    }
    // Keepalives from the locked gateway count too, so it isn't released just
    // because timecode stopped.
    if (gatewayLock && !gatewayLock.accept(rinfo.address, senderCid(buf), messages.length > 0)) return;
    if (messages.length === 0) return; // keepalives, ACKs, sACN and other ACN traffic

    if (!gatewaySequenceFilters.has(rinfo.address)) {
        gatewaySequenceFilters.set(rinfo.address, createSequenceFilter());
    }
    if (!gatewaySequenceFilters.get(rinfo.address)(wrapperSequence(buf))) return; // duplicate copy

    if (networkStatus.source !== rinfo.address) {
        console.log(networkStatus.source
            ? `Network timecode: now receiving from ${rinfo.address} (was ${networkStatus.source}) - set GATEWAY_IP to choose one gateway`
            : `Network timecode: first MIDI packet from gateway ${rinfo.address}:${rinfo.port} (CID ${senderCid(buf)}) on group ${gatewayGroup}:${ACN_PORT}`);
        networkStatus.source = rinfo.address;
        emitNetworkStatus();
    }

    for (const midi of messages) {
        if (midi[0] === 0xF1 && midi.length >= 2) {
            networkDecoder.quarterFrame((midi[1] >> 4) & 0x07, midi[1] & 0x0F);
            networkQuarterFrameReceived();
        } else {
            networkDecoder.fullFrame(midi); // MSC and other SysEx are ignored
        }
    }
}

function stopGatewayLock() {
    if (gatewayLock) gatewayLock.stop();
    gatewayLock = null;
    networkStatus.auto = null;
}

function startNetworkTimecode() {
    const auto = settings.networkInterface === 'auto';
    // Resolved on every (re)start so an interface that comes up late is found.
    const iface = auto ? null : resolveInterface(settings.networkInterface, listIpv4Interfaces());
    networkStatus.interfaceSelection = settings.networkInterface;
    networkStatus.interfaceAddress = iface ? iface.address : null;
    networkStatus.interfaceReason = iface ? iface.reason : 'automatic: all interfaces until a gateway is heard';
    networkStatus.auto = null;
    if (iface) console.log(`Network timecode: interface ${iface.address} - ${iface.reason}`);
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true }); // sACN shares port 5568
    socket.on('message', handleGatewayPacket);
    socket.on('error', (error) => {
        if (networkSocket !== socket) return;
        console.log(`Network timecode: socket error on ${gatewayGroup}:${ACN_PORT}: ${error.message} - retrying in ${NETWORK_RETRY_MS / 1000} s`);
        stopGatewayLock();
        networkStatus.listening = false;
        networkStatus.error = error.message;
        emitNetworkStatus();
        networkSocket = null;
        socket.close();
        networkRetryTimer = setTimeout(() => {
            networkRetryTimer = null;
            startNetworkTimecode();
        }, NETWORK_RETRY_MS);
    });
    socket.bind(ACN_PORT, () => {
        if (networkSocket !== socket) return;
        if (auto) {
            const lock = createGatewayLock({
                socket,
                group: gatewayGroup,
                listInterfaces: listIpv4Interfaces,
                lostMs: NETWORK_LOST_MS,
                onChange: () => {
                    networkStatus.auto = lock.state();
                    if (!networkStatus.auto.locked) networkStatus.source = null;
                    emitNetworkStatus();
                }
            });
            if (lock.start() === 0) {
                lock.stop();
                socket.emit('error', new Error(`could not join multicast group ${gatewayGroup} on any interface`));
                return;
            }
            gatewayLock = lock;
            networkStatus.auto = lock.state();
        } else {
            try {
                socket.addMembership(gatewayGroup, iface.address);
            } catch (error) {
                socket.emit('error', new Error(`could not join multicast group: ${error.message}`));
                return;
            }
            console.log(`Network timecode: joined multicast group ${gatewayGroup}:${ACN_PORT} on interface ${iface.address}`);
        }
        networkStatus.listening = true;
        networkStatus.error = null;
        console.log(`Network timecode: accepting MIDI from ${gatewayIp || 'any gateway'}`);
        emitNetworkStatus();
    });
    networkSocket = socket;
}

// Leave the multicast group and join again on the current interface setting.
function restartNetworkTimecode() {
    if (networkRetryTimer) {
        clearTimeout(networkRetryTimer);
        networkRetryTimer = null;
    }
    if (networkStopTimer) {
        clearTimeout(networkStopTimer);
        networkStopTimer = null;
    }
    stopGatewayLock();
    const oldSocket = networkSocket;
    networkSocket = null; // its error handler now ignores it
    if (oldSocket) oldSocket.close();
    networkDecoder.reset();
    Object.assign(networkStatus, { listening: false, running: false, source: null, error: null });
    emitNetworkStatus();
    startNetworkTimecode();
}

// Timecode of the source the current time mode displays.
function currentModeTimecode() {
    return globalState.timeMode === 'network' ? globalState.networkTimecode : globalState.timecode;
}

function systemStatus() {
    return {
        midiAvailable: !!midiInput,
        portCount: getMidiInputs().length,
        currentPort: openedPortName,
        mtcMessagesReceived: mtcMessagesReceived,
        oscAvailable: !!oscServer
    };
}

// Choices shown in the config page's MIDI input and network interface menus.
function settingsOptions() {
    return {
        midiInputs: getMidiInputs(),
        midiInput: midiInput ? openedPortName : null,
        interfaces: listIpv4Interfaces().map(i => ({ name: i.name, address: i.address })),
        networkInterface: settings.networkInterface
    };
}

const BACKUPS_DIR = process.env.BACKUPS_DIR || path.join(__dirname, 'backups');

// Until the start-up restore below has run, the server's notes are not the
// notes it should be backing up: an empty server must not write a backup that
// outranks the good one from before the crash.
let notesRestored = false;

// A change (note, comment, edit, tag) is backed up BACKUP_DELAY_MS later, so a
// crash or power cut loses at most that much; the interval below is only a
// safety net. One write runs at a time, and a newer file from the same minute
// replaces the previous one, so the folder keeps about one backup per minute.
const BACKUP_DELAY_MS = Number(process.env.BACKUP_DELAY_MS) || 1000;
let backupTimer = null;
let backupWriting = false;
let backupAgain = false;
let lastBackupFile = null;

// What a backup, the JSON export and a saved show hold (Past notes reads all three).
function notesExport() {
    return {
        notes: globalState.notes,
        exportedAt: new Date().toISOString(),
        totalNotes: globalState.notes.length,
        authors: authorsOf(globalState.notes),
        users: listedUsers().map(u => ({
            name: u.name,
            joinedAt: u.joinedAt
        })),
        tags: globalState.tags,
        showLog: globalState.showLog,
        ...(PLAYBACK_DEMO ? { demo: true } : {})
    };
}

function scheduleBackup() {
    if (backupTimer) return;
    backupTimer = setTimeout(() => {
        backupTimer = null;
        backup();
    }, BACKUP_DELAY_MS);
}

function backup(sync = false) {
    if (!notesRestored) {
        console.log('Backup skipped: notes not restored yet');
        return;
    }
    if (!sync && backupWriting) {
        backupAgain = true;
        return;
    }
    const data = JSON.stringify(notesExport(), null, 2);
    const filename = backupFilename();
    const previous = lastBackupFile;
    const written = () => {
        lastBackupFile = filename;
        const prevTime = previous && backupTime(previous);
        if (prevTime !== null && previous !== filename &&
            Math.floor(prevTime / 60000) === Math.floor(backupTime(filename) / 60000)) {
            fs.rm(path.join(BACKUPS_DIR, previous), { force: true }, () => {});
        }
    };
    try {
        fs.mkdirSync(BACKUPS_DIR, { recursive: true });
        if (sync) {
            // Crash/shutdown handlers call process.exit() immediately after
            // backup(), so the write must complete before returning.
            writeBackupFile(BACKUPS_DIR, filename, data);
            console.log(`Backup saved to backups/${filename}`);
        } else {
            backupWriting = true;
            writeBackupFile(BACKUPS_DIR, filename, data, (error) => {
                backupWriting = false;
                if (error) {
                    console.log('Error saving backup file:', error.message);
                } else {
                    written();
                }
                if (backupAgain) {
                    backupAgain = false;
                    backup();
                }
            });
        }
    } catch (error) {
        backupWriting = false;
        console.log('Error saving backup file:', error.message);
    }
}

// On start, load the notes and tags from the newest backup that is under two
// hours old and passes the check (see notes-backup.js), so a crash does not
// lose the dress notes while a restart days later starts clean. A bad backup
// is skipped, never fatal.
// A backup's tags, rebuilt like a tag from the tag editor; one without a
// valid colour gets a random one, as a new tag does.
function storedTags(list) {
    return input.cleanStoredTags(list).map(t => ({ ...t, color: t.color || getRandomColor() }));
}

function restoreNotes() {
    try {
        const found = findRestorableBackup(BACKUPS_DIR);
        for (const { file, reason } of found.skipped) {
            console.log(`Notes restore: skipped backups/${file}: ${reason}`);
        }
        if (found.file) {
            globalState.notes = applyAuthors(input.cleanStoredNotes(found.data.notes), found.data.authors);
            if (found.data.tags) globalState.tags = storedTags(found.data.tags);
            globalState.showLog = showLog.cleanShowLog(found.data.showLog);
            console.log(`Notes restore: loaded ${found.data.notes.length} notes from backups/${found.file}`);
        } else {
            console.log(`Notes restore: starting empty (${found.reason})`);
        }
    } catch (error) {
        console.log('Notes restore: starting empty (restore failed):', error.message);
    }
    notesRestored = true;
}
restoreNotes();

// Opt-in examples for the separate playback development instance only.
// Refuse to seed over existing notes; other instances use their normal data.
if (PLAYBACK_DEMO) {
    const sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'public/playback-demo/show.json'), 'utf8'));
    if (!globalState.notes.length) {
        globalState.notes = input.cleanStoredNotes(sample.notes);
        globalState.tags = storedTags(sample.tags);
        globalState.showLog = showLog.cleanShowLog(sample.showLog);
        backup(true);
    }
    const sampleId = savedShows.showId('Sample dress rehearsal', new Date('2026-10-07T19:00:00Z'));
    if (!fs.existsSync(path.join(SAVED_SHOWS_DIR, `${sampleId}.json`))) {
        savedShows.saveShow(SAVED_SHOWS_DIR, 'Sample dress rehearsal', { ...sample, totalNotes: sample.notes.length }, new Date('2026-10-07T19:00:00Z'));
    }
    // The saved sample plays its recording from the server, as an uploaded one would.
    if (!recordings.listParts(RECORDINGS_DIR, sampleId).length) {
        const info = recordings.cleanPartInfo({
            name: 'Sample Show.2026-10-07 19-30-00.mp4', startAt: Date.parse(sample.showLog[0].at), duration: 720
        });
        recordings.addPart(RECORDINGS_DIR, sampleId, fs.createReadStream(path.join(__dirname, 'public/playback-demo/recording.mp4')), info)
            .catch(error => console.log('Sample recording not added:', error.message));
    }
}

app.get('/playback/live', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ ...notesExport(), name: PLAYBACK_DEMO ? 'Sample live session' : 'Live notes' });
});

// Safety net: a backup every minute even if nothing called scheduleBackup().
setInterval(backup, Number(process.env.BACKUP_INTERVAL_MS) || 1 * 60 * 1000);

// Delete backups more than a day old, going by the time in the file name
// (mtime can be off after a copy). Only backup files are touched.
function deleteOldBackups() {
    fs.readdir(BACKUPS_DIR, (err, files) => {
        if (err) return;
        const now = Date.now();
        for (const file of files) {
            const time = backupTime(file);
            if (time === null || now - time <= 24 * 60 * 60 * 1000) continue;
            fs.unlink(path.join(BACKUPS_DIR, file), (error) => {
                if (!error) console.log(`Deleted old backup file: ${file}`);
            });
        }
    });
}
deleteOldBackups();
setInterval(deleteOldBackups, 60 * 60 * 1000).unref();

// Notes kept from a reset go once their time runs out (reset-notes.js).
function pruneResets() {
    resetNotes.prune(RESETS_DIR, Date.now(), RESET_KEEP_MS).then((gone) => {
        for (const id of gone) console.log(`Deleted notes kept from the reset at ${id}`);
        if (gone.length) resetsChanged();
    }, (error) => console.log('Error deleting old reset notes:', error.message));
}
pruneResets();
setInterval(pruneResets, 10 * 60 * 1000).unref();

function resetsList() {
    return resetNotes.listResets(RESETS_DIR, Date.now(), RESET_KEEP_MS);
}

async function resetsChanged() {
    io.emit('resets-update', await resetsList());
}

// Backups on errors and graceful shutdown
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    backup(true);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    backup(true);
    process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        console.log(`Received ${signal}. Backing up and shutting down...`);
        backup(true);
        sessionStore.close();
        process.exit(0);
    });
}


// Session is available during the WS handshake as socket.request.session.
io.engine.use(sessionMiddleware);

// Refuse sockets with no valid Keycloak-backed session.
io.use((socket, next) => {
    const sessionUser = socket.request.session && socket.request.session.user;
    if (sessionUser && sessionUser.sub) {
        return next();
    }
    next(new Error('unauthorized'));
});

// Which page a socket belongs to. Pages say so in the handshake
// (io({ auth: { page } })); the Referer is the fallback for older tabs.
function pageOf(socket) {
    const page = socket.handshake.auth && socket.handshake.auth.page;
    if (page === 'overlay' || page === 'config' || page === 'main') return page;
    const referer = socket.handshake.headers.referer || '';
    if (referer.includes('overlay.html') || referer.includes('overlay-cast.html')) return 'overlay';
    if (referer.includes('config.html')) return 'config';
    return 'main';
}

// Notes, comments and chat messages all get ids that cannot collide.
function newId() {
    return crypto.randomUUID();
}

// WebSocket connections
// Notes deleted since start, as `${userId} ${clientId}`, so a resend that was
// still on its way (a lost ack, then a delete from another tab) doesn't bring
// the note back. Oldest dropped past DELETED_SUBMISSIONS_MAX.
const deletedSubmissions = new Set();
const DELETED_SUBMISSIONS_MAX = 10000;

function rememberDeleted(note) {
    if (!note.clientId) return;
    deletedSubmissions.add(`${note.userId} ${note.clientId}`);
    if (deletedSubmissions.size > DELETED_SUBMISSIONS_MAX) deletedSubmissions.delete(deletedSubmissions.values().next().value);
}

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    const sessionUser = socket.request.session.user;
    const page = pageOf(socket);
    const isOverlay = page === 'overlay';
    // The config page is left out of the online users list but, unlike
    // overlays, may still change settings such as the time mode.
    const isConfig = page === 'config';

    const user = {
        id: sessionUser.sub,
        name: sessionUser.name,
        isTyping: false,
        currentTimecode: null,
        currentLxCue: null,
        joinedAt: new Date(),
        isOverlay: isOverlay,
        isConfig: isConfig
    };

    // A person is listed once however many pages they have open; they only
    // join with their first page and leave with their last.
    const listed = !isOverlay && !isConfig;
    const firstPage = listed && !isListed(user.id);
    globalState.users.set(socket.id, user);

    // Every handler runs inside a try/catch: one bad message from one browser
    // must not reach the uncaughtException handler, which exits the server.
    const on = (event, handler) => {
        socket.on(event, (...args) => {
            const failed = (error) => console.error(`Socket ${event} from ${user.name} failed:`, error);
            try {
                const result = handler(...args);
                if (result && typeof result.catch === 'function') result.catch(failed);
            } catch (error) {
                failed(error);
            }
        });
    };

    // Send current state to newly connected client
    socket.emit('act-update', globalState.currentAct);
    socket.emit('timecode-update', globalState.timecode);
    socket.emit('timecode-update', globalState.networkTimecode);
    socket.emit('notes-update', globalState.notes);
    socket.emit('tags-update', globalState.tags);
    socket.emit('show-log-update', globalState.showLog);
    socket.emit('time-mode-update', globalState.timeMode);
    socket.emit('lx-cue-update', globalState.currentLxCue);
    socket.emit('system-status', systemStatus());
    socket.emit('network-timecode-status', networkStatus);
    socket.emit('eos-status', eosStatus);
    socket.emit('settings-options', settingsOptions());

    // Only send user-related updates if this is NOT an overlay
    if (!isOverlay) {
        socket.emit('current-user', { name: user.name, sub: user.id });

        const filteredUsers = listedUsers();
        if (listed) {
            io.emit('users-update', filteredUsers);
            if (firstPage) {
                io.emit('user-joined', {
                    user: user.name,
                    userCount: filteredUsers.length
                });
            }
        } else {
            socket.emit('users-update', filteredUsers);
        }
    } else {
        // Overlay users get minimal user info
        socket.emit('users-update', []);
    }

    // Handle note tag updates
    on('note-update-tags', (data) => {
        if (user.isOverlay || !data) return;
        const note = globalState.notes.find(n => n.id === data.noteId);
        if (note) {
            const tags = input.cleanTags(data.tags);
            // Every note keeps at least one tag; put the sender's view back if it tried to clear them.
            if (!tags.length) return socket.emit('note-update-tags', { noteId: note.id, tags: note.tags });
            note.tags = tags;
            io.emit('note-update-tags', { noteId: note.id, tags: note.tags });
            scheduleBackup();
        }
    });

    // Handle tag creation/updates
    on('create-tag', (tagData) => {
        if (user.isOverlay) return;
        const tag = input.cleanTag(tagData);
        if (!tag) return;
        const existingIndex = tag.id ? globalState.tags.findIndex(t => t.id === tag.id) : -1;
        const newTag = {
            id: tag.id || generateId(),
            name: tag.name,
            color: tag.color || (existingIndex >= 0 && globalState.tags[existingIndex].color) || getRandomColor()
        };
        if (existingIndex >= 0) {
            globalState.tags[existingIndex] = newTag;
        } else {
            globalState.tags.push(newTag);
        }

        saveTagsToFile();
        io.emit('tags-update', globalState.tags);
        scheduleBackup();
    });

    // Handle tag deletion
    on('delete-tag', (tagId) => {
        if (user.isOverlay) return;
        const id = input.cleanId(tagId);
        if (!id) return;
        globalState.tags = globalState.tags.filter(tag => tag.id !== id);
        saveTagsToFile();
        io.emit('tags-update', globalState.tags);
        scheduleBackup();
    });

    // Handle user starting to type (only for non-overlay users)
    on('typing-start', (data) => {
        if (user.isOverlay) return; // Overlay users can't type

        user.isTyping = true;
        user.currentTimecode = input.cleanTimecode(data && data.timecode) || {...currentModeTimecode()};
        user.currentLxCue = input.cleanCue(data && data.lxCue) || globalState.currentLxCue;

        broadcastTyping();
    });

    // Handle user stopping typing (only for non-overlay users)
    on('typing-stop', () => {
        if (user.isOverlay) return; // Overlay users can't type

        user.isTyping = false;
        user.currentTimecode = null;
        user.currentLxCue = null;

        broadcastTyping();
    });

    // Handle time mode change (only for non-overlay users)
    on('time-mode-change', (newMode) => {
        if (user.isOverlay) return; // Overlay users can't change time mode

        if (newMode === 'midi' || newMode === 'network' || newMode === 'realtime') {
            globalState.timeMode = newMode;
            io.emit('time-mode-update', globalState.timeMode);
        }
    });

    // Handle MIDI input change from the config page ('' or null for none)
    on('midi-input-change', (inputName) => {
        if (user.isOverlay) return; // Overlay users can't change settings
        const name = inputName || null;
        if (name !== null && !getMidiInputs().includes(name)) return;
        openMidiInput(name);
        settings.midiInput = name;
        persistSettings();
        if (!midiInput && globalState.timeMode === 'midi') {
            globalState.timeMode = 'realtime';
            io.emit('time-mode-update', globalState.timeMode);
        }
        io.emit('system-status', systemStatus());
        io.emit('settings-options', settingsOptions());
    });

    // Handle network interface change from the config page ('auto' or a local IPv4 address)
    on('network-interface-change', (selection) => {
        if (user.isOverlay) return; // Overlay users can't change settings
        if (selection !== 'auto' && !listIpv4Interfaces().some(i => i.address === selection)) return;
        settings.networkInterface = selection;
        persistSettings();
        restartNetworkTimecode();
        io.emit('settings-options', settingsOptions());
    });

    // Handle LX Cue change (manual input - will be overridden by OSC)
    on('lx-cue-change', (newCue) => {
        if (user.isOverlay) return; // Overlay users can't change LX cues
        const cue = input.cleanCue(newCue);
        if (!cue) return;

        // Only update if OSC is not available, or allow manual override
        if (!oscServer) {
            globalState.currentLxCue = cue;
            io.emit('lx-cue-update', globalState.currentLxCue);
        } else {
            // OSC is available, so manual changes are temporary
            console.log('Manual LX cue change ignored - OSC source is active');
        }
    });

    // Handle note submission (only for non-overlay users)
    // The client resends a note it has no acknowledgement for after a
    // reconnect, tagged with its own clientId, so a resend must not duplicate
    // a note that already arrived. The ack carries the stored note, or
    // { error } for a note that can never be stored, so the browser stops
    // resending it.
    // A late note carries ageMs (how long ago it was written); it is stamped
    // and placed by that rather than by its arrival (see public/note-order.js).
    // startedAgeMs, how long ago its author started typing it, becomes
    // startedAt on the server's clock whatever the timecode mode, which is what
    // lines a note up with a recording (playback.html).
    on('note-submit', (data, ack) => {
        const respond = typeof ack === 'function' ? ack : () => {};
        if (user.isOverlay) return respond({ error: 'Overlays cannot add notes.' });
        if (!data || typeof data !== 'object') return respond({ error: 'Something went wrong. Write it again.' });
        const clientId = input.cleanId(data.clientId) || undefined;
        if (clientId) {
            // Only the sender's own notes: another person's note with the same clientId is not this one.
            const existing = globalState.notes.find(n => n.clientId === clientId && n.userId === user.id);
            if (existing) return respond(existing);
            if (deletedSubmissions.has(`${user.id} ${clientId}`)) return respond({ deleted: true, clientId });
        }
        const text = input.cleanText(data.text, input.MAX_NOTE_LENGTH);
        if (!text) return respond({ error: 'A note needs some text.' });

        // The composer requires a tag, and note-update-tags refuses an empty list.
        const tags = input.cleanTags(data.tags);
        if (!tags.length) return respond({ error: 'A note needs at least one tag.' });

        const noteTimecode = input.cleanTimecode(data.timecode) || {...currentModeTimecode()};
        const now = Date.now();
        const ageMs = sanitizeAge(data.ageMs);

        const note = {
            id: newId(),
            user: user.name,
            userId: user.id,
            text,
            timecode: noteTimecode,
            lxCue: input.cleanCue(data.lxCue) || globalState.currentLxCue,
            timestamp: new Date(now - ageMs).toISOString(),
            frameRate: input.cleanFrameRate(data.frameRate) || currentModeTimecode().frameRate,
            tags,
            act: globalState.currentAct, // Use current act from OSC
            comments: []
        };
        if (clientId) note.clientId = clientId;
        // Older tabs don't send it; their notes have no startedAt.
        if (typeof data.startedAgeMs === 'number') {
            note.startedAt = new Date(now - Math.max(ageMs, sanitizeAge(data.startedAgeMs))).toISOString();
        }

        globalState.notes.splice(insertionIndex(globalState.notes, note), 0, note);

        respond(note);
        io.emit('note-added', note);
        scheduleBackup();
    });

    // Handle comment submission (only for non-overlay users)
    on('comment-submit', (data) => {
        if (user.isOverlay || !data) return;
        const text = input.cleanText(data.text, input.MAX_COMMENT_LENGTH);
        const note = globalState.notes.find(n => n.id === data.noteId);
        if (note && text) {
            const comment = {
                id: newId(),
                user: user.name,
                userId: user.id,
                text,
                timestamp: new Date().toISOString()
            };
            if (!note.comments) note.comments = [];
            note.comments.push(comment);
            io.emit('comment-submit', { noteId: note.id, comment });
            scheduleBackup();
        }
    });

    // Handle chat message submission (only for non-overlay users)
    on('chat-message', (data) => {
        if (user.isOverlay) return; // Overlay users can't chat

        const bounded = boundChatMessage({ user: user.name, userId: user.id, text: data && data.text });
        if (!bounded) return;

        const chatMessage = {
            id: newId(),
            ...bounded,
            timestamp: new Date().toISOString()
        };

        globalState.chatMessages.push(chatMessage);
        io.emit('chat-message-added', chatMessage);
    });

    // A client that still holds the chat log from before a restart offers it back
    on('chat-restore-offer', (log) => {
        if (user.isOverlay || user.isConfig) return;
        const restored = chatRestore.offer(user.id, log, globalState.chatMessages);
        if (!restored) return;
        globalState.chatMessages = mergeChatLogs(globalState.chatMessages, restored);
        emitToChatClients('chat-messages-update', globalState.chatMessages);
    });

    // Send chat history to newly connected clients (only for non-overlay)
    if (!isOverlay) {
        socket.emit('chat-restore-status', { open: !chatRestore.closed }); // before the log, so the client knows how to treat it
        socket.emit('chat-messages-update', globalState.chatMessages);
    }

    // Handle note text editing (only for non-overlay users)
    on('note-edit-text', (data) => {
        if (user.isOverlay || !data) return;
        const newText = input.cleanText(data.newText, input.MAX_NOTE_LENGTH);
        const note = globalState.notes.find(n => n.id === data.noteId);
        // Only the author (by session identity) may edit; see public/note-author.js
        if (note && newText && canEditNote(note, user.id)) {
            note.text = newText;
            note.lastEdited = new Date().toISOString();
            note.lastEditedBy = user.name;
            io.emit('note-edit-text', {
                noteId: note.id,
                newText,
                lastEditedBy: user.name,
                lastEdited: note.lastEdited
            });
            scheduleBackup();
        }
    });
    // Handle comment editing: only its author, same rule as notes
    on('comment-edit', (data) => {
        if (user.isOverlay || !data) return;
        const newText = input.cleanText(data.newText, input.MAX_COMMENT_LENGTH);
        const note = globalState.notes.find(n => n.id === data.noteId);
        const comment = note && Array.isArray(note.comments) && note.comments.find(c => c.id === data.commentId);
        if (comment && newText && canEditNote(comment, user.id)) {
            comment.text = newText;
            comment.lastEdited = new Date().toISOString();
            comment.lastEditedBy = user.name;
            io.emit('comment-edit', {
                noteId: note.id,
                commentId: comment.id,
                newText,
                lastEditedBy: user.name,
                lastEdited: comment.lastEdited
            });
            scheduleBackup();
        }
    });
    // Handle note deletion: only its author, and only a note that has one
    // (an ownerless note is editable by anyone but deletable by no one).
    on('note-delete', (data) => {
        if (user.isOverlay || !data) return;
        const note = globalState.notes.find(n => n.id === data.noteId);
        if (note && note.userId && canEditNote(note, user.id)) {
            globalState.notes = globalState.notes.filter(n => n !== note);
            rememberDeleted(note);
            io.emit('note-delete', { noteId: note.id });
            scheduleBackup();
        }
    });
    // Handle comment deletion: only its author, same rule as notes
    on('comment-delete', (data) => {
        if (user.isOverlay || !data) return;
        const note = globalState.notes.find(n => n.id === data.noteId);
        const comment = note && Array.isArray(note.comments) && note.comments.find(c => c.id === data.commentId);
        if (comment && canEditNote(comment, user.id)) {
            note.comments = note.comments.filter(c => c !== comment);
            io.emit('comment-delete', { noteId: note.id, commentId: comment.id });
            scheduleBackup();
        }
    });

    // Reconnect to the Eos console from the config page; same rule as the other controls.
    on('eos-reconnect', () => {
        if (user.isOverlay) return;
        console.log(`Eos TCP reconnect requested by ${user.name}`);
        connectToEOS();
    });

    // Reset from the config page: empties the notes and the chat for everyone.
    // Same rule as the other config page controls: any non-overlay user.
    on('reset-all', (ack) => {
        const respond = typeof ack === 'function' ? ack : () => {};
        if (user.isOverlay) return;
        console.log(`Reset of all notes and chat requested by ${user.name}`);
        respond(resetNotesAndChat(user.name) ? {} : { error: "The notes couldn't be kept, so nothing was reset." });
    });

    // Notes kept from recent resets, for the config page to restore.
    on('resets-list', async (ack) => {
        if (user.isOverlay || typeof ack !== 'function') return;
        ack(await resetsList());
    });

    // Puts a kept reset's notes back alongside the live ones. Notes already
    // live (same id) are left as they are, so restoring twice adds nothing.
    // The kept copy stays until its time runs out.
    on('restore-reset', async (data, ack) => {
        const respond = typeof ack === 'function' ? ack : () => {};
        if (user.isOverlay) return;
        const kept = await resetNotes.readReset(RESETS_DIR, data && data.id, Date.now(), RESET_KEEP_MS);
        if (!kept) return respond({ error: "Those notes are no longer kept." });
        const live = new Set(globalState.notes.map(n => n.id));
        const added = applyAuthors(input.cleanStoredNotes(kept.notes), kept.authors).filter(n => !live.has(n.id));
        for (const note of added) globalState.notes.splice(insertionIndex(globalState.notes, note), 0, note);
        const events = new Set(globalState.showLog.map(e => JSON.stringify(e)));
        globalState.showLog = showLog.cleanShowLog([...globalState.showLog,
            ...showLog.cleanShowLog(kept.showLog).filter(e => !events.has(JSON.stringify(e)))]);
        console.log(`${added.length} notes restored from the reset at ${data.id} by ${user.name}`);
        if (added.length) {
            io.emit('notes-update', globalState.notes);
            io.emit('show-log-update', globalState.showLog);
            scheduleBackup();
        }
        respond({ restored: added.length });
    });

    // Save from the config page: the notes as they are now, under a name, for
    // Past notes; with `reset`, then the same reset as the button above.
    on('save-show', (data, ack) => {
        const respond = typeof ack === 'function' ? ack : () => {};
        if (user.isOverlay) return;
        const name = savedShows.cleanShowName(data && data.name);
        if (!name) return respond({ error: 'Give the show a name first.' });
        if (globalState.notes.length === 0) return respond({ error: 'There are no notes to save.' });
        const resetsBefore = resetCount;
        let show;
        try {
            show = savedShows.saveShow(SAVED_SHOWS_DIR, name, notesExport());
        } catch (error) {
            console.log('Error saving show:', error.message);
            return respond({ error: "The notes couldn't be saved. Nothing was reset." });
        }
        // The live videos go with it; the reset (which removes them) waits for that.
        recordings.copyCollection(RECORDINGS_DIR, 'live', show.id).then((parts) => {
            if (parts) recordingsChanged(show.id);
            // Notes can arrive while the videos copy; write the show again (same
            // id) straight before the reset so none of them are lost. If another
            // reset came first, these notes are already gone from the live list:
            // keep the show as first saved and don't reset what came after.
            const reset = data.reset && resetCount === resetsBefore;
            if (reset) {
                try {
                    show = savedShows.saveShow(SAVED_SHOWS_DIR, name, notesExport(), new Date(show.savedAt), true);
                } catch (error) {
                    console.log('Error saving show:', error.message);
                    return respond({ error: "The latest notes couldn't be saved. Nothing was reset." });
                }
            }
            console.log(`Show "${name}" (${show.totalNotes} notes, ${parts} video parts) saved by ${user.name}${reset ? ', then reset' : ''}`);
            if (reset && !resetNotesAndChat(user.name)) {
                return respond({ error: "The notes were saved, but couldn't be kept for undoing a reset. Nothing was reset." });
            }
            respond({ show: { ...show, recordingParts: parts } });
        }, (error) => {
            console.log(`Error keeping the videos with show "${name}":`, error.message);
            respond({ error: `The notes were saved, but the videos couldn't be kept with them.${data.reset ? ' Nothing was reset.' : ''}` });
        });
    });

    // Handle backup import (only for non-overlay users). The file gets the same
    // check as a backup loaded at start-up, so a bad one changes nothing.
    on('import-backup', (data) => {
        if (user.isOverlay) return; // Overlay users can't import

        const problem = checkBackup(data);
        if (problem) {
            socket.emit('import-error', `Invalid backup: ${problem}.`);
            return;
        }
        console.log(`Backup with ${data.notes.length} notes imported by ${user.name}`);
        globalState.notes = applyAuthors(input.cleanStoredNotes(data.notes), data.authors);
        // Notes that fail the per-note checks are dropped; say so rather than report a clean import.
        const skipped = data.notes.length - globalState.notes.length;
        if (skipped) console.warn(`Import skipped ${skipped} of ${data.notes.length} notes that could not be read`);
        globalState.showLog = showLog.cleanShowLog(data.showLog);

        // Restore tags if present in backup
        if (data.tags) {
            globalState.tags = storedTags(data.tags);
            saveTagsToFile(); // Save to tags.json
        }

        // Broadcast updates to all clients
        io.emit('notes-update', globalState.notes);
        io.emit('tags-update', globalState.tags);
        io.emit('show-log-update', globalState.showLog);
        scheduleBackup();

        // Notify the importer of success
        socket.emit('import-success', skipped
            ? `Backup imported, but ${skipped} of ${data.notes.length} notes could not be read and were skipped.`
            : 'Backup imported successfully.');
    });

    // Handle export requests (only for non-overlay users)
    on('export-request', (format) => {
        if (user.isOverlay) return; // Overlay users can't export

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        let data, mimeType, filename;

        if (format === 'json') {
            data = JSON.stringify(notesExport(), null, 2);
            mimeType = 'application/json';
            filename = `timecoded-notes-${timestamp}.json`;
        }
        socket.emit('export-data', { data, mimeType, filename });
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        const user = globalState.users.get(socket.id);
        if (user) {
            globalState.users.delete(socket.id);

            // Only notify if this user was in the online users list
            if (!user.isOverlay && !user.isConfig) {
                const filteredUsers = listedUsers();
                if (!isListed(user.id)) {
                    io.emit('user-left', {
                        user: user.name,
                        userCount: filteredUsers.length
                    });
                }
                io.emit('users-update', filteredUsers);
            }
        }
    });
});

// Clears every note and chat message on the server and in every connected
// browser. Closing the chat restore window drops any offers and stops browsers
// from offering their copy again, and the backup written straight afterwards
// is the newest one, so a restart cannot bring the cleared notes back. Tags
// are kept: they are the department list, not show data, and the notes that
// are gone were the only things that used them.
// Bumped by every reset, so a save that waited on its videos can tell whether
// the notes it saved are still the live ones.
let resetCount = 0;

// The notes are kept first (reset-notes.js) so the reset can be undone for a
// few days; if they can't be written nothing is reset, and this returns false.
function resetNotesAndChat(resetBy) {
    if (globalState.notes.length) {
        try {
            resetNotes.keepReset(RESETS_DIR, notesExport(), resetBy);
        } catch (error) {
            console.log('Error keeping the notes before a reset:', error.message);
            return false;
        }
        resetsChanged();
    }
    resetCount++;
    globalState.notes = [];
    globalState.chatMessages = [];
    globalState.showLog = [];
    recordings.removeCollection(RECORDINGS_DIR, 'live');
    recordingsChanged('live');
    chatRestore.close();
    io.emit('all-reset'); // each page also drops its saved chat copy and unsent notes
    io.emit('notes-update', globalState.notes);
    io.emit('show-log-update', globalState.showLog);
    emitToChatClients('chat-messages-update', globalState.chatMessages);
    backup(true);
    return true;
}

// Typing changes go to everyone with the whole list, so with a full room a
// burst of them is sent as one: the first at once, the rest as a single
// update USERS_UPDATE_MS later.
const USERS_UPDATE_MS = 250;
let typingTimer = null;
let typingChanged = false;

function broadcastTyping() {
    if (typingTimer) {
        typingChanged = true;
        return;
    }
    io.emit('users-update', listedUsers());
    typingTimer = setTimeout(() => {
        typingTimer = null;
        if (!typingChanged) return;
        typingChanged = false;
        broadcastTyping();
    }, USERS_UPDATE_MS);
}

// Users shown in the online users list: one entry per person (Keycloak sub),
// however many pages they have open, so a reload, a second tab or a trip to
// the recall page and back never lists anyone twice. Overlay and config pages
// are left out. A person is typing if any of their pages is.
function listedUsers() {
    const people = new Map();
    for (const u of globalState.users.values()) {
        if (u.isOverlay || u.isConfig) continue;
        const seen = people.get(u.id);
        if (!seen) {
            people.set(u.id, { ...u });
            continue;
        }
        if (u.joinedAt < seen.joinedAt) seen.joinedAt = u.joinedAt;
        if (u.isTyping && !seen.isTyping) {
            seen.isTyping = true;
            seen.currentTimecode = u.currentTimecode;
            seen.currentLxCue = u.currentLxCue;
        }
    }
    return [...people.values()];
}

// Whether this person has a page open that is in the online users list.
function isListed(userId) {
    for (const u of globalState.users.values()) {
        if (u.id === userId && !u.isOverlay && !u.isConfig) return true;
    }
    return false;
}

// Helper functions for tags
function generateId() {
    return crypto.randomUUID();
}

function getRandomColor() {
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F'];
    return colors[Math.floor(Math.random() * colors.length)];
}

if (midiInput) {
    console.log('MIDI device detected - listening for timecode');
} else {
    console.log('No MIDI devices detected - MIDI timecode disabled');
    // Set time mode to realtime if no MIDI available
    globalState.timeMode = 'realtime';
}

initKeycloak().finally(() => {
    server.listen(PORT, () => {
        console.log(`MIDI Timecode Notes Server running on http://localhost:${PORT}`);
        if (oscServer) {
            console.log(`OSC Server listening for LX cues on port ${oscPort}`);
        }

        connectToEOS();
        startNetworkTimecode();
    });
});

process.on('SIGINT', () => {
    if (midiInput) midiInput.close();
    if (oscServer) oscServer.close();
    if (networkRetryTimer) clearTimeout(networkRetryTimer);
    stopGatewayLock();
    if (networkSocket) networkSocket.close();
    process.exit();
});
