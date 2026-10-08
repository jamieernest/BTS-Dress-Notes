// The online users list: one entry per person, listing the devices they are on.
// A device is a browser profile (its id lives in localStorage and is shared by
// its tabs), so many tabs are one device while a phone and a laptop are two.

// "Chrome, Windows" from a User-Agent header; "Unknown device" if nothing is recognised.
// Order matters: most browsers (and Edge, Opera, Chrome on iOS...) also say "Chrome" or "Safari".
function deviceLabel(userAgent) {
    const ua = String(userAgent || '');
    const browser = [
        [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
        [/\bOPR\/|\bOpera\b|\bOPT\//, 'Opera'],
        [/\bSamsungBrowser\//, 'Samsung Internet'],
        [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
        [/\bChrome\/|\bCriOS\//, 'Chrome'],
        [/\bSafari\//, 'Safari']
    ].find(([re]) => re.test(ua));
    // iPhone/iPad before Mac: iPadOS Safari may claim to be a Mac and cannot be told apart.
    const os = [
        [/\b(?:iPhone|iPad|iPod)\b/, 'iOS'],
        [/\bAndroid\b/, 'Android'],
        [/\bCrOS\b/, 'ChromeOS'],
        [/\bWindows\b/, 'Windows'],
        [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
        [/\bLinux\b|\bX11\b/, 'Linux']
    ].find(([re]) => re.test(ua));
    const parts = [browser && browser[1], os && os[1]].filter(Boolean);
    return parts.length ? parts.join(', ') : 'Unknown device';
}

// `sockets` are the server's per-socket user records ({ id (the person), name, deviceId,
// deviceLabel, isTyping, ... }); overlay and config pages are left out. Returns one entry
// per person, in the order they first connected, with a `devices` entry per deviceId.
// A person or device shows as typing while any of their sockets is.
function groupUsers(sockets) {
    const people = new Map();
    for (const u of sockets) {
        if (u.isOverlay || u.isConfig) continue;
        let person = people.get(u.id);
        if (!person) {
            person = { ...u, isTyping: false, devices: [] };
            delete person.deviceId;
            delete person.deviceLabel;
            people.set(u.id, person);
        }
        let device = person.devices.find((d) => d.id === u.deviceId);
        if (!device) {
            device = { id: u.deviceId, label: u.deviceLabel, isTyping: false };
            person.devices.push(device);
        }
        if (u.isTyping && !person.isTyping) {
            person.currentTimecode = u.currentTimecode;
            person.currentLxCue = u.currentLxCue;
        }
        person.isTyping = person.isTyping || !!u.isTyping;
        device.isTyping = device.isTyping || !!u.isTyping;
    }
    return Array.from(people.values());
}

// The id the page sent in the handshake, or a per-socket one for pages that send none.
function deviceIdOf(socket) {
    const sent = socket.handshake.auth && socket.handshake.auth.deviceId;
    return typeof sent === 'string' && /^[\w-]{8,64}$/.test(sent) ? sent : `socket-${socket.id}`;
}

module.exports = { deviceLabel, groupUsers, deviceIdOf };
