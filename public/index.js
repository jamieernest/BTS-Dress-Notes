document.addEventListener('DOMContentLoaded', function() {
    // --- DOM element references ---
    const globalTimecodeElement = document.getElementById('globalTimecode');
    const globalLxCueElement = document.getElementById('globalLxCue');
    const globalFrameRateElement = document.getElementById('globalFrameRate');
    const personalTimecodeElement = document.getElementById('personalTimecodeDisplay');
    const personalLxCueElement = document.getElementById('personalLxCueDisplay');
    const personalTimecodeContainer = document.getElementById('personalTimecode');
    const sourceBadge = document.getElementById('sourceBadge');
    const timeModeLabel = document.getElementById('timeModeLabel');
    const noteInput = document.getElementById('noteInput');
    const lxCueInput = document.getElementById('lxCueInput');
    const sendNoteBtn = document.getElementById('sendNote');
    const cancelNoteBtn = document.getElementById('cancelNote');
    const usersPanel = document.getElementById('usersPanel');
    const usersList = document.getElementById('usersList');
    const notesList = document.getElementById('notesList');
    const exportJsonBtn = document.getElementById('exportJson');
    const currentUserName = document.getElementById('currentUserName');
    const tagsContainer = document.getElementById('tagsContainer');
    const filterTagsContainer = document.getElementById('filterTags');
    const currentActDisplay = document.getElementById('currentActDisplay');
    const actFilter = document.getElementById('actFilter');
    const editTagsModal = document.getElementById('editTagsModal');
    const editTagsContainer = document.getElementById('editTagsContainer');
    const cancelEditTagsBtn = document.getElementById('cancelEditTags');
    const saveEditTagsBtn = document.getElementById('saveEditTags');
    const userCount = document.getElementById('userCount');
    const chatInput = document.getElementById('chatInput');
    const sendChatBtn = document.getElementById('sendChat');
    const chatMessages = document.getElementById('chatMessages');
    const chatCount = document.getElementById('chatCount');
    const chatUserName = document.getElementById('chatUserName');
    const scrollToTopBtn = document.getElementById('scrollToTopBtn');
    const connectionBanner = document.getElementById('connectionBanner');

    // --- State variables ---
    let currentUser = {
        name: 'Guest',
        id: null,
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
    let filterTag = 'all';
    let filterAct = 'all';
    let currentlyEditingNoteId = null;
    let editTagsSelected = [];
    let autoResumeTimer = null;
    let chatMessagesList = [];
    let expandedCommentSections = new Set();
    let currentAct = 'Preshow';
    let noteElements = new Map();
    // Notes submitted but not yet acknowledged by the server, keyed by the
    // clientId sent with them: clientId -> { note, element }.
    const pendingNotes = new Map();

    let savedCommentInputs = {};
    let focusedCommentNoteId = null;

    function captureCommentInputs() {
        savedCommentInputs = {};
        document.querySelectorAll('.comment-input').forEach(input => {
            const noteId = input.dataset.noteId;
            if (noteId) savedCommentInputs[noteId] = input.value;
        });
        const active = document.activeElement;
        if (active && active.classList && active.classList.contains('comment-input')) {
            focusedCommentNoteId = active.dataset.noteId;
        } else {
            focusedCommentNoteId = null;
        }
    }

    function restoreCommentInputs() {
        for (const [noteId, text] of Object.entries(savedCommentInputs)) {
            const input = document.querySelector(`.comment-input[data-note-id="${noteId}"]`);
            if (input) {
                input.value = text;
                const submitBtn = document.querySelector(`[data-action="submit-comment"][data-note-id="${noteId}"]`);
                if (submitBtn) submitBtn.disabled = text.trim().length === 0;
            }
        }
        if (focusedCommentNoteId) {
            const input = document.querySelector(`.comment-input[data-note-id="${focusedCommentNoteId}"]`);
            if (input) {
                input.focus();
                input.setSelectionRange(input.value.length, input.value.length);
            }
        }
    }

    // --- Helper functions (reused from original) ---
    function formatTimecode(tc) {
        if (!tc || typeof tc !== 'object') return '00:00:00:00';
        return `${(tc.hours || 0).toString().padStart(2, '0')}:${(tc.minutes || 0).toString().padStart(2, '0')}:${(tc.seconds || 0).toString().padStart(2, '0')}:${(tc.frames || 0).toString().padStart(2, '0')}`;
    }

    function formatCommentTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        return date.toLocaleDateString();
    }

    // See public/safe-html.js: escape every value, set HTML only through setHtml().
    const { escapeHtml, safeColour, setHtml } = SafeHtml;

    // --- Tag persistence ---
    function loadTagsFromStorage() {
        const storedTags = localStorage.getItem('midi-timecode-notes-tags');
        if (storedTags) {
            availableTags = JSON.parse(storedTags);
            updateTagsDisplay();
            updateFilterTags();
        }
    }

    function saveTagsToStorage() {
        localStorage.setItem('midi-timecode-notes-tags', JSON.stringify(availableTags));
    }

    function initializeTags() {
        loadTagsFromStorage();
    }
    initializeTags();

    function updateTagsDisplay() {
        setHtml(tagsContainer, availableTags.map(tag => {
            const tagId = `tag-${tag.id}`;
            return `
                <input type="checkbox" id="${escapeHtml(tagId)}" class="tag-checkbox" value="${escapeHtml(tag.id)}" ${selectedTags.includes(tag.id) ? 'checked' : ''}>
                <label for="${escapeHtml(tagId)}" class="tag-label" style="background-color: ${safeColour(tag.color)}; color: #000;">
                    ${escapeHtml(tag.name)}
                </label>
            `;
        }).join(''));
        availableTags.forEach(tag => {
            const checkbox = document.getElementById(`tag-${tag.id}`);
            if (checkbox) {
                checkbox.addEventListener('change', function() {
                    if (this.checked) selectedTags.push(this.value);
                    else selectedTags = selectedTags.filter(t => t !== this.value);
                });
            }
        });
    }

    function updateFilterTags() {
        setHtml(filterTagsContainer, '<div class="filter-tag active" data-tag="all">All Notes</div>' + availableTags.map(tag => `
                <div class="filter-tag" data-tag="${escapeHtml(tag.id)}" style="background-color: ${safeColour(tag.color)}; color: #000;">
                    ${escapeHtml(tag.name)}
                </div>
            `).join(''));
        document.querySelectorAll('.filter-tag').forEach(tag => {
            tag.addEventListener('click', function() {
                filterTag = this.getAttribute('data-tag');
                document.querySelectorAll('.filter-tag').forEach(t => t.classList.remove('active'));
                this.classList.add('active');
                filterNotes();
            });
        });
        // Act filter listeners are reattached in updateActFilter
    }

    function updateEditTagsDisplay(noteTags) {
        noteTags = noteTags || [];
        editTagsSelected = [...noteTags];
        setHtml(editTagsContainer, availableTags.map(tag => {
            const tagId = `edit-tag-${tag.id}`;
            const isChecked = noteTags.includes(tag.id);
            return `
                <input type="checkbox" id="${escapeHtml(tagId)}" class="tag-checkbox" value="${escapeHtml(tag.id)}" ${isChecked ? 'checked' : ''}>
                <label for="${escapeHtml(tagId)}" class="tag-label" style="background-color: ${safeColour(tag.color)}; color: #000;">
                    ${escapeHtml(tag.name)}
                </label>
            `;
        }).join(''));
        availableTags.forEach(tag => {
            const checkbox = document.getElementById(`edit-tag-${tag.id}`);
            if (checkbox) {
                checkbox.addEventListener('change', function() {
                    if (this.checked) editTagsSelected.push(this.value);
                    else editTagsSelected = editTagsSelected.filter(t => t !== this.value);
                });
            }
        });
    }

    function filterNotes() {
        const noteItems = document.querySelectorAll('.note-item:not(.pending)');
        noteItems.forEach(item => {
            let showNote = true;
            if (filterTag !== 'all') {
                const itemTags = item.getAttribute('data-tags').split(',');
                if (!itemTags.includes(filterTag)) showNote = false;
            }
            if (filterAct !== 'all') {
                const itemAct = item.getAttribute('data-act');
                if (itemAct !== filterAct) showNote = false;
            }
            item.style.display = showNote ? 'block' : 'none';
        });
    }

    function updateActFilter() {
        const uniqueActs = [...new Set(allNotes.map(note => note.act || 'Preshow'))];
        setHtml(actFilter, '<div class="filter-tag active" data-act="all">All Acts</div>' +
            uniqueActs.map(act => `<div class="filter-tag" data-act="${escapeHtml(act)}">${escapeHtml(act)}</div>`).join(''));
        document.querySelectorAll('.act-filter .filter-tag').forEach(tag => {
            tag.addEventListener('click', function() {
                filterAct = this.getAttribute('data-act');
                document.querySelectorAll('.act-filter .filter-tag').forEach(t => t.classList.remove('active'));
                this.classList.add('active');
                filterNotes();
            });
        });
    }

    // --- Timecode and UI update functions ---
    function updateGlobalTimecodeDisplay(timecode) {
        let formatted;
        if (timecode.displayMode === 'realtime') {
            const ms = Math.floor((timecode.milliseconds || 0) / 10);
            formatted = `${timecode.hours.toString().padStart(2, '0')}:${timecode.minutes.toString().padStart(2, '0')}:${timecode.seconds.toString().padStart(2, '0')}:${ms.toString().padStart(2, '0')}`;
        } else {
            formatted = formatTimecode(timecode);
        }
        globalTimecodeElement.textContent = formatted;
    }

    function updatePersonalTimecodeDisplay(timecode) {
        let formatted;
        if (timecode.displayMode === 'realtime') {
            const ms = Math.floor((timecode.milliseconds || 0) / 10);
            formatted = `${timecode.hours.toString().padStart(2, '0')}:${timecode.minutes.toString().padStart(2, '0')}:${timecode.seconds.toString().padStart(2, '0')}:${ms.toString().padStart(2, '0')}`;
        } else {
            formatted = formatTimecode(timecode);
        }
        personalTimecodeElement.textContent = formatted;
    }

    function updateGlobalLxCueDisplay(cue) {
        globalLxCueElement.textContent = `LX Cue: ${cue}`;
    }

    function updatePersonalLxCueDisplay(cue) {
        personalLxCueElement.textContent = `LX Cue: ${cue}`;
    }

    const timeModeLabels = {
        midi: 'MIDI TIMECODE',
        network: 'NETWORK TIMECODE',
        realtime: 'REAL TIME'
    };

    function updateSourceBadge() {
        const name = timeMode === 'network' ? 'NETWORK' : 'MIDI';
        sourceBadge.textContent = liveSources[timeMode] ? `LIVE ${name}` : name;
        sourceBadge.className = `source-badge source-${timeMode}`;
    }

    function updateTimeModeDisplay() {
        timeModeLabel.textContent = timeModeLabels[timeMode] || timeModeLabels.midi;
        if (timeMode === 'realtime') {
            sourceBadge.style.display = 'none';
            globalFrameRateElement.textContent = 'Time Unit: Milliseconds';
            startRealTimeMode();
        } else {
            currentGlobalTimecode = latestTimecodes[timeMode];
            currentUser.currentFrameRate = currentGlobalTimecode.frameRate;
            updateSourceBadge();
            sourceBadge.style.display = 'inline-block';
            globalFrameRateElement.textContent = `Frame Rate: ${currentGlobalTimecode.frameRate} fps`;
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
        const now = new Date();
        const realTimeTimecode = {
            hours: now.getHours(),
            minutes: now.getMinutes(),
            seconds: now.getSeconds(),
            milliseconds: now.getMilliseconds(),
            displayMode: 'realtime'
        };
        updateGlobalTimecodeDisplay(realTimeTimecode);
        if (!currentUser.isTyping) updatePersonalTimecodeDisplay(realTimeTimecode);
    }

    function startTyping() {
        if (currentUser.isTyping) return;
        currentUser.isTyping = true;
        if (timeMode === 'realtime') {
            const now = new Date();
            currentUser.frozenTimecode = {
                hours: now.getHours(),
                minutes: now.getMinutes(),
                seconds: now.getSeconds(),
                milliseconds: now.getMilliseconds(),
                displayMode: 'realtime',
                frameRate: 'ms'
            };
        } else {
            currentUser.frozenTimecode = { ...currentGlobalTimecode, displayMode: timeMode };
        }
        currentUser.frozenLxCue = currentGlobalLxCue;
        updatePersonalTimecodeDisplay(currentUser.frozenTimecode);
        updatePersonalLxCueDisplay(currentUser.frozenLxCue);
        personalTimecodeContainer.classList.add('frozen');
        window.socket.emit('typing-start', {
            timecode: currentUser.frozenTimecode,
            lxCue: currentUser.frozenLxCue
        });
        startAutoResumeTimer();
    }

    // Unfreezes the personal timecode and LX cue so they follow the show again.
    function releaseFreeze() {
        currentUser.isTyping = false;
        currentUser.frozenTimecode = null;
        currentUser.frozenLxCue = null;
        personalTimecodeContainer.classList.remove('frozen');
        if (timeMode !== 'realtime') updatePersonalTimecodeDisplay(currentGlobalTimecode);
        updatePersonalLxCueDisplay(currentGlobalLxCue);
        window.socket.emit('typing-stop');
        clearAutoResumeTimer();
    }

    function cancelNote() {
        noteInput.value = '';
        sendNoteBtn.disabled = true;
        selectedTags = [];
        document.querySelectorAll('.tag-checkbox:checked').forEach(cb => cb.checked = false);
        releaseFreeze();
        clearDraft();
    }

    // Restarted by every focus, keystroke and blur: once the box has been
    // empty that long the timecode follows the show again (see type-to-note.js).
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

    // --- Chat functions ---
    function updateChatMessages() {
        chatCount.textContent = `${chatMessagesList.length} shitpost${chatMessagesList.length !== 1 ? 's' : ''}`;
        if (chatMessagesList.length === 0) {
            setHtml(chatMessages, '<div style="text-align: center; opacity: 0.7; padding: 2rem;">No chat messages yet. Start the conversation!</div>');
            return;
        }
        const sorted = [...chatMessagesList].sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
        setHtml(chatMessages, sorted.map(msg => {
            const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return `
                <div class="chat-message">
                    <div class="chat-message-header">
                        <span class="chat-message-user">${escapeHtml(msg.user)}</span>
                        <span class="chat-message-time">${escapeHtml(time)}</span>
                    </div>
                    <div class="chat-message-text">${escapeHtml(msg.text)}</div>
                </div>
            `;
        }).join(''));
        setTimeout(() => chatMessages.scrollTop = chatMessages.scrollHeight, 100);
    }

    function sendChatMessage() {
        const text = chatInput.value.trim();
        if (text) {
            window.socket.emit('chat-message', { text });
            chatInput.value = '';
            sendChatBtn.disabled = true;
        }
    }

    function updateChatUserName() {
        chatUserName.textContent = currentUser.name;
    }

    function updateUserCount(count) {
        userCount.textContent = `${count} user${count !== 1 ? 's' : ''}`;
    }

    // --- Scroll button logic ---
    // Newest notes are at the top of the list.
    function isNearTop() {
        return notesList.scrollTop < 50;
    }

    function toggleScrollButton() {
        if (isNearTop()) scrollToTopBtn.style.display = 'none';
        else scrollToTopBtn.style.display = 'flex';
    }

    function scrollToTop() {
        notesList.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // --- Incremental DOM update functions ---
    function getTagElements(tags) {
        return (tags || []).map(tagId => {
            const tag = availableTags.find(t => t.id === tagId);
            return tag ? `<span class="note-tag" style="background-color: ${safeColour(tag.color)}; color: #000;">${escapeHtml(tag.name)}</span>`
                       : `<span class="note-tag" style="background-color: #cccccc; color: #000;">${escapeHtml(tagId)}</span>`;
        }).join('');
    }

    function formatNoteTimecode(note) {
        if (!note.timecode) return formatTimecode(null);
        if (note.frameRate === 'ms') {
            const ms = Math.floor((note.timecode.milliseconds || 0) / 10);
            return `${note.timecode.hours.toString().padStart(2, '0')}:${note.timecode.minutes.toString().padStart(2, '0')}:${note.timecode.seconds.toString().padStart(2, '0')}:${ms.toString().padStart(2, '0')}`;
        }
        return formatTimecode(note.timecode);
    }

    function getNoteHTML(note) {
        const tags = note.tags || [];
        const act = escapeHtml(note.act || 'Preshow');
        const timecodeDisplay = formatNoteTimecode(note);
        const tagElements = getTagElements(tags);
        const editButton = `<button class="small edit-tags-btn" data-action="edit-tags" data-note-id="${escapeHtml(note.id)}">Edit Tags</button>`;
        const editNoteButton = !NoteAuthor.canEditNote(note, currentUser.sub) ? '' : `<button class="small edit-note-btn" data-action="edit-note" data-note-id="${escapeHtml(note.id)}">Edit Note</button>`;
        const editedIndicator = note.lastEdited ? `<div class="note-edited">Last edited by ${escapeHtml(note.lastEditedBy || 'unknown')} at ${new Date(note.lastEdited).toLocaleTimeString()}</div>` : '';
        const isCommentsExpanded = expandedCommentSections.has(note.id);
        const commentCount = note.comments ? note.comments.length : 0;

        const commentsSection = `
            <div class="comments-section">
                <button class="comments-toggle ${isCommentsExpanded ? 'expanded' : ''}" data-action="toggle-comments" data-note-id="${escapeHtml(note.id)}">
                    <span>Comments</span>
                    <span class="count">${commentCount}</span>
                    <span class="arrow">▼</span>
                </button>
                <div class="comments-container ${isCommentsExpanded ? 'expanded' : ''}" id="comments-${escapeHtml(note.id)}">
                    ${note.comments ? note.comments.map(comment => `
                        <div class="comment-item" data-comment-id="${escapeHtml(comment.id)}">
                            <div class="comment-header">
                                <span class="comment-user">${escapeHtml(comment.user)}</span>
                                <span class="comment-time">
                                    ${formatCommentTime(comment.timestamp)}
                                    ${comment.lastEdited ? `(edited by ${escapeHtml(comment.lastEditedBy || 'unknown')} at ${new Date(comment.lastEdited).toLocaleTimeString()})` : ''}
                                </span>
                            </div>
                            <div class="comment-text">
                                <span class="comment-text-display">${escapeHtml(comment.text)}</span>
                                <textarea class="comment-text-edit" style="display: none">${escapeHtml(comment.text)}</textarea>
                            </div>
                            ${!NoteAuthor.canEditNote(comment, currentUser.sub) ? '' : `<div class="comment-actions" style="margin-top: 0.5rem;">
                                <button class="small edit-comment-btn" data-action="edit-comment" data-note-id="${escapeHtml(note.id)}" data-comment-id="${escapeHtml(comment.id)}">Edit</button>
                                <button class="small delete-comment-btn" data-action="delete-comment" data-note-id="${escapeHtml(note.id)}" data-comment-id="${escapeHtml(comment.id)}">Delete</button>
                                <button class="small save-comment-btn" data-action="save-comment" data-note-id="${escapeHtml(note.id)}" data-comment-id="${escapeHtml(comment.id)}" style="display: none">Save</button>
                                <button class="small cancel-comment-btn" data-action="cancel-comment" data-note-id="${escapeHtml(note.id)}" data-comment-id="${escapeHtml(comment.id)}" style="display: none">Cancel</button>
                            </div>`}
                        </div>
                    `).join('') : ''}
                </div>
                <div class="comment-input-area ${isCommentsExpanded ? 'expanded' : ''}" id="comment-input-${escapeHtml(note.id)}">
                    <textarea class="comment-input" data-action="comment-input" data-note-id="${escapeHtml(note.id)}" placeholder="Add a comment..."></textarea>
                    <div class="comment-actions">
                        <button class="small secondary cancel-comment" data-action="cancel-comment-input" data-note-id="${escapeHtml(note.id)}">Cancel</button>
                        <button class="small primary submit-comment" data-action="submit-comment" data-note-id="${escapeHtml(note.id)}" disabled>Submit</button>
                    </div>
                </div>
            </div>
        `;

        return `
            <div class="note-item" data-tags="${escapeHtml(tags.join(','))}" data-act="${act}" data-note-id="${escapeHtml(note.id)}">
                <div class="note-header">
                    <span class="note-act">${act}</span>
                    <span class="note-user">${escapeHtml(note.user)}</span>
                    <span class="note-timecode">
                        ${escapeHtml(timecodeDisplay)} 
                        <span class="note-lx-cue">LX: ${escapeHtml(note.lxCue || 'N/A')}</span>
                        @ ${escapeHtml(note.frameRate || '30 fps')}
                    </span>
                </div>
                <div class="note-text">
                    <span class="note-text-display">${escapeHtml(note.text)}</span>
                    <textarea class="note-text-edit" style="display: none">${escapeHtml(note.text)}</textarea>
                </div>
                ${editedIndicator}
                ${tags.length > 0 ? `<div class="note-tags">${tagElements}</div>` : ''}
                ${commentsSection}
                <div class="note-actions-row">
                    ${editButton}
                    ${editNoteButton}
                </div>
            </div>
        `;
    }

    function createNoteElement(note) {
        const wrapper = document.createElement('div');
        setHtml(wrapper, getNoteHTML(note).trim());
        const element = wrapper.firstChild;
        noteElements.set(note.id, element);
        return element;
    }

    function updateNoteElement(note) {
        const oldElement = noteElements.get(note.id);
        if (!oldElement) return;
        const newElement = createNoteElement(note);
        oldElement.replaceWith(newElement);
        noteElements.set(note.id, newElement);
        const shouldShow = (filterTag === 'all' || (note.tags || []).includes(filterTag)) &&
                           (filterAct === 'all' || (note.act || 'Preshow') === filterAct);
        newElement.style.display = shouldShow ? 'block' : 'none';
    }

    function insertNoteInOrder(noteElement, note) {
        // Only for a note that is the newest; addNote rebuilds the list for one that isn't.
        // Pending notes stay above every note the server has.
        notesList.insertBefore(noteElement, notesList.querySelector('.note-item:not(.pending)'));
        const shouldShow = (filterTag === 'all' || (note.tags || []).includes(filterTag)) &&
                           (filterAct === 'all' || (note.act || 'Preshow') === filterAct);
        noteElement.style.display = shouldShow ? 'block' : 'none';
    }

    function rebuildFullNotesList() {
        captureCommentInputs();                // Save any in‑progress comments
        notesList.replaceChildren();
        noteElements.clear();
        for (const { element } of [...pendingNotes.values()].reverse()) notesList.appendChild(element);
        for (const note of NoteOrder.newestFirst(allNotes)) {
            const element = createNoteElement(note);
            notesList.appendChild(element);
        }
        updateActFilter();
        filterNotes();
        restoreCommentInputs();                // Restore comment text and focus
        toggleScrollButton();
    }

    function addNote(note) {
        if (noteElements.has(note.id)) return;
        const wasNearTop = isNearTop();   // Check BEFORE insertion
        const index = NoteOrder.insertionIndex(allNotes, note);
        allNotes.splice(index, 0, note);
        if (index < allNotes.length - 1) {
            // A late note (written while disconnected) belongs below later ones.
            rebuildFullNotesList();
        } else {
            insertNoteInOrder(createNoteElement(note), note);
            updateActFilter();
        }
        if (wasNearTop) {
            scrollToTop();
        } else {
            toggleScrollButton();
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
        return window.socket.connected ? 'Pending - sending...' : 'Pending - will send on reconnect';
    }

    function createPendingNoteElement(note) {
        const wrapper = document.createElement('div');
        setHtml(wrapper, `
            <div class="note-item pending" data-client-id="${escapeHtml(note.clientId)}">
                <div class="note-pending-badge">${escapeHtml(pendingBadgeText())}</div>
                <div class="note-header">
                    <span class="note-user">${escapeHtml(currentUser.name)}</span>
                    <span class="note-timecode">
                        ${escapeHtml(formatNoteTimecode(note))}
                        <span class="note-lx-cue">LX: ${escapeHtml(note.lxCue || 'N/A')}</span>
                        @ ${escapeHtml(note.frameRate || '30 fps')}
                    </span>
                </div>
                <div class="note-text">
                    <span class="note-text-display">${escapeHtml(note.text)}</span>
                </div>
                ${(note.tags || []).length > 0 ? `<div class="note-tags">${getTagElements(note.tags)}</div>` : ''}
            </div>
        `.trim());
        return wrapper.firstChild;
    }

    function updatePendingBadges() {
        const text = pendingBadgeText();
        for (const { element } of pendingNotes.values()) {
            element.querySelector('.note-pending-badge').textContent = text;
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
                pending.element.querySelector('.note-pending-badge').textContent =
                    `Not saved: ${(stored && stored.error) || 'refused by the server'}`;
                pending.element.classList.add('failed');
                return;
            }
            clearPendingNote(stored.clientId);
            addNote(stored);
        });
    }

    function clearPendingNote(clientId) {
        const pending = pendingNotes.get(clientId);
        if (!pending) return;
        pending.element.remove();
        pendingNotes.delete(clientId);
        savePendingNotes();
    }

    function showPendingNote(note, writtenAt) {
        const wasNearTop = isNearTop();
        const element = createPendingNoteElement(note);
        pendingNotes.set(note.clientId, { note, element, writtenAt });
        // The newest pending note goes above the older ones.
        notesList.insertBefore(element, notesList.firstChild);
        if (wasNearTop) scrollToTop();
        else toggleScrollButton();
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

    function updateCommentsForNote(noteId) {
        const note = allNotes.find(n => n.id === noteId);
        if (note) updateNoteElement(note);
    }

    // --- Draft note ---
    // The note being written is kept in sessionStorage (this tab only), with
    // its frozen timecode, so a reload or a bounce through /login gives it back.
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
        currentUser.isTyping = true;
        currentUser.frozenTimecode = draft.timecode;
        currentUser.frozenLxCue = draft.lxCue;
        updatePersonalTimecodeDisplay(draft.timecode);
        updatePersonalLxCueDisplay(draft.lxCue);
        personalTimecodeContainer.classList.add('frozen');
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

    window.socket.on('current-user', (data) => {
        const changed = currentUser.sub !== data.sub;
        currentUser.name = data.name;
        currentUser.sub = data.sub;
        currentUserName.textContent = data.name;
        updateChatUserName();
        if (changed) rebuildFullNotesList(); // edit buttons depend on who we are, which may arrive after the notes
        restorePendingNotes();
    });

    // Collapsing the online users list is remembered per browser (nice to have, so failures are ignored).
    try {
        if (localStorage.getItem('users-panel-collapsed') === '1') usersPanel.open = false;
    } catch (e) { /* storage unavailable */ }
    usersPanel.addEventListener('toggle', () => {
        try { localStorage.setItem('users-panel-collapsed', usersPanel.open ? '0' : '1'); } catch (e) { /* ignore */ }
    });

    window.socket.on('user-joined', (data) => updateUserCount(data.userCount));
    window.socket.on('user-left', (data) => updateUserCount(data.userCount));

    window.socket.on('users-update', (users) => {
        updateUserCount(users.length);
        // Built from elements, so a name is only ever text.
        usersList.replaceChildren(...users.map(user => {
            const userItem = document.createElement('li');
            userItem.className = 'user-item';
            userItem.textContent = user.name;
            if (user.isTyping) {
                const typing = document.createElement('span');
                typing.className = 'user-typing';
                const indicator = document.createElement('span');
                indicator.className = 'typing-indicator';
                typing.append(indicator, 'writing note');
                userItem.appendChild(typing);
            }
            return userItem;
        }));
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
        lxCueInput.value = cue;
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
        if (data.oscAvailable) {
            lxCueInput.disabled = true;
            lxCueInput.placeholder = 'Auto-updated via OSC';
        } else {
            lxCueInput.disabled = false;
            lxCueInput.placeholder = 'Cue Number';
        }
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
            globalFrameRateElement.textContent = `Frame Rate: ${data.frameRate} fps`;
            updateGlobalTimecodeDisplay(data);
            if (!currentUser.isTyping) updatePersonalTimecodeDisplay(data);
            if (data.source === 'midi' && !liveSources.midi) {
                liveSources.midi = true;
                updateSourceBadge();
            }
        }
    });

    let isFirstLoad = true;

    window.socket.on('notes-update', (notes) => {
        // Only rebuild if the notes array has changed (e.g., name change, import)
        if (allNotes.length === notes.length && allNotes.every((n, i) => n.id === notes[i].id)) {
            return;
        }
        allNotes = notes;
        for (const note of notes) {
            if (note.clientId && pendingNotes.has(note.clientId)) clearPendingNote(note.clientId);
        }
        rebuildFullNotesList();
    });

    window.socket.on('note-added', (note) => {
        if (note.clientId) clearPendingNote(note.clientId);
        addNote(note);
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
            updateCommentsForNote(noteId);
        }
    });

    window.socket.on('comment-edit', ({ noteId, commentId, newText, lastEditedBy, lastEdited }) => {
        const note = allNotes.find(n => n.id === noteId);
        if (note && note.comments) {
            const comment = note.comments.find(c => c.id === commentId);
            if (comment) {
                comment.text = newText;
                comment.lastEdited = lastEdited;
                comment.lastEditedBy = lastEditedBy;
                updateCommentsForNote(noteId);
            }
        }
    });

    window.socket.on('comment-delete', ({ noteId, commentId }) => {
        const note = allNotes.find(n => n.id === noteId);
        if (note && note.comments) {
            note.comments = note.comments.filter(c => c.id !== commentId);
            updateCommentsForNote(noteId);
        }
    });

    // The server sends each new message on its own, and the whole log only on
    // connecting and after a restore.
    window.socket.on('chat-message-added', (msg) => {
        if (chatMessagesList.some((m) => m.id === msg.id)) return;
        chatMessagesList.push(msg);
        chatCopy.onMessageAdded(chatMessagesList);
        updateChatMessages();
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
    });

    // --- Event listeners ---
    lxCueInput.addEventListener('input', () => window.socket.emit('lx-cue-change', lxCueInput.value));

    cancelEditTagsBtn.addEventListener('click', () => {
        editTagsModal.style.display = 'none';
        currentlyEditingNoteId = null;
        editTagsSelected = [];
    });

    saveEditTagsBtn.addEventListener('click', () => {
        if (currentlyEditingNoteId) {
            window.socket.emit('note-update-tags', { noteId: currentlyEditingNoteId, tags: editTagsSelected });
            editTagsModal.style.display = 'none';
            currentlyEditingNoteId = null;
            editTagsSelected = [];
        }
    });

    noteInput.addEventListener('focus', startTyping);
    noteInput.addEventListener('input', () => {
        sendNoteBtn.disabled = noteInput.value.trim().length === 0;
        // After a release, the next key freezes the timecode at that moment.
        if (!currentUser.isTyping && noteInput.value.length > 0) startTyping();
        else startAutoResumeTimer();
        saveDraft();
    });
    noteInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!sendNoteBtn.disabled) sendNoteBtn.click();
        }
    });
    noteInput.addEventListener('blur', startAutoResumeTimer);

    // Typing anywhere else on the page starts a note (see type-to-note.js).
    document.addEventListener('keydown', (e) => {
        const ctx = {
            modalOpen: editTagsModal.style.display === 'flex',
            noteHasText: noteInput.value.length > 0,
            body: document.body
        };
        if (typeToNote.shouldFocusNote(e, document.activeElement, ctx)) noteInput.focus();

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

    sendNoteBtn.addEventListener('click', () => {
        const text = noteInput.value.trim();
        if (text && currentUser.frozenTimecode) {
            submitNote({
                text: text,
                timecode: currentUser.frozenTimecode,
                lxCue: currentUser.frozenLxCue,
                frameRate: timeMode === 'realtime' ? 'ms' : currentUser.currentFrameRate,
                tags: selectedTags,
            });
            cancelNote();
        }
    });

    cancelNoteBtn.addEventListener('click', cancelNote);
    exportJsonBtn.addEventListener('click', () => window.socket.emit('export-request', 'json'));

    chatInput.addEventListener('input', () => { sendChatBtn.disabled = chatInput.value.trim().length === 0; });
    chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter' && e.ctrlKey) sendChatMessage(); });
    sendChatBtn.addEventListener('click', sendChatMessage);

    // Delegated events for dynamic buttons
    notesList.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button) return;
        const action = button.dataset.action;
        if (!action) return;
        const noteId = button.dataset.noteId;

        if (action === 'edit-tags') {
            const note = allNotes.find(n => n.id === noteId);
            if (note) {
                currentlyEditingNoteId = noteId;
                updateEditTagsDisplay(note.tags);
                editTagsModal.style.display = 'flex';
            }
        } else if (action === 'toggle-comments') {
            const container = document.getElementById(`comments-${noteId}`);
            const inputArea = document.getElementById(`comment-input-${noteId}`);
            if (container.classList.contains('expanded')) {
                container.classList.remove('expanded');
                inputArea.classList.remove('expanded');
                button.classList.remove('expanded');
                expandedCommentSections.delete(noteId);
            } else {
                container.classList.add('expanded');
                inputArea.classList.add('expanded');
                button.classList.add('expanded');
                expandedCommentSections.add(noteId);
            }
        } else if (action === 'edit-note') {
            const noteItem = button.closest('.note-item');
            const display = noteItem.querySelector('.note-text-display');
            const textarea = noteItem.querySelector('.note-text-edit');
            if (display.style.display !== 'none') {
                display.style.display = 'none';
                textarea.style.display = 'block';
                textarea.focus();
                button.textContent = 'Save Note';
                button.dataset.action = 'save-note';
            }
        } else if (action === 'save-note') {
            const noteItem = button.closest('.note-item');
            const display = noteItem.querySelector('.note-text-display');
            const textarea = noteItem.querySelector('.note-text-edit');
            const newText = textarea.value.trim();
            if (newText && newText !== display.textContent) {
                window.socket.emit('note-edit-text', { noteId, newText });
            }
            display.textContent = newText || display.textContent;
            display.style.display = 'block';
            textarea.style.display = 'none';
            button.textContent = 'Edit Note';
            button.dataset.action = 'edit-note';
        } else if (action === 'edit-comment') {
            const commentId = button.dataset.commentId;
            const commentItem = button.closest('.comment-item');
            const display = commentItem.querySelector('.comment-text-display');
            const textarea = commentItem.querySelector('.comment-text-edit');
            const editBtn = commentItem.querySelector('[data-action="edit-comment"]');
            const delBtn = commentItem.querySelector('[data-action="delete-comment"]');
            const saveBtn = commentItem.querySelector('[data-action="save-comment"]');
            const cancelBtn = commentItem.querySelector('[data-action="cancel-comment"]');
            display.style.display = 'none';
            textarea.style.display = 'block';
            textarea.focus();
            editBtn.style.display = 'none';
            delBtn.style.display = 'none';
            saveBtn.style.display = 'inline-block';
            cancelBtn.style.display = 'inline-block';
        } else if (action === 'save-comment') {
            const commentId = button.dataset.commentId;
            const commentItem = button.closest('.comment-item');
            const display = commentItem.querySelector('.comment-text-display');
            const textarea = commentItem.querySelector('.comment-text-edit');
            const newText = textarea.value.trim();
            if (newText) {
                window.socket.emit('comment-edit', { noteId, commentId, newText });
            }
            display.style.display = 'block';
            textarea.style.display = 'none';
            const editBtn = commentItem.querySelector('[data-action="edit-comment"]');
            const delBtn = commentItem.querySelector('[data-action="delete-comment"]');
            const saveBtn = commentItem.querySelector('[data-action="save-comment"]');
            const cancelBtn = commentItem.querySelector('[data-action="cancel-comment"]');
            editBtn.style.display = 'inline-block';
            delBtn.style.display = 'inline-block';
            saveBtn.style.display = 'none';
            cancelBtn.style.display = 'none';
        } else if (action === 'cancel-comment') {
            const commentId = button.dataset.commentId;
            const commentItem = button.closest('.comment-item');
            const display = commentItem.querySelector('.comment-text-display');
            const textarea = commentItem.querySelector('.comment-text-edit');
            textarea.value = display.textContent;
            display.style.display = 'block';
            textarea.style.display = 'none';
            const editBtn = commentItem.querySelector('[data-action="edit-comment"]');
            const delBtn = commentItem.querySelector('[data-action="delete-comment"]');
            const saveBtn = commentItem.querySelector('[data-action="save-comment"]');
            const cancelBtn = commentItem.querySelector('[data-action="cancel-comment"]');
            editBtn.style.display = 'inline-block';
            delBtn.style.display = 'inline-block';
            saveBtn.style.display = 'none';
            cancelBtn.style.display = 'none';
        } else if (action === 'delete-comment') {
            const commentId = button.dataset.commentId;
            if (confirm('Are you sure you want to delete this comment?')) {
                window.socket.emit('comment-delete', { noteId, commentId });
            }
        } else if (action === 'submit-comment') {
            const input = document.querySelector(`.comment-input[data-note-id="${noteId}"]`);
            const text = input.value.trim();
            if (text) {
                window.socket.emit('comment-submit', { noteId, text });
                input.value = '';
                button.disabled = true;
                expandedCommentSections.add(noteId);
            }
        } else if (action === 'cancel-comment-input') {
            const input = document.querySelector(`.comment-input[data-note-id="${noteId}"]`);
            input.value = '';
            const submitBtn = document.querySelector(`[data-action="submit-comment"][data-note-id="${noteId}"]`);
            if (submitBtn) submitBtn.disabled = true;
        }
    });

    notesList.addEventListener('input', (e) => {
        const target = e.target;
        if (target.dataset.action === 'comment-input') {
            const noteId = target.dataset.noteId;
            const submitBtn = document.querySelector(`[data-action="submit-comment"][data-note-id="${noteId}"]`);
            if (submitBtn) submitBtn.disabled = target.value.trim().length === 0;
        }
    });

    notesList.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            const target = e.target;
            if (target.dataset.action === 'comment-input') {
                e.preventDefault();
                const noteId = target.dataset.noteId;
                const submitBtn = document.querySelector(`[data-action="submit-comment"][data-note-id="${noteId}"]`);
                if (submitBtn && !submitBtn.disabled) submitBtn.click();
            }
        }
    });

    scrollToTopBtn.addEventListener('click', scrollToTop);
    let scrollTimeout;
    notesList.addEventListener('scroll', () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => toggleScrollButton(), 50);
    });

    // --- Initialization ---
    updateGlobalTimecodeDisplay(currentGlobalTimecode);
    updatePersonalTimecodeDisplay(currentGlobalTimecode);
    updateGlobalLxCueDisplay(currentGlobalLxCue);
    updatePersonalLxCueDisplay(currentGlobalLxCue);
    restoreDraft();
});