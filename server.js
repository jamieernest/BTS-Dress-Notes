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

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const eosHost = process.env.EOS_HOST || '10.10.160.143';
const eosPort = process.env.EOS_PORT || 3037;
const oscPort = process.env.OSC_PORT || 8001;

// Network timecode from the ETC Response MIDI gateway (ACN/SDT multicast).
// The group address is chosen by the gateway; 239.194.242.66 has held across
// gateway and Eos restarts, but it stays configurable.
const gatewayGroup = process.env.GATEWAY_MCAST || '239.194.242.66';
const gatewayIp = process.env.GATEWAY_IP || null; // optional source filter
const gatewayIface = process.env.GATEWAY_IFACE || undefined; // local IP of the NIC to join on
const ACN_PORT = 5568;
const NETWORK_STOP_MS = 250; // the gateway sends no stop message; quarter-frames just cease
const NETWORK_RETRY_MS = 5000; // the venue interface may not be up yet when the service starts

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

// Session cookie is signed by this app; secure:false is intentional - the
// venue LAN serves this app over plain HTTP, and the goal is to minimize
// dependence on anything outside the venue LAN (see captain's decision).
const sessionMiddleware = session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 12 * 60 * 60 * 1000 // 12 hours - long enough to cover a show
    }
});
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

// Authorization Code + PKCE redirect to Keycloak.
app.get('/login', async (req, res) => {
    if (!oidcConfig) {
        return res.status(503).send('Keycloak SSO is not configured or unreachable. Set KEYCLOAK_ISSUER, KEYCLOAK_CLIENT_ID, KEYCLOAK_CLIENT_SECRET and SESSION_SECRET, then restart the server.');
    }
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const state = oidc.randomState();
    req.session.oidc = { codeVerifier, state };
    const redirectUri = `${req.protocol}://${req.get('host')}/callback`;
    const authUrl = oidc.buildAuthorizationUrl(oidcConfig, {
        redirect_uri: redirectUri,
        scope: 'openid profile email',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state
    });
    res.redirect(authUrl.href);
});

// Exchanges the authorization code, populates req.session.user from the
// Keycloak claims (sub is the stable per-account identifier we key notes on).
app.get('/callback', async (req, res) => {
    if (!oidcConfig) {
        return res.status(503).send('Keycloak SSO is not configured or unreachable.');
    }
    const pending = req.session.oidc;
    if (!pending || !pending.codeVerifier || !pending.state) {
        return res.redirect('/login');
    }
    try {
        const tokens = await oidc.authorizationCodeGrant(oidcConfig, currentUrlFor(req), {
            pkceCodeVerifier: pending.codeVerifier,
            expectedState: pending.state
        });
        const claims = tokens.claims();
        if (!claims || !claims.sub) {
            throw new Error('Keycloak did not return identity claims');
        }
        req.session.user = {
            sub: claims.sub,
            name: claims.name || claims.preferred_username || claims.email || claims.sub,
            email: claims.email || null,
            idToken: tokens.id_token || null
        };
        delete req.session.oidc;
        const returnTo = req.session.returnTo || '/';
        delete req.session.returnTo;
        res.redirect(returnTo);
    } catch (error) {
        console.error('Keycloak callback failed:', error.message);
        res.status(401).send('Login failed. Please try again.');
    }
});

// Destroys the local session and redirects to Keycloak's end-session endpoint.
app.get('/logout', (req, res) => {
    const idToken = req.session.user && req.session.user.idToken;
    req.session.destroy(() => {
        if (oidcConfig) {
            try {
                const endSessionUrl = oidc.buildEndSessionUrl(oidcConfig, {
                    post_logout_redirect_uri: `${req.protocol}://${req.get('host')}/login`,
                    ...(idToken ? { id_token_hint: idToken } : {})
                });
                return res.redirect(endSessionUrl.href);
            } catch (error) {
                // Issuer has no end_session_endpoint configured - fall through to /login.
            }
        }
        res.redirect('/login');
    });
});

// Auth guard - no page is exempt, including static assets, overlay/cast
// pages and the recall/backup-viewer page. /login, /callback and /logout
// above are registered before this and stay reachable without a session.
function requireAuth(req, res, next) {
    if (req.session && req.session.user && req.session.user.sub) {
        return next();
    }
    req.session.returnTo = req.originalUrl;
    res.redirect('/login');
}

app.use(requireAuth);

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Add explicit route for root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Add route for recall page
app.get('/recall.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'recall.html'));
});

app.get('/config.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'config.html'));
});

app.get('/overlay.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'overlay.html'));
});

app.get('/overlay-cast.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'overlay-cast.html'));
});

app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'favicon.ico'));
});

// Load tags from JSON file
let tags = [];
try {
    const tagsData = fs.readFileSync(path.join(__dirname, 'tags.json'), 'utf8');
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

// Function to save tags to file
function saveTagsToFile() {
    try {
        fs.writeFileSync(path.join(__dirname, 'tags.json'), JSON.stringify({ tags: tags }, null, 2));
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
    currentAct: 'Preshow'
};

// Try to use EasyMIDI
let midiInput = null;
let openedPortName = 'None';
let mtcMessagesReceived = 0;

try {
    const easymidi = require('easymidi');
    console.log('EasyMIDI module loaded successfully');
    
    const inputs = easymidi.getInputs();
    console.log('Available MIDI inputs:', inputs);
    
    if (inputs.length > 1) {
        const inputName = inputs[1];
        midiInput = new easymidi.Input(inputName);
        openedPortName = inputName;
        globalState.timecode.source = 'midi';
    } else if (inputs.length > 0) {
        const inputName = inputs[0];
        midiInput = new easymidi.Input(inputName);
        openedPortName = inputName;
        globalState.timecode.source = 'midi';
    } else {
        console.log('No MIDI inputs available. Running in demo mode.');
    }
} catch (error) {
    console.log('EasyMIDI not available:', error.message);
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
            console.log(`Updated current act to: ${act}`);
            io.emit('act-update', act);
        }
    }
}

const connectMessage = new Message('/eos/subscribe=1');
const buffer = encode(connectMessage);

function subscribeToEOS() {
    let eosClient = new net.Socket();
    eosClient.connect(eosPort, eosHost);

    eosClient.on('connect', function() {
        console.log('Connected to EOS');
        eosClient.write(buffer);
    });

    const pushSlip = createSlipDecoder(function(packet) {
        for (const [address, value] of decodeOscPacket(packet)) {
            if (process.env.DEBUG_EOS) {
                console.log(`Received: ${address} ${value === undefined ? '' : JSON.stringify(value)}`);
            }
            handleOscMessage(address, value);
        }
    });

    eosClient.on('data', pushSlip);

    eosClient.on('error', function(err) {
        console.log('Error connecting to EOS via TCP:', err);
    });
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
    listening: false,
    running: false,
    source: null,
    error: null
};
let networkSocket = null;
let networkStopTimer = null;
let networkRetryTimer = null;
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
    if (messages.length === 0) return; // keepalives, ACKs, sACN and other ACN traffic

    if (gatewayIp && rinfo.address !== gatewayIp) {
        if (!ignoredGatewaySources.has(rinfo.address)) {
            ignoredGatewaySources.add(rinfo.address);
            console.log(`Network timecode: ignoring MIDI from ${rinfo.address} (CID ${senderCid(buf)}) on ${gatewayGroup} - GATEWAY_IP is ${gatewayIp}`);
        }
        return;
    }
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

function startNetworkTimecode() {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true }); // sACN shares port 5568
    socket.on('message', handleGatewayPacket);
    socket.on('error', (error) => {
        if (networkSocket !== socket) return;
        console.log(`Network timecode: socket error on ${gatewayGroup}:${ACN_PORT}: ${error.message} - retrying in ${NETWORK_RETRY_MS / 1000} s`);
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
        try {
            socket.addMembership(gatewayGroup, gatewayIface);
        } catch (error) {
            socket.emit('error', new Error(`could not join multicast group: ${error.message}`));
            return;
        }
        networkStatus.listening = true;
        networkStatus.error = null;
        console.log(`Network timecode: joined multicast group ${gatewayGroup}:${ACN_PORT}` +
            (gatewayIface ? ` on interface ${gatewayIface}` : '') +
            `, accepting MIDI from ${gatewayIp || 'any gateway'}`);
        emitNetworkStatus();
    });
    networkSocket = socket;
}

// Timecode of the source the current time mode displays.
function currentModeTimecode() {
    return globalState.timeMode === 'network' ? globalState.networkTimecode : globalState.timecode;
}

function formatTimecode(tc) {
    if (!tc || typeof tc !== 'object') {
        return '00:00:00:00';
    }
    return `${(tc.hours || 0).toString().padStart(2, '0')}:${(tc.minutes || 0).toString().padStart(2, '0')}:${(tc.seconds || 0).toString().padStart(2, '0')}:${(tc.frames || 0).toString().padStart(2, '0')}`;
}

// EasyMIDI message handler
if (midiInput) {
    midiInput.on('message', (msg) => {
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
    });
}

function backup(sync = false) {
    let data;
    const exportData = {
        notes: globalState.notes,
        exportedAt: new Date().toISOString(),
        totalNotes: globalState.notes.length,
        users: Array.from(globalState.users.values()).filter(u => !u.isOverlay).map(u => ({
            name: u.name,
            joinedAt: u.joinedAt
        })),
        tags: globalState.tags
    };
    data = JSON.stringify(exportData, null, 2);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${timestamp}.json`;
    try {
        fs.mkdirSync(path.join(__dirname, 'backups'), { recursive: true });
        if (sync) {
            // Crash/shutdown handlers call process.exit() immediately after
            // backup(), so the write must complete before returning.
            fs.writeFileSync(path.join(__dirname, 'backups', filename), data);
            console.log(`Backup saved to backups/${filename}`);
        } else {
            fs.writeFile(path.join(__dirname, 'backups', filename), data, (error) => {
                if (error) {
                    console.log('Error saving backup file:', error.message);
                } else {
                    console.log(`Backup saved to backups/${filename}`);
                }
            });
        }
    } catch (error) {
        console.log('Error saving backup file:', error.message);
    }
}

// Schedule backups every minute
setInterval(backup, 1 * 60 * 1000);

// Delete backups older than 1 day
setInterval(() => {
    const backupDir = path.join(__dirname, 'backups');
    fs.readdir(backupDir, (err, files) => {
        if (err) return;
        const now = Date.now();
        files.forEach(file => {
            const filePath = path.join(backupDir, file);
            fs.stat(filePath, (err, stats) => {
                if (err) return;
                const age = now - stats.mtimeMs;
                if (age > 24 * 60 * 60 * 1000) {
                    fs.unlink(filePath, (error) => {
                        if (error) return;
                        console.log(`Deleted old backup file: ${file}`);
                    });
                }
            });
        });
    });
}, 24 * 60 * 60 * 1000);

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

process.on('SIGINT', () => {
    console.log('Received SIGINT. Backing up and shutting down...');
    backup(true);
    process.exit(0);
});


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

// WebSocket connections
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    const sessionUser = socket.request.session.user;
    const isOverlay = socket.handshake.headers.referer &&
                     (socket.handshake.headers.referer.includes('overlay.html') || socket.handshake.headers.referer.includes('overlay-cast.html'));

    const user = {
        id: sessionUser.sub,
        name: sessionUser.name,
        isTyping: false,
        currentTimecode: null,
        currentLxCue: null,
        joinedAt: new Date(),
        isOverlay: isOverlay
    };

    globalState.users.set(socket.id, user);

    // Send current state to newly connected client
    socket.emit('act-update', globalState.currentAct);
    socket.emit('timecode-update', globalState.timecode);
    socket.emit('timecode-update', globalState.networkTimecode);
    socket.emit('notes-update', globalState.notes);
    socket.emit('tags-update', globalState.tags);
    socket.emit('time-mode-update', globalState.timeMode);
    socket.emit('lx-cue-update', globalState.currentLxCue);
    socket.emit('system-status', {
        midiAvailable: !!midiInput,
        portCount: midiInput ? require('easymidi').getInputs().length : 0,
        currentPort: openedPortName,
        mtcMessagesReceived: mtcMessagesReceived,
        oscAvailable: !!oscServer
    });
    socket.emit('network-timecode-status', networkStatus);

    // Only send user-related updates if this is NOT an overlay
    if (!isOverlay) {
        socket.emit('current-user', { name: user.name, sub: user.id });

        // Send filtered users list (excluding overlay users)
        const filteredUsers = Array.from(globalState.users.values()).filter(u => !u.isOverlay);
        socket.emit('users-update', filteredUsers);
        
        // Notify about new user joining (only for non-overlay users)
        io.emit('user-joined', {
            user: user.name,
            userCount: filteredUsers.length
        });
    } else {
        // Overlay users get minimal user info
        socket.emit('users-update', []);
    }

    // Handle note tag updates
    socket.on('note-update-tags', (data) => {
        if (user.isOverlay) return;
        const { noteId, tags } = data;
        const note = globalState.notes.find(n => n.id === noteId);
        if (note) {
            note.tags = tags;
            io.emit('note-update-tags', { noteId, tags });
        }
    });

    // Handle tag creation/updates
    socket.on('create-tag', (tagData) => {
        const newTag = {
            id: tagData.id || generateId(),
            name: tagData.name,
            color: tagData.color || getRandomColor()
        };
        
        const existingIndex = globalState.tags.findIndex(tag => tag.id === newTag.id);
        if (existingIndex >= 0) {
            globalState.tags[existingIndex] = newTag;
        } else {
            globalState.tags.push(newTag);
        }
        
        saveTagsToFile();
        io.emit('tags-update', globalState.tags);
    });

    // Handle tag deletion
    socket.on('delete-tag', (tagId) => {
        globalState.tags = globalState.tags.filter(tag => tag.id !== tagId);
        saveTagsToFile();
        io.emit('tags-update', globalState.tags);
    });
    
    // Handle user starting to type (only for non-overlay users)
    socket.on('typing-start', (data) => {
        if (user.isOverlay) return; // Overlay users can't type
        
        user.isTyping = true;
        user.currentTimecode = data.timecode || {...currentModeTimecode()};
        user.currentLxCue = data.lxCue || globalState.currentLxCue;
        
        // Send filtered users list (excluding overlay users)
        const filteredUsers = Array.from(globalState.users.values()).filter(u => !u.isOverlay);
        io.emit('users-update', filteredUsers);
    });
    
    // Handle user stopping typing (only for non-overlay users)
    socket.on('typing-stop', () => {
        if (user.isOverlay) return; // Overlay users can't type
        
        user.isTyping = false;
        user.currentTimecode = null;
        user.currentLxCue = null;
        
        // Send filtered users list (excluding overlay users)
        const filteredUsers = Array.from(globalState.users.values()).filter(u => !u.isOverlay);
        io.emit('users-update', filteredUsers);
    });
    
    // Handle time mode change (only for non-overlay users)
    socket.on('time-mode-change', (newMode) => {
        if (user.isOverlay) return; // Overlay users can't change time mode
        
        if (newMode === 'midi' || newMode === 'network' || newMode === 'realtime') {
            globalState.timeMode = newMode;
            io.emit('time-mode-update', globalState.timeMode);
        }
    });

    // Handle LX Cue change (manual input - will be overridden by OSC)
    socket.on('lx-cue-change', (newCue) => {
        if (user.isOverlay) return; // Overlay users can't change LX cues
        
        // Only update if OSC is not available, or allow manual override
        if (!oscServer) {
            globalState.currentLxCue = newCue;
            io.emit('lx-cue-update', globalState.currentLxCue);
        } else {
            // OSC is available, so manual changes are temporary
            // You could choose to still update or ignore manual changes
            console.log('Manual LX cue change ignored - OSC source is active');
        }
    });
    
    // Handle note submission (only for non-overlay users)
    socket.on('note-submit', (data) => {
        if (user.isOverlay) return;
        
        const noteTimecode = data.timecode || {...currentModeTimecode()};
        
        const note = {
            id: Date.now() + Math.random().toString(36).substr(2, 9),
            user: user.name,
            userId: user.id,
            text: data.text,
            timecode: noteTimecode,
            lxCue: data.lxCue || globalState.currentLxCue,
            timestamp: new Date().toISOString(),
            frameRate: data.frameRate || currentModeTimecode().frameRate,
            tags: data.tags || [],
            act: globalState.currentAct, // Use current act from OSC
            comments: []
        };
        
        globalState.notes.push(note);
        
        io.emit('note-added', note);
    });

    // Handle comment submission (only for non-overlay users)
    socket.on('comment-submit', (data) => {
        if (user.isOverlay) return;
        const { noteId, text } = data;
        const note = globalState.notes.find(n => n.id === noteId);
        if (note) {
            const comment = {
                id: Date.now() + Math.random().toString(36).substr(2, 9),
                user: user.name,
                userId: user.id,
                text: text,
                timestamp: new Date().toISOString()
            };
            if (!note.comments) note.comments = [];
            note.comments.push(comment);
            io.emit('comment-submit', { noteId, comment });
        }
    });

    // Handle chat message submission (only for non-overlay users)
    socket.on('chat-message', (data) => {
        if (user.isOverlay) return; // Overlay users can't chat
        
        const chatMessage = {
            id: Date.now() + Math.random().toString(36).substr(2, 9),
            user: user.name,
            userId: user.id,
            text: data.text,
            timestamp: new Date().toISOString()
        };
        
        globalState.chatMessages.push(chatMessage);
        
        // Keep only last 100 messages to prevent memory issues
        if (globalState.chatMessages.length > 100) {
            globalState.chatMessages = globalState.chatMessages.slice(-100);
        }
        
        io.emit('chat-message-added', chatMessage);
        io.emit('chat-messages-update', globalState.chatMessages);
    });

    // Send chat history to newly connected clients (only for non-overlay)
    if (!isOverlay) {
        socket.emit('chat-messages-update', globalState.chatMessages);
    }

    // Handle note text editing (only for non-overlay users)
    socket.on('note-edit-text', (data) => {
        if (user.isOverlay) return;
        const { noteId, newText } = data;
        const note = globalState.notes.find(n => n.id === noteId);
        if (note) {
            note.text = newText;
            note.lastEdited = new Date().toISOString();
            note.lastEditedBy = user.name;
            io.emit('note-edit-text', { 
                noteId, 
                newText, 
                lastEditedBy: user.name, 
                lastEdited: note.lastEdited 
            });
        }
    });
    // Handle comment editing (only for non-overlay users)
    socket.on('comment-edit', (data) => {
        if (user.isOverlay) return;
        const { noteId, commentId, newText } = data;
        const note = globalState.notes.find(n => n.id === noteId);
        if (note && note.comments) {
            const comment = note.comments.find(c => c.id === commentId);
            if (comment) {
                comment.text = newText;
                comment.lastEdited = new Date().toISOString();
                comment.lastEditedBy = user.name;
                io.emit('comment-edit', { 
                    noteId, 
                    commentId, 
                    newText, 
                    lastEditedBy: user.name, 
                    lastEdited: comment.lastEdited 
                });
            }
        }
    });
    // Handle comment deletion (only for non-overlay users)
    socket.on('comment-delete', (data) => {
        if (user.isOverlay) return;
        const { noteId, commentId } = data;
        const note = globalState.notes.find(n => n.id === noteId);
        if (note && note.comments) {
            note.comments = note.comments.filter(c => c.id !== commentId);
            io.emit('comment-delete', { noteId, commentId });
        }
    });
    
    // Handle backup import (only for non‑overlay users)
    socket.on('import-backup', (data) => {
        if (user.isOverlay) return; // Overlay users can't import

        // Validate that the backup contains a notes array and optionally tags
        if (data && Array.isArray(data.notes)) {
            globalState.notes = data.notes;
            
            // Restore tags if present in backup
            if (data.tags && Array.isArray(data.tags)) {
                globalState.tags = data.tags;
                saveTagsToFile(); // Save to tags.json
            }

            // Broadcast updates to all clients
            io.emit('notes-update', globalState.notes);
            io.emit('tags-update', globalState.tags);

            // Notify the importer of success
            socket.emit('import-success', 'Backup imported successfully.');
        } else {
            socket.emit('import-error', 'Invalid backup format (missing notes array).');
        }
    });

    // Handle export requests (only for non-overlay users)
    socket.on('export-request', (format) => {
        if (user.isOverlay) return; // Overlay users can't export
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        let data, mimeType, filename;
        
        if (format === 'json') {
            const exportData = {
                notes: globalState.notes,
                exportedAt: new Date().toISOString(),
                totalNotes: globalState.notes.length,
                users: Array.from(globalState.users.values()).filter(u => !u.isOverlay).map(u => ({
                    name: u.name,
                    joinedAt: u.joinedAt
                })),
                tags: globalState.tags
            };
            data = JSON.stringify(exportData, null, 2);
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
            
            // Only notify if this was NOT an overlay user
            if (!user.isOverlay) {
                const filteredUsers = Array.from(globalState.users.values()).filter(u => !u.isOverlay);
                io.emit('user-left', {
                    user: user.name,
                    userCount: filteredUsers.length
                });
                io.emit('users-update', filteredUsers);
            }
        }
    });
});

// Helper functions for tags
function generateId() {
    return Math.random().toString(36).substr(2, 9);
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

const PORT = process.env.PORT || 80;

initKeycloak().finally(() => {
    server.listen(PORT, () => {
        console.log(`MIDI Timecode Notes Server running on http://localhost:${PORT}`);
        if (oscServer) {
            console.log(`OSC Server listening for LX cues on port ${oscPort}`);
        }

        subscribeToEOS();
        startNetworkTimecode();
    });
});

process.on('SIGINT', () => {
    if (midiInput) midiInput.close();
    if (oscServer) oscServer.close();
    if (networkRetryTimer) clearTimeout(networkRetryTimer);
    if (networkSocket) networkSocket.close();
    process.exit();
});