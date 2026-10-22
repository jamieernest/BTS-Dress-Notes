// Choosing the local network interface to join the gateway's multicast group on.
const os = require('os');

function ipToInt(ip) {
    const parts = String(ip).split('.').map(Number);
    if (parts.length !== 4 || parts.some(p => !Number.isInteger(p) || p < 0 || p > 255)) return null;
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

// True when `ip` is on the subnet of an interface with `address`/`netmask`.
function inSubnet(ip, address, netmask) {
    const target = ipToInt(ip);
    const local = ipToInt(address);
    const mask = ipToInt(netmask);
    if (target === null || local === null || mask === null) return false;
    return ((target & mask) >>> 0) === ((local & mask) >>> 0);
}

// Non-internal IPv4 interfaces as [{ name, address, netmask }].
function listIpv4Interfaces(interfaces = os.networkInterfaces()) {
    const result = [];
    for (const [name, addresses] of Object.entries(interfaces)) {
        for (const a of addresses || []) {
            // Node 18.0-18.3 reported family as the number 4.
            if ((a.family === 'IPv4' || a.family === 4) && !a.internal) {
                result.push({ name, address: a.address, netmask: a.netmask });
            }
        }
    }
    return result;
}

// Resolve an interface chosen on the config page or by GATEWAY_IFACE (a local
// IPv4 address) to { address, reason }. Automatic mode ('auto') is handled by
// gateway-lock.js instead.
function resolveInterface(selection, interfaces) {
    const match = interfaces.find(i => i.address === selection);
    return {
        address: selection,
        reason: match ? `selected (${match.name})` : 'selected, but no interface currently has this address'
    };
}

module.exports = { inSubnet, listIpv4Interfaces, resolveInterface };
