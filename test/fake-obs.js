// A stand-in for OBS Studio's WebSocket server (obs-websocket 5): the opening
// Hello/Identify handshake with optional password, GetRecordStatus,
// StartRecord and StopRecord with OBS's own error codes, and the
// RecordStateChanged events, including for recording started or stopped "by
// hand in OBS" (setRecording). Shared by the recorder and server tests.
const crypto = require('node:crypto');
const { WebSocketServer } = require('ws');

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('base64');

function createFakeObs({ port, password = '' }) {
    const obs = {
        port, password, active: false, paused: false, startedAt: null, recordTo: null,
        requests: [], clients: new Set(), hang: false, wss: null,
        // Milliseconds of recording OBS already counts when it says STARTED (the
        // first frame was earlier), and a failing GetRecordStatus for testing the
        // fallback; `statusLogs` records each GetRecordStatus answer's duration.
        leadMs: 0, statusError: false, statusLogs: []
    };

    function send(ws, op, d) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ op, d }));
    }

    function event(data) {
        for (const ws of obs.clients) {
            if (ws.identified) send(ws, 5, { eventType: 'RecordStateChanged', eventIntent: 64, eventData: data });
        }
    }

    const outputEvent = (state, extra = {}) => event({
        outputActive: state === 'STARTED' || state === 'STARTING' || state === 'STOPPING' || state === 'PAUSED' || state === 'RESUMED',
        outputState: `OBS_WEBSOCKET_OUTPUT_${state}`, outputPath: null, ...extra
    });

    obs.setRecording = (on, outputPath) => {
        if (on === obs.active) return;
        obs.active = on;
        if (on) {
            obs.startedAt = Date.now() - obs.leadMs;
            outputEvent('STARTING');
            outputEvent('STARTED');
        } else {
            outputEvent('STOPPING');
            outputEvent('STOPPED', { outputActive: false, outputPath: outputPath || obs.recordTo });
        }
    };

    obs.setPaused = (paused) => {
        obs.paused = paused;
        outputEvent(paused ? 'PAUSED' : 'RESUMED');
    };

    function answer(ws, request) {
        const { requestType, requestId } = request;
        obs.requests.push(requestType);
        if (obs.hang) return;
        const respond = (result, code, responseData, comment) => send(ws, 7, {
            requestType, requestId, requestStatus: { result, code, ...(comment ? { comment } : {}) }, ...(responseData ? { responseData } : {})
        });
        if (requestType === 'GetRecordStatus') {
            if (obs.statusError) return respond(false, 207, null, 'OBS is not ready.');
            obs.statusLogs.push(obs.active ? Date.now() - obs.startedAt : 0);
            return respond(true, 100, {
                outputActive: obs.active, outputPaused: obs.paused, outputTimecode: '00:00:00.000',
                outputDuration: obs.active ? Date.now() - obs.startedAt : 0, outputBytes: 0
            });
        }
        if (requestType === 'StartRecord') {
            if (obs.active) return respond(false, 500, null, 'Recording is already active.');
            respond(true, 100);
            return obs.setRecording(true);
        }
        if (requestType === 'StopRecord') {
            if (!obs.active) return respond(false, 501, null, 'Recording is not active.');
            respond(true, 100, { outputPath: obs.recordTo });
            return obs.setRecording(false);
        }
        respond(false, 204, null, 'Unknown request type.');
    }

    obs.start = () => new Promise((resolve) => {
        obs.wss = new WebSocketServer({
            port, host: '127.0.0.1',
            handleProtocols: (protocols) => (protocols.has('obswebsocket.json') ? 'obswebsocket.json' : false)
        }, resolve);
        obs.wss.on('connection', (ws) => {
            obs.clients.add(ws);
            ws.on('close', () => obs.clients.delete(ws));
            ws.on('error', () => {});
            const auth = password ? { challenge: crypto.randomBytes(8).toString('hex'), salt: crypto.randomBytes(8).toString('hex') } : undefined;
            send(ws, 0, { obsWebSocketVersion: '5.5.0', rpcVersion: 1, ...(auth ? { authentication: auth } : {}) });
            ws.on('message', (data) => {
                const { op, d } = JSON.parse(data.toString());
                if (op === 1) {
                    if (auth && d.authentication !== sha256(sha256(password + auth.salt) + auth.challenge)) {
                        return ws.close(4009, 'Authentication failed.');
                    }
                    ws.identified = true;
                    return send(ws, 2, { negotiatedRpcVersion: 1 });
                }
                if (op === 6 && ws.identified) answer(ws, d);
            });
        });
    });

    // Closes every connection and the listener, as quitting OBS does.
    obs.stop = () => new Promise((resolve) => {
        for (const ws of obs.clients) ws.terminate();
        if (!obs.wss) return resolve();
        const wss = obs.wss;
        obs.wss = null;
        wss.close(() => resolve());
    });

    return obs;
}

module.exports = { createFakeObs };
