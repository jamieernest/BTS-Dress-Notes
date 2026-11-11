// Overlays (overlay.html, overlay-cast.html) run on the machine that hosts the
// server, so a request that really comes from that machine needs no login.
// "Really" means the raw connection address, never a header a remote client
// can set. A reverse proxy on the same host would make every remote request
// look like loopback, so any forwarding header disqualifies the request.

const OVERLAY_PATHS = new Set([
    '/overlay.html', '/overlay-cast.html',
    '/overlay-style.css', '/overlay.js', '/overlay-cast.js',
    '/keepalive.js', '/timecode-format.js'
]);

function isLoopbackAddress(address) {
    return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function isDirectLoopback(req) {
    const headers = req.headers || {};
    if (headers['x-forwarded-for'] || headers.forwarded || headers['x-real-ip']) return false;
    return isLoopbackAddress(req.socket && req.socket.remoteAddress);
}

// An HTTP request for an overlay page or one of its assets.
function isLoopbackOverlayRequest(req) {
    if (!isDirectLoopback(req)) return false;
    const path = String(req.path || '').toLowerCase();
    if (OVERLAY_PATHS.has(path)) return true;
    // The overlays' keepalive ping; without the flag /session still 401s.
    return path === '/session' && !!req.query && req.query.overlay === '1';
}

// A socket handshake from an overlay page. `page` is what pageOf() decided.
function isLoopbackOverlaySocket(socket, page) {
    return page === 'overlay' && isDirectLoopback(socket.request);
}

module.exports = { isLoopbackAddress, isDirectLoopback, isLoopbackOverlayRequest, isLoopbackOverlaySocket };
