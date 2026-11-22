// A stand-in for the Lumens VC-A61PN's web API: POST /cgi-bin/lums_login.cgi
// and /cgi-bin/lums_configuration.cgi with JSON bodies. It keeps the logins it
// handed out and records every request (with its cookies) so tests can check
// the exact sequence. `restart()` forgets every login like a rebooted camera.
const http = require('node:http');

function createFakeCamera({ port, username = 'cam-user', password = 'cam-pass', loginBody = '{"result":"ok"}' }) {
    const camera = {
        port, requests: [], logins: new Set(), recalls: [], delayMs: 0, failStatus: 0, server: null,
        restart() { camera.logins.clear(); },
        async start() {
            await new Promise((resolve) => camera.server.listen(port, '127.0.0.1', resolve));
        },
        async stop() {
            camera.server.closeAllConnections();
            await new Promise((resolve) => camera.server.close(resolve));
        }
    };

    camera.server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (chunk) => { raw += chunk; });
        req.on('end', () => {
            let body = null;
            try { body = JSON.parse(raw); } catch { /* recorded as null */ }
            camera.requests.push({ path: req.url, method: req.method, headers: req.headers, body });
            const reply = () => {
                const send = (status, text) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(text); };
                if (camera.failStatus) return send(camera.failStatus, '{"result":"error"}');
                if (req.method !== 'POST' || !body) return send(400, '{}');
                if (req.url === '/cgi-bin/lums_login.cgi' && body.cmd === 'loginauth') {
                    if (body.username !== username || body.password !== password) return send(200, '{"result":"fail"}');
                    camera.logins.add(body.uuid);
                    return send(200, loginBody);
                }
                if (req.url === '/cgi-bin/lums_configuration.cgi' && body.cmd === 'campresetrecall') {
                    if (!camera.logins.has(body.uuid)) return send(401, '{"result":"not logged in"}');
                    camera.recalls.push(body.memnum);
                    return send(200, '{"result":"ok"}');
                }
                return send(404, '{}');
            };
            if (camera.delayMs) setTimeout(reply, camera.delayMs); else reply();
        });
    });
    return camera;
}

module.exports = { createFakeCamera };
