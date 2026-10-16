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
        midi: 'MIDI timecode',
        network: 'Network timecode (MIDI gateway)',
        realtime: 'Time of day (server clock)'
    };
    let timeMode = null;
    const midiInputSelect = byId('midiInputSelect');
    const networkInterfaceSelect = byId('networkInterfaceSelect');

    function fillSelect(select, options, value) {
        select.replaceChildren();
        options.forEach(([optionValue, label]) => {
            const option = document.createElement('option');
            option.value = optionValue;
            option.textContent = label;
            select.appendChild(option);
        });
        select.value = value;
    }

    // A status row: its text, and 'ok' (green), 'bad' (red) or '' (neutral) for its dot.
    function setStatus(row, text, state) {
        row.querySelector('.row-value').textContent = text;
        row.dataset.state = state;
    }

    function formatTimecode(tc) {
        const pad = n => (n || 0).toString().padStart(2, '0');
        return `${pad(tc.hours)}:${pad(tc.minutes)}:${pad(tc.seconds)}:${pad(tc.frames)}`;
    }

    function updateTimeModeDisplay() {
        timeModeStatus.textContent = timeModeNames[timeMode] || timeMode;
        timeModeButtons.forEach(button => button.setAttribute('aria-pressed', button.dataset.mode === timeMode));
    }

    // `page` tells the server which page this is (see pageOf() in server.js).
    const socket = io({ auth: { page: 'config' } });

    socket.on('connect', () => {
        setStatus(connectionStatus, 'Connected', 'ok');
    });

    socket.on('disconnect', () => {
        setStatus(connectionStatus, 'Disconnected. Reconnecting\u2026', 'bad');
    });

    // A refused handshake means the session is gone; retrying can't succeed.
    socket.on('connect_error', (err) => {
        if (err && err.message === 'unauthorized') {
            window.location.href = loginUrl();
        }
    });
    socket.on('logged-out', () => { window.location.href = loginUrl(); });
    keepLoginAlive(() => { window.location.href = loginUrl(); });

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

    socket.on('settings-options', (data) => {
        const midiOptions = [['', 'None'], ...data.midiInputs.map(name => [name, name])];
        if (data.midiInput && !data.midiInputs.includes(data.midiInput)) {
            midiOptions.push([data.midiInput, `${data.midiInput} (not connected)`]);
        }
        fillSelect(midiInputSelect, midiOptions, data.midiInput || '');

        const interfaceOptions = [['auto', 'Automatic (gateway subnet)'],
            ...data.interfaces.map(i => [i.address, `${i.name} - ${i.address}`])];
        if (data.networkInterface !== 'auto' && !data.interfaces.some(i => i.address === data.networkInterface)) {
            interfaceOptions.push([data.networkInterface, `${data.networkInterface} (not present)`]);
        }
        fillSelect(networkInterfaceSelect, interfaceOptions, data.networkInterface);
    });

    socket.on('system-status', (data) => {
        if (data.midiAvailable && data.portCount > 0) {
            setStatus(midiStatus, `Using ${data.currentPort}`, 'ok');
            midiModeButton.disabled = false;
            midiModeButton.title = '';
        } else if (data.portCount > 0) {
            setStatus(midiStatus, `No input chosen (${data.portCount} available)`, 'bad');
            midiModeButton.disabled = true;
            midiModeButton.title = 'Choose a MIDI input below first';
        } else {
            setStatus(midiStatus, 'No MIDI devices found', 'bad');
            midiModeButton.disabled = true;
            midiModeButton.title = 'No MIDI devices found';
        }
        if (data.oscAvailable) {
            setStatus(oscStatus, 'Updating from OSC', 'ok');
        } else {
            setStatus(oscStatus, 'Typed in by hand', '');
        }
        byId('midiPort').textContent = data.currentPort || 'none';
        byId('midiPortCount').textContent = data.portCount;
        byId('mtcMessages').textContent = data.mtcMessagesReceived;
    });

    socket.on('network-timecode-status', (status) => {
        const where = `${status.group}:${status.port}` +
            (status.interfaceAddress ? ` via ${status.interfaceAddress}` : '');
        if (status.error) {
            setStatus(networkStatus, `Error on ${where}: ${status.error}`, 'bad');
        } else if (!status.listening) {
            setStatus(networkStatus, `Starting (${where})\u2026`, '');
        } else if (status.running) {
            setStatus(networkStatus, `Receiving from ${status.source} on ${where}`, 'ok');
        } else if (status.source) {
            setStatus(networkStatus, `Stopped (last from ${status.source} on ${where})`, '');
        } else {
            setStatus(networkStatus, `Listening on ${where}` +
                (status.gatewayIp ? ` for ${status.gatewayIp}` : '') + ', no timecode yet', '');
        }
        byId('networkGroup').textContent = `${status.group}:${status.port}`;
        byId('networkInterface').textContent =
            `${status.interfaceAddress || 'system default'} (${status.interfaceReason || '-'})`;
        byId('networkGatewayIp').textContent = status.gatewayIp || 'any';
        byId('networkSource').textContent = status.source || 'none';
        byId('networkState').textContent = `${status.listening ? 'yes' : 'no'} / ${status.running ? 'yes' : 'no'}`;
        byId('networkError').textContent = status.error || 'none';
    });

    midiInputSelect.addEventListener('change', () => {
        socket.emit('midi-input-change', midiInputSelect.value);
    });

    networkInterfaceSelect.addEventListener('change', () => {
        socket.emit('network-interface-change', networkInterfaceSelect.value);
    });

    const eosStatus = byId('eosStatus');
    const eosReconnectButton = byId('eosReconnectButton');
    socket.on('eos-status', (status) => {
        const where = `${status.host}:${status.port}`;
        const text = {
            connecting: `Connecting to ${where}\u2026`,
            connected: `Connected to ${where}`,
            failed: `Couldn't connect to ${where}: ${status.error}`,
            disconnected: `Disconnected from ${where}`
        }[status.state] || status.state;
        setStatus(eosStatus, text, status.state === 'connected' ? 'ok'
            : status.state === 'connecting' ? '' : 'bad');
        byId('eosConnectionState').textContent = text;
        eosReconnectButton.disabled = status.state === 'connecting';
    });
    eosReconnectButton.addEventListener('click', () => socket.emit('eos-reconnect'));

    // Two steps: the first click only asks, the second deletes.
    const resetButton = byId('resetButton');
    const resetConfirm = byId('resetConfirm');
    const resetResult = byId('resetResult');
    resetButton.addEventListener('click', () => {
        resetResult.hidden = true;
        resetConfirm.hidden = false;
        resetButton.hidden = true;
        byId('resetCancelButton').focus();
    });
    byId('resetCancelButton').addEventListener('click', () => {
        resetConfirm.hidden = true;
        resetButton.hidden = false;
    });
    byId('resetConfirmButton').addEventListener('click', () => {
        socket.emit('reset-all');
        resetConfirm.hidden = true;
        resetButton.hidden = false;
    });
    socket.on('all-reset', () => {
        resetResult.textContent = `All notes and chat were reset at ${new Date().toLocaleTimeString()}.`;
        resetResult.hidden = false;
    });

    timeModeButtons.forEach(button => button.addEventListener('click', () => {
        if (!button.disabled && button.dataset.mode !== timeMode) {
            socket.emit('time-mode-change', button.dataset.mode);
        }
    }));
});
