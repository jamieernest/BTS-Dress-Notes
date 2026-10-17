document.addEventListener('DOMContentLoaded', function() {
    const realtimeValue = document.getElementById('realtimeValue');
    const actValue = document.getElementById('actValue');
    const connectionStatus = document.getElementById('connectionStatus');
    const overlayContainer = document.getElementById('overlayContainer');

    let currentAct = '--';
    let realTimeInterval = null;

    // Parse URL parameters for customization - matching original overlay
    const urlParams = new URLSearchParams(window.location.search);

    // Layout - same options as original overlay
    const layout = urlParams.get('layout') || 'center';
    overlayContainer.classList.add(`layout-${layout}`);

    // Size - same options as original overlay
    const size = urlParams.get('size') || 'normal';
    if (size !== 'normal') {
        overlayContainer.classList.add(size);
    }

    // Theme - same options as original overlay
    const theme = urlParams.get('theme') || 'default';
    if (theme !== 'default') {
        overlayContainer.classList.add(theme);
    }

    // Display mode - hide individual elements if needed
    const display = urlParams.get('display');
    if (display === 'realtime-only') {
        document.querySelector('.act-display').classList.add('act-hidden');
    } else if (display === 'act-only') {
        document.querySelector('.realtime-display').classList.add('realtime-hidden');
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
    });

    socket.on('act-update', function(act) {
        if (act !== currentAct) {
            currentAct = act;
            actValue.textContent = act;

            // Add pulse animation for act changes
            actValue.classList.add('act-pulse');
            setTimeout(() => {
                actValue.classList.remove('act-pulse');
            }, 500);
        }
    });

    function startRealTimeMode() {
        if (realTimeInterval) {
            clearInterval(realTimeInterval);
        }

        updateRealTimeDisplay();
        realTimeInterval = setInterval(updateRealTimeDisplay, 10);
    }


    function updateRealTimeDisplay() {
        realtimeValue.textContent = TimecodeFormat.formatTimecode(TimecodeFormat.timeOfDay());
    }

    // Initial display - exactly like original overlay
    startRealTimeMode();
    actValue.textContent = currentAct;
});
