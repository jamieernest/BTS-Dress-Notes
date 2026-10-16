// How notes, replies, people and tags look, shared by the notes page and past
// notes so the two can't drift apart. Templates return HTML strings with every
// value escaped (see public/safe-html.js); put them on the page with setHtml().
// Icons come from icons.svg: write <i data-icon="name"> and setHtml() swaps in
// the SVG, since DOMPurify strips <svg><use>.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./safe-html.js'), require('./timecode-format.js'));
    else root.NoteView = factory(root.SafeHtml, root.TimecodeFormat);
}(typeof self !== 'undefined' ? self : this, function (SafeHtml, TimecodeFormat) {
    const { escapeHtml: esc } = SafeHtml;
    const NEUTRAL = '#8a8f98';
    const safeColor = (color) => SafeHtml.safeColour(color, NEUTRAL);
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const ICONS = typeof document !== 'undefined' && document.getElementById('app-icons') ? '' : 'icons.svg';

    function setHtml(element, html) {
        SafeHtml.setHtml(element, html);
        for (const placeholder of element.querySelectorAll('i[data-icon]')) {
            const svg = document.createElementNS(SVG_NS, 'svg');
            svg.setAttribute('class', `icon ${placeholder.dataset.class || ''}`.trim());
            svg.setAttribute('aria-hidden', 'true');
            const use = document.createElementNS(SVG_NS, 'use');
            use.setAttribute('href', `${ICONS}#i-${placeholder.dataset.icon}`);
            svg.appendChild(use);
            placeholder.replaceWith(svg);
        }
    }

    // --- Words and times ---
    function clockTime(timestamp) {
        const date = new Date(timestamp);
        return isNaN(date) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function fullTime(timestamp) {
        const date = new Date(timestamp);
        return isNaN(date) ? '' : date.toLocaleString();
    }

    function relativeTime(timestamp, now = Date.now()) {
        const mins = Math.floor((now - new Date(timestamp)) / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        return clockTime(timestamp);
    }

    function plural(n, word) {
        return `${n} ${word}${n === 1 ? '' : 's'}`;
    }

    // --- People ---
    function initials(name) {
        const parts = String(name || '?').trim().split(/\s+/);
        return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
    }

    // A stable colour per person (keyed by their account), the same everywhere.
    function personColor(key) {
        let h = 0;
        for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        return `hsl(${h % 360}, 45%, 42%)`;
    }

    function avatarHTML(key, name, extraClass) {
        return `<span class="avatar${extraClass ? ` ${extraClass}` : ''}" style="background:${personColor(key)}" aria-hidden="true">${esc(initials(name))}</span>`;
    }

    // --- Tags ---
    // A tag id with no tag behind it (deleted since, or an old file).
    function unknownTag(id) {
        return { id, name: id, color: NEUTRAL };
    }

    // A tag chip; with `attrs` (already escaped) it is a toggle button instead of a label.
    function tagChipHTML(tag, attrs) {
        const el = attrs ? 'button' : 'span';
        return `<${el} class="chip" style="--tag: ${safeColor(tag.color)}"${attrs ? ` ${attrs}` : ''}><span class="dot"></span>${esc(tag.name)}</${el}>`;
    }

    function tagChipsHTML(ids, tagById) {
        return ids.map(id => tagChipHTML(tagById(id))).join('');
    }

    // color '' draws an empty ring, so "All tags" lines up with the dots under it;
    // undefined draws nothing.
    function dotHTML(color) {
        if (color === undefined) return '';
        return color ? `<span class="dot" style="--tag: ${safeColor(color)}"></span>` : '<span class="dot ring"></span>';
    }

    // --- Notes ---
    function playbackLinkHTML(href) {
        return `<a class="icon-btn note-playback" href="${esc(href)}" aria-label="View this note in video" title="View this note in video"><i data-icon="video"></i></a>`;
    }
    // Who wrote it, then where in the show (cue and timecode), then `side`.
    function noteHeadHTML(note, name, side = '') {
        const rate = note.frameRate === 'ms' ? 'real time' : `${note.frameRate || 30} fps`;
        const title = note.timestamp ? `${rate} · sent ${fullTime(note.timestamp)}` : rate;
        return `
            <div class="note-head">
                <span class="note-author">${esc(name)}</span>
                <span class="note-meta">
                    <span class="note-cue">Cue ${esc(note.lxCue || '–')}</span>
                    <span class="note-tc mono" title="${esc(title)}">${esc(TimecodeFormat.formatNoteTimecode(note))}</span>
                </span>
                ${side}
            </div>`;
    }

    // `parts` swaps in the page's own pieces; trusted HTML built from these templates.
    //   attrs, className: on the <article>; author: { key, name } (defaults to the note's);
    //   side: end of the header (actions, badges); body: replaces the text;
    //   foot: under the text; thread: inside the replies box (shown only if not empty).
    function noteHTML(note, parts = {}) {
        const author = parts.author || { key: note.userId || note.user, name: note.user };
        const body = parts.body !== undefined ? parts.body : `<div class="note-text">${esc(note.text)}</div>`;
        const edited = note.lastEdited
            ? `<div class="note-edited">Edited by ${esc(note.lastEditedBy || 'unknown')} at ${esc(clockTime(note.lastEdited))}</div>` : '';
        return `
            <article class="note${parts.className ? ` ${parts.className}` : ''}"${parts.attrs ? ` ${parts.attrs}` : ''}>
                ${avatarHTML(author.key, author.name)}
                <div class="note-main">
                    ${noteHeadHTML(note, author.name, parts.side)}
                    ${body}${edited}
                    ${parts.foot ? `<div class="note-foot">${parts.foot}</div>` : ''}
                    ${parts.thread ? `<div class="comments">${parts.thread}</div>` : ''}
                </div>
            </article>`;
    }

    // One reply. `tools` goes at the end of its header; `body` replaces the text (editing).
    function commentHTML(comment, { tools = '', body } = {}) {
        const edited = comment.lastEdited ? ' · edited' : '';
        return `
            <div class="comment" data-comment-id="${esc(comment.id)}">
                ${avatarHTML(comment.userId || comment.user, comment.user, 'sm')}
                <div class="comment-main">
                    <div class="comment-head">
                        <span class="comment-user">${esc(comment.user)}</span>
                        <span class="muted" title="${esc(fullTime(comment.timestamp))}">${esc(relativeTime(comment.timestamp))}${edited}</span>
                        ${tools}
                    </div>
                    ${body !== undefined ? body : `<div class="comment-text">${esc(comment.text)}</div>`}
                </div>
            </div>`;
    }

    // A scene heading in the list; fill .group-count with how many notes show.
    function groupHeadHTML(act) {
        return `<div class="group-head" data-act="${esc(act)}"><span>${esc(act)}</span><span class="muted group-count"></span></div>`;
    }

    // --- Search and filters ---
    // filters: { act, tag ('all' for any), search (lower case) }.
    function noteMatches(note, filters, tagById) {
        if (filters.tag !== 'all' && !note.tags.includes(filters.tag)) return false;
        if (filters.act !== 'all' && (note.act || 'Preshow') !== filters.act) return false;
        if (filters.search) {
            const haystack = [
                note.text, note.user, note.lxCue, note.act,
                ...note.tags.map(id => tagById(id).name),
                ...(note.comments || []).map(c => `${c.user} ${c.text}`)
            ].join(' ').toLowerCase();
            if (!haystack.includes(filters.search)) return false;
        }
        return true;
    }

    function filtersActive(filters) {
        return filters.tag !== 'all' || filters.act !== 'all' || filters.search !== '';
    }

    // The scene and tag dropdowns' choices.
    function sceneOptions(acts) {
        return [{ value: 'all', label: 'All scenes' }, ...acts.map(act => ({ value: act, label: act }))];
    }

    function tagOptions(tags) {
        return [{ value: 'all', label: 'All tags', color: '' }, ...tags.map(tag => ({ value: tag.id, label: tag.name, color: tag.color }))];
    }

    // --- Popovers ---
    // Shows `popover` under `anchor` (or above, if there's no room), kept on screen.
    function placePopover(popover, anchor, align) {
        popover.hidden = false;
        const r = anchor.getBoundingClientRect();
        const w = popover.offsetWidth;
        const h = popover.offsetHeight;
        let left = align === 'right' ? r.right - w : r.left;
        left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
        let top = r.bottom + 4;
        if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
        popover.style.left = `${left}px`;
        popover.style.top = `${top}px`;
    }

    // A filter is a button opening a list of choices rather than a <select>,
    // which can't show each tag's colour. `button` is a .select, `popover` a
    // .popover.filter-popover[role=listbox]. Closes on a choice, Escape, a
    // click elsewhere or a resize; `beforeOpen` closes the page's other popovers.
    function createDropdown({ button, popover, onChange, beforeOpen }) {
        function isOpen() {
            return !popover.hidden;
        }

        function close() {
            if (!isOpen()) return false;
            const hadFocus = popover.contains(document.activeElement);
            popover.hidden = true;
            button.setAttribute('aria-expanded', 'false');
            if (hadFocus) button.focus({ preventScroll: true });
            return true;
        }

        function open() {
            if (beforeOpen) beforeOpen();
            placePopover(popover, button, 'left');
            button.setAttribute('aria-expanded', 'true');
            popover.querySelector('[aria-selected="true"]')?.focus();
        }

        // options: [{ value, label, color? }]; 'all' is the unfiltered choice.
        function render(options, value) {
            const current = options.find(o => o.value === value) || options[0];
            setHtml(button, `${dotHTML(current.color)}<span>${esc(current.label)}</span>`);
            button.classList.toggle('active', value !== 'all');
            setHtml(popover, options.map(o => `
                <button type="button" class="tag-option" role="option" data-value="${esc(o.value)}" aria-selected="${o.value === value}">
                    ${dotHTML(o.color)}${esc(o.label)}<i data-icon="check" data-class="check"></i>
                </button>`).join(''));
        }

        button.setAttribute('aria-haspopup', 'listbox');
        button.setAttribute('aria-expanded', 'false');
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isOpen()) close();
            else open();
        });
        popover.addEventListener('click', (e) => {
            const option = e.target.closest('[role="option"]');
            if (!option) return;
            close();
            onChange(option.dataset.value);
        });
        popover.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                close();
                return;
            }
            const options = [...popover.querySelectorAll('[role="option"]')];
            const i = options.indexOf(document.activeElement);
            const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: options.length - 1 }[e.key];
            if (next === undefined) return;
            e.preventDefault();
            options[Math.max(0, Math.min(next, options.length - 1))].focus();
        });
        document.addEventListener('click', (e) => {
            if (!popover.contains(e.target)) close();
        });
        window.addEventListener('resize', close);

        return { render, open, close, isOpen };
    }

    return {
        esc, safeColor, setHtml, playbackLinkHTML,
        clockTime, fullTime, relativeTime, plural,
        initials, personColor, avatarHTML,
        unknownTag, tagChipHTML, tagChipsHTML, dotHTML,
        noteHeadHTML, noteHTML, commentHTML, groupHeadHTML,
        noteMatches, filtersActive, sceneOptions, tagOptions,
        placePopover, createDropdown
    };
}));
