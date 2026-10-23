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
    PlaybackContext.restoreNote(notesList);
    $('liveSampleBadge').hidden = document.body.dataset.playbackDemo !== 'true';
    const notesEmpty = $('notesEmpty');
    const notesSection = document.querySelector('section.notes');
    const notesNoMatch = $('notesNoMatch');
    const notesCount = $('notesCount');
    const clearFiltersBtn = $('clearFilters');
    const searchInput = $('searchInput');
    const exportJsonBtn = $('exportJson');
    const currentUserName = $('currentUserName');
    const tagsContainer = $('tagsContainer');
    const composerTagsToggle = $('composerTagsToggle');
    const composerTagsLabel = $('composerTagsLabel');
    const menuUsersButton = $('menuUsersButton');
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
    const phoneLayout = matchMedia('(max-width: 640px)');
    const touchInput = matchMedia('(pointer: coarse)');
    const modalChatLayout = matchMedia('(max-width: 860px)');

    // --- State variables ---
    let currentUser = {
        name: 'Guest',
        sub: null,
        isTyping: false,
        frozenTimecode: null,
        frozenLxCue: null,
        typingStartedAt: null, // this browser's clock; sent as an age (see sendPendingNote)
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
    let oscAvailable = true; // cue comes from the desk; without it the cue is typed in
    let allNotes = [];
    let timeMode = 'realtime';
    let realTimeInterval = null;
    let availableTags = [];
    let selectedTags = [];
    let autoResumeTimer = null;
    let chatMessagesList = [];
    let unreadChat = 0;
    let currentAct = 'Preshow';
    let lastUsers = [];
    const filters = { tag: 'all', act: 'all', search: '' };
    const filterDropdown = (button, popover, key, update) => NoteView.createDropdown({
        button, popover,
        beforeOpen: () => closePopovers(),
        onChange: (value) => {
            filters[key] = value;
            update();
            filterNotes();
        }
    });
    const actDropdown = filterDropdown(actFilter, actFilterPopover, 'act', updateActFilter);
    const tagDropdown = filterDropdown(tagFilter, tagFilterPopover, 'tag', updateFilterTags);
    const noteElements = new Map();
    // Notes submitted but not yet acknowledged by the server, keyed by the
    // clientId sent with them: clientId -> { note, element, writtenAt, sub }.
    const pendingNotes = new Map();
    let identityConfirmed = false; // this connection has sent current-user

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
    // Templates and helpers shared with past notes: public/note-view.js.
    const { esc, safeColor, setHtml, clockTime, fullTime, relativeTime, plural, avatarHTML, dotHTML } = NoteView;
    const { formatTimecode } = TimecodeFormat;

    function isMine(item) {
        return NoteAuthor.canEditNote(item, currentUser.sub);
    }

    // Older backups may lack a note's tags or comments; the page assumes lists.
    function withLists(note) {
        return { ...note, tags: Array.isArray(note.tags) ? note.tags : [], comments: Array.isArray(note.comments) ? note.comments : [] };
    }

    function tagById(id) {
        return availableTags.find(t => t.id === id) || NoteView.unknownTag(id);
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
            const parsed = JSON.parse(storedTags);
            if (Array.isArray(parsed)) availableTags = parsed.filter(tag => tag &&
                typeof tag.id === 'string' && typeof tag.name === 'string' && typeof tag.color === 'string');
        } catch (e) { /* storage unavailable */ }
    }

    function saveTagsToStorage() {
        try { localStorage.setItem('midi-timecode-notes-tags', JSON.stringify(availableTags)); } catch (e) { /* ignore */ }
    }

    // Tags for the note being written: toggles under the note box.
    function updateTagsDisplay() {
        selectedTags = selectedTags.filter(id => availableTags.some(t => t.id === id));
        setHtml(tagsContainer, availableTags.map(tag =>
            NoteView.tagChipHTML(tag, `type="button" data-tag="${esc(tag.id)}" aria-pressed="${selectedTags.includes(tag.id)}"`)
        ).join(''));
        updateComposerTagsLabel();
    }

    function updateComposerTagsLabel() {
        const names = selectedTags.map(id => tagById(id).name);
        composerTagsLabel.textContent = names.length === 1 ? names[0] : names.length ? `${names.length} tags` : 'Choose tags';
        composerTagsToggle.title = names.join(', ') || 'Choose tags for this note';
        composerTagsToggle.hidden = availableTags.length === 0;
    }

    function setComposerTagsExpanded(open) {
        composer.classList.toggle('tags-expanded', open);
        composerTagsToggle.setAttribute('aria-expanded', String(open));
    }

    function updateFilterTags() {
        if (filters.tag !== 'all' && !availableTags.some(t => t.id === filters.tag)) filters.tag = 'all';
        tagDropdown.render(NoteView.tagOptions(availableTags), filters.tag);
        tagFilter.hidden = availableTags.length === 0;
    }

    // --- Filtering ---
    const noteMatches = (note) => NoteView.noteMatches(note, filters, tagById);
    const filtersActive = () => NoteView.filtersActive(filters);

    // Shows/hides rows, then each act heading with how many of its notes show.
    // The counts come from the notes, not the rows: a long list is still being
    // drawn for a moment after a rebuild (see rebuildFullNotesList). Headings
    // are the runs of one act in newest-first order, the same as drawn.
    function filterNotes() {
        const notesById = new Map(allNotes.map(n => [n.id, n]));
        const isShown = (note) => !!note && !deletedNotes.has(note.id) && noteMatches(note);
        const runCounts = [];
        let lastAct = null;
        let shown = 0;
        for (const note of NoteOrder.newestFirst(allNotes)) {
            const act = note.act || 'Preshow';
            if (act !== lastAct) {
                runCounts.push(0);
                lastAct = act;
            }
            if (isShown(note)) {
                runCounts[runCounts.length - 1]++;
                shown++;
            }
        }
        let run = 0;
        for (const el of notesList.children) {
            if (el.classList.contains('group-head')) {
                const count = runCounts[run++] || 0;
                el.hidden = count === 0;
                el.querySelector('.group-count').textContent = plural(count, 'note');
            } else if (!el.classList.contains('pending')) {
                el.hidden = !isShown(notesById.get(el.dataset.noteId));
            }
        }

        const total = allNotes.length - deletedNotes.size;
        notesSection.classList.toggle('has-notes', total > 0 || pendingNotes.size > 0);
        notesCount.textContent = filtersActive() ? `${shown} of ${plural(total, 'note')}` : '';
        clearFiltersBtn.hidden = !filtersActive();
        notesEmpty.hidden = total > 0 || pendingNotes.size > 0;
        notesNoMatch.hidden = !(total > 0 && shown === 0 && filtersActive());
    }

    const notesLoading = createLoadingState(notesSection);
    const chatLoading = createLoadingState(chatDrawer);
    const liveHeader = document.querySelector('.topbar .live');
    const liveReceived = new Set();
    function receivedLive(part) {
        liveReceived.add(part);
        if (['act', 'mode', 'cue', 'system'].every(key => liveReceived.has(key))) {
            liveHeader.classList.remove('awaiting-data');
        }
    }

    function updateActFilter() {
        const acts = [...new Set(allNotes.filter(n => !deletedNotes.has(n.id)).map(note => note.act || 'Preshow'))];
        if (filters.act !== 'all' && !acts.includes(filters.act)) filters.act = 'all';
        actDropdown.render(NoteView.sceneOptions(acts), filters.act);
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

    // Without a cue feed from the desk the cue is typed in by hand.
    function updateCueMode() {
        lxCueInput.hidden = oscAvailable;
        globalLxCueElement.hidden = !oscAvailable;
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

    function updateRealTimeDisplay() {
        const now = TimecodeFormat.timeOfDay();
        updateGlobalTimecodeDisplay(now);
        if (!currentUser.isTyping) updatePersonalTimecodeDisplay(now);
    }

    // --- Writing a note ---
    // Set while a press below the note box is landing (see releaseComposer).
    let composerHold = null;
    let composerHoldTimer = null;
    let composerHoldWatch = null;
    function updateComposer() {
        const open = currentUser.isTyping || noteInput.value.length > 0 || document.activeElement === noteInput || !!composerHold;
        composer.classList.toggle('open', open);
        composer.classList.toggle('focused', composer.contains(document.activeElement) || !!composerHold);
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
            currentUser.frozenTimecode = { ...TimecodeFormat.timeOfDay(), frameRate: 'ms' };
        } else {
            currentUser.frozenTimecode = { ...currentGlobalTimecode, displayMode: timeMode };
        }
        currentUser.frozenLxCue = currentGlobalLxCue;
        currentUser.typingStartedAt = Date.now();
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
        currentUser.typingStartedAt = null;
        if (timeMode !== 'realtime') updatePersonalTimecodeDisplay(currentGlobalTimecode);
        updatePersonalLxCueDisplay(currentGlobalLxCue);
        window.socket.emit('typing-stop');
        clearAutoResumeTimer();
        updateComposer();
    }

    // The tags a person last sent with start every new note, per person
    // (localStorage, so all their tabs share them).
    const lastTagsKey = () => `last-tags:${currentUser.sub}`;

    function rememberedTags() {
        if (!currentUser.sub) return [];
        try {
            const tags = JSON.parse(localStorage.getItem(lastTagsKey()));
            return Array.isArray(tags) ? tags.filter(id => typeof id === 'string') : [];
        } catch (e) { return []; }
    }

    function rememberTags(tags) {
        if (!currentUser.sub) return;
        try { localStorage.setItem(lastTagsKey(), JSON.stringify(tags)); } catch (e) { /* storage unavailable */ }
    }

    // Puts the remembered tags on a note that hasn't been started yet.
    function applyRememberedTags() {
        if (currentUser.isTyping || noteInput.value) return;
        selectedTags = rememberedTags();
        updateTagsDisplay();
    }

    function resetComposer() {
        noteInput.value = '';
        sendNoteBtn.disabled = true;
        selectedTags = rememberedTags();
        setComposerTagsExpanded(false);
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
        if (show) setComposerTagsExpanded(true);
    }

    function cancelNote() {
        resetComposer();
    }

    // Discarding typed text can be undone for a few seconds (stamp included).
    function discardNote() {
        const text = noteInput.value;
        if (!text.trim()) {
            cancelNote();
            if (phoneLayout.matches) { noteInput.blur(); cancelNoteBtn.blur(); updateComposer(); }
            return;
        }
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
        usersButton.classList.remove('awaiting-data');

        const MAX = 4;
        setHtml(avatarStack, list.slice(0, MAX).map(p =>
            avatarHTML(p.key, p.name, p.isTyping ? 'typing' : '')
        ).join('') + (list.length > MAX ? `<span class="avatar more">+${list.length - MAX}</span>` : ''));

        setHtml(usersList, list.map(p => `
            <li>
                ${avatarHTML(p.key, p.name)}
                <span>${esc(p.name)}</span>${p.me ? '<span class="you">you</span>' : ''}
                ${p.isTyping ? '<span class="writing">writing…</span>' : ''}
            </li>`).join(''));
    }

    // --- Popovers (online list, menu, filters, tag picker) ---
    const { placePopover } = NoteView;

    function closePopovers() {
        let closed = false;
        for (const dropdown of [actDropdown, tagDropdown]) closed = dropdown.close() || closed;
        for (const [popover, button] of [[usersPopover, usersButton], [menuPopover, menuButton]]) {
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
        anchor.setAttribute('aria-expanded', 'true');
        const first = tagPickerList.querySelector('.tag-option');
        if (first) first.focus();
    }

    function closeTagPicker() {
        const noteId = tagPickerNoteId;
        tagPicker.hidden = true;
        tagPickerNoteId = null;
        const el = noteId && noteElements.get(noteId);
        el?.querySelector('[data-action="edit-tags"]')?.setAttribute('aria-expanded', 'false');
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
                    <span class="chat-msg-time">${esc(clockTime(msg.timestamp))}</span>
                </div>`;
        const face = mine ? '' : (cont ? '<span class="avatar-gap"></span>' : avatarHTML(msg.userId || msg.user, msg.user, 'sm'));
        return `
            <div class="chat-msg${mine ? ' mine' : ''}${cont ? ' cont' : ''}">
                ${face}
                <div class="chat-msg-main">${head}
                    <div class="bubble" title="${esc(fullTime(msg.timestamp))}">${esc(msg.text)}</div>
                </div>
            </div>`;
    }

    function chatNearBottom() {
        return chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 80;
    }

    function updateChatMessages() {
        chatCount.textContent = plural(chatMessagesList.length, 'shitpost');
        if (chatMessagesList.length === 0) {
            setHtml(chatMessages, '<div class="chat-empty">No shitposts yet.</div>');
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
        document.documentElement.classList.toggle('chat-open', open);
        chatToggle.setAttribute('aria-expanded', String(open));
        updateChatLayout();
        if (open) {
            closePopovers();
            unreadChat = 0;
            updateUnread();
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    }

    // On phones chat occupies the visible viewport, including while the
    // software keyboard is open. The page underneath is not interactive.
    function updateChatLayout() {
        const modal = modalChatLayout.matches && !chatDrawer.hidden;
        document.querySelector('.page').inert = modal;
        document.querySelector('.topbar').inert = modal;
        scrollToTopBtn.inert = modal;
        if (modal) {
            chatDrawer.setAttribute('role', 'dialog');
            chatDrawer.setAttribute('aria-modal', 'true');
            chatDrawer.setAttribute('aria-labelledby', 'chatTitle');
        } else {
            chatDrawer.removeAttribute('role');
            chatDrawer.removeAttribute('aria-modal');
            chatDrawer.removeAttribute('aria-labelledby');
        }
    }

    function updateVisibleViewport() {
        const viewport = window.visualViewport;
        document.documentElement.style.setProperty('--visible-height', `${viewport?.height ?? window.innerHeight}px`);
        document.documentElement.style.setProperty('--visible-top', `${viewport?.offsetTop ?? 0}px`);
    }
    window.visualViewport?.addEventListener('resize', updateVisibleViewport);
    window.visualViewport?.addEventListener('scroll', updateVisibleViewport);
    window.addEventListener('resize', updateVisibleViewport);
    modalChatLayout.addEventListener('change', () => {
        updateChatLayout();
        if (!chatDrawer.hidden && modalChatLayout.matches && !chatDrawer.contains(document.activeElement)) chatClose.focus();
    });
    updateVisibleViewport();
    new ResizeObserver(() => {
        document.documentElement.style.setProperty('--connection-banner-h', `${connectionBanner.offsetHeight}px`);
    }).observe(connectionBanner);

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
    const tagChipsHTML = (note) => NoteView.tagChipsHTML(note.tags, tagById);

    // A note's tags are one dropdown: the chips and a chevron open the tag picker.
    function tagTriggerHTML(note) {
        const names = note.tags.map(id => tagById(id).name).join(', ');
        const label = note.tags.length ? `Tags: ${names}. Change tags` : 'Add a tag';
        return `<button type="button" class="tag-trigger" data-action="edit-tags" aria-haspopup="dialog" aria-expanded="${tagPickerNoteId === note.id}" aria-label="${esc(label)}" title="Change tags">
            ${tagChipsHTML(note) || '<span class="chip add-tag">Add a tag</span>'}<i data-icon="chevron"></i></button>`;
    }

    function iconButton(action, icon, label, extra) {
        return `<button type="button" class="icon-btn" data-action="${esc(action)}" aria-label="${esc(label)}" title="${esc(label)}"${extra || ''}><i data-icon="${icon}"></i></button>`;
    }

    function commentHTML(note, comment) {
        const key = `${note.id}/${comment.id}`;
        const editing = commentEditDrafts.has(key);
        const tools = isMine(comment) && !editing ? `
            <span class="row-actions">
                ${iconButton('edit-comment', 'edit', 'Edit reply', ` data-comment-id="${esc(comment.id)}"`)}
                ${iconButton('delete-comment', 'trash', 'Delete reply', ` data-comment-id="${esc(comment.id)}"`)}
            </span>` : '';
        const body = editing ? `
            <div class="comment-edit">
                <textarea data-field="comment-edit" data-comment-id="${esc(comment.id)}" aria-label="Edit reply">${esc(commentEditDrafts.get(key))}</textarea>
                <div class="edit-actions">
                    <button type="button" class="btn ghost" data-action="cancel-comment-edit" data-comment-id="${esc(comment.id)}">Cancel</button>
                    <button type="button" class="btn primary" data-action="save-comment" data-comment-id="${esc(comment.id)}">Save</button>
                </div>
            </div>` : undefined;
        return NoteView.commentHTML(comment, { tools, body });
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
            </div>` : undefined;

        // While the note is being edited, Save and Cancel are its only actions.
        const actions = editing ? '' : `
            <span class="row-actions">
                ${NoteView.playbackLinkHTML(PlaybackContext.playbackUrl({ source: 'live' }, note.id, location.pathname + location.search))}
                ${iconButton('reply', 'reply', 'Reply')}
                ${canEdit ? iconButton('edit-note', 'edit', 'Edit note') : ''}
                ${canDelete ? iconButton('delete-note', 'trash', 'Delete note') : ''}
            </span>`;

        const draft = commentDrafts.get(note.id) || '';
        const thread = comments.length || replying ? `
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
            <button type="button" class="reply-more" data-action="reply"><i data-icon="reply"></i>Reply</button>`}` : '';

        return NoteView.noteHTML(note, {
            attrs: `data-note-id="${esc(note.id)}"`,
            side: actions, body, thread,
            foot: tagTriggerHTML(note)
        });
    }

    function createNoteElement(note) {
        const wrapper = document.createElement('div');
        setHtml(wrapper, noteHTML(note).trim());
        const element = wrapper.firstChild;
        noteElements.set(note.id, element);
        return element;
    }

    function groupHeadElement(act) {
        const wrapper = document.createElement('div');
        setHtml(wrapper, NoteView.groupHeadHTML(act));
        return wrapper.firstChild;
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
                : `[data-action="${active.dataset.action}"]${comment}${active.classList.contains('reply-more') ? '.reply-more' : ''}`;
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

    // `refilter: false` when the caller filters once after a batch of updates.
    function updateNoteElement(note, { refilter = true } = {}) {
        const oldElement = noteElements.get(note.id);
        if (!oldElement) return;
        const newElement = createNoteElement(note);
        rerenderPreservingFocus(oldElement, newElement);
        if (tagPickerNoteId === note.id) renderTagPicker();
        if (refilter) filterNotes();
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

    // Drawing a note costs about half a millisecond (mostly DOMPurify), so a
    // long list is drawn top first: enough to fill the screen at once, then the
    // rest a batch per task so the page never stalls. Batches look each note up
    // again, so one changed or deleted meanwhile is drawn as it is now.
    const FIRST_BATCH = 30;
    const LATER_BATCH = 60;
    let rebuildTimer = null;

    function rebuildFullNotesList() {
        clearTimeout(rebuildTimer);
        notesList.replaceChildren();
        noteElements.clear();
        for (const { element } of [...pendingNotes.values()].reverse()) notesList.appendChild(element);
        const order = NoteOrder.newestFirst(allNotes).map(note => note.id);
        let next = 0;
        let lastAct = null;
        const drawBatch = (size) => {
            const notesById = new Map(allNotes.map(n => [n.id, n]));
            const batch = document.createDocumentFragment();
            for (let drawn = 0; drawn < size && next < order.length; next++) {
                const note = notesById.get(order[next]);
                if (!note || noteElements.has(note.id)) continue;
                const act = note.act || 'Preshow';
                if (act !== lastAct) {
                    batch.appendChild(groupHeadElement(act));
                    lastAct = act;
                }
                batch.appendChild(createNoteElement(note));
                drawn++;
            }
            notesList.appendChild(batch);
            filterNotes();
            if (next < order.length) rebuildTimer = setTimeout(() => drawBatch(LATER_BATCH), 0);
        };
        drawBatch(FIRST_BATCH);
        updateActFilter();
        if (tagPickerNoteId) renderTagPicker();
    }

    // Rows are drawn in batches after a rebuild, so check the notes, not the drawn rows.
    function addNote(note) {
        if (allNotes.some(n => n.id === note.id)) return;
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

    // The notes this browser had not got stored before it was last closed.
    function restorePendingNotes() {
        for (const { note, writtenAt } of pendingStore.load(currentUser.sub)) {
            if (pendingNotes.has(note.clientId) || allNotes.some(n => isMyStoredNote(n, note.clientId))) continue;
            showPendingNote(note, writtenAt);
            sendPendingNote(note, writtenAt);
        }
    }

    function pendingBadgeText() {
        return window.socket.connected ? 'Sending…' : 'Not sent yet · goes out when the connection is back';
    }

    function createPendingNoteElement(note) {
        const wrapper = document.createElement('div');
        setHtml(wrapper, NoteView.noteHTML(note, {
            className: 'pending',
            attrs: `data-client-id="${esc(note.clientId)}"`,
            author: { key: currentUser.sub || currentUser.name, name: currentUser.name },
            side: `<span class="pending-badge">${esc(pendingBadgeText())}</span>`,
            foot: tagChipsHTML(note)
        }).trim());
        return wrapper.firstChild;
    }

    function updatePendingBadges() {
        const text = pendingBadgeText();
        for (const { element } of pendingNotes.values()) {
            element.querySelector('.pending-badge').textContent = text;
        }
    }

    // The ages are recomputed on every send: the browser's clock is not the
    // server's, but how long ago the note was written (and started) is the
    // same on both.
    function sendPendingNote(note, writtenAt) {
        const pending = pendingNotes.get(note.clientId);
        if (!window.socket.connected || !identityConfirmed || !pending || pending.sub !== currentUser.sub) return;
        const { typingStartedAt, ...payload } = note;
        payload.ageMs = Math.max(0, Date.now() - writtenAt);
        if (typeof typingStartedAt === 'number') payload.startedAgeMs = Math.max(0, Date.now() - typingStartedAt);
        window.socket.emit('note-submit', payload, (stored) => {
            // Already sent and deleted since (from another tab, say).
            if (stored && stored.deleted) return clearPendingNote(note.clientId);
            if (!stored || stored.error) {
                // Refused, so resending cannot help: say so on the note and stop trying.
                if (pendingNotes.get(note.clientId) !== pending) return;
                pendingNotes.delete(note.clientId);
                pendingStore.remove(pending.sub, note.clientId);
                pending.element.querySelector('.pending-badge').textContent =
                    `Not added. ${(stored && stored.error) || 'Something went wrong. Write it again.'}`;
                pending.element.classList.add('failed');
                return;
            }
            clearPendingNote(stored.clientId);
            addNote(withLists(stored));
        });
    }

    // The server keeps clientIds per person, so someone else's note with the same one is not ours.
    function isMyStoredNote(note, clientId) {
        return !!clientId && note.clientId === clientId && note.userId === currentUser.sub;
    }

    function clearPendingNote(clientId) {
        const pending = pendingNotes.get(clientId);
        if (!pending) return;
        pending.element.remove();
        pendingNotes.delete(clientId);
        pendingStore.remove(pending.sub, clientId);
        filterNotes();
    }

    function showPendingNote(note, writtenAt) {
        const element = createPendingNoteElement(note);
        // `sub` is whoever wrote it: it is only ever sent under their login.
        pendingNotes.set(note.clientId, { note, element, writtenAt, sub: currentUser.sub });
        notesLoading.finish({ immediate: true });
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
        pendingStore.add(currentUser.sub, { note, writtenAt });
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
                lxCue: currentUser.frozenLxCue,
                typingStartedAt: currentUser.typingStartedAt
            }));
        } catch (e) { /* storage unavailable */ }
    }

    function clearDraft() {
        try { sessionStorage.removeItem(DRAFT_KEY); } catch (e) { /* storage unavailable */ }
    }

    // --- Notes snapshot ---
    // What this tab last showed, drawn at start-up so the notes are there at
    // once rather than after the socket connects (public/notes-snapshot.js).
    const notesSnapshot = createNotesSnapshot({
        // reached inside notesSnapshot's try/catch, as merely touching sessionStorage can throw
        getItem: (key) => sessionStorage.getItem(key),
        setItem: (key, value) => sessionStorage.setItem(key, value),
        removeItem: (key) => sessionStorage.removeItem(key)
    });

    function saveNotesSnapshot() {
        notesSnapshot.save({
            sub: currentUser.sub,
            name: currentUser.name,
            notes: allNotes.filter(n => !deletedNotes.has(n.id)),
            live: { users: lastUsers, act: currentAct, cue: currentGlobalLxCue, timeMode, oscAvailable,
                timecodes: latestTimecodes, liveSources, unreadChat }
        });
    }

    function showNotesSnapshot() {
        const snapshot = notesSnapshot.load();
        if (!snapshot) return;
        currentUser.sub = snapshot.sub;
        currentUser.name = snapshot.name;
        currentUserName.textContent = snapshot.name;
        currentUserName.classList.remove('awaiting-data');
        allNotes = snapshot.notes.map(withLists);
        rebuildFullNotesList();
        notesLoading.finish({ immediate: true });
        const live = snapshot.live;
        if (!live) return false;
        lastUsers = live.users;
        renderUsers(lastUsers);
        currentAct = live.act;
        currentActDisplay.textContent = live.act;
        currentGlobalLxCue = live.cue;
        lxCueInput.value = live.cue;
        oscAvailable = live.oscAvailable;
        updateCueMode();
        Object.assign(latestTimecodes.midi, live.timecodes.midi);
        Object.assign(latestTimecodes.network, live.timecodes.network);
        Object.assign(liveSources, live.liveSources);
        timeMode = live.timeMode;
        unreadChat = live.unreadChat;
        updateUnread();
        liveHeader.classList.remove('awaiting-data');
        return true;
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
        currentUser.typingStartedAt = typeof draft.typingStartedAt === 'number' ? draft.typingStartedAt : null;
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
    let pageInCache = false;
    let connectionBannerTimer = null;
    function showConnectionProblem() {
        clearTimeout(connectionBannerTimer);
        connectionBannerTimer = setTimeout(() => {
            if (!pageInCache && !loggingOut) connectionBanner.hidden = false;
        }, 1000);
    }

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
        showConnectionProblem();
    });

    // Logged out on purpose, here or in another tab: the note being written is
    // dropped so whoever logs in next on this tab doesn't send it as theirs.
    // (Unsent notes are kept per person and go out at their next login.)
    // The tab that sent the logout form gets `logged-out` too, often before the
    // form's own redirect: leaving then would cut that short before it reaches
    // Keycloak, whose login would then sign the person straight back in.
    let loggingOut = false;
    function loggedOut() {
        if (loggingOut) return;
        loggingOut = true;
        clearDraft();
        notesSnapshot.clear();
        window.location.href = loggedOutUrl();
    }
    document.querySelector('form[action="/logout"]').addEventListener('submit', () => {
        loggingOut = true;
        clearDraft();
        notesSnapshot.clear();
    });
    window.socket.on('logged-out', loggedOut);

    keepLoginAlive(goToLogin);

    // A page kept in the back/forward cache (e.g. after visiting the recall
    // page) must not keep its socket, or the server would count it as open.
    window.addEventListener('pagehide', (e) => {
        if (!loggingOut) {
            saveDraft();
            saveNotesSnapshot();
        }
        if (e.persisted) {
            pageInCache = true;
            clearTimeout(connectionBannerTimer);
            connectionBanner.hidden = true;
            window.socket.disconnect();
        }
    });
    // A phone may discard a tab in the background without a pagehide.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && !loggingOut) saveNotesSnapshot();
    });
    window.addEventListener('pageshow', (e) => {
        if (e.persisted) {
            pageInCache = false;
            window.socket.connect();
            showConnectionProblem();
        }
    });

    window.socket.on('disconnect', () => {
        identityConfirmed = false;
        if (!loggingOut && !pageInCache) showConnectionProblem();
        updatePendingBadges();
    });

    // The server sends full state on every connect, so only the banner needs
    // attention here. Unacknowledged notes wait for current-user: another tab
    // may have signed in as someone else while this one was offline.
    window.socket.on('connect', () => {
        clearTimeout(connectionBannerTimer);
        connectionBanner.hidden = true;
        updatePendingBadges();
    });

    window.socket.on('current-user', (data) => {
        const changed = currentUser.sub !== data.sub;
        currentUser.name = data.name;
        currentUser.sub = data.sub;
        currentUserName.textContent = data.name;
        currentUserName.classList.remove('awaiting-data');
        identityConfirmed = true;
        if (changed) applyRememberedTags();
        // Notes written before we knew who we are are ours; another person's
        // stay in their own saved copy (pending-notes.js) for their next login.
        for (const [clientId, pending] of pendingNotes) {
            if (pending.sub === null) {
                pending.sub = data.sub;
                pendingStore.add(data.sub, { note: pending.note, writtenAt: pending.writtenAt });
            } else if (pending.sub !== data.sub) {
                pending.element.remove();
                pendingNotes.delete(clientId);
            }
        }
        if (changed) {
            rebuildFullNotesList(); // edit buttons depend on who we are, which may arrive after the notes
            if (!usersButton.classList.contains('awaiting-data')) renderUsers(lastUsers);
            updateChatMessages();
        }
        for (const { note, writtenAt } of pendingNotes.values()) sendPendingNote(note, writtenAt);
        restorePendingNotes();
    });

    window.socket.on('users-update', (users) => {
        lastUsers = users;
        renderUsers(users);
    });

    window.socket.on('act-update', (act) => {
        currentAct = act;
        currentActDisplay.textContent = act;
        receivedLive('act');
    });

    window.socket.on('time-mode-update', (newMode) => {
        timeMode = newMode;
        updateTimeModeDisplay();
        receivedLive('mode');
    });

    window.socket.on('lx-cue-update', (cue) => {
        currentGlobalLxCue = cue;
        updateGlobalLxCueDisplay(cue);
        if (document.activeElement !== lxCueInput) lxCueInput.value = cue;
        if (!currentUser.isTyping) updatePersonalLxCueDisplay(cue);
        receivedLive('cue');
    });

    window.socket.on('tags-update', (tags) => {
        // Sent on every connect, usually the same tags the page already has.
        if (JSON.stringify(tags) === JSON.stringify(availableTags)) return;
        availableTags = tags;
        saveTagsToStorage();
        if (selectedTags.length) updateTagsDisplay();
        else applyRememberedTags();
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
        oscAvailable = !!data.oscAvailable;
        updateCueMode();
        receivedLive('system');
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

    // Sent on every connect, so it also catches up a page drawn from the
    // snapshot or back from the back/forward cache: notes edited, tagged or
    // replied to meanwhile are redrawn one by one (keeping any open edit box
    // and its focus), and only a changed set of notes rebuilds the list.
    window.socket.on('notes-update', (notes) => {
        notesLoading.finish();
        const incoming = notes.map(withLists);
        for (const note of incoming) {
            if (isMyStoredNote(note, note.clientId)) clearPendingNote(note.clientId);
        }
        if (allNotes.length === incoming.length && allNotes.every((n, i) => n.id === incoming[i].id)) {
            incoming.forEach((note, i) => {
                if (JSON.stringify(note) === JSON.stringify(allNotes[i])) return;
                allNotes[i] = note;
                updateNoteElement(note, { refilter: false });
            });
            filterNotes();
            return;
        }
        allNotes = incoming;
        rebuildFullNotesList();
    });

    window.socket.on('note-added', (note) => {
        if (isMyStoredNote(note, note.clientId)) clearPendingNote(note.clientId);
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
        chatLoading.finish({ immediate: true });
        if (chatMessagesList.some((m) => m.id === msg.id)) return;
        chatMessagesList.push(msg);
        chatCopy.onMessageAdded(chatMessagesList);
        const mine = isMyChat(msg);
        if (chatDrawer.hidden && !mine) {
            unreadChat++;
            updateUnread();
        }
        // Only the new message is drawn, open or not: redrawing the whole
        // (uncapped) log per message gets slower as the log grows.
        const stick = !chatDrawer.hidden && (mine || chatNearBottom());
        if (chatMessagesList.length === 1) setHtml(chatMessages, '');
        const holder = document.createElement('div');
        setHtml(holder, renderChatMessage(msg, chatMessagesList[chatMessagesList.length - 2]));
        chatMessages.append(...holder.childNodes);
        chatCount.textContent = plural(chatMessagesList.length, 'shitpost');
        if (stick) chatMessages.scrollTop = chatMessages.scrollHeight;
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
        chatLoading.finish();
    });

    // The server was reset from the config page: forget the saved chat copy
    // and the notes still waiting to be acknowledged, so neither comes back.
    window.socket.on('all-reset', () => {
        chatCopy.onReset();
        for (const { element } of pendingNotes.values()) element.remove();
        pendingNotes.clear();
        pendingStore.clear(currentUser.sub);
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
    menuUsersButton.addEventListener('click', (e) => { e.stopPropagation(); togglePopover(usersPopover, menuButton); });
    menuButton.addEventListener('click', (e) => { e.stopPropagation(); togglePopover(menuPopover, menuButton); });
    exportJsonBtn.addEventListener('click', () => {
        closePopovers();
        window.socket.emit('export-request', 'json');
    });

    chatToggle.addEventListener('click', () => {
        setChatOpen(chatDrawer.hidden);
        if (!chatDrawer.hidden) (modalChatLayout.matches ? chatClose : chatInput).focus();
    });
    chatClose.addEventListener('click', () => { setChatOpen(false); chatToggle.focus(); });

    chatDrawer.addEventListener('keydown', (e) => {
        if (!modalChatLayout.matches || e.key !== 'Tab') return;
        const controls = [...chatDrawer.querySelectorAll('button:not(:disabled), textarea')];
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

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
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !phoneLayout.matches && !touchInput.matches) {
            e.preventDefault();
            if (!sendNoteBtn.disabled) sendNoteBtn.click();
        }
    });
    noteInput.addEventListener('blur', () => {
        startAutoResumeTimer();
        updateComposer();
    });
    composer.addEventListener('focusin', updateComposer);
    // Clicking or tabbing away from an empty note closes it (see type-to-note.js).
    // Checked once focus has landed, so a move to the note's own tags doesn't count.
    composer.addEventListener('focusout', () => {
        setTimeout(() => {
            updateComposer();
            const action = typeToNote.leaveAction({
                noteValue: noteInput.value,
                focusInComposer: composer.contains(document.activeElement),
                pageFocused: document.hasFocus()
            });
            const tagsChanged = JSON.stringify(selectedTags) !== JSON.stringify(rememberedTags().filter(id => availableTags.some(t => t.id === id)));
            if (action === 'cancel' && (currentUser.isTyping || tagsChanged)) cancelNote();
        }, 0);
    });

    // Leaving the note box shrinks it, which used to move whatever was pressed
    // below it before the press ended, so the click missed. Hold its size until
    // the click has landed and any popover it opened has closed, then shrink it
    // without moving what was pressed (as far as the scroll position allows).
    document.addEventListener('pointerdown', (e) => {
        // A hold still set at the next press missed its click; let it go first.
        if (composerHold && !composerHoldWatch) releaseComposer();
        if (composerHold || composer.contains(e.target) || !composer.contains(document.activeElement)) return;
        composerHold = { target: e.target };
        updateComposer();
    }, true);
    // Touch can deliver the click a moment after the finger lifts.
    for (const type of ['pointerup', 'pointercancel']) {
        window.addEventListener(type, () => {
            if (composerHold) composerHoldTimer = setTimeout(releaseComposer, 500);
        }, true);
    }
    window.addEventListener('click', () => {
        if (composerHold) setTimeout(releaseComposer, 0);
    }, true);

    function releaseComposer() {
        if (!composerHold || composerHoldWatch) return;
        clearTimeout(composerHoldTimer);
        if (document.querySelector('.popover:not([hidden])')) {
            composerHoldWatch = new MutationObserver(() => {
                if (document.querySelector('.popover:not([hidden])')) return;
                composerHoldWatch.disconnect();
                composerHoldWatch = null;
                releaseComposer();
            });
            composerHoldWatch.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
            return;
        }
        const { target } = composerHold;
        const before = target.isConnected ? target.getBoundingClientRect().top : null;
        composerHold = null;
        updateComposer();
        if (before !== null) {
            const moved = target.getBoundingClientRect().top - before;
            if (moved) window.scrollBy(0, moved);
        }
    }

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
        updateComposerTagsLabel();
        if (!needsTag()) showTagError(false);
        saveDraft();
    });
    composerTagsToggle.addEventListener('click', () => setComposerTagsExpanded(!composer.classList.contains('tags-expanded')));

    sendNoteBtn.addEventListener('click', () => {
        const text = noteInput.value.trim();
        if (text && needsTag()) {
            showTagError(true);
            if (phoneLayout.matches) tagsContainer.querySelector('button')?.focus();
            else noteInput.focus();
            return;
        }
        if (text && currentUser.frozenTimecode) {
            submitNote({
                text: text,
                timecode: currentUser.frozenTimecode,
                lxCue: currentUser.frozenLxCue,
                typingStartedAt: currentUser.typingStartedAt,
                frameRate: timeMode === 'realtime' ? 'ms' : currentUser.currentFrameRate,
                tags: selectedTags,
            });
            rememberTags(selectedTags);
            resetComposer();
            // Dismiss the phone keyboard after sending; desktop stays ready to type.
            if (phoneLayout.matches || touchInput.matches) {
                noteInput.blur();
                sendNoteBtn.blur();
            } else noteInput.focus();
            currentUser.isTyping = false;
            updateComposer();
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
            modalOpen: !tagPicker.hidden || (modalChatLayout.matches && !chatDrawer.hidden),
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
    clearFiltersBtn.addEventListener('click', clearFilters);
    notesNoMatch.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="clear-filters"]')) clearFilters();
    });

    // --- Event listeners: chat ---
    chatInput.addEventListener('input', () => { sendChatBtn.disabled = chatInput.value.trim().length === 0; });
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !phoneLayout.matches && !touchInput.matches) {
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

    // Closes the reply box and focuses the "Reply" link under the thread if there is one, else the reply icon.
    function closeReplyBox(note) {
        openReplies.delete(note.id);
        updateNoteElement(note);
        const el = noteElements.get(note.id);
        (el?.querySelector('.reply-more') || el?.querySelector('[data-action="reply"]'))?.focus();
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
        actDropdown.close();
        tagDropdown.close();
    }, { passive: true });

    // --- Initialization ---
    loadTagsFromStorage();
    updateTagsDisplay();
    updateFilterTags();
    updateActFilter();
    // Restore identity before chat so its own messages have the right alignment.
    showNotesSnapshot();
    chatMessagesList = chatCopy.saved();
    if (chatMessagesList.length) {
        updateChatMessages();
        chatLoading.finish({ immediate: true });
    }
    setChatOpen(document.documentElement.classList.contains('chat-open'));
    updateTimeModeDisplay();
    updateGlobalLxCueDisplay(currentGlobalLxCue);
    updatePersonalLxCueDisplay(currentGlobalLxCue);
    updateComposer();
    filterNotes();
    restoreDraft();
    applyRememberedTags();
});
