// Keep the pre-layout reading position. Resize/scroll events can arrive after
// reflow, so measuring "at bottom" inside a resize handler is too late.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.createChatScroll = factory().createChatScroll;
}(typeof self !== 'undefined' ? self : this, function () {
    function createChatScroll(scroller, content, {
        schedule = requestAnimationFrame, observe = callback => new ResizeObserver(callback)
    } = {}) {
        let following = true;
        let saved = null;
        let queued = false;
        const geometry = () => [scroller.clientWidth, scroller.clientHeight, scroller.scrollHeight];
        const offset = row => row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        function remember() {
            if (!scroller.clientHeight) return; // Hidden drawers have no useful position.
            const row = [...content.children].find(child => offset(child) + child.getBoundingClientRect().height > 0);
            saved = { geometry: geometry(), top: scroller.scrollTop, row, offset: row ? offset(row) : 0 };
        }
        function restore() {
            if (!scroller.clientHeight) return;
            if (following) scroller.scrollTop = scroller.scrollHeight;
            else if (saved) {
                // A full log refresh replaces the rows: recover the same message by id.
                const row = saved.row?.parentNode === content ? saved.row
                    : [...content.children].find(child => child.dataset.chatId && child.dataset.chatId === saved.row?.dataset.chatId);
                scroller.scrollTop = row ? scroller.scrollTop + offset(row) - saved.offset : saved.top;
            }
            remember();
        }
        function layoutChanged() {
            if (queued) return;
            queued = true;
            schedule(() => { queued = false; restore(); });
        }
        scroller.addEventListener('scroll', () => {
            // Layout itself may generate a scroll event (including clamping).
            // Never let that event replace the state captured before reflow.
            if (!scroller.clientHeight) return;
            if (!saved || geometry().some((value, i) => value !== saved.geometry[i])) {
                layoutChanged();
                return;
            }
            following = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 2;
            remember();
        }, { passive: true });
        const observer = observe(layoutChanged);
        observer.observe(scroller);
        observer.observe(content); // Wrapping, late rendering, and loading visibility.
        remember();
        return {
            followsBottom: () => following,
            layoutChanged,
            follow() { following = true; restore(); layoutChanged(); }
        };
    }
    return { createChatScroll };
}));
