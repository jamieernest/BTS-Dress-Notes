// How the camera's last preset recall (`camera-status` from the server) reads
// on the Config & Status page. It never carries the camera's address or login.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CameraStatus = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    // { tone, text }: 'ok' / 'bad' / '' for the dot, and the sentence to show.
    // `clock` formats the time of the recall (the page passes its own).
    function describe(status, clock = () => '') {
        if (!status || !status.configured) return { tone: '', text: 'Not configured' };
        if (status.state === 'ok') {
            const at = clock(status.at);
            return { tone: 'ok', text: `Preset ${status.preset} recalled${at ? ` at ${at}` : ''}` };
        }
        if (status.state === 'failed') {
            const at = clock(status.at);
            return { tone: 'bad', text: `Preset ${status.preset} failed${at ? ` at ${at}` : ''}: ${status.error || 'the recall failed'}` };
        }
        return { tone: '', text: status.error ? status.error : 'No recall yet' };
    }

    return { describe };
}));
