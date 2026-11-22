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

    // The Config page's Video offset row (VIDEO_OFFSET_S on the server): { show,
    // tone, text }. Shown with the OBS row; 'bad' when the value was refused.
    function describeOffset(status) {
        if (!status || !status.enabled || status.state === 'off') return { show: false, tone: '', text: '' };
        if (status.videoOffsetError) return { show: true, tone: 'bad', text: status.videoOffsetError };
        const seconds = Number(status.videoOffsetS) || 0;
        if (!seconds) return { show: true, tone: 'ok', text: 'None' };
        const size = `${Math.abs(seconds)} s`;
        return {
            show: true, tone: 'ok',
            text: `${seconds > 0 ? '+' : '-'}${size}: new recordings start ${size} ${seconds > 0 ? 'earlier' : 'later'} against the notes`
        };
    }

    return { describe, describeOffset };
}));
