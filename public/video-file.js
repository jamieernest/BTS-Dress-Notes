// Videos chosen in the browser: whether a file is one, and how long it runs.
// Used by playback.html (videos from this device) and the settings page's upload.
(function (root) {
    const isVideo = (file) => /^video\//.test(file.type) || /\.(mov|mp4|m4v|webm)$/i.test(file.name);

    // The length in seconds of the video at `url`; rejects if this browser can't play it.
    function probeDuration(url) {
        return new Promise((resolve, reject) => {
            const probe = document.createElement('video');
            probe.preload = 'metadata';
            probe.muted = true;
            probe.addEventListener('loadedmetadata', () => {
                const seconds = probe.duration;
                probe.removeAttribute('src');
                probe.load();
                if (Number.isFinite(seconds) && seconds > 0) resolve(seconds);
                else reject(new Error('No length'));
            }, { once: true });
            probe.addEventListener('error', () => reject(new Error('Unplayable')), { once: true });
            probe.src = url;
        });
    }

    root.VideoFile = { isVideo, probeDuration };
}(self));
