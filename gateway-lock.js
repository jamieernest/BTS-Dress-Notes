// Automatic interface mode for network timecode: join the gateway's multicast
// group on every interface, lock onto the first gateway heard (source address
// and ACN CID) and the interface it arrived on, and drop the other memberships.
// If the locked gateway goes silent for `lostMs`, the lock is released and the
// group is joined everywhere again.
//
// dgram doesn't say which interface a packet arrived on, so it is taken to be
// the joined interface whose subnet holds the gateway's address. A gateway on
// no local subnet (routed multicast) is still locked onto, but every
// membership is kept since the arrival interface can't be told apart.
const { inSubnet } = require('./net-iface');

function createGatewayLock({
    socket,                 // bound dgram socket (addMembership/dropMembership)
    group,                  // multicast group address
    listInterfaces,         // () => [{ name, address, netmask }]
    lostMs,
    log = console.log,
    onChange = () => {},    // called whenever state() changes
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout
}) {
    const joined = new Map();       // address -> { name, address, netmask }
    const failed = new Set();       // addresses whose join failure was logged
    const ignored = new Set();      // `${address} ${cid}` of gateways logged as ignored
    let lock = null;                // { address, cid, iface }
    let lastSeen = 0;
    let timer = null;

    function schedule(delay) {
        if (timer) clearTimer(timer);
        timer = setTimer(tick, delay);
    }

    // While locked: release after lostMs of silence. While unlocked: join any
    // interface that has come up since the last scan.
    function tick() {
        timer = null;
        if (!lock) {
            if (joinAll()) onChange();
            schedule(lostMs);
            return;
        }
        const silent = now() - lastSeen;
        if (silent < lostMs) {
            schedule(lostMs - silent);
            return;
        }
        log(`Network timecode: nothing from gateway ${lock.address} for ${lostMs / 1000} s - listening on all interfaces again`);
        lock = null;
        ignored.clear();
        joinAll();
        onChange();
        schedule(lostMs);
    }

    // Join the group on every interface, forgetting ones that have gone away.
    // Interfaces already joined are joined again, since an adapter unplugged
    // and plugged back in loses its membership; EADDRINUSE means it is still
    // there. A failed join (VPN and virtual adapters often refuse) is logged
    // once and skipped. Returns whether the joined set changed.
    function joinAll() {
        let changed = false;
        const present = listInterfaces();
        const addresses = new Set(present.map(i => i.address));
        for (const address of [...joined.keys()]) {
            if (addresses.has(address)) continue;
            try {
                socket.dropMembership(group, address);
            } catch {
                // The membership went with the interface.
            }
            joined.delete(address);
            changed = true;
        }
        for (const iface of present) {
            try {
                socket.addMembership(group, iface.address);
            } catch (error) {
                if (error.code !== 'EADDRINUSE') {
                    if (joined.delete(iface.address)) changed = true;
                    if (!failed.has(iface.address)) {
                        failed.add(iface.address);
                        log(`Network timecode: can't join ${group} on ${iface.name} (${iface.address}): ${error.message} - skipping it`);
                    }
                    continue;
                }
            }
            failed.delete(iface.address);
            if (!joined.has(iface.address)) changed = true;
            joined.set(iface.address, iface);
        }
        return changed;
    }

    function dropAllBut(keep) {
        for (const address of [...joined.keys()]) {
            if (address === keep) continue;
            try {
                socket.dropMembership(group, address);
            } catch {
                // The interface may have gone away; the membership went with it.
            }
            joined.delete(address);
        }
    }

    function start() {
        joinAll();
        schedule(lostMs);
        if (joined.size > 0) {
            log(`Network timecode: listening for a gateway on ${group} on all interfaces: ` +
                [...joined.values()].map(i => `${i.name} (${i.address})`).join(', '));
        }
        return joined.size;
    }

    // Returns whether a packet from `address` with sender `cid` comes from the
    // accepted gateway. Only a packet carrying MIDI can take the lock; any
    // packet from the locked gateway (keepalives included) keeps it.
    function accept(address, cid, hasMidi) {
        if (!cid) return false;
        if (lock) {
            if (address === lock.address && cid === lock.cid) {
                lastSeen = now();
                return true;
            }
            const key = `${address} ${cid}`;
            if (hasMidi && !ignored.has(key)) {
                ignored.add(key);
                log(`Network timecode: ignoring MIDI from ${address} (CID ${cid}) - locked onto gateway ${lock.address}`);
            }
            return false;
        }
        if (!hasMidi) return false;
        const iface = [...joined.values()].find(i => inSubnet(address, i.address, i.netmask)) || null;
        lock = { address, cid, iface };
        lastSeen = now();
        if (iface) {
            dropAllBut(iface.address);
            log(`Network timecode: locked onto gateway ${address} (CID ${cid}) on ${iface.name} (${iface.address})`);
        } else {
            log(`Network timecode: locked onto gateway ${address} (CID ${cid}), which is on no local subnet - staying joined on all interfaces`);
        }
        schedule(lostMs);
        onChange();
        return true;
    }

    function state() {
        return {
            locked: !!lock,
            gateway: lock ? lock.address : null,
            gatewayCid: lock ? lock.cid : null,
            interfaceName: lock && lock.iface ? lock.iface.name : null,
            interfaceAddress: lock && lock.iface ? lock.iface.address : null,
            joined: [...joined.values()].map(i => ({ name: i.name, address: i.address }))
        };
    }

    function stop() {
        if (timer) clearTimer(timer);
        timer = null;
    }

    return { start, accept, state, stop };
}

module.exports = { createGatewayLock };
