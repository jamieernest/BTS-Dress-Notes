document.addEventListener('DOMContentLoaded', function() {
    const byId = id => document.getElementById(id);
    const connectionStatus = byId('connectionStatus');
    const midiStatus = byId('midiStatus');
    const networkStatus = byId('networkStatus');
    const oscStatus = byId('oscStatus');
    const timeModeStatus = byId('timeModeStatus');
    const timeModeButtons = document.querySelectorAll('.time-mode-button');
    const midiModeButton = document.querySelector('.time-mode-button[data-mode="midi"]');

    const timeModeNames = {
        midi: 'Time Mode: MIDI Timecode',
        network: 'Time Mode: Network Timecode (MIDI gateway)',
        realtime: 'Time Mode: Real Time (System Clock)'
    };
    let timeMode = null;

    function formatTimecode(tc) {
        const pad = n => (n || 0).toString().padStart(2, '0');
        return `${pad(tc.hours)}:${pad(tc.minutes)}:${pad(tc.seconds)}:${pad(tc.frames)}`;
    }

    function updateTimeModeDisplay() {
        timeModeStatus.textContent = timeModeNames[timeMode] || `Time Mode: ${timeMode}`;
        timeModeButtons.forEach(button => button.classList.toggle('active', button.dataset.mode === timeMode));
    }

    const socket = io();

    socket.on('connect', () => {
        connectionStatus.textContent = 'Connected to Server';
        connectionStatus.className = 'status-connected';
    });

    socket.on('disconnect', () => {
        connectionStatus.textContent = 'Disconnected from Server';
        connectionStatus.className = 'status-disconnected';
    });

    // A refused handshake means the session is gone; retrying can't succeed.
    socket.on('connect_error', (err) => {
        if (err && err.message === 'unauthorized') {
            window.location.href = '/login';
        }
    });

    socket.on('current-user', (data) => {
        byId('currentUserName').textContent = data.name;
    });

    socket.on('users-update', (users) => {
        byId('onlineUsers').textContent = users.length
            ? `${users.length}: ${users.map(u => u.name).join(', ')}`
            : '0';
    });

    socket.on('act-update', (act) => {
        byId('currentAct').textContent = act;
    });

    socket.on('lx-cue-update', (cue) => {
        byId('currentLxCue').textContent = cue;
    });

    socket.on('time-mode-update', (newMode) => {
        timeMode = newMode;
        updateTimeModeDisplay();
    });

    socket.on('timecode-update', (data) => {
        if (data.source !== 'midi' && data.source !== 'network') return;
        byId(`${data.source}Timecode`).textContent = formatTimecode(data);
        byId(`${data.source}FrameRate`).textContent = `${data.frameRate} fps`;
    });

    socket.on('system-status', (data) => {
        if (data.midiAvailable && data.portCount > 0) {
            midiStatus.textContent = `MIDI Interface: ${data.portCount} port(s) available - ${data.currentPort}`;
            midiStatus.className = 'status-connected';
            midiModeButton.disabled = false;
        } else {
            midiStatus.textContent = 'MIDI Interface: No MIDI devices found';
            midiStatus.className = 'status-disconnected';
            midiModeButton.disabled = true;
        }
        if (data.oscAvailable) {
            oscStatus.textContent = 'LX Cues: OSC Source Active (Auto-updating)';
            oscStatus.className = 'status-connected';
        } else {
            oscStatus.textContent = 'LX Cues: Manual Input';
            oscStatus.className = '';
        }
        byId('midiPort').textContent = data.currentPort || 'none';
        byId('midiPortCount').textContent = data.portCount;
        byId('mtcMessages').textContent = data.mtcMessagesReceived;
    });

    socket.on('network-timecode-status', (status) => {
        const where = `${status.group}:${status.port}`;
        if (status.error) {
            networkStatus.textContent = `Network Timecode: Error on ${where} - ${status.error}`;
            networkStatus.className = 'status-disconnected';
        } else if (!status.listening) {
            networkStatus.textContent = `Network Timecode: Starting (${where})...`;
            networkStatus.className = '';
        } else if (status.running) {
            networkStatus.textContent = `Network Timecode: Receiving from ${status.source} on ${where}`;
            networkStatus.className = 'status-connected';
        } else if (status.source) {
            networkStatus.textContent = `Network Timecode: Stopped (last from ${status.source} on ${where})`;
            networkStatus.className = '';
        } else {
            networkStatus.textContent = `Network Timecode: Listening on ${where}` +
                (status.gatewayIp ? ` for ${status.gatewayIp}` : '') + ' - no timecode yet';
            networkStatus.className = '';
        }
        byId('networkGroup').textContent = where;
        byId('networkGatewayIp').textContent = status.gatewayIp || 'any';
        byId('networkSource').textContent = status.source || 'none';
        byId('networkState').textContent = `${status.listening ? 'yes' : 'no'} / ${status.running ? 'yes' : 'no'}`;
        byId('networkError').textContent = status.error || 'none';
    });

    timeModeButtons.forEach(button => button.addEventListener('click', () => {
        if (!button.disabled && button.dataset.mode !== timeMode) {
            socket.emit('time-mode-change', button.dataset.mode);
        }
    }));
});
