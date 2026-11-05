// One loading policy for notes, chat and saved shows. Fast loads skip the
// skeleton; a visible skeleton gets a short minimum stay to avoid a flash.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.createLoadingState = factory().createLoadingState;
}(typeof self !== 'undefined' ? self : this, function () {
    function createLoadingState(element, {
        delayMs = 400, minimumMs = 300, now = () => performance.now(),
        schedule = setTimeout, cancel = clearTimeout
    } = {}) {
        let shownAt = null;
        let finished = false;
        let finishTimer = null;
        let resolveFinished;
        const settled = new Promise(resolve => { resolveFinished = resolve; });
        element.classList.add('is-loading');
        element.setAttribute('aria-busy', 'true');
        const showTimer = schedule(() => {
            shownAt = now();
            element.classList.add('show-loading');
        }, delayMs);

        function reveal() {
            cancel(showTimer);
            cancel(finishTimer);
            element.classList.remove('is-loading', 'show-loading');
            element.setAttribute('aria-busy', 'false');
            finished = true;
            resolveFinished();
        }

        return {
            // Cached content and a person's own new note bypass the minimum.
            finish({ immediate = false } = {}) {
                if (finished) return settled;
                const remaining = shownAt === null ? 0 : minimumMs - (now() - shownAt);
                cancel(showTimer);
                cancel(finishTimer);
                if (immediate || remaining <= 0) reveal();
                else finishTimer = schedule(reveal, remaining);
                return settled;
            }
        };
    }
    return { createLoadingState };
}));
