// How notes, replies, people and tags look, shared by the notes page and past
// notes so the two can't drift apart. Templates return HTML strings with every
// value escaped (see public/safe-html.js); put them on the page with setHtml().
// Icons come from icons.svg: write <i data-icon="name"> and setHtml() swaps in
// the SVG, since DOMPurify strips <svg><use>.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./safe-html.js'), require('./timecode-format.js'), require('./note-numbers.js'), require('./mentions.js'), require('./profile-photos.js'));
    else root.NoteView = factory(root.SafeHtml, root.TimecodeFormat, root.NoteNumbers, root.Mentions, root.ProfilePhotos);
}(typeof self !== 'undefined' ? self : this, function (SafeHtml, TimecodeFormat, NoteNumbers, Mentions, ProfilePhotos) {
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
            const controls = details.closest('.note-agreements');
            let hideTimer = null;
            let pinned = false;
            // The top layer escapes the notes list's clipped rounded corners.
            panel.setAttribute('popover', 'auto');
            const show = () => { clearTimeout(hideTimer); details.open = true; };
            const hideSoon = () => {
                clearTimeout(hideTimer);
                hideTimer = setTimeout(() => {
                    const keyboardFocus = controls.contains(document.activeElement) && document.activeElement.matches(':focus-visible');
                    if (!pinned && !controls.matches(':hover') && !keyboardFocus) details.open = false;
                }, 140);
            };
            // Hover/focus shows who agrees; clicking the thumb only toggles
            // agreement. The separate count also opens it on touch devices.
            controls.addEventListener('pointerenter', event => {
                if (event.pointerType === 'mouse' && window.matchMedia('(hover: hover)').matches) show();
            });
            controls.addEventListener('pointerleave', hideSoon);
            controls.addEventListener('focusin', event => { if (event.target.matches(':focus-visible')) show(); });
            controls.addEventListener('focusout', hideSoon);
            summary.addEventListener('click', event => {
                event.preventDefault();
                pinned = !pinned;
                if (pinned) show(); else details.open = false;
            });
            details.addEventListener('toggle', () => {
                if (!details.isConnected) return;
                if (details.open) {
                    panel.showPopover();
                    placePopover(panel, summary, 'right');
                } else if (panel.matches(':popover-open')) panel.hidePopover();
            });
            panel.addEventListener('toggle', event => {
                if (event.newState === 'closed') { pinned = false; details.open = false; }
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

    // Keep the original third argument (CSS class) compatible with all callers.
    function avatarHTML(key, name, extraClass, emailPrefix) {
        const url = ProfilePhotos.imageUrl(emailPrefix);
        const image = url
            ? `<img class="avatar-photo" src="${esc(url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
            : '';
        return `<span class="avatar${extraClass ? ` ${esc(extraClass)}` : ''}" style="background:${personColor(key)}" aria-hidden="true">${image}<span class="avatar-initials">${esc(initials(name))}</span></span>`;
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
    // A native disclosure keeps the people list keyboard accessible, including
    // a useful empty state. Fixed icon/count slots avoid 0 -> 1 layout changes.
    function agreementsHTML(note, actor, { comment = false } = {}) {
        const seen = new Set();
        const people = (Array.isArray(note.agreements) ? note.agreements : []).slice(0, 500)
            .filter(p => p && typeof p.userId === 'string' && typeof p.name === 'string'
                && p.userId && !seen.has(p.userId) && seen.add(p.userId));
        if (!actor && !people.length) return '';
        const active = people.some(p => p.userId === actor);
        const toggle = actor ? `<button type="button" class="icon-btn agreement-toggle" data-action="${comment ? 'agree-comment' : 'agree'}"
            aria-pressed="${active}" aria-label="${active ? 'Remove your agreement' : `Agree with this ${comment ? 'reply' : 'note'}`}" title="${active ? 'Remove your agreement' : 'Agree'}"><i data-icon="thumbs-up"></i></button>` : '<span class="icon-btn agreement-mark" role="img" aria-label="Agreements"><i data-icon="thumbs-up"></i></span>';
        const list = `<details class="agreement-people"><summary class="agreement-count" aria-label="See who agrees (${people.length})" title="${people.length ? 'See who agrees' : 'No agreements yet'}">${people.length}</summary>
            <div class="agreement-popover" role="group" aria-label="People who agree">${people.length ? people.map(p =>
                `<div class="agreement-person">${avatarHTML(p.userId, p.name, 'sm', p.emailPrefix)}<span>${esc(p.name)}</span></div>`).join('') : '<p class="agreement-empty">No agreements yet.</p>'}</div>
            </details>`;
        return `<span class="note-agreements">${toggle}${list}</span>`;
    }

    // An agreement acknowledgement must not replace the note and restart the
    // neighbouring action icons' hover transition. Keep the controls, focus and
    // any open disclosure in place; replace only the sanitized people list.
    function updateAgreements(element, note, actor, options) {
        if (!element) return false;
        const current = element.querySelector('.note-agreements');
        if (!current) return false;
        const holder = document.createElement('div');
        setHtml(holder, agreementsHTML(note, actor, options));
        const next = holder.querySelector('.note-agreements');
        if (!next) return false;
        const button = current.querySelector('.agreement-toggle');
        const nextButton = next.querySelector('.agreement-toggle');
        if (!!button !== !!nextButton) return false;
        if (button) {
            for (const attribute of ['aria-pressed', 'aria-label', 'title']) button.setAttribute(attribute, nextButton.getAttribute(attribute));
        }
        const count = current.querySelector('.agreement-count');
        const nextCount = next.querySelector('.agreement-count');
        count.textContent = nextCount.textContent;
        for (const attribute of ['aria-label', 'title']) count.setAttribute(attribute, nextCount.getAttribute(attribute));
        const panel = current.querySelector('.agreement-popover');
        panel.replaceChildren(...next.querySelector('.agreement-popover').childNodes);
        if (panel.matches(':popover-open')) placePopover(panel, count, 'right');
        return true;
    }

    function playbackLinkHTML(href) {
        return `<a class="icon-btn note-playback" href="${esc(href)}" aria-label="View this note in video" title="View this note in video"><i data-icon="video"></i></a>`;
    }
    // The visible hierarchy is person, cue, then stable note reference. Exact
    // timecode/timestamps remain on the note and in video playback metadata.
    function noteHeadHTML(note, name, side = '') {
        return `
            <div class="note-head">
                <span class="note-heading">
                    <span class="note-author">${esc(name)}</span>
                    <span class="note-meta"><span class="note-cue">Cue ${esc(note.lxCue || '–')}</span></span>
                    ${NoteNumbers.label(note) ? `<span class="note-reference mono" title="Note ${esc(NoteNumbers.label(note))}">${esc(NoteNumbers.label(note))}</span>` : ''}
                </span>
                ${side}
            </div>`;
    }

    // `parts` swaps in the page's own pieces; trusted HTML built from these templates.
    //   attrs, className: on the <article>; author: { key, name, emailPrefix } (defaults to the note's);
    //   side: end of the header (actions, badges); body: replaces the text;
    //   foot: under the text; thread: inside the replies box (shown only if not empty).
    function noteHTML(note, parts = {}) {
        const author = parts.author || { key: note.userId || note.user, name: note.user, emailPrefix: note.emailPrefix };
        const body = parts.body !== undefined ? parts.body : `<div class="note-text">${Mentions.html(note.text, note.mentions)}</div>`;
        const edited = note.lastEdited
            ? `<div class="note-edited">Edited by ${esc(note.lastEditedBy || 'unknown')} at ${esc(clockTime(note.lastEdited))}</div>` : '';
        const foot = (parts.foot ? `<div class="note-tags">${parts.foot}</div>` : '') + agreementsHTML(note, parts.agreementActor);
        return `
            <article class="note${parts.className ? ` ${parts.className}` : ''}"${parts.attrs ? ` ${parts.attrs}` : ''}>
                ${avatarHTML(author.key, author.name, '', author.emailPrefix)}
                <div class="note-main">
                    ${noteHeadHTML(note, author.name, parts.side)}
                    ${body}${edited}
                    ${foot ? `<div class="note-foot">${foot}</div>` : ''}
                    ${parts.thread ? `<div class="comments">${parts.thread}</div>` : ''}
                </div>
            </article>`;
    }

    // One reply. `tools` goes at the end of its header; `body` replaces the text (editing).
    function commentHTML(comment, { tools = '', body, agreementActor } = {}) {
        const edited = comment.lastEdited ? ' · edited' : '';
        const agreements = agreementsHTML(comment, agreementActor, { comment: true });
        return `
            <div class="comment" data-comment-id="${esc(comment.id)}">
                ${avatarHTML(comment.userId || comment.user, comment.user, 'sm', comment.emailPrefix)}
                <div class="comment-main">
                    <div class="comment-head">
                        <span class="comment-heading">
                            <span class="comment-user">${esc(comment.user)}</span>
                            <span class="muted" title="${esc(fullTime(comment.timestamp))}">${esc(relativeTime(comment.timestamp))}${edited}</span>
                        </span>
                        ${agreements || tools ? `<span class="comment-actions">${agreements}${tools}</span>` : ''}
                    </div>
                    ${body !== undefined ? body : `<div class="comment-text">${Mentions.html(comment.text, comment.mentions)}</div>`}
                </div>
            </div>`;
    }

    // First recorded entry into each named scene, or the oldest retained note
    // when an older file has no scene log. Always use all notes, not search hits.
    function sceneStartTimes(notes = [], showLog = []) {
        const noteStarts = new Map();
        const sceneStarts = new Map();
        const remember = (map, scene, value) => {
            if (typeof value !== 'string' || !value.trim()) return;
            const at = Date.parse(value);
            if (!Number.isFinite(at)) return;
            if (!map.has(scene) || at < map.get(scene)) map.set(scene, at);
        };
        for (const note of Array.isArray(notes) ? notes : []) {
            if (note && typeof note === 'object') remember(noteStarts, String(note.act || 'Preshow'), note.timestamp);
        }
        for (const event of Array.isArray(showLog) ? showLog : []) {
            if (event?.type === 'scene' && typeof event.value === 'string' && event.value.trim()) remember(sceneStarts, event.value, event.at);
        }
        return new Map([...noteStarts, ...sceneStarts].map(([scene, at]) => [scene, new Date(at).toISOString()]));
    }

    // One start time per group, in the groups' order. A scene's earliest visit
    // keeps its scene start time; a return visit uses its own earliest note.
    function groupStartTimes(groups, sceneTimes) {
        const own = groups.map(group => {
            const stamps = group.notes.map(n => Date.parse(n.startedAt || n.timestamp)).filter(Number.isFinite);
            return stamps.length ? Math.min(...stamps) : NaN;
        });
        const first = new Map();
        groups.forEach((group, i) => {
            const j = first.get(group.act);
            if (j === undefined || own[i] < own[j]) first.set(group.act, i);
        });
        return groups.map((group, i) => first.get(group.act) === i || !Number.isFinite(own[i])
            ? sceneTimes.get(group.act) : new Date(own[i]).toISOString());
    }

    function groupTimeHTML(at) {
        const clock = TimecodeFormat.formatClockMinute(at);
        return clock ? `<time class="group-time mono" datetime="${esc(at)}" title="When this scene started">${esc(clock)}</time>` : '';
    }

    // A scene heading in the list; fill .group-count with how many notes show.
    // Input is newest first. A group is one stretch of the show in one scene:
    // when a scene returns (Preshow, Scene A, Preshow) the second visit is its
    // own group at the current end, not merged into the first. Notes are placed
    // by the moment they were started, so one sent after the next scene began
    // stays with its starting scene; within a group they keep submission order.
    // shortcut: a visit with no notes leaves no trace here, so two visits with
    // nothing between them merge; upgrade by feeding in the show log.
    function groupNotes(notes) {
        const act = (note) => note.act || 'Preshow';
        const stampOf = (note) => Date.parse(note.startedAt || note.timestamp);
        const entries = notes.map((note, i) => ({ note, i, at: stampOf(note) }));
        const stamped = entries.filter(e => Number.isFinite(e.at)).sort((a, b) => a.at - b.at || b.i - a.i);
        const groups = []; // oldest first
        for (const entry of stamped) {
            let group = groups[groups.length - 1];
            if (group?.act !== act(entry.note)) groups.push(group = { act: act(entry.note), entries: [] });
            group.entries.push(entry);
        }
        // Notes with no usable stamp (old files) join the latest group of their scene.
        for (const entry of entries.filter(e => !Number.isFinite(e.at))) {
            let group = groups.findLast(g => g.act === act(entry.note));
            if (!group) groups.unshift(group = { act: act(entry.note), entries: [] });
            group.entries.push(entry);
        }
        return groups.reverse().map(group => ({ act: group.act, notes: group.entries.sort((a, b) => a.i - b.i).map(e => e.note) }));
    }

    // people/me only affect how the label is drawn; data-act stays the raw label.
    function groupHeadHTML(act, at, count = '', people = [], me = null) {
        return `<div class="group-head" data-act="${esc(act)}"><span>${Mentions.labelHtml(act, people, me)}</span><span class="muted group-count">${esc(count)}</span>${groupTimeHTML(at)}</div>`;
    }

    function updateGroupTime(head, at) {
        const clock = TimecodeFormat.formatClockMinute(at);
        let element = head.querySelector('.group-time');
        if (!clock) { element?.remove(); return; }
        if (!element) {
            element = document.createElement('time'); element.className = 'group-time mono';
            element.title = 'When this scene started'; head.append(element);
        }
        if (element.textContent !== clock) element.textContent = clock;
        element.dateTime = at;
    }

    // --- Search and filters ---
    // filters.author is an exact Keycloak userId; empty means any author.
    // act/tag use 'all'; search is lower case.
    // `me` is the viewer's username (emailPrefix); only the "My scenes" filter needs it.
    function noteMatches(note, filters, tagById, me = '') {
        if (filters.author && note.userId !== filters.author) return false;
        if (filters.tag !== 'all' && !note.tags.includes(filters.tag)) return false;
        if (filters.act === MY_SCENES) { if (!Mentions.labelMentions(note.act || 'Preshow', me)) return false; }
        else if (filters.act !== 'all' && (note.act || 'Preshow') !== filters.act) return false;
        if (filters.mentionedUserId && !Mentions.has(note, filters.mentionedUserId) && !(note.comments || []).some(c => Mentions.has(c, filters.mentionedUserId))) return false;
        if (filters.search) {
            const reference = /^(?:#|note\s*#?\s*)?(\d+)$/i.exec(filters.search.trim());
            if (reference && NoteNumbers.label(note) === `#${Number(reference[1])}`) return true;
            if (reference && /^(#|note\s)/i.test(filters.search.trim())) return false;
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
                ...(ProfilePhotos.validUsername(note.emailPrefix) ? { emailPrefix: note.emailPrefix } : previous?.emailPrefix ? { emailPrefix: previous.emailPrefix } : {}),
                names: [...new Set([...(previous?.names || []), name])] });
        }
        const result = [...people.values()].sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
        for (const person of result) person.label = result.some(other => other.userId !== person.userId && other.name === person.name)
            ? `${person.name} · Account ${result.filter(other => other.name === person.name).findIndex(other => other.userId === person.userId) + 1}` : person.name;
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

    function createAuthorSearch({ input, chip, mentionChip, getCurrentUserId, getCurrentUserName, popover, filters, getNotes, onChange, beforeOpen }) {
        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-autocomplete', 'list');
        input.setAttribute('aria-controls', popover.id);
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-description');
        popover.setAttribute('role', 'listbox');
        popover.setAttribute('aria-label', 'Search suggestions');
        const clearSearch = input.closest('.search').querySelector('[data-clear-search]');
        let people = [], active = -1, pendingPerson = null, suppressFocusSuggestions = false;
        const controls = [];
        function close() {
            popover.hidden = true; active = -1; pendingPerson = null;
            input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant');
        }
        function focusSearch() {
            suppressFocusSuggestions = true;
            input.focus({ preventScroll: true });
            suppressFocusSuggestions = false;
        }
        function closeModes() { controls.forEach(control => control.dropdown.close()); }
        function reposition() {
            if (!popover.hidden) placePopover(popover, input.closest('.search'), 'left');
            controls.forEach(control => control.dropdown.reposition());
        }
        const matchOptions = [{ value: 'author', label: 'Written by' }, { value: 'mentionedUserId', label: 'Mentions' }];
        for (const [container, field, prefix] of [[chip, 'author', 'By'], [mentionChip, 'mentionedUserId', 'Mentions']]) {
            if (!container) continue;
            const button = document.createElement('button'); button.type = 'button'; button.className = 'select active person-filter-value';
            const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'icon-btn person-filter-clear';
            setHtml(remove, '<i data-icon="close"></i>');
            container.replaceChildren(button, remove);
            const modePopover = document.createElement('div'); modePopover.className = 'popover filter-popover'; modePopover.hidden = true;
            modePopover.id = container.id + '-mode'; modePopover.setAttribute('role', 'listbox'); modePopover.setAttribute('aria-label', 'Match this person'); document.body.append(modePopover);
            const dropdown = createDropdown({ button, popover: modePopover,
                beforeOpen: () => { close(); beforeOpen?.(); closeModes(); },
                onChange: nextField => {
                    const userId = filters[field];
                    if (!userId) return;
                    if (!matchOptions.some(option => option.value === nextField)) return;
                    if (nextField !== field) { filters[field] = ''; filters[nextField] = userId; }
                    refresh(); onChange(); controls.find(control => control.field === nextField)?.button.focus({ preventScroll: true });
                }
            });
            remove.addEventListener('click', () => { filters[field] = ''; closeModes(); close(); refresh(); onChange(); focusSearch(); });
            controls.push({ container, button, remove, dropdown, field, prefix });
        }
        function refresh() {
            if (clearSearch) clearSearch.hidden = !input.value;
            const ownId = getCurrentUserId?.();
            people = authorOptions(getNotes().flatMap(note => [note,
                ...[...(note.mentions || []), ...(note.comments || []).flatMap(comment => comment.mentions || [])]
                    .map(person => ({ userId: person.userId, user: person.name }))]));
            for (const control of controls) {
                const { container, button, remove, dropdown, field, prefix } = control;
                container.hidden = !filters[field];
                if (container.hidden) { control.key = null; continue; }
                const person = people.find(p => p.userId === filters[field]);
                const self = field === 'mentionedUserId' && !!ownId && filters[field] === ownId;
                const label = self ? 'you' : person?.label || 'Unknown person';
                const avatarName = self ? getCurrentUserName?.() || person?.name || '' : person?.name || label;
                const key = JSON.stringify([filters[field], label, avatarName, person?.emailPrefix]);
                if (control.key === key) continue;
                control.key = key;
                dropdown.render(matchOptions, field);
                setHtml(button, `${avatarHTML(filters[field], avatarName, 'sm', person?.emailPrefix)}<span>${esc(prefix)} ${esc(label)}</span>`);
                button.setAttribute('aria-label', `Change person filter: ${prefix} ${label}`);
                remove.setAttribute('aria-label', `Remove ${prefix.toLowerCase()} filter: ${label}`);
            }
        }
        function applyPerson(person, field) {
            filters[field] = person.userId; filters.search = ''; input.value = '';
            close(); refresh(); onChange(); focusSearch();
        }
        function choosePerson(person) {
            if (!person) return;
            if (!mentionChip || (!filters.author && !filters.mentionedUserId)) return applyPerson(person, 'author');
            // Existing filters stay untouched until the person explicitly chooses
            // which kind to replace/add. One row per person in ordinary search.
            pendingPerson = person;
            setHtml(popover, `<div class="person-choice-label">${avatarHTML(person.userId, person.name, 'sm', person.emailPrefix)}<span>${esc(person.label)}</span></div>` +
                matchOptions.map((option, i) => `<button type="button" class="tag-option" role="option" id="${esc(popover.id)}-${i}" data-person-mode="${option.value}" aria-selected="${i === 0}">${esc(option.label)}</button>`).join(''));
            active = 0; input.setAttribute('aria-activedescendant', popover.id + '-0');
            placePopover(popover, input.closest('.search'), 'left');
        }
        function suggest() {
            pendingPerson = null; refresh(); closeModes();
            const query = input.value.trim().toLowerCase();
            const personQuery = query.replace(/^@/, '').trim().replace(/\s+/g, ' ');
            const matches = query ? people.filter(p => p.names.some(name => name.toLowerCase().trim().replace(/\s+/g, ' ').includes(personQuery))).slice(0, 8) : [];
            const references = NoteNumbers.suggestions(getNotes(), query);
            const ownId = getCurrentUserId?.();
            const showSelfFilter = query === '@' && !!ownId && !!mentionChip;
            if (!matches.length && !references.length && !showSelfFilter) return close();
            beforeOpen?.();
            const numbers = references.map((note, i) => `<button type="button" class="tag-option reference-option" role="option" id="${esc(popover.id)}-${i}" data-number="${note.noteNumber}" aria-selected="false"><span class="reference-symbol mono" aria-hidden="true">#</span><span><strong>Note ${esc(NoteNumbers.label(note))}</strong><small>${esc(note.user || 'Unknown')} · ${esc(String(note.text).replace(/\s+/g, ' ').slice(0, 90))}</small></span></button>`).join('');
            const persons = matches.map((person, i) => `<button type="button" class="tag-option author-option" role="option" id="${esc(popover.id)}-${references.length + i}" data-person="${esc(person.userId)}" aria-selected="false">${avatarHTML(person.userId, person.name, 'sm', person.emailPrefix)}<span>${esc(person.label)}</span></button>`).join('');
            const applied = showSelfFilter && filters.mentionedUserId === ownId;
            const selfFilter = showSelfFilter ? `<button type="button" class="tag-option quick-filter-option" role="option" id="${esc(popover.id)}-self" data-self-mentions="true" aria-selected="${applied}"><span class="reference-symbol mono" aria-hidden="true">@</span><span>Notes mentioning you</span><i data-icon="check" data-class="quick-filter-check${applied ? '' : ' is-hidden'}"></i></button>` : '';
            setHtml(popover, selfFilter + numbers + persons); active = -1;
            placePopover(popover, input.closest('.search'), 'left'); input.setAttribute('aria-expanded', 'true');
        }
        function selectOption(option) {
            if (!option) return;
            if (option.dataset.selfMentions) {
                const ownId = getCurrentUserId?.();
                if (!ownId) return close();
                filters.mentionedUserId = filters.mentionedUserId === ownId ? '' : ownId;
                filters.search = ''; input.value = ''; close(); refresh(); onChange(); focusSearch(); return;
            }
            if (option.dataset.personMode && pendingPerson) return applyPerson(pendingPerson, option.dataset.personMode);
            if (!option.dataset.number) return choosePerson(people.find(person => person.userId === option.dataset.person));
            filters.search = `#${option.dataset.number}`; input.value = filters.search;
            close(); refresh(); onChange(); focusSearch(); close();
        }
        function clearInput() {
            input.value = ''; filters.search = ''; close(); refresh(); onChange(); focusSearch();
        }
        clearSearch?.addEventListener('click', clearInput);
        input.addEventListener('input', suggest);
        input.addEventListener('focus', () => { if (!suppressFocusSuggestions) suggest(); });
        input.addEventListener('click', () => { if (!input.value.trim() && popover.hidden) suggest(); });
        input.addEventListener('keydown', event => {
            if (event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
            if (event.key === 'Escape' && (input.value || !popover.hidden)) { event.preventDefault(); event.stopPropagation(); clearInput(); return; }
            if (popover.hidden && event.key === 'ArrowDown' && !input.value.trim()) suggest();
            if (popover.hidden) return;
            if (event.key === 'Tab' && event.shiftKey) { close(); return; }
            const options = [...popover.querySelectorAll('[role="option"]')];
            if ((event.key === 'Enter' && active >= 0) || (event.key === 'Tab' && options.length)) {
                event.preventDefault(); selectOption(options[Math.max(0, active)]);
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault(); active = Math.max(0, Math.min(options.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)));
                options.forEach((option, i) => option.setAttribute('aria-selected', String(i === active)));
                input.setAttribute('aria-activedescendant', options[active].id); options[active].scrollIntoView({ block: 'nearest' });
            }
        });
        input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input && !popover.contains(document.activeElement)) close(); }, 0));
        popover.addEventListener('click', event => { event.stopPropagation(); selectOption(event.target.closest('[role="option"]')); });
        popover.addEventListener('keydown', event => { if (event.key === 'Escape') { clearInput(); } });
        document.addEventListener('click', event => { if (!popover.contains(event.target) && event.target !== input) close(); });
        document.addEventListener('focusin', event => { if (event.target !== input && !popover.contains(event.target)) close(); });
        window.addEventListener('scroll', reposition, { passive: true }); watchPopoverResize(close, reposition);
        return { refresh, close() { close(); closeModes(); }, reposition };
    }

    // The scene and tag dropdowns' choices.
    const MY_SCENES = '@my-scenes';
    function sceneOptions(acts, me = '') {
        return [{ value: 'all', label: 'All scenes' }, ...(me ? [{ value: MY_SCENES, label: 'My scenes' }] : []), ...acts.map(act => ({ value: act, label: act }))];
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
        esc, safeColor, setHtml, playbackLinkHTML, agreementsHTML, updateAgreements,
        clockTime, fullTime, relativeTime, plural,
        initials, personColor, avatarHTML,
        unknownTag, tagChipHTML, tagChipsHTML, dotHTML,
        noteHeadHTML, noteHTML, commentHTML, groupHeadHTML, groupNotes, groupStartTimes, sceneStartTimes, updateGroupTime,
        noteMatches, filtersActive, sceneOptions, MY_SCENES, tagOptions,
        authorOptions, storedAuthorId, readFilters, writeFilters, watchNavigation, createAuthorSearch,
        placePopover, fitPopoverInViewport, watchPopoverResize, createDropdown
    };
}));
