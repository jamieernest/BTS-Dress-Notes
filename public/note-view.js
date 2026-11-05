// How notes, replies, people and tags look, shared by the notes page and past
// notes so the two can't drift apart. Templates return HTML strings with every
// value escaped (see public/safe-html.js); put them on the page with setHtml().
// Icons come from icons.svg: write <i data-icon="name"> and setHtml() swaps in
// the SVG, since DOMPurify strips <svg><use>.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./safe-html.js'), require('./timecode-format.js'), require('./note-numbers.js'), require('./mentions.js'));
    else root.NoteView = factory(root.SafeHtml, root.TimecodeFormat, root.NoteNumbers, root.Mentions);
}(typeof self !== 'undefined' ? self : this, function (SafeHtml, TimecodeFormat, NoteNumbers, Mentions) {
    const { escapeHtml: esc } = SafeHtml;
    const NEUTRAL = '#8a8f98';
    const safeColor = (color) => SafeHtml.safeColour(color, NEUTRAL);
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const ICONS = typeof document !== 'undefined' && document.getElementById('app-icons') ? '' : 'icons.svg';

    function setHtml(element, html) {
        SafeHtml.setHtml(element, html);
        for (const details of element.querySelectorAll('.agreement-people')) {
            const panel = details.querySelector('.agreement-popover');
            const summary = details.querySelector('summary');
            // Top-layer popovers escape the notes list's clipped rounded corners.
            panel.setAttribute('popover', 'auto');
            details.addEventListener('toggle', () => {
                if (!details.isConnected) return;
                if (details.open) {
                    panel.showPopover();
                    placePopover(panel, summary, 'right');
                } else if (panel.matches(':popover-open')) panel.hidePopover();
            });
            panel.addEventListener('toggle', event => {
                if (event.newState === 'closed') details.open = false;
            });
        }
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

    if (typeof window !== 'undefined') {
        const closeAgreementPanels = (event) => {
            if (event?.target?.closest?.('.agreement-popover')) return;
            document.querySelectorAll('.agreement-popover:popover-open').forEach(panel => panel.hidePopover());
        };
        window.addEventListener('resize', closeAgreementPanels);
        window.addEventListener('scroll', closeAgreementPanels, true);
        window.visualViewport?.addEventListener('resize', closeAgreementPanels);
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
        const letters = String(name || '').normalize('NFC').split(/\s+/)
            .map(part => part.match(/\p{L}\p{M}*/u)?.[0]).filter(Boolean);
        return letters.length
            ? (letters[0] + (letters.length > 1 ? letters[letters.length - 1] : '')).toUpperCase()
            : '?';
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
    // A native disclosure keeps the people list keyboard accessible on both pages.
    function agreementsHTML(note, actor) {
        const seen = new Set();
        const people = (Array.isArray(note.agreements) ? note.agreements : []).slice(0, 500)
            .filter(p => p && typeof p.userId === 'string' && typeof p.name === 'string'
                && p.userId && !seen.has(p.userId) && seen.add(p.userId));
        if (!actor && !people.length) return '';
        const active = people.some(p => p.userId === actor);
        const toggle = actor ? `<button type="button" class="agreement-toggle" data-action="agree"
            aria-pressed="${active}" aria-label="${active ? 'Remove your agreement' : 'Agree with this note'}">+1</button>` : '<span class="agreement-mark">+1</span>';
        const list = people.length ? `<details class="agreement-people"><summary aria-label="See who agrees (${people.length})">${people.length}</summary>
            <div class="agreement-popover" role="group" aria-label="People who agree">${people.map(p =>
                `<div class="agreement-person">${avatarHTML(p.userId, p.name, 'sm')}<span>${esc(p.name)}</span></div>`).join('')}</div>
            </details>` : '<span class="agreement-count">0</span>';
        return `<span class="note-agreements">${toggle}${list}</span>`;
    }

    function playbackLinkHTML(href) {
        return `<a class="icon-btn note-playback" href="${esc(href)}" aria-label="View this note in video" title="View this note in video"><i data-icon="video"></i></a>`;
    }
    // Who wrote it, then where in the show (cue and timecode), then `side`.
    function noteHeadHTML(note, name, side = '') {
        const rate = note.frameRate === 'ms' ? 'real time' : `${note.frameRate || 30} fps`;
        const title = note.timestamp ? `${rate} · sent ${fullTime(note.timestamp)}` : rate;
        return `
            <div class="note-head">
                <span class="note-author">${NoteNumbers.label(note) ? `<span class="note-reference mono">${esc(NoteNumbers.label(note))}</span> ` : ''}${esc(name)}</span>
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
        const body = parts.body !== undefined ? parts.body : `<div class="note-text">${Mentions.html(note.text, note.mentions)}</div>`;
        const edited = note.lastEdited
            ? `<div class="note-edited">Edited by ${esc(note.lastEditedBy || 'unknown')} at ${esc(clockTime(note.lastEdited))}</div>` : '';
        const foot = (parts.foot || '') + agreementsHTML(note, parts.agreementActor);
        return `
            <article class="note${parts.className ? ` ${parts.className}` : ''}"${parts.attrs ? ` ${parts.attrs}` : ''}>
                ${avatarHTML(author.key, author.name)}
                <div class="note-main">
                    ${noteHeadHTML(note, author.name, parts.side)}
                    ${body}${edited}
                    ${foot ? `<div class="note-foot">${foot}</div>` : ''}
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
                    ${body !== undefined ? body : `<div class="comment-text">${Mentions.html(comment.text, comment.mentions)}</div>`}
                </div>
            </div>`;
    }

    // A scene heading in the list; fill .group-count with how many notes show.
    function groupHeadHTML(act) {
        return `<div class="group-head" data-act="${esc(act)}"><span>${esc(act)}</span><span class="muted group-count"></span></div>`;
    }

    // --- Search and filters ---
    // filters.author is an exact Keycloak userId; empty means any author.
    // act/tag use 'all'; search is lower case.
    function noteMatches(note, filters, tagById) {
        if (filters.author && note.userId !== filters.author) return false;
        if (filters.tag !== 'all' && !note.tags.includes(filters.tag)) return false;
        if (filters.act !== 'all' && (note.act || 'Preshow') !== filters.act) return false;
        if (filters.mentionedUserId && !Mentions.has(note, filters.mentionedUserId) && !(note.comments || []).some(c => Mentions.has(c, filters.mentionedUserId))) return false;
        if (filters.search) {
            const reference = /^#?(\d+)$/.exec(filters.search.trim());
            if (reference && NoteNumbers.label(note) === `#${Number(reference[1])}`) return true;
            if (reference && filters.search.trim().startsWith('#')) return false;
            const haystack = [
                NoteNumbers.label(note), note.text, note.user, note.lxCue, note.act,
                ...note.tags.map(id => tagById(id).name),
                ...(note.comments || []).map(c => `${c.user} ${c.text}`)
            ].join(' ').toLowerCase();
            if (!haystack.includes(filters.search)) return false;
        }
        return true;
    }

    function filtersActive(filters) {
        return !!filters.author || !!filters.mentionedUserId || filters.tag !== 'all' || filters.act !== 'all' || filters.search !== '';
    }

    // Names label accounts; they never identify them. No name-based fallback for old notes.
    function authorOptions(notes) {
        const people = new Map();
        for (const note of notes) {
            if (typeof note.userId !== 'string' || !note.userId) continue;
            const previous = people.get(note.userId);
            const name = String(note.user || 'Unknown');
            people.set(note.userId, { userId: note.userId, name,
                names: [...new Set([...(previous?.names || []), name])] });
        }
        const result = [...people.values()].sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
        for (const person of result) person.label = result.some(other => other.userId !== person.userId && other.name === person.name)
            ? `${person.name} · ${person.userId}` : person.name;
        return result;
    }

    // Only an authors manifest establishes identities in saved/local exports.
    function storedAuthorId(note, authors) {
        return typeof note.userId === 'string' && Array.isArray(authors) &&
            authors.some(author => author && author.userId === note.userId) ? note.userId : undefined;
    }

    function readFilters(params) {
        return { act: params.get('scene') || 'all', tag: params.get('tag') || 'all',
            author: params.get('author') || '', mentionedUserId: params.get('mentioned') || '', search: (params.get('q') || '').trim().toLowerCase() };
    }

    function writeFilters(params, filters, query) {
        for (const [key, value] of [['scene', filters.act === 'all' ? '' : filters.act],
            ['tag', filters.tag === 'all' ? '' : filters.tag], ['author', filters.author], ['mentioned', filters.mentionedUserId], ['q', query.trim()]]) {
            if (value) params.set(key, value); else params.delete(key);
        }
        return params;
    }

    // Measure the real header: Past notes can wrap and the connection banner can grow.
    function watchNavigation() {
        const header = document.querySelector('.topbar');
        const banner = document.querySelector('.connection-banner');
        const measure = () => document.documentElement.style.setProperty('--navigation-top',
            `${header.offsetHeight + (banner && !banner.hidden ? banner.offsetHeight : 0)}px`);
        const observer = new ResizeObserver(measure);
        observer.observe(header);
        if (banner) observer.observe(banner);
        measure();
    }

    function createAuthorSearch({ input, chip, mentionChip, popover, filters, getNotes, onChange, beforeOpen }) {
        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-autocomplete', 'list');
        input.setAttribute('aria-controls', popover.id);
        input.setAttribute('aria-expanded', 'false');
        let people = [];
        let active = -1;
        let chipKey = null;
        function close() {
            popover.hidden = true;
            active = -1;
            input.setAttribute('aria-expanded', 'false');
            input.removeAttribute('aria-activedescendant');
        }
        function reposition() { if (!popover.hidden) placePopover(popover, input.closest('.search'), 'left'); }
        function refresh() {
            const notes = getNotes();
            people = authorOptions(notes.flatMap(note => [note,
                ...[...(note.mentions || []), ...(note.comments || []).flatMap(comment => comment.mentions || [])]
                    .map(person => ({ userId: person.userId, user: person.name }))]));
            const key = JSON.stringify([filters.author, filters.mentionedUserId, people]);
            if (key === chipKey) return;
            chipKey = key;
            for (const [button, field, prefix] of [[chip, 'author', 'By'], [mentionChip, 'mentionedUserId', 'Mentions']]) {
                if (!button) continue;
                const person = people.find(p => p.userId === filters[field]);
                const label = person?.label || filters[field];
                button.hidden = !filters[field];
                button.setAttribute('aria-label', `Remove ${prefix.toLowerCase()} filter: ${label || ''}`);
                setHtml(button, filters[field] ? `${avatarHTML(filters[field], person?.name || label, 'sm')}<span>${esc(prefix)} ${esc(label)}</span><i data-icon="close"></i>` : '');
            }
        }
        function suggest() {
            refresh();
            const query = input.value.trim().toLowerCase();
            const matches = query ? people.filter(p => p.names.some(name => name.toLowerCase().includes(query))) : [];
            if (!matches.length) return close();
            beforeOpen?.();
            const options = matches.flatMap(person => [{ person, field: 'author', prefix: 'By' },
                ...(mentionChip ? [{ person, field: 'mentionedUserId', prefix: 'Mentions' }] : [])]);
            setHtml(popover, options.map(({ person: p, field, prefix }, i) => `<button type="button" class="tag-option author-option" role="option" id="${esc(popover.id)}-${i}" data-person="${esc(p.userId)}" data-filter="${field}" aria-selected="false">${avatarHTML(p.userId, p.name, 'sm')}<span>${esc(prefix)} ${esc(p.label)}</span></button>`).join(''));
            active = -1;
            placePopover(popover, input.closest('.search'), 'left');
            input.setAttribute('aria-expanded', 'true');
        }
        function select(userId, field = 'author') {
            filters[field] = userId;
            filters.search = '';
            input.value = '';
            close();
            refresh();
            onChange();
            input.focus({ preventScroll: true });
        }
        input.addEventListener('input', suggest);
        input.addEventListener('focus', suggest);
        input.addEventListener('keydown', event => {
            if (popover.hidden) return;
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
            const options = [...popover.querySelectorAll('[role="option"]')];
            if (event.key === 'Enter' && active >= 0) {
                event.preventDefault(); select(options[active].dataset.person, options[active].dataset.filter);
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                active = Math.max(0, Math.min(options.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)));
                options.forEach((option, i) => option.setAttribute('aria-selected', String(i === active)));
                input.setAttribute('aria-activedescendant', options[active].id);
                options[active].scrollIntoView({ block: 'nearest' });
            }
        });
        input.addEventListener('blur', () => setTimeout(() => { if (!popover.contains(document.activeElement)) close(); }, 0));
        popover.addEventListener('click', event => {
            const option = event.target.closest('[data-person]');
            if (option) select(option.dataset.person, option.dataset.filter);
        });
        popover.addEventListener('keydown', event => { if (event.key === 'Escape') { close(); input.focus(); } });
        for (const [button, field] of [[chip, 'author'], [mentionChip, 'mentionedUserId']]) {
            button?.addEventListener('click', () => { filters[field] = ''; refresh(); onChange(); input.focus(); });
        }
        document.addEventListener('click', event => { if (!popover.contains(event.target) && event.target !== input) close(); });
        document.addEventListener('focusin', event => { if (event.target !== input && !popover.contains(event.target)) close(); });
        window.addEventListener('scroll', reposition, { passive: true });
        watchPopoverResize(close, reposition);
        return { refresh, close, reposition };
    }

    // The scene and tag dropdowns' choices.
    function sceneOptions(acts) {
        return [{ value: 'all', label: 'All scenes' }, ...acts.map(act => ({ value: act, label: act }))];
    }

    function tagOptions(tags) {
        return [{ value: 'all', label: 'All tags', color: '' }, ...tags.map(tag => ({ value: tag.id, label: tag.name, color: tag.color }))];
    }

    // --- Popovers ---
    function mobilePopoverViewport() {
        if (!window.matchMedia('(max-width: 860px), (pointer: coarse)').matches) return null;
        const viewport = window.visualViewport;
        return { left: viewport?.offsetLeft || 0, top: viewport?.offsetTop || 0,
            width: viewport?.width ?? window.innerWidth, height: viewport?.height ?? window.innerHeight };
    }

    function fitPopoverInViewport(popover) {
        const viewport = mobilePopoverViewport();
        if (!viewport || popover.hidden) return;
        popover.style.setProperty('--popover-viewport-height', `${viewport.height}px`);
        const r = popover.getBoundingClientRect();
        popover.style.left = `${Math.max(viewport.left + 8, Math.min(r.left, viewport.left + viewport.width - r.width - 8))}px`;
        popover.style.top = `${Math.max(viewport.top + 8, Math.min(r.top, viewport.top + viewport.height - r.height - 8))}px`;
    }

    // Keyboard height changes reposition menus; width changes dismiss them.
    function watchPopoverResize(close, reposition) {
        let previousWidth = window.innerWidth;
        window.addEventListener('resize', () => {
            const heightOnly = window.innerWidth === previousWidth;
            previousWidth = window.innerWidth;
            if (heightOnly && mobilePopoverViewport()) reposition();
            else close();
        });
        for (const event of ['resize', 'scroll']) {
            window.visualViewport?.addEventListener(event, () => {
                if (mobilePopoverViewport()) reposition();
            });
        }
    }

    // Shows `popover` under `anchor` (or above, if there's no room), kept on screen.
    function placePopover(popover, anchor, align) {
        popover.hidden = false;
        const viewport = mobilePopoverViewport();
        if (viewport) popover.style.setProperty('--popover-viewport-height', `${viewport.height}px`);
        const r = anchor.getBoundingClientRect();
        const w = popover.offsetWidth;
        const h = popover.offsetHeight;
        let left = align === 'right' ? r.right - w : r.left;
        left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
        let top = r.bottom + 4;
        if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
        popover.style.left = `${left}px`;
        popover.style.top = `${top}px`;
        fitPopoverInViewport(popover);
    }

    // A filter is a button opening a list of choices rather than a <select>,
    // which can't show each tag's colour. `button` is a .select, `popover` a
    // .popover.filter-popover[role=listbox]. Closes on a choice, Escape, a
    // click elsewhere or a width change (any resize on desktop);
    // `beforeOpen` closes the page's other popovers.
    function createDropdown({ button, popover, onChange, beforeOpen }) {
        function isOpen() {
            return !popover.hidden;
        }

        function reposition() {
            if (isOpen()) placePopover(popover, button, 'left');
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
            if (value !== 'all' && !options.some(o => o.value === value)) options = [...options, { value, label: value }];
            const current = options.find(o => o.value === value) || options[0];
            setHtml(button, `${dotHTML(current.color)}<span>${esc(current.label)}</span>`);
            button.classList.toggle('active', value !== 'all');
            setHtml(popover, options.map(o => `
                <button type="button" class="tag-option" role="option" data-value="${esc(o.value)}" aria-selected="${o.value === value}">
                    ${dotHTML(o.color)}${esc(o.label)}<i data-icon="check" data-class="check"></i>
                </button>`).join(''));
        }

        button.setAttribute('aria-controls', popover.id);
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
        watchPopoverResize(close, reposition);

        return { render, open, close, isOpen, reposition };
    }

    return {
        esc, safeColor, setHtml, playbackLinkHTML, agreementsHTML,
        clockTime, fullTime, relativeTime, plural,
        initials, personColor, avatarHTML,
        unknownTag, tagChipHTML, tagChipsHTML, dotHTML,
        noteHeadHTML, noteHTML, commentHTML, groupHeadHTML,
        noteMatches, filtersActive, sceneOptions, tagOptions,
        authorOptions, storedAuthorId, readFilters, writeFilters, watchNavigation, createAuthorSearch,
        placePopover, fitPopoverInViewport, watchPopoverResize, createDropdown
    };
}));
