// Which stretch of the playback timeline is on screen (playback.html). A view
// is { t0, span } in seconds along the timeline: the left edge and the width.
// The full timeline (Fit) is { t0: 0, span: duration }, the same picture as
// before zooming existed. Everything here is pure; playback.js draws it.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.PlaybackViewport = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    const MIN_SPAN = 15;   // seconds: the closest zoom
    const EPSILON = 1e-6;
    const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400];

    const fit = (duration) => ({ t0: 0, span: Math.max(0, duration) });
    const isFit = (view, duration) => view.span >= duration - EPSILON;
    const minSpan = (duration) => Math.min(MIN_SPAN, Math.max(0, duration));

    // Keeps a view inside the timeline and no closer than MIN_SPAN.
    function clamp(view, duration) {
        if (!(duration > 0)) return fit(0);
        const span = Math.min(duration, Math.max(minSpan(duration), Number.isFinite(view.span) ? view.span : duration));
        const t0 = Math.min(Math.max(0, Number.isFinite(view.t0) ? view.t0 : 0), duration - span);
        return { t0, span };
    }

    // The view of `span` seconds that keeps `time` at `frac` (0-1) of the width.
    const zoomTo = (view, time, frac, span, duration) => clamp({ t0: time - frac * span, span }, duration);

    // Zooms by `factor` (above 1 closer) about the point at `frac` of the width.
    function zoomAt(view, frac, factor, duration) {
        return zoomTo(view, view.t0 + frac * view.span, frac, view.span / factor, duration);
    }

    const panBy = (view, seconds, duration) => clamp({ t0: view.t0 + seconds, span: view.span }, duration);

    // Shows from..to with a margin of `pad` (a share of the stretch) either side.
    function fitRange(from, to, duration, pad = 0.05) {
        const span = Math.max(to - from, 0) * (1 + 2 * pad);
        const centre = (from + to) / 2;
        return clamp({ t0: centre - span / 2, span }, duration);
    }

    // Keeps the playhead in view by turning the page: once it passes 90% of
    // the width (only while `playing`; a still playhead may sit anywhere) or
    // leaves the view, the view moves so it sits at 10%.
    function follow(view, position, duration, playing) {
        const end = view.t0 + view.span;
        const inside = position >= view.t0 && position <= (playing ? view.t0 + view.span * 0.9 : end);
        if (inside || isFit(view, duration)) return view;
        return clamp({ t0: position - view.span * 0.1, span: view.span }, duration);
    }

    // Moves the view so that the playhead at `position` is inside it, if it is not.
    const reveal = (view, position, duration) => (position >= view.t0 && position <= view.t0 + view.span) ? view
        : clamp({ t0: position - view.span / 2, span: view.span }, duration);

    // Round-number times to label across the view, at least `minGapPx` apart.
    function ticks(view, widthPx, minGapPx = 80) {
        if (!(view.span > 0) || !(widthPx > 0)) return [];
        const pxPerSecond = widthPx / view.span;
        const step = STEPS.find(s => s * pxPerSecond >= minGapPx) || STEPS[STEPS.length - 1];
        const out = [];
        for (let t = Math.ceil(view.t0 / step) * step; t <= view.t0 + view.span + EPSILON; t += step) out.push(t);
        return out;
    }

    return { MIN_SPAN, fit, isFit, minSpan, clamp, zoomTo, zoomAt, panBy, fitRange, follow, reveal, ticks };
}));
