// Restore layout before first paint, so an open chat doesn't squeeze the page
// sideways after it appears. Values and content are restored by index.js.
try {
    document.documentElement.classList.toggle('chat-open', matchMedia('(min-width: 1100px)').matches && localStorage.getItem('chat-open') === '1');
} catch (e) { /* storage unavailable */ }
