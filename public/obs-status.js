// How the OBS recording state (`obs-status` from the server) reads on the
// notes page indicator and the Config & Status row. The state comes from OBS
// itself, so it stays right when someone presses Record in OBS by hand.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ObsStatus = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    const NAMES = {
        connecting: 'Connecting to OBS',
        idle: 'Not recording',
        starting: 'Starting',
        recording: 'Recording',
        paused: 'Recording paused',
        stopping: 'Stopping'
    };

    // { show, tone, label, text }: whether to show it at all (it is off unless
    // OBS is set up), 'ok' / 'live' / 'bad' / '' for the dot, the short label
    // for the indicator and the full sentence for the Config page.
    function describe(status) {
        if (!status || !status.enabled || status.state === 'off') return { show: false, tone: '', label: '', text: '' };
        const state = String(status.state);
        if (state === 'error') {
            const text = status.error || 'OBS is not reachable';
            return { show: true, tone: 'bad', label: 'OBS offline', text };
        }
        const text = NAMES[state] || state;
        const live = state === 'recording' || state === 'starting' || state === 'paused';
        return {
            show: true,
            tone: live ? 'live' : state === 'idle' ? 'ok' : '',
            label: state === 'recording' ? 'REC' : state === 'idle' ? 'OBS idle' : text,
            text
        };
    }

    return { describe };
}));
