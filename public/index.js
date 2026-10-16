document.addEventListener('DOMContentLoaded', function() {
    const $ = (id) => document.getElementById(id);

    // --- DOM element references ---
    const globalTimecodeElement = $('globalTimecode');
    const globalLxCueElement = $('globalLxCue');
    const personalTimecodeElement = $('personalTimecodeDisplay');
    const personalLxCueElement = $('personalLxCueDisplay');
    const personalTimecodeContainer = $('personalTimecode');
    const stampLabel = $('stampLabel');
    const sourceBadge = $('sourceBadge');
    const timeModeLabel = $('timeModeLabel');
    const composer = $('composer');
    const noteInput = $('noteInput');
    const lxCueInput = $('lxCueInput');
    const sendNoteBtn = $('sendNote');
    const cancelNoteBtn = $('cancelNote');
    const usersButton = $('usersButton');
    const usersPopover = $('usersPopover');
    const usersList = $('usersList');
    const avatarStack = $('avatarStack');
    const userCount = $('userCount');
    const menuButton = $('menuButton');
    const menuPopover = $('menuPopover');
    const notesList = $('notesList');
    const notesEmpty = $('notesEmpty');
    const notesNoMatch = $('notesNoMatch');
    const notesCount = $('notesCount');
    const clearFiltersBtn = $('clearFilters');
    const searchInput = $('searchInput');
    const exportJsonBtn = $('exportJson');
    const currentUserName = $('currentUserName');
    const tagsContainer = $('tagsContainer');
    const tagFilter = $('tagFilter');
    const tagError = $('tagError');
    const currentActDisplay = $('currentActDisplay');
    const actFilter = $('actFilter');
    const actFilterPopover = $('actFilterPopover');
    const tagFilterPopover = $('tagFilterPopover');
    const tagPicker = $('tagPicker');
    const tagPickerList = $('tagPickerList');
    const tagPickerHint = $('tagPickerHint');
    const chatToggle = $('chatToggle');
    const chatDrawer = $('chatDrawer');
    const chatClose = $('chatClose');
    const chatUnread = $('chatUnread');
    const chatInput = $('chatInput');
    const sendChatBtn = $('sendChat');
    const chatMessages = $('chatMessages');
    const chatCount = $('chatCount');
    const scrollToTopBtn = $('scrollToTopBtn');
    const connectionBanner = $('connectionBanner');

    // --- State variables ---
    let currentUser = {
        name: 'Guest',
        sub: null,
        isTyping: false,
        frozenTimecode: null,
        frozenLxCue: null,
        currentFrameRate: 30
    };
    let currentGlobalTimecode = { hours: 0, minutes: 0, seconds: 0, frames: 0, frameRate: 30 };
    // Latest timecode from each source; the display shows the one matching timeMode.
    const latestTimecodes = {
        midi: { hours: 0, minutes: 0, seconds: 0, frames: 0, frameRate: 30, source: 'midi' },
        network: { hours: 0, minutes: 0, seconds: 0, frames: 0, frameRate: 30, source: 'network' }
    };
    const liveSources = { midi: false, network: false };
    let currentGlobalLxCue = '1';
    let allNotes = [];
    let timeMode = 'realtime';
    let realTimeInterval = null;
    let availableTags = [];
    let selectedTags = [];
    let autoResumeTimer = null;
    let chatMessagesList = [];
    let unreadChat = 0;
    let currentAct = 'Preshow';
    const filters = { tag: 'all', act: 'all', search: '' };
    const noteElements = new Map();
    // Notes submitted but not yet acknowledged by the server, keyed by the
    // clientId sent with them: clientId -> { note, element, writtenAt }.
    const pendingNotes = new Map();

    // Per-note UI state lives here rather than in the DOM, so a note can be
    // re-rendered (tags changed, comment added...) without losing what
    // someone is in the middle of typing.
    const openReplies = new Set(); // notes with the reply box open
    const commentDrafts = new Map();            // noteId -> text
    const noteEditDrafts = new Map();           // noteId -> text, while editing
    const commentEditDrafts = new Map();        // `${noteId}/${commentId}` -> text, while editing
    const deletedNotes = new Set();             // noteIds hidden while their Undo toast shows
    const deletedComments = new Set();          // `${noteId}/${commentId}`, likewise
    let tagPickerNoteId = null;

    // --- Helper functions ---
    // See public/safe-html.js: escape every value, set HTML only through setHtml().
    const { escapeHtml: esc } = SafeHtml;
    const safeColor = (color) => SafeHtml.safeColour(color, '#8a8f98');
    const SVG_NS = 'http://www.w3.org/2000/svg';

    // Like SafeHtml.setHtml, then swaps each <i data-icon="name"> placeholder
    // for the matching icon from the page's sprite. DOMPurify strips <svg><use>,
    // so icons are made here with DOM calls instead of in the markup.
    function setHtml(element, html) {
        SafeHtml.setHtml(element, html);
        for (const placeholder of element.querySelectorAll('i[data-icon]')) {
            const svg = document.createElementNS(SVG_NS, 'svg');
            svg.setAttribute('class', `icon ${placeholder.dataset.class || ''}`.trim());
            svg.setAttribute('aria-hidden', 'true');
            const use = document.createElementNS(SVG_NS, 'use');
            use.setAttribute('href', `#i-${placeholder.dataset.icon}`);
            svg.appendChild(use);
            placeholder.replaceWith(svg);
        }
    }

    const pad = (n) => String(n || 0).padStart(2, '0');

    function formatTimecode(tc) {
        if (!tc || typeof tc !== 'object') return '00:00:00:00';
        if (tc.displayMode === 'realtime') return `${pad(tc.hours)}:${pad(tc.minutes)}:${pad(tc.seconds)}.${pad(Math.floor((tc.milliseconds || 0) / 10))}`;
        return `${pad(tc.hours)}:${pad(tc.minutes)}:${pad(tc.seconds)}:${pad(tc.frames)}`;
    }

    function formatNoteTimecode(note) {
        if (!note.timecode) return formatTimecode(null);
        if (note.frameRate === 'ms') return formatTimecode({ ...note.timecode, displayMode: 'realtime' });
        return formatTimecode(note.timecode);
    }

    function clockTime(timestamp) {
        return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function relativeTime(timestamp) {
        const mins = Math.floor((Date.now() - new Date(timestamp)) / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        return clockTime(timestamp);
    }

    function plural(n, word) {
        return `${n} ${word}${n === 1 ? '' : 's'}`;
    }

    function isMine(item) {
        return NoteAuthor.canEditNote(item, currentUser.sub);
    }

    function initials(name) {
        const parts = String(name || '?').trim().split(/\s+/);
        return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
    }

    // A stable colour per person, so the same face shows up the same way everywhere.
    function personColor(key) {
        let h = 0;
        for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        return `hsl(${h % 360}, 45%, 42%)`;
    }

    // Older backups may lack a note's tags or comments; the page assumes lists.
    function withLists(note) {
        return { ...note, tags: Array.isArray(note.tags) ? note.tags : [], comments: Array.isArray(note.comments) ? note.comments : [] };
    }

    function tagById(id) {
        return availableTags.find(t => t.id === id) || { id, name: id, color: '#8a8f98' };
    }

    const TOAST_MS = 6000;
    let toastTimer = null;
    function showToast(message, actionLabel, action) {
        document.querySelectorAll('.toast').forEach(t => t.remove());
        clearTimeout(toastTimer);
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.setAttribute('role', 'status');
        setHtml(toast, `<span>${esc(message)}</span>${actionLabel ? `<button type="button" class="link-btn">${esc(actionLabel)}</button>` : ''}`);
        if (actionLabel) {
            toast.querySelector('button').addEventListener('click', () => { toast.remove(); action(); });
        }
        document.body.appendChild(toast);
        toastTimer = setTimeout(() => toast.remove(), TOAST_MS);
    }

    // --- Tags ---
    function loadTagsFromStorage() {
        try {
            const storedTags = localStorage.getItem('midi-timecode-notes-tags');
            if (storedTags) availableTags = JSON.parse(storedTags);
        } catch (e) { /* storage unavailable */ }
    }

    function saveTagsToStorage() {
        try { localStorage.setItem('midi-timecode-notes-tags', JSON.stringify(availableTags)); } catch (e) { /* ignore */ }
    }

    function chipHTML(tag, attrs) {
        return `<button type="button" class="chip" style="--tag: ${safeColor(tag.color)}" ${attrs}><span class="dot"></span>${esc(tag.name)}</button>`;
    }

    // Tags for the note being written: toggles under the note box.
    function updateTagsDisplay() {
        selectedTags = selectedTags.filter(id => availableTags.some(t => t.id === id));
        setHtml(tagsContainer, availableTags.map(tag =>
            chipHTML(tag, `data-tag="${esc(tag.id)}" aria-pressed="${selectedTags.includes(tag.id)}"`)
        ).join(''));
    }

    // A filter is a button opening a list of choices rather than a <select>,
    // which can't show each tag's colour. color '' draws an empty ring, so
    // "All tags" lines up with the coloured dots under it.
    function dotHTML(color) {
        if (color === undefined) return '';
        return color ? `<span class="dot" style="--tag: ${safeColor(color)}"></span>` : '<span class="dot ring"></span>';
    }

    function renderDropdown(button, popover, options, value) {
        const current = options.find(o => o.value === value) || options[0];
        setHtml(button, `${dotHTML(current.color)}<span>${esc(current.label)}</span>`);
        button.classList.toggle('active', value !== 'all');
        setHtml(popover, options.map(o => `
            <button type="button" class="tag-option" role="option" data-value="${esc(o.value)}" aria-selected="${o.value === value}">
                ${dotHTML(o.color)}${esc(o.label)}<i data-icon="check" data-class="check"></i>
            </button>`).join(''));
    }

    function updateFilterTags() {
        if (filters.tag !== 'all' && !availableTags.some(t => t.id === filters.tag)) filters.tag = 'all';
        renderDropdown(tagFilter, tagFilterPopover, [
            { value: 'all', label: 'All tags', color: '' },
            ...availableTags.map(tag => ({ value: tag.id, label: tag.name, color: tag.color }))
        ], filters.tag);
        tagFilter.hidden = availableTags.length === 0;
    }

    // --- Filtering ---
    function noteMatches(note) {
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

    function filtersActive() {
        return filters.tag !== 'all' || filters.act !== 'all' || filters.search !== '';
    }

    // Shows/hides rows, then each act heading with how many of its notes show.
    function filterNotes() {
        let shown = 0;
        let head = null;
        let headCount = 0;
        const closeGroup = () => {
            if (!head) return;
            head.hidden = headCount === 0;
            head.querySelector('.group-count').textContent = plural(headCount, 'note');
        };
        for (const el of notesList.children) {
            if (el.classList.contains('group-head')) {
                closeGroup();
                head = el;
                headCount = 0;
            } else if (!el.classList.contains('pending')) {
                const note = allNotes.find(n => n.id === el.dataset.noteId);
                const visible = !!note && !deletedNotes.has(note.id) && noteMatches(note);
                el.hidden = !visible;
                if (visible) { shown++; headCount++; }
            }
        }
        closeGroup();

        const total = allNotes.length - deletedNotes.size;
        notesCount.textContent = filtersActive() ? `${shown} of ${plural(total, 'note')}` : '';
        clearFiltersBtn.hidden = !filtersActive();
        notesEmpty.hidden = total > 0 || pendingNotes.size > 0;
        notesNoMatch.hidden = !(total > 0 && shown === 0 && filtersActive());
    }

    function updateActFilter() {
        const acts = [...new Set(allNotes.filter(n => !deletedNotes.has(n.id)).map(note => note.act || 'Preshow'))];
        if (filters.act !== 'all' && !acts.includes(filters.act)) filters.act = 'all';
        renderDropdown(actFilter, actFilterPopover, [
            { value: 'all', label: 'All scenes' },
            ...acts.map(act => ({ value: act, label: act }))
        ], filters.act);
        actFilter.hidden = acts.length < 2 && filters.act === 'all';
    }

    function clearFilters() {
        filters.tag = 'all';
        filters.act = 'all';
        filters.search = '';
        searchInput.value = '';
        updateActFilter();
        updateFilterTags();
        filterNotes();
    }

    // --- Timecode and live display ---
    function updateGlobalTimecodeDisplay(timecode) {
        globalTimecodeElement.textContent = formatTimecode(timecode);
    }

    function updatePersonalTimecodeDisplay(timecode) {
        personalTimecodeElement.textContent = formatTimecode(timecode);
    }

    function updateGlobalLxCueDisplay(cue) {
        globalLxCueElement.textContent = cue || '--';
    }

    function updatePersonalLxCueDisplay(cue) {
        personalLxCueElement.textContent = cue || '--';
    }

    const timeModeLabels = { midi: 'MIDI TC', network: 'Network TC', realtime: 'Time' };

    function updateSourceBadge() {
        const live = liveSources[timeMode];
        sourceBadge.textContent = live ? 'Live' : 'Waiting';
        sourceBadge.title = live ? 'Timecode is coming in' : 'No timecode received yet';
        sourceBadge.classList.toggle('live', !!live);
    }

    function updateTimeModeDisplay() {
        timeModeLabel.textContent = timeModeLabels[timeMode] || timeModeLabels.midi;
        if (timeMode === 'realtime') {
            sourceBadge.hidden = true;
            globalTimecodeElement.title = 'Time of day';
            startRealTimeMode();
        } else {
            currentGlobalTimecode = latestTimecodes[timeMode];
            currentUser.currentFrameRate = currentGlobalTimecode.frameRate;
            updateSourceBadge();
            sourceBadge.hidden = false;
            globalTimecodeElement.title = `${currentGlobalTimecode.frameRate} fps`;
            stopRealTimeMode();
            updateGlobalTimecodeDisplay(currentGlobalTimecode);
            if (!currentUser.isTyping) updatePersonalTimecodeDisplay(currentGlobalTimecode);
        }
    }

    function startRealTimeMode() {
        if (realTimeInterval) clearInterval(realTimeInterval);
        updateRealTimeDisplay();
        realTimeInterval = setInterval(updateRealTimeDisplay, 10);
    }

    function stopRealTimeMode() {
        if (realTimeInterval) {
            clearInterval(realTimeInterval);
            realTimeInterval = null;
        }
    }

    function realTimeNow() {
        const now = new Date();
        return {
            hours: now.getHours(),
            minutes: now.getMinutes(),
            seconds: now.getSeconds(),
            milliseconds: now.getMilliseconds(),
            displayMode: 'realtime'
        };
    }

    function updateRealTimeDisplay() {
        const now = realTimeNow();
        updateGlobalTimecodeDisplay(now);
        if (!currentUser.isTyping) updatePersonalTimecodeDisplay(now);
    }

    // --- Writing a note ---
    function updateComposer() {
        const open = currentUser.isTyping || noteInput.value.length > 0 || document.activeElement === noteInput;
        composer.classList.toggle('open', open);
        personalTimecodeContainer.classList.toggle('frozen', currentUser.isTyping);
        stampLabel.textContent = currentUser.isTyping ? 'Note taken at' : 'Taken when you start typing';
        personalTimecodeContainer.title = 'Locked when you start writing, so it matches the moment you saw';
        noteInput.style.height = 'auto';
        noteInput.style.height = `${noteInput.scrollHeight}px`;
    }

    function startTyping() {
        if (currentUser.isTyping) return;
        currentUser.isTyping = true;
        if (timeMode === 'realtime') {
            currentUser.frozenTimecode = { ...realTimeNow(), frameRate: 'ms' };
        } else {
            currentUser.frozenTimecode = { ...currentGlobalTimecode, displayMode: timeMode };
        }
        currentUser.frozenLxCue = currentGlobalLxCue;
        updatePersonalTimecodeDisplay(currentUser.frozenTimecode);
        updatePersonalLxCueDisplay(currentUser.frozenLxCue);
        updateComposer();
        window.socket.emit('typing-start', {
            timecode: currentUser.frozenTimecode,
            lxCue: currentUser.frozenLxCue
        });
        startAutoResumeTimer();
    }

    // Unfreezes the stamp so it follows the show again.
    function releaseFreeze() {
        currentUser.isTyping = false;
        currentUser.frozenTimecode = null;
        currentUser.frozenLxCue = null;
        if (timeMode !== 'realtime') updatePersonalTimecodeDisplay(currentGlobalTimecode);
        updatePersonalLxCueDisplay(currentGlobalLxCue);
        window.socket.emit('typing-stop');
        clearAutoResumeTimer();
        updateComposer();
    }

    function resetComposer() {
        noteInput.value = '';
        sendNoteBtn.disabled = true;
        selectedTags = [];
        updateTagsDisplay();
        showTagError(false);
        releaseFreeze();
        clearDraft();
    }

    // A note needs a tag (unless none are set up) so it reaches the right department.
    function needsTag() {
        return availableTags.length > 0 && selectedTags.length === 0;
    }

    function showTagError(show) {
        tagError.hidden = !show;
        tagsContainer.classList.toggle('invalid', show);
    }

    function cancelNote() {
        resetComposer();
    }

    // Discarding typed text can be undone for a few seconds (stamp included).
    function discardNote() {
        const text = noteInput.value;
        if (!text.trim()) return cancelNote();
        const saved = { text, tags: [...selectedTags], timecode: currentUser.frozenTimecode, lxCue: currentUser.frozenLxCue };
        cancelNote();
        noteInput.blur();
        showToast('Note discarded', 'Undo', () => {
            noteInput.value = saved.text;
            selectedTags = saved.tags;
            updateTagsDisplay();
            noteInput.focus();
            currentUser.frozenTimecode = saved.timecode;
            currentUser.frozenLxCue = saved.lxCue;
            updatePersonalTimecodeDisplay(saved.timecode);
            updatePersonalLxCueDisplay(saved.lxCue);
            sendNoteBtn.disabled = false;
            updateComposer();
            saveDraft();
        });
    }

    // Restarted by every focus, keystroke and blur: once the box has been
    // empty that long the stamp follows the show again (see type-to-note.js).
    function startAutoResumeTimer() {
        clearAutoResumeTimer();
        autoResumeTimer = setTimeout(function() {
            autoResumeTimer = null;
            const action = typeToNote.emptyBoxAction({
                isTyping: currentUser.isTyping,
                noteValue: noteInput.value,
                focused: document.activeElement === noteInput
            });
            if (action === 'release') releaseFreeze();
            else if (action === 'cancel') cancelNote();
        }, typeToNote.EMPTY_RELEASE_MS);
    }

    function clearAutoResumeTimer() {
        if (autoResumeTimer) {
            clearTimeout(autoResumeTimer);
            autoResumeTimer = null;
        }
    }

    // --- Online users ---
    // One entry per person, even with the page open in several tabs.
    function renderUsers(users) {
        const people = new Map();
        for (const u of users) {
            const key = u.id || u.name;
            const existing = people.get(key);
            if (existing) existing.isTyping = existing.isTyping || u.isTyping;
            else people.set(key, { key, name: u.name, isTyping: !!u.isTyping, me: !!currentUser.sub && u.id === currentUser.sub });
        }
        const list = [...people.values()].sort((a, b) => (b.me - a.me) || a.name.localeCompare(b.name));
        userCount.textContent = `${list.length} online`;

        const MAX = 4;
        setHtml(avatarStack, list.slice(0, MAX).map(p =>
            `<span class="avatar${p.isTyping ? ' typing' : ''}" style="background:${personColor(p.key)}">${esc(initials(p.name))}</span>`
        ).join('') + (list.length > MAX ? `<span class="avatar more">+${list.length - MAX}</span>` : ''));

        setHtml(usersList, list.map(p => `
            <li>
                <span class="avatar" style="background:${personColor(p.key)}">${esc(initials(p.name))}</span>
                <span>${esc(p.name)}</span>${p.me ? '<span class="you">you</span>' : ''}
                ${p.isTyping ? '<span class="writing">writing…</span>' : ''}
            </li>`).join(''));
    }

    // --- Popovers (online list, menu, tag picker) ---
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

    function closePopovers() {
        let closed = false;
        for (const [popover, button] of [[usersPopover, usersButton], [menuPopover, menuButton], [actFilterPopover, actFilter], [tagFilterPopover, tagFilter]]) {
            if (popover.hidden) continue;
            closed = true;
            const hadFocus = popover.contains(document.activeElement);
            popover.hidden = true;
            button.setAttribute('aria-expanded', 'false');
            if (hadFocus) button.focus({ preventScroll: true });
        }
        if (!tagPicker.hidden) {
            closed = true;
            closeTagPicker();
        }
        return closed;
    }

    function togglePopover(popover, button, align = 'right') {
        const wasOpen = !popover.hidden;
        closePopovers();
        if (wasOpen) return false;
        placePopover(popover, button, align);
        button.setAttribute('aria-expanded', 'true');
        return true;
    }

    function renderTagPicker() {
        const note = allNotes.find(n => n.id === tagPickerNoteId);
        if (!note) return closeTagPicker();
        // The last tag on a note can't be taken off, only swapped by ticking another first.
        const onlyTag = note.tags.length === 1 ? note.tags[0] : null;
        tagPickerHint.hidden = !onlyTag;
        const focused = tagPicker.contains(document.activeElement) ? document.activeElement.dataset.tag : null;
        setHtml(tagPickerList, availableTags.map(tag => `
            <button type="button" class="tag-option" role="menuitemcheckbox" data-tag="${esc(tag.id)}" aria-checked="${note.tags.includes(tag.id)}"${tag.id === onlyTag ? ' aria-disabled="true"' : ''} style="--tag: ${safeColor(tag.color)}">
                <span class="dot"></span>${esc(tag.name)}<i data-icon="check" data-class="check"></i>
            </button>`).join('') || '<div class="popover-title">No tags set up</div>');
        if (focused) [...tagPickerList.querySelectorAll('.tag-option')].find(o => o.dataset.tag === focused)?.focus();
    }

    function openTagPicker(noteId, anchor) {
        closePopovers();
        tagPickerNoteId = noteId;
        renderTagPicker();
        placePopover(tagPicker, anchor, 'left');
        const first = tagPickerList.querySelector('.tag-option');
        if (first) first.focus();
    }

    function closeTagPicker() {
        const noteId = tagPickerNoteId;
        tagPicker.hidden = true;
        tagPickerNoteId = null;
        const el = noteId && noteElements.get(noteId);
        if (el && tagPicker.contains(document.activeElement)) el.querySelector('[data-action="edit-tags"]')?.focus();
    }

    tagPickerList.addEventListener('click', (e) => {
        const option = e.target.closest('.tag-option');
        const note = allNotes.find(n => n.id === tagPickerNoteId);
        if (!option || !note) return;
        const id = option.dataset.tag;
        const tags = note.tags.includes(id) ? note.tags.filter(t => t !== id) : [...note.tags, id];
        if (!tags.length) return;
        option.setAttribute('aria-checked', String(tags.includes(id)));
        window.socket.emit('note-update-tags', { noteId: note.id, tags });
    });

    tagPickerList.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const options = [...tagPickerList.querySelectorAll('.tag-option')];
        const i = options.indexOf(document.activeElement);
        const next = options[(i + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length];
        if (next) next.focus();
    });

    // --- Chat ---
    function isMyChat(msg) {
        return msg.userId ? msg.userId === currentUser.sub : msg.user === currentUser.name;
    }

    // Messages from one person within a few minutes of each other read as one
    // run: the name and face show once, at the start.
    function continuesRun(prev, msg) {
        return !!prev && (prev.userId || prev.user) === (msg.userId || msg.user)
            && new Date(msg.timestamp) - new Date(prev.timestamp) < 5 * 60 * 1000;
    }

    function renderChatMessage(msg, prev) {
        const mine = isMyChat(msg);
        const cont = continuesRun(prev, msg);
        const head = cont ? '' : `
                <div class="chat-msg-head">
                    ${mine ? '' : `<span class="chat-msg-user">${esc(msg.user)}</span>`}
                    <span class="chat-msg-time">${clockTime(msg.timestamp)}</span>
                </div>`;
        const face = mine ? '' : (cont ? '<span class="avatar-gap"></span>' : avatarHTML(msg.userId || msg.user, msg.user, 'sm'));
        return `
            <div class="chat-msg${mine ? ' mine' : ''}${cont ? ' cont' : ''}">
                ${face}
                <div class="chat-msg-main">${head}
                    <div class="bubble" title="${esc(new Date(msg.timestamp).toLocaleString())}">${esc(msg.text)}</div>
                </div>
            </div>`;
    }

    function chatNearBottom() {
        return chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 80;
    }

    function updateChatMessages() {
        chatCount.textContent = plural(chatMessagesList.length, 'message');
        if (chatMessagesList.length === 0) {
            setHtml(chatMessages, '<div class="chat-empty">No messages yet. Chat here is for everyone online and isn\'t part of the notes.</div>');
            return;
        }
        const sorted = [...chatMessagesList].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        setHtml(chatMessages, sorted.map((m, i) => renderChatMessage(m, sorted[i - 1])).join(''));
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function updateUnread() {
        chatUnread.hidden = unreadChat === 0;
        chatUnread.textContent = unreadChat > 99 ? '99+' : String(unreadChat);
    }

    function setChatOpen(open) {
        chatDrawer.hidden = !open;
        document.body.classList.toggle('chat-open', open);
        chatToggle.setAttribute('aria-expanded', String(open));
        if (open) {
            unreadChat = 0;
            updateUnread();
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
        try { localStorage.setItem('chat-open', open ? '1' : '0'); } catch (e) { /* ignore */ }
    }

    function sendChatMessage() {
        const text = chatInput.value.trim();
        if (text) {
            window.socket.emit('chat-message', { text });
            chatInput.value = '';
            sendChatBtn.disabled = true;
        }
    }

    // --- Scroll back to the newest notes ---
    function toggleScrollButton() {
        scrollToTopBtn.hidden = window.scrollY < 400;
    }

    function scrollToTop() {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // --- Rendering notes ---
    function tagChipsHTML(note) {
        return note.tags.map(id => {
            const tag = tagById(id);
            return `<span class="chip" style="--tag: ${safeColor(tag.color)}"><span class="dot"></span>${esc(tag.name)}</span>`;
        }).join('');
    }

    // A note's tags are one dropdown: the chips and a chevron open the tag picker.
    function tagTriggerHTML(note) {
        const names = note.tags.map(id => tagById(id).name).join(', ');
        const label = note.tags.length ? `Tags: ${names}. Change tags` : 'Add a tag';
        return `<button type="button" class="tag-trigger" data-action="edit-tags" aria-haspopup="dialog" aria-label="${esc(label)}" title="Change tags">
            ${tagChipsHTML(note) || '<span class="chip add-tag">Add a tag</span>'}<i data-icon="chevron"></i></button>`;
    }

    function avatarHTML(key, name, extraClass) {
        return `<span class="avatar${extraClass ? ` ${extraClass}` : ''}" style="background:${personColor(key)}" aria-hidden="true">${esc(initials(name))}</span>`;
    }

    function iconButton(action, icon, label, extra) {
        return `<button type="button" class="icon-btn" data-action="${action}" aria-label="${label}" title="${label}"${extra || ''}><i data-icon="${icon}"></i></button>`;
    }

    // Who wrote it, then where in the show (cue and timecode), then when.
    function noteHeadHTML(note, name, side) {
        const rate = note.frameRate === 'ms' ? 'real time' : `${note.frameRate || 30} fps`;
        const title = note.timestamp ? `${rate} · sent ${new Date(note.timestamp).toLocaleString()}` : rate;
        return `
            <div class="note-head">
                <span class="note-author">${esc(name)}</span>
                <span class="note-cue">Cue ${esc(note.lxCue || '–')}</span>
                <span class="note-tc mono" title="${esc(title)}">${esc(formatNoteTimecode(note))}</span>
                ${side}
            </div>`;
    }

    function commentHTML(note, comment) {
        const key = `${note.id}/${comment.id}`;
        const editing = commentEditDrafts.has(key);
        const tools = isMine(comment) && !editing ? `
            <span class="row-actions">
                ${iconButton('edit-comment', 'edit', 'Edit comment', ` data-comment-id="${esc(comment.id)}"`)}
                ${iconButton('delete-comment', 'trash', 'Delete reply', ` data-comment-id="${esc(comment.id)}"`)}
            </span>` : '';
        const body = editing ? `
            <div class="comment-edit">
                <textarea data-field="comment-edit" data-comment-id="${esc(comment.id)}" aria-label="Edit comment">${esc(commentEditDrafts.get(key))}</textarea>
                <div class="edit-actions">
                    <button type="button" class="btn ghost" data-action="cancel-comment-edit" data-comment-id="${esc(comment.id)}">Cancel</button>
                    <button type="button" class="btn primary" data-action="save-comment" data-comment-id="${esc(comment.id)}">Save</button>
                </div>
            </div>` : `<div class="comment-text">${esc(comment.text)}</div>`;
        const edited = comment.lastEdited ? ' · edited' : '';
        return `
            <div class="comment" data-comment-id="${esc(comment.id)}">
                ${avatarHTML(comment.userId || comment.user, comment.user, 'sm')}
                <div class="comment-main">
                    <div class="comment-head">
                        <span class="comment-user">${esc(comment.user)}</span>
                        <span class="muted" title="${esc(new Date(comment.timestamp).toLocaleString())}">${relativeTime(comment.timestamp)}${edited}</span>
                        ${tools}
                    </div>
                    ${body}
                </div>
            </div>`;
    }

    function noteHTML(note) {
        const comments = (note.comments || []).filter(c => !deletedComments.has(`${note.id}/${c.id}`));
        const editing = noteEditDrafts.has(note.id);
        const replying = openReplies.has(note.id);
        const canEdit = isMine(note);
        // Ownerless notes can be edited by anyone, but only deleted by whoever wrote them.
        const canDelete = !!note.userId && canEdit;

        const body = editing ? `
            <div class="note-edit">
                <textarea data-field="note-edit" aria-label="Edit note">${esc(noteEditDrafts.get(note.id))}</textarea>
                <div class="edit-actions">
                    <button type="button" class="btn ghost" data-action="cancel-note-edit">Cancel</button>
                    <button type="button" class="btn primary" data-action="save-note">Save</button>
                </div>
            </div>` : `<div class="note-text">${esc(note.text)}</div>`;

        const edited = note.lastEdited
            ? `<div class="note-edited">Edited by ${esc(note.lastEditedBy || 'unknown')} at ${clockTime(note.lastEdited)}</div>` : '';

        // While the note is being edited, Save and Cancel are its only actions.
        const actions = editing ? '' : `
            <span class="row-actions">
                ${iconButton('reply', 'reply', 'Reply')}
                ${canEdit ? iconButton('edit-note', 'edit', 'Edit note') : ''}
                ${canDelete ? iconButton('delete-note', 'trash', 'Delete note') : ''}
            </span>`;

        const foot = `<div class="note-foot">${tagTriggerHTML(note)}</div>`;

        const draft = commentDrafts.get(note.id) || '';
        return `
            <article class="note" data-note-id="${esc(note.id)}">
                ${avatarHTML(note.userId || note.user, note.user)}
                <div class="note-main">
                    ${noteHeadHTML(note, note.user, actions)}
                    ${body}${edited}
                    ${foot}
                    ${comments.length || replying ? `
                    <div class="comments">
                        ${comments.map(c => commentHTML(note, c)).join('')}
                        ${replying ? `
                        <div class="comment-input">
                            ${avatarHTML(currentUser.sub || currentUser.name, currentUser.name, 'sm')}
                            <div class="comment-box">
                                <textarea rows="1" data-field="comment" placeholder="Write a reply…" aria-label="Write a reply">${esc(draft)}</textarea>
                                <div class="comment-box-actions">
                                    <button type="button" class="btn ghost" data-action="cancel-comment">Cancel</button>
                                    <button type="button" class="btn primary" data-action="submit-comment" ${draft.trim() ? '' : 'disabled'}>Reply</button>
                                </div>
                            </div>
                        </div>` : editing ? '' : `
                        <button type="button" class="comment-input reply-prompt" data-action="reply">
                            ${avatarHTML(currentUser.sub || currentUser.name, currentUser.name, 'sm')}
                            <span class="reply-prompt-box">Reply to this thread…</span>
                        </button>`}
                    </div>` : ''}
                </div>
            </article>`;
    }

    function createNoteElement(note) {
        const wrapper = document.createElement('div');
        setHtml(wrapper, noteHTML(note).trim());
        const element = wrapper.firstChild;
        noteElements.set(note.id, element);
        return element;
    }

    function groupHeadElement(act) {
        const head = document.createElement('div');
        head.className = 'group-head';
        head.dataset.act = act;
        setHtml(head, `<span>${esc(act)}</span><span class="muted group-count"></span>`);
        return head;
    }

    // Puts focus and caret back where they were if the focused field was re-rendered.
    // Keeps focus (and the caret, in a text box) on the matching field or button in the new element.
    function rerenderPreservingFocus(oldEl, newEl) {
        const active = document.activeElement;
        let target = null;
        let caret = null;
        if (active && oldEl.contains(active) && (active.dataset.field || active.dataset.action)) {
            const comment = active.dataset.commentId ? `[data-comment-id="${CSS.escape(active.dataset.commentId)}"]` : '';
            target = active.dataset.field
                ? `[data-field="${active.dataset.field}"]${comment}`
                : `[data-action="${active.dataset.action}"]${comment}${active.classList.contains('reply-prompt') ? '.reply-prompt' : ''}`;
            if (active.dataset.field) caret = active.selectionStart;
        }
        newEl.hidden = oldEl.hidden;
        oldEl.replaceWith(newEl);
        if (target) {
            const el = newEl.querySelector(target);
            if (el) {
                el.focus();
                if (caret !== null) el.setSelectionRange(caret, caret);
            }
        }
    }

    function updateNoteElement(note) {
        const oldElement = noteElements.get(note.id);
        if (!oldElement) return;
        const newElement = createNoteElement(note);
        rerenderPreservingFocus(oldElement, newElement);
        if (tagPickerNoteId === note.id) renderTagPicker();
        filterNotes();
    }

    // Only for a note that is the newest; addNote rebuilds the list for one that isn't.
    // Pending notes stay above every note the server has.
    function insertNewestNote(element, note) {
        const act = note.act || 'Preshow';
        const firstHead = notesList.querySelector('.group-head');
        if (firstHead && firstHead.dataset.act === act) {
            firstHead.after(element);
        } else {
            const head = groupHeadElement(act);
            notesList.insertBefore(head, firstHead);
            head.after(element);
        }
    }

    function rebuildFullNotesList() {
        notesList.replaceChildren();
        noteElements.clear();
        for (const { element } of [...pendingNotes.values()].reverse()) notesList.appendChild(element);
        let lastAct = null;
        for (const note of NoteOrder.newestFirst(allNotes)) {
            const act = note.act || 'Preshow';
            if (act !== lastAct) {
                notesList.appendChild(groupHeadElement(act));
                lastAct = act;
            }
            notesList.appendChild(createNoteElement(note));
        }
        updateActFilter();
        filterNotes();
        if (tagPickerNoteId) renderTagPicker();
    }

    function addNote(note) {
        if (noteElements.has(note.id)) return;
        const index = NoteOrder.insertionIndex(allNotes, note);
        allNotes.splice(index, 0, note);
        if (index < allNotes.length - 1) {
            // A late note (written while disconnected) belongs below later ones.
            rebuildFullNotesList();
        } else {
            const element = createNoteElement(note);
            insertNewestNote(element, note);
            updateActFilter();
            filterNotes();
            if (note.userId !== currentUser.sub) element.classList.add('flash');
        }
    }

    // --- Pending notes ---
    // A note is shown as pending from Send until the server acknowledges it
    // has stored it. While disconnected it is held here rather than in
    // socket.io's send buffer, and every pending note is (re)sent on connect:
    // one sent just before a drop may or may not have arrived, and the server
    // ignores a resend with a clientId it already has. They are also saved to
    // localStorage (pending-notes.js), so a reload or a trip through /login
    // while the server is unreachable does not lose them.
    const pendingStore = createPendingNotes({
        // reached inside pendingStore's try/catch, as merely touching localStorage can throw
        getItem: (key) => localStorage.getItem(key),
        setItem: (key, value) => localStorage.setItem(key, value),
        removeItem: (key) => localStorage.removeItem(key)
    });

    function savePendingNotes() {
        pendingStore.save(currentUser.sub, [...pendingNotes.values()]);
    }

    // The notes this browser had not got stored before it was last closed.
    function restorePendingNotes() {
        for (const { note, writtenAt } of pendingStore.load(currentUser.sub)) {
            if (pendingNotes.has(note.clientId) || allNotes.some(n => n.clientId === note.clientId)) continue;
            showPendingNote(note, writtenAt);
            sendPendingNote(note, writtenAt);
        }
        savePendingNotes();
    }

    function pendingBadgeText() {
        return window.socket.connected ? 'Sending…' : 'Not sent yet · goes out when the connection is back';
    }

    function createPendingNoteElement(note) {
        const wrapper = document.createElement('div');
        setHtml(wrapper, `
            <article class="note pending" data-client-id="${esc(note.clientId)}">
                ${avatarHTML(currentUser.sub || currentUser.name, currentUser.name)}
                <div class="note-main">
                    ${noteHeadHTML(note, currentUser.name, `<span class="pending-badge">${pendingBadgeText()}</span>`)}
                    <div class="note-text">${esc(note.text)}</div>
                    ${note.tags.length ? `<div class="note-foot">${tagChipsHTML(note)}</div>` : ''}
                </div>
            </article>
        `.trim());
        return wrapper.firstChild;
    }

    function updatePendingBadges() {
        const text = pendingBadgeText();
        for (const { element } of pendingNotes.values()) {
            element.querySelector('.pending-badge').textContent = text;
        }
    }

    // The age is recomputed on every send: the browser's clock is not the
    // server's, but how long ago the note was written is the same on both.
    function sendPendingNote(note, writtenAt) {
        if (!window.socket.connected) return;
        window.socket.emit('note-submit', { ...note, ageMs: Math.max(0, Date.now() - writtenAt) }, (stored) => {
            if (!stored || stored.error) {
                // Refused, so resending cannot help: say so on the note and stop trying.
                const pending = pendingNotes.get(note.clientId);
                if (!pending) return;
                pendingNotes.delete(note.clientId);
                savePendingNotes();
                pending.element.querySelector('.pending-badge').textContent =
                    `Not added. ${(stored && stored.error) || 'Something went wrong. Write it again.'}`;
                pending.element.classList.add('failed');
                return;
            }
            clearPendingNote(stored.clientId);
            addNote(withLists(stored));
        });
    }

    function clearPendingNote(clientId) {
        const pending = pendingNotes.get(clientId);
        if (!pending) return;
        pending.element.remove();
        pendingNotes.delete(clientId);
        savePendingNotes();
        filterNotes();
    }

    function showPendingNote(note, writtenAt) {
        const element = createPendingNoteElement(note);
        pendingNotes.set(note.clientId, { note, element, writtenAt });
        // The newest pending note goes above the older ones.
        notesList.insertBefore(element, notesList.firstChild);
        filterNotes();
    }

    function newClientId() {
        if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    }

    function submitNote(data) {
        const note = { ...data, clientId: newClientId() };
        const writtenAt = Date.now();
        showPendingNote(note, writtenAt);
        savePendingNotes();
        sendPendingNote(note, writtenAt);
    }

    // --- Draft note ---
    // The note being written is kept in sessionStorage (this tab only), with
    // its frozen stamp, so a reload or a bounce through /login gives it back.
    const DRAFT_KEY = 'note-draft';

    function saveDraft() {
        try {
            if (noteInput.value.trim() === '') return clearDraft();
            sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
                text: noteInput.value,
                tags: selectedTags,
                timecode: currentUser.frozenTimecode,
                lxCue: currentUser.frozenLxCue
            }));
        } catch (e) { /* storage unavailable */ }
    }

    function clearDraft() {
        try { sessionStorage.removeItem(DRAFT_KEY); } catch (e) { /* storage unavailable */ }
    }

    function restoreDraft() {
        let draft = null;
        try { draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY)); } catch (e) { /* none */ }
        if (!draft || typeof draft.text !== 'string' || !draft.timecode) return;
        noteInput.value = draft.text;
        sendNoteBtn.disabled = draft.text.trim().length === 0;
        selectedTags = Array.isArray(draft.tags) ? draft.tags : [];
        updateTagsDisplay();
        currentUser.isTyping = true;
        currentUser.frozenTimecode = draft.timecode;
        currentUser.frozenLxCue = draft.lxCue;
        updatePersonalTimecodeDisplay(draft.timecode);
        updatePersonalLxCueDisplay(draft.lxCue);
        updateComposer();
        startAutoResumeTimer();
    }

    // --- Login ---
    // Back through Keycloak to this same page, keeping the note being written.
    let goingToLogin = false;
    function goToLogin() {
        if (goingToLogin) return;
        goingToLogin = true;
        saveDraft();
        window.location.href = loginUrl();
    }

    // --- Socket.io setup ---
    // `page` tells the server which page this is (see pageOf() in server.js).
    window.socket = io({ auth: { page: 'main' } });

    // The server refuses the socket handshake when the session is missing or
    // expired (e.g. the login sat idle for 12 hours, or local-sessions.json was
    // deleted). That's distinct from an ordinary network blip - socket.io's normal
    // auto-reconnect can never succeed here, so send the user back through
    // the login flow instead of retrying forever.
    window.socket.on('connect_error', (err) => {
        if (err && err.message === 'unauthorized') {
            goToLogin();
            return;
        }
        connectionBanner.hidden = false;
    });

    // Logged out in another tab: this page's login is gone too.
    window.socket.on('logged-out', goToLogin);

    keepLoginAlive(goToLogin);

    // A page kept in the back/forward cache (e.g. after visiting the recall
    // page) must not keep its socket, or the server would count it as open.
    window.addEventListener('pagehide', (e) => {
        saveDraft();
        if (e.persisted) window.socket.disconnect();
    });
    window.addEventListener('pageshow', (e) => {
        if (e.persisted) window.socket.connect();
    });

    window.socket.on('disconnect', () => {
        connectionBanner.hidden = false;
        updatePendingBadges();
    });

    // The server sends full state on every connect, so only the banner and
    // any unacknowledged notes need attention here.
    window.socket.on('connect', () => {
        connectionBanner.hidden = true;
        updatePendingBadges();
        for (const { note, writtenAt } of pendingNotes.values()) sendPendingNote(note, writtenAt);
    });

    let lastUsers = [];
    window.socket.on('current-user', (data) => {
        const changed = currentUser.sub !== data.sub;
        currentUser.name = data.name;
        currentUser.sub = data.sub;
        currentUserName.textContent = data.name;
        if (changed) {
            rebuildFullNotesList(); // edit buttons depend on who we are, which may arrive after the notes
            renderUsers(lastUsers);
        }
        restorePendingNotes();
    });

    window.socket.on('users-update', (users) => {
        lastUsers = users;
        renderUsers(users);
    });

    window.socket.on('act-update', (act) => {
        currentAct = act;
        currentActDisplay.textContent = act;
    });

    window.socket.on('time-mode-update', (newMode) => {
        timeMode = newMode;
        updateTimeModeDisplay();
    });

    window.socket.on('lx-cue-update', (cue) => {
        currentGlobalLxCue = cue;
        updateGlobalLxCueDisplay(cue);
        if (document.activeElement !== lxCueInput) lxCueInput.value = cue;
        if (!currentUser.isTyping) updatePersonalLxCueDisplay(cue);
    });

    window.socket.on('tags-update', (tags) => {
        availableTags = tags;
        saveTagsToStorage();
        updateTagsDisplay();
        updateFilterTags();
        rebuildFullNotesList();
    });

    window.socket.on('system-status', (data) => {
        // Network timecode and real time stay selectable without a MIDI device.
        if (!(data.midiAvailable && data.portCount > 0) && timeMode === 'midi') {
            timeMode = 'realtime';
            updateTimeModeDisplay();
            window.socket.emit('time-mode-change', 'realtime');
        }
        // Without a cue feed from the desk the cue is typed in by hand.
        lxCueInput.hidden = !!data.oscAvailable;
        globalLxCueElement.hidden = !data.oscAvailable;
    });

    window.socket.on('network-timecode-status', (status) => {
        liveSources.network = !!status.running;
        if (timeMode === 'network') updateSourceBadge();
    });

    window.socket.on('timecode-update', (data) => {
        if (!latestTimecodes[data.source]) return;
        latestTimecodes[data.source] = data;
        if (timeMode === data.source) {
            currentGlobalTimecode = data;
            currentUser.currentFrameRate = data.frameRate;
            globalTimecodeElement.title = `${data.frameRate} fps`;
            updateGlobalTimecodeDisplay(data);
            if (!currentUser.isTyping) updatePersonalTimecodeDisplay(data);
            if (data.source === 'midi' && !liveSources.midi) {
                liveSources.midi = true;
                updateSourceBadge();
            }
        }
    });

    window.socket.on('notes-update', (notes) => {
        // Only rebuild if the notes array has changed (e.g., import)
        if (allNotes.length === notes.length && allNotes.every((n, i) => n.id === notes[i].id)) {
            return;
        }
        allNotes = notes.map(withLists);
        for (const note of notes) {
            if (note.clientId) clearPendingNote(note.clientId);
        }
        rebuildFullNotesList();
    });

    window.socket.on('note-added', (note) => {
        if (note.clientId) clearPendingNote(note.clientId);
        addNote(withLists(note));
    });

    window.socket.on('note-edit-text', ({ noteId, newText, lastEditedBy, lastEdited }) => {
        const note = allNotes.find(n => n.id === noteId);
        if (note) {
            note.text = newText;
            note.lastEdited = lastEdited;
            note.lastEditedBy = lastEditedBy;
            updateNoteElement(note);
        }
    });

    window.socket.on('note-update-tags', ({ noteId, tags }) => {
        const note = allNotes.find(n => n.id === noteId);
        if (note) {
            note.tags = tags;
            updateNoteElement(note);
        }
    });

    window.socket.on('comment-submit', ({ noteId, comment }) => {
        const note = allNotes.find(n => n.id === noteId);
        if (note) {
            if (!note.comments) note.comments = [];
            note.comments.push(comment);
            updateNoteElement(note);
        }
    });

    window.socket.on('comment-edit', ({ noteId, commentId, newText, lastEditedBy, lastEdited }) => {
        const note = allNotes.find(n => n.id === noteId);
        const comment = note && note.comments && note.comments.find(c => c.id === commentId);
        if (comment) {
            comment.text = newText;
            comment.lastEdited = lastEdited;
            comment.lastEditedBy = lastEditedBy;
            updateNoteElement(note);
        }
    });

    window.socket.on('note-delete', ({ noteId }) => {
        deletedNotes.delete(noteId);
        const index = allNotes.findIndex(n => n.id === noteId);
        if (index === -1) return;
        allNotes.splice(index, 1);
        noteEditDrafts.delete(noteId);
        commentDrafts.delete(noteId);
        openReplies.delete(noteId);
        if (tagPickerNoteId === noteId) closeTagPicker();
        const element = noteElements.get(noteId);
        noteElements.delete(noteId);
        const before = element && element.previousElementSibling;
        const after = element && element.nextElementSibling;
        if (element) element.remove();
        // A scene heading left with no notes could sit next to another for the same scene.
        if (before && before.classList.contains('group-head') && (!after || after.classList.contains('group-head'))) {
            rebuildFullNotesList();
        } else {
            updateActFilter();
            filterNotes();
        }
    });

    window.socket.on('comment-delete', ({ noteId, commentId }) => {
        deletedComments.delete(`${noteId}/${commentId}`);
        const note = allNotes.find(n => n.id === noteId);
        if (note && note.comments) {
            note.comments = note.comments.filter(c => c.id !== commentId);
            commentEditDrafts.delete(`${noteId}/${commentId}`);
            updateNoteElement(note);
        }
    });

    // The server sends each new message on its own, and the whole log only on
    // connecting and after a restore.
    window.socket.on('chat-message-added', (msg) => {
        if (chatMessagesList.some((m) => m.id === msg.id)) return;
        chatMessagesList.push(msg);
        chatCopy.onMessageAdded(chatMessagesList);
        const mine = isMyChat(msg);
        if (chatDrawer.hidden) {
            if (!mine) unreadChat++;
            updateUnread();
            updateChatMessages();
        } else {
            const stick = mine || chatNearBottom();
            if (chatMessagesList.length === 1) setHtml(chatMessages, '');
            chatMessages.insertAdjacentHTML('beforeend', renderChatMessage(msg, chatMessagesList[chatMessagesList.length - 2]));
            chatCount.textContent = plural(chatMessagesList.length, 'message');
            if (stick) chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    });

    // The chat log kept in localStorage so it survives a reload. After a server
    // restart this copy is offered back so the server can restore it, and it is
    // not replaced by the server's log until the server says restoring is over.
    const chatCopy = createChatCopy({
        // reached inside chatCopy's try/catch, as merely touching localStorage can throw
        getItem: (key) => localStorage.getItem(key),
        setItem: (key, value) => localStorage.setItem(key, value)
    });
    window.socket.on('chat-restore-status', ({ open }) => chatCopy.onRestoreStatus(open));
    window.socket.on('chat-messages-update', (msgs) => {
        const offer = chatCopy.onServerLog(msgs);
        if (offer) window.socket.emit('chat-restore-offer', offer);
        chatMessagesList = msgs;
        updateChatMessages();
    });

    // The server was reset from the config page: forget the saved chat copy
    // and the notes still waiting to be acknowledged, so neither comes back.
    window.socket.on('all-reset', () => {
        chatCopy.onReset();
        for (const { element } of pendingNotes.values()) element.remove();
        pendingNotes.clear();
        savePendingNotes();
        filterNotes();
    });

    window.socket.on('export-data', (data) => {
        const blob = new Blob([data.data], { type: data.mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = data.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast(`Downloaded ${data.filename}`);
    });

    // --- Event listeners: top bar ---
    lxCueInput.addEventListener('input', () => window.socket.emit('lx-cue-change', lxCueInput.value));
    lxCueInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') lxCueInput.blur(); });

    usersButton.addEventListener('click', (e) => { e.stopPropagation(); togglePopover(usersPopover, usersButton); });
    menuButton.addEventListener('click', (e) => { e.stopPropagation(); togglePopover(menuPopover, menuButton); });
    exportJsonBtn.addEventListener('click', () => {
        closePopovers();
        window.socket.emit('export-request', 'json');
    });

    chatToggle.addEventListener('click', () => {
        setChatOpen(chatDrawer.hidden);
        if (!chatDrawer.hidden) chatInput.focus();
    });
    chatClose.addEventListener('click', () => setChatOpen(false));

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.popover') && !e.target.closest('[data-action="edit-tags"]')) closePopovers();
    });
    window.addEventListener('resize', closePopovers);

    // --- Event listeners: note box ---
    noteInput.addEventListener('focus', () => {
        startTyping();
        updateComposer();
    });
    noteInput.addEventListener('input', () => {
        sendNoteBtn.disabled = noteInput.value.trim().length === 0;
        // After a release, the next key freezes the stamp at that moment.
        if (!currentUser.isTyping && noteInput.value.length > 0) startTyping();
        else startAutoResumeTimer();
        updateComposer();
        saveDraft();
    });
    noteInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            if (!sendNoteBtn.disabled) sendNoteBtn.click();
        }
    });
    noteInput.addEventListener('blur', () => {
        startAutoResumeTimer();
        updateComposer();
    });

    // Picking a tag keeps the cursor in the note box.
    tagsContainer.addEventListener('mousedown', (e) => {
        if (e.target.closest('.chip') && document.activeElement === noteInput) e.preventDefault();
    });
    tagsContainer.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        const id = chip.dataset.tag;
        selectedTags = selectedTags.includes(id) ? selectedTags.filter(t => t !== id) : [...selectedTags, id];
        chip.setAttribute('aria-pressed', String(selectedTags.includes(id)));
        if (!needsTag()) showTagError(false);
        saveDraft();
    });

    sendNoteBtn.addEventListener('click', () => {
        const text = noteInput.value.trim();
        if (text && needsTag()) {
            showTagError(true);
            noteInput.focus();
            return;
        }
        if (text && currentUser.frozenTimecode) {
            submitNote({
                text: text,
                timecode: currentUser.frozenTimecode,
                lxCue: currentUser.frozenLxCue,
                frameRate: timeMode === 'realtime' ? 'ms' : currentUser.currentFrameRate,
                tags: selectedTags,
            });
            resetComposer();
            noteInput.focus(); // ready for the next one; the stamp locks again on the next key
            currentUser.isTyping = false;
            window.scrollTo({ top: 0 });
        }
    });

    cancelNoteBtn.addEventListener('mousedown', (e) => e.preventDefault());
    cancelNoteBtn.addEventListener('click', discardNote);

    // Typing anywhere else on the page starts a note (see type-to-note.js).
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
            if (closePopovers()) return;
            if (!chatDrawer.hidden && chatDrawer.contains(document.activeElement)) {
                setChatOpen(false);
                chatToggle.focus();
                return;
            }
        }

        const ctx = {
            modalOpen: !tagPicker.hidden,
            noteHasText: noteInput.value.length > 0,
            body: document.body
        };
        if (typeToNote.shouldFocusNote(e, document.activeElement, ctx)) {
            closePopovers();
            noteInput.focus();
        }

        // Escape leaves the note box; an empty note is also cancelled.
        const action = typeToNote.escapeAction(e, document.activeElement, {
            modalOpen: ctx.modalOpen,
            noteInput,
            noteValue: noteInput.value
        });
        if (action) {
            noteInput.blur();
            if (action === 'cancel') cancelNote();
        }
    });

    // --- Event listeners: filters ---
    searchInput.addEventListener('input', () => {
        filters.search = searchInput.value.trim().toLowerCase();
        filterNotes();
    });
    for (const [button, popover, key, update] of [[actFilter, actFilterPopover, 'act', updateActFilter], [tagFilter, tagFilterPopover, 'tag', updateFilterTags]]) {
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            if (togglePopover(popover, button, 'left')) popover.querySelector('[aria-selected="true"]')?.focus();
        });
        popover.addEventListener('click', (e) => {
            const option = e.target.closest('[role="option"]');
            if (!option) return;
            filters[key] = option.dataset.value;
            closePopovers();
            update();
            filterNotes();
        });
        popover.addEventListener('keydown', (e) => {
            const options = [...popover.querySelectorAll('[role="option"]')];
            const i = options.indexOf(document.activeElement);
            const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: options.length - 1 }[e.key];
            if (next === undefined) return;
            e.preventDefault();
            options[Math.max(0, Math.min(next, options.length - 1))].focus();
        });
    }
    clearFiltersBtn.addEventListener('click', clearFilters);
    notesNoMatch.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="clear-filters"]')) clearFilters();
    });

    // --- Event listeners: chat ---
    chatInput.addEventListener('input', () => { sendChatBtn.disabled = chatInput.value.trim().length === 0; });
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            sendChatMessage();
        }
    });
    sendChatBtn.addEventListener('click', sendChatMessage);

    // --- Event listeners: the notes list (delegated) ---
    function noteOf(el) {
        const item = el.closest('.note[data-note-id]');
        return item && allNotes.find(n => n.id === item.dataset.noteId);
    }

    function saveNoteEdit(note) {
        const newText = (noteEditDrafts.get(note.id) || '').trim();
        noteEditDrafts.delete(note.id);
        if (newText && newText !== note.text) window.socket.emit('note-edit-text', { noteId: note.id, newText });
        updateNoteElement(note);
    }

    function saveCommentEdit(note, commentId) {
        const key = `${note.id}/${commentId}`;
        const comment = (note.comments || []).find(c => c.id === commentId);
        const newText = (commentEditDrafts.get(key) || '').trim();
        commentEditDrafts.delete(key);
        if (comment && newText && newText !== comment.text) {
            window.socket.emit('comment-edit', { noteId: note.id, commentId, newText });
        }
        updateNoteElement(note);
    }

    function submitComment(note) {
        const text = (commentDrafts.get(note.id) || '').trim();
        if (!text) return;
        window.socket.emit('comment-submit', { noteId: note.id, text });
        commentDrafts.delete(note.id);
        closeReplyBox(note);
    }

    // Closes the reply box and focuses the "Reply…" prompt under the thread if there is one, else the reply icon.
    function closeReplyBox(note) {
        openReplies.delete(note.id);
        updateNoteElement(note);
        const el = noteElements.get(note.id);
        (el?.querySelector('.reply-prompt') || el?.querySelector('[data-action="reply"]'))?.focus();
    }

    // Throws the reply draft away and closes the reply box.
    function cancelComment(note) {
        commentDrafts.delete(note.id);
        closeReplyBox(note);
    }

    // A delete shows straight away but only reaches the server once its Undo
    // toast has gone, so Undo just never sends it.
    const pendingDeletes = new Map(); // key -> { send, timer }

    function finishDelete(key) {
        const pending = pendingDeletes.get(key);
        if (!pending) return;
        clearTimeout(pending.timer);
        pendingDeletes.delete(key);
        pending.send();
    }

    function deleteWithUndo(key, message, hide, unhide, send) {
        hide();
        pendingDeletes.set(key, { send, timer: setTimeout(() => finishDelete(key), TOAST_MS) });
        showToast(message, 'Undo', () => {
            const pending = pendingDeletes.get(key);
            if (!pending) return;
            clearTimeout(pending.timer);
            pendingDeletes.delete(key);
            unhide();
        });
    }

    // Leaving the page doesn't undo a delete.
    window.addEventListener('pagehide', () => {
        for (const key of [...pendingDeletes.keys()]) finishDelete(key);
    });

    function deleteNote(note) {
        const showNote = (hidden) => {
            if (hidden) deletedNotes.add(note.id);
            else deletedNotes.delete(note.id);
            if (hidden && tagPickerNoteId === note.id) closeTagPicker();
            updateActFilter();
            filterNotes();
        };
        deleteWithUndo(`note:${note.id}`, 'Note deleted', () => showNote(true), () => showNote(false),
            () => window.socket.emit('note-delete', { noteId: note.id }));
    }

    function deleteComment(note, commentId) {
        const key = `${note.id}/${commentId}`;
        deleteWithUndo(`comment:${key}`, 'Reply deleted',
            () => { deletedComments.add(key); updateNoteElement(note); },
            () => { deletedComments.delete(key); updateNoteElement(note); },
            () => window.socket.emit('comment-delete', { noteId: note.id, commentId }));
    }

    notesList.addEventListener('click', (e) => {
        const button = e.target.closest('button[data-action]');
        if (!button) return;
        const note = noteOf(button);
        if (!note) return;
        const action = button.dataset.action;
        const commentId = button.dataset.commentId;

        if (action === 'edit-tags') {
            if (tagPickerNoteId === note.id) closeTagPicker();
            else openTagPicker(note.id, button);
        } else if (action === 'reply') {
            openReplies.add(note.id);
            updateNoteElement(note);
            noteElements.get(note.id).querySelector('[data-field="comment"]')?.focus();
        } else if (action === 'cancel-comment') {
            cancelComment(note);
        } else if (action === 'edit-note') {
            noteEditDrafts.set(note.id, note.text);
            updateNoteElement(note);
            const textarea = noteElements.get(note.id).querySelector('[data-field="note-edit"]');
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        } else if (action === 'save-note') {
            saveNoteEdit(note);
        } else if (action === 'cancel-note-edit') {
            noteEditDrafts.delete(note.id);
            updateNoteElement(note);
        } else if (action === 'submit-comment') {
            submitComment(note);
        } else if (action === 'edit-comment') {
            const comment = note.comments.find(c => c.id === commentId);
            commentEditDrafts.set(`${note.id}/${commentId}`, comment ? comment.text : '');
            updateNoteElement(note);
            noteElements.get(note.id).querySelector(`[data-field="comment-edit"][data-comment-id="${CSS.escape(commentId)}"]`)?.focus();
        } else if (action === 'save-comment') {
            saveCommentEdit(note, commentId);
        } else if (action === 'cancel-comment-edit') {
            commentEditDrafts.delete(`${note.id}/${commentId}`);
            updateNoteElement(note);
        } else if (action === 'delete-note') {
            deleteNote(note);
        } else if (action === 'delete-comment') {
            deleteComment(note, commentId);
        }
    });

    notesList.addEventListener('input', (e) => {
        const target = e.target;
        const note = noteOf(target);
        if (!note) return;
        const field = target.dataset.field;
        if (field === 'comment') {
            commentDrafts.set(note.id, target.value);
            const submit = target.closest('.comment-box').querySelector('[data-action="submit-comment"]');
            if (submit) submit.disabled = target.value.trim().length === 0;
        } else if (field === 'note-edit') {
            noteEditDrafts.set(note.id, target.value);
        } else if (field === 'comment-edit') {
            commentEditDrafts.set(`${note.id}/${target.dataset.commentId}`, target.value);
        }
    });

    notesList.addEventListener('keydown', (e) => {
        const target = e.target;
        const field = target.dataset && target.dataset.field;
        if (!field) return;
        const note = noteOf(target);
        if (!note) return;
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            if (field === 'comment') submitComment(note);
            else if (field === 'note-edit') saveNoteEdit(note);
            else if (field === 'comment-edit') saveCommentEdit(note, target.dataset.commentId);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            if (field === 'note-edit') {
                noteEditDrafts.delete(note.id);
                updateNoteElement(note);
            } else if (field === 'comment-edit') {
                commentEditDrafts.delete(`${note.id}/${target.dataset.commentId}`);
                updateNoteElement(note);
            } else if (field === 'comment') {
                cancelComment(note);
            }
        }
    });

    scrollToTopBtn.addEventListener('click', scrollToTop);
    let scrollTimeout;
    window.addEventListener('scroll', () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(toggleScrollButton, 50);
        if (!tagPicker.hidden && !tagPicker.contains(document.activeElement)) closeTagPicker();
        if (!actFilterPopover.hidden || !tagFilterPopover.hidden) closePopovers();
    }, { passive: true });

    // --- Initialization ---
    loadTagsFromStorage();
    updateTagsDisplay();
    updateFilterTags();
    updateActFilter();
    try { if (localStorage.getItem('chat-open') === '1') setChatOpen(true); } catch (e) { /* storage unavailable */ }
    updateGlobalTimecodeDisplay(currentGlobalTimecode);
    updatePersonalTimecodeDisplay(currentGlobalTimecode);
    updateGlobalLxCueDisplay(currentGlobalLxCue);
    updatePersonalLxCueDisplay(currentGlobalLxCue);
    updateComposer();
    filterNotes();
    restoreDraft();
});
