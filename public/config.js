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
        realtime: 'Time of day'
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
    socket.on('logged-out', () => { window.location.href = loggedOutUrl(); });
    keepLoginAlive(() => { window.location.href = loginUrl(); });

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
        byId(`${data.source}Timecode`).textContent = TimecodeFormat.formatTimecode(data);
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

    // Save notes under a name, optionally followed by the reset (two steps, like the reset).
    const saveShowForm = byId('saveShowForm');
    const showNameInput = byId('showNameInput');
    const saveResetButton = byId('saveResetButton');
    const saveResetConfirm = byId('saveResetConfirm');
    const saveResult = byId('saveResult');
    const saveButtons = [byId('saveShowButton'), saveResetButton, byId('saveResetConfirmButton')];

    function showSaveResult(...parts) {
        saveResult.replaceChildren(...parts);
        saveResult.hidden = false;
    }
    function closeSaveReset() {
        saveResetConfirm.hidden = true;
        saveResetButton.hidden = false;
    }
    function saveShow(reset) {
        saveButtons.forEach(button => { button.disabled = true; });
        // Keeping the videos can mean copying them, so allow longer than the other settings.
        socket.timeout(120000).emit('save-show', { name: showNameInput.value, reset }, (err, reply) => {
            saveButtons.forEach(button => { button.disabled = false; });
            closeSaveReset();
            if (err || !reply || reply.error) {
                showSaveResult(err || !reply ? "The notes couldn't be saved. Try again." : reply.error);
                return;
            }
            const link = document.createElement('a');
            link.href = `/recall.html?show=${encodeURIComponent(reply.show.id)}`;
            link.textContent = 'Open in Past notes';
            const notes = `${reply.show.totalNotes} note${reply.show.totalNotes === 1 ? '' : 's'}`;
            const parts = reply.show.recordingParts;
            const video = parts ? ` and ${parts === 1 ? 'its video' : `${parts} video parts`}` : '';
            showSaveResult(`Saved “${reply.show.name}” (${notes}${video})${reset ? ' and reset everything' : ''}. `, link);
            loadShows();
            showNameInput.value = '';
        });
    }
    // The form's `required` asks for a name before either kind of save.
    saveShowForm.addEventListener('submit', (e) => {
        e.preventDefault();
        saveShow(false);
    });
    saveResetButton.addEventListener('click', () => {
        if (!showNameInput.value.trim()) {
            showNameInput.value = '';
            showNameInput.reportValidity();
            return;
        }
        saveResult.hidden = true;
        saveResetConfirm.hidden = false;
        saveResetButton.hidden = true;
        byId('saveResetCancelButton').focus();
    });
    byId('saveResetCancelButton').addEventListener('click', closeSaveReset);
    byId('saveResetConfirmButton').addEventListener('click', () => saveShow(true));

    // Recordings for the live notes or a saved show, uploaded here for everyone
    // to watch back on playback.html (recordings.js on the server).
    const recordingNotesSelect = byId('recordingNotesSelect');
    const recordingRows = byId('recordingRows');
    const uploadRow = byId('uploadRow');
    const recordingResult = byId('recordingResult');
    const { isVideo, probeDuration } = VideoFile;
    let recordingCollection = 'live';
    let parts = [];
    let confirmRemove = null;      // the part whose Remove asks to confirm
    let uploading = null;          // { xhr, name, index, count, loaded, total }

    function showRecordingResult(message) {
        recordingResult.textContent = message;
        recordingResult.hidden = !message;
    }

    async function getJson(url) {
        const response = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' });
        if (response.status === 401) { window.location.href = loginUrl(); throw new Error('Login required'); }
        if (!response.ok) throw new Error('Unavailable');
        return response.json();
    }

    // Live notes, then every saved show, newest first.
    async function loadShows() {
        try {
            const shows = await getJson('/shows');
            fillSelect(recordingNotesSelect, [['live', 'Live notes'], ...shows.map(show => [show.id, show.name])], recordingCollection);
            if (recordingNotesSelect.value !== recordingCollection) chooseCollection('live');
        } catch (_) { /* the select keeps what it has */ }
    }

    function chooseCollection(collection) {
        recordingCollection = collection;
        recordingNotesSelect.value = collection;
        parts = [];
        confirmRemove = null;
        renderParts();
        loadParts();
    }

    async function loadParts() {
        const collection = recordingCollection;
        try {
            const result = await getJson(`/recordings/${encodeURIComponent(collection)}`);
            if (collection === recordingCollection) applyParts(result.recordings);
        } catch (_) { /* the next update or reconnect brings it */ }
    }

    function applyParts(list) {
        parts = Array.isArray(list) ? list : [];
        if (confirmRemove && !parts.some(p => p.id === confirmRemove)) confirmRemove = null;
        renderParts();
    }

    const wallText = (iso) => TimecodeFormat.formatTimecode(TimecodeFormat.timeOfDay(new Date(iso))).slice(0, 8);

    function partRow(part) {
        const row = document.createElement('div');
        row.className = 'row row-wrap part-row';
        const text = document.createElement('div');
        text.className = 'row-text';
        const name = document.createElement('div');
        name.className = 'row-label';
        name.textContent = part.name;
        const about = document.createElement('p');
        about.className = 'section-note';
        const start = part.startAt ? Date.parse(part.startAt) : null;
        about.textContent = [
            start ? `${wallText(start)}–${wallText(start + part.duration * 1000)}` : '',
            TimecodeFormat.formatDuration(part.duration),
            part.uploadedBy ? `added by ${part.uploadedBy}` : ''
        ].filter(Boolean).join(' · ');
        text.append(name, about);
        row.append(text);
        if (confirmRemove === part.id) {
            const confirm = document.createElement('div');
            confirm.className = 'reset-confirm';
            const question = document.createElement('span');
            question.textContent = 'Remove for everyone?';
            confirm.append(question,
                button('Cancel', 'btn ghost', { action: 'cancel-remove' }),
                button('Remove', 'btn danger', { action: 'remove', id: part.id }));
            row.append(confirm);
        } else {
            row.append(button('Remove', 'btn danger-outline', { action: 'ask-remove', id: part.id }));
        }
        return row;
    }

    function button(label, className, data) {
        const element = document.createElement('button');
        element.type = 'button';
        element.className = className;
        element.textContent = label;
        Object.assign(element.dataset, data);
        return element;
    }

    function renderParts() {
        recordingRows.querySelectorAll('.part-row').forEach(row => row.remove());
        parts.forEach(part => recordingRows.insertBefore(partRow(part), uploadRow));
        showUploadStatus();
    }

    recordingRows.addEventListener('click', (e) => {
        const target = e.target.closest('button[data-action]');
        if (!target) return;
        const action = target.dataset.action;
        if (action === 'ask-remove' || action === 'cancel-remove') {
            confirmRemove = action === 'ask-remove' ? target.dataset.id : null;
            renderParts();
            recordingRows.querySelector(confirmRemove ? '[data-action="cancel-remove"]' : '#uploadButton').focus();
        } else if (action === 'remove') removePart(target.dataset.id);
    });

    async function removePart(id) {
        const collection = recordingCollection;
        try {
            const response = await fetch(`/recordings/${encodeURIComponent(collection)}/${id}`, { method: 'DELETE' });
            if (response.status === 401) { window.location.href = loginUrl(); return; }
            if (!response.ok && response.status !== 404) throw new Error('Not removed');
            confirmRemove = null;
            showRecordingResult('');
            await loadParts();
        } catch (error) {
            showRecordingResult('That part couldn\'t be removed. Try again.');
        }
    }


    // Uploads one after another, each with its length and (from Vor's file
    // name) start time; the parts appear for everyone as each one finishes.
    async function uploadFiles(files) {
        const collection = recordingCollection;
        const list = [...files].filter(isVideo);
        if (!list.length || uploading) return;
        showRecordingResult('');
        for (let i = 0; i < list.length; i++) {
            const file = list[i];
            const url = URL.createObjectURL(file);
            let seconds;
            try {
                seconds = await probeDuration(url);
            } catch (error) {
                showRecordingResult(`This browser can't play "${file.name}", so it wasn't uploaded. Try Safari or Chrome.`);
                continue;
            } finally {
                URL.revokeObjectURL(url);
            }
            if (await sendFile(collection, file, seconds, i, list.length) === 'cancelled') break;
            if (collection === recordingCollection) loadParts();
        }
        uploading = null;
        showUploadStatus();
    }

    function sendFile(collection, file, seconds, index, count) {
        return new Promise((resolve) => {
            const query = new URLSearchParams({ name: file.name, duration: String(seconds) });
            const start = PlaybackTimeline.vorStartFromName(file.name);
            if (start) query.set('startAt', String(start));
            const xhr = new XMLHttpRequest();
            uploading = { xhr, name: file.name, index, count, loaded: 0, total: file.size };
            xhr.open('POST', `/recordings/${encodeURIComponent(collection)}?${query}`);
            xhr.upload.addEventListener('progress', (e) => { uploading.loaded = e.loaded; showUploadStatus(); });
            xhr.addEventListener('load', () => {
                if (xhr.status === 401) { window.location.href = loginUrl(); resolve('failed'); return; }
                if (xhr.status >= 200 && xhr.status < 300) { resolve('done'); return; }
                let reason = '';
                try { reason = JSON.parse(xhr.responseText).error || ''; } catch (error) { /* not JSON */ }
                showRecordingResult(`"${file.name}" wasn't uploaded. ${/^[A-Z]/.test(reason) ? reason : 'Try again.'}`);
                resolve('failed');
            });
            xhr.addEventListener('error', () => {
                showRecordingResult(`"${file.name}" wasn't uploaded. Check the connection and try again.`);
                resolve('failed');
            });
            xhr.addEventListener('abort', () => resolve('cancelled'));
            xhr.send(file);
            showUploadStatus();
        });
    }

    function showUploadStatus() {
        byId('uploadProgress').hidden = !uploading;
        byId('cancelUpload').hidden = !uploading;
        byId('uploadButton').hidden = !!uploading;
        if (!uploading) {
            byId('uploadText').textContent = parts.length ? '' : 'No recording yet';
            return;
        }
        const { name, index, count, loaded, total } = uploading;
        const share = total ? loaded / total : 0;
        byId('uploadText').textContent = `Uploading ${count > 1 ? `part ${index + 1} of ${count}, ` : ''}“${name}” · ${Math.floor(share * 100)}%`;
        byId('uploadProgress').value = share;
    }

    recordingNotesSelect.addEventListener('change', () => chooseCollection(recordingNotesSelect.value));
    byId('uploadButton').addEventListener('click', () => byId('uploadInput').click());
    byId('uploadInput').addEventListener('change', (e) => {
        const files = [...e.target.files];
        e.target.value = '';
        uploadFiles(files);
    });
    byId('cancelUpload').addEventListener('click', () => { if (uploading) uploading.xhr.abort(); });
    window.addEventListener('beforeunload', (e) => { if (uploading) e.preventDefault(); });
    socket.on('recordings-update', (update) => {
        if (update && update.collection === recordingCollection) applyParts(update.recordings);
    });
    socket.on('connect', () => { loadShows(); loadParts(); });
    renderParts();

    timeModeButtons.forEach(button => button.addEventListener('click', () => {
        if (!button.disabled && button.dataset.mode !== timeMode) {
            socket.emit('time-mode-change', button.dataset.mode);
        }
    }));
});
