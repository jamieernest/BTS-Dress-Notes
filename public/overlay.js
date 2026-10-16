document.addEventListener('DOMContentLoaded', function() {
    const timecodeDisplayElement = document.getElementById('timecodeDisplayElement');
    const timecodeDisplay = document.getElementById('timecodeDisplay');
    const timecodeLabel = document.getElementById('timecodeLabel');
    const realtimeValue = document.getElementById('realtimeValue');
    const lxCueDisplay = document.getElementById('lxCueDisplay');
    const connectionStatus = document.getElementById('connectionStatus');
    const overlayContainer = document.getElementById('overlayContainer');

    let currentTimecode = {
        hours: 0,
        minutes: 0,
        seconds: 0,
        frames: 0
    };
    // Latest timecode from each source; the display shows the one matching timeMode.
    const latestTimecodes = {
        midi: currentTimecode,
        network: currentTimecode
    };

    let currentLxCue = '--';
    let timeMode = 'midi';
    let realTimeInterval = null;

    // Parse URL parameters for customization
    const urlParams = new URLSearchParams(window.location.search);

    // Layout
    const layout = urlParams.get('layout') || 'center';
    overlayContainer.classList.add(`layout-${layout}`);

    // Size
    const size = urlParams.get('size') || 'normal';
    if (size !== 'normal') {
        overlayContainer.classList.add(size);
    }

    // Theme
    const theme = urlParams.get('theme') || 'default';
    if (theme !== 'default') {
        overlayContainer.classList.add(theme);
    }

    // Display mode
    const display = urlParams.get('display') || 'all';
    if (display !== 'all') {
        overlayContainer.classList.add(display);
    }

    // Connect to WebSocket server
    const socket = io({ auth: { page: 'overlay' } });

    // A lost login cannot come back by reconnecting: log in again and return here.
    function goToLogin() { window.location.href = loginUrl(); }
    socket.on('connect_error', function(err) {
        if (err && err.message === 'unauthorized') goToLogin();
    });
    socket.on('logged-out', function() { window.location.href = loggedOutUrl(); });
    keepLoginAlive(goToLogin);

    socket.on('connect', function() {
        connectionStatus.textContent = 'Connected';
        connectionStatus.className = 'connection-status connected';
        startRealTimeMode();
    });

    socket.on('disconnect', function() {
        connectionStatus.textContent = 'Disconnected';
        connectionStatus.className = 'connection-status disconnected';
        stopRealTimeMode();
    });

    socket.on('timecode-update', function(data) {
        if (!latestTimecodes[data.source]) return;
        latestTimecodes[data.source] = data;
        if (data.source === timeMode) {
            currentTimecode = data;
            updateTimecodeDisplay();
        }
    });

    socket.on('time-mode-update', function(newMode) {
        timeMode = newMode;
        updateTimeModeDisplay();

        // Show/hide the timecode based on mode
        if (timeMode === 'realtime') {
            timecodeDisplayElement.classList.add('timecode-hidden');
        } else {
            timecodeDisplayElement.classList.remove('timecode-hidden');
            currentTimecode = latestTimecodes[timeMode] || currentTimecode;
            updateTimecodeDisplay();
        }
    });

    socket.on('lx-cue-update', function(cue) {
        currentLxCue = cue;
        lxCueDisplay.textContent = cue;
    });

    function updateTimeModeDisplay() {
        timecodeLabel.textContent = timeMode === 'network' ? 'Network timecode' : 'MIDI timecode';
    }

    function startRealTimeMode() {
        if (realTimeInterval) {
            clearInterval(realTimeInterval);
        }

        updateRealTimeDisplay();
        realTimeInterval = setInterval(updateRealTimeDisplay, 10);
    }

    function stopRealTimeMode() {
        if (realTimeInterval) {
            clearInterval(realTimeInterval);
            realTimeInterval = null;
        }
    }

    function updateRealTimeDisplay() {
        realtimeValue.textContent = TimecodeFormat.formatTimecode(TimecodeFormat.timeOfDay());
    }

    function updateTimecodeDisplay() {
        timecodeDisplay.textContent = TimecodeFormat.formatTimecode(currentTimecode);
    }

    // Initial display - always show both timecodes
    updateTimeModeDisplay();
    updateTimecodeDisplay();
    startRealTimeMode(); // Always run real time clock
    lxCueDisplay.textContent = currentLxCue;
});
