document.addEventListener('DOMContentLoaded', function() {
    // --- DOM element references ---
    const globalTimecodeElement = document.getElementById('globalTimecode');
    const globalLxCueElement = document.getElementById('globalLxCue');
    const globalFrameRateElement = document.getElementById('globalFrameRate');
    const personalTimecodeElement = document.getElementById('personalTimecodeDisplay');
    const personalLxCueElement = document.getElementById('personalLxCueDisplay');
    const personalTimecodeContainer = document.getElementById('personalTimecode');
    const connectionStatus = document.getElementById('connectionStatus');
    const midiStatus = document.getElementById('midiStatus');
    const oscStatus = document.getElementById('oscStatus');
    const timeModeStatus = document.getElementById('timeModeStatus');
    const userStatus = document.getElementById('userStatus');
    const sourceBadge = document.getElementById('sourceBadge');
    const timeModeLabel = document.getElementById('timeModeLabel');
    const noteInput = document.getElementById('noteInput');
    const lxCueInput = document.getElementById('lxCueInput');
    const sendNoteBtn = document.getElementById('sendNote');
    const cancelNoteBtn = document.getElementById('cancelNote');
    const usersList = document.getElementById('usersList');
    const notesList = document.getElementById('notesList');
    const exportJsonBtn = document.getElementById('exportJson');
    const currentUserName = document.getElementById('currentUserName');
    const changeNameBtn = document.getElementById('changeNameBtn');
    const timeModeToggle = document.getElementById('timeModeToggle');
    const realtimeLabel = document.getElementById('realtimeLabel');
    const midiLabel = document.getElementById('midiLabel');
    const nameModal = document.getElementById('nameModal');
    const nameInput = document.getElementById('nameInput');
    const confirmNameBtn = document.getElementById('confirmName');
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
    const scrollToBottomBtn = document.getElementById('scrollToBottomBtn');

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
    let currentUsers = [];
    let chatMessagesList = [];
    let expandedCommentSections = new Set();
    let nameTimeout = null;
    let nameSet = false;
    let currentAct = 'Preshow';
    let noteElements = new Map();

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

    function timecodeToSeconds(tc) {
        if (!tc) return 0;
        const hours = tc.hours || 0;
        const minutes = tc.minutes || 0;
        const seconds = tc.seconds || 0;
        const frames = tc.frames || 0;
        const frameRate = tc.frameRate || 30;
        return hours * 3600 + minutes * 60 + seconds + frames / frameRate;
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

    function escapeHtml(str) {
        return str.replace(/[&<>]/g, function(m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            return m;
        });
    }

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
        tagsContainer.innerHTML = '';
        availableTags.forEach(tag => {
            const tagId = `tag-${tag.id}`;
            const tagElement = `
                <input type="checkbox" id="${tagId}" class="tag-checkbox" value="${tag.id}">
                <label for="${tagId}" class="tag-label" style="background-color: ${tag.color}; color: #000;">
                    ${tag.name}
                </label>
            `;
            tagsContainer.innerHTML += tagElement;
        });
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
        filterTagsContainer.innerHTML = '<div class="filter-tag active" data-tag="all">All Notes</div>';
        availableTags.forEach(tag => {
            const filterTagElement = `
                <div class="filter-tag" data-tag="${tag.id}" style="background-color: ${tag.color}; color: #000;">
                    ${tag.name}
                </div>
            `;
            filterTagsContainer.innerHTML += filterTagElement;
        });
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
        editTagsContainer.innerHTML = '';
        editTagsSelected = [...noteTags];
        availableTags.forEach(tag => {
            const tagId = `edit-tag-${tag.id}`;
            const isChecked = noteTags.includes(tag.id);
            const tagElement = `
                <input type="checkbox" id="${tagId}" class="tag-checkbox" value="${tag.id}" ${isChecked ? 'checked' : ''}>
                <label for="${tagId}" class="tag-label" style="background-color: ${tag.color}; color: #000;">
                    ${tag.name}
                </label>
            `;
            editTagsContainer.innerHTML += tagElement;
        });
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
        const noteItems = document.querySelectorAll('.note-item');
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
        actFilter.innerHTML = '<div class="filter-tag active" data-act="all">All Acts</div>';
        uniqueActs.forEach(act => {
            const actElement = `<div class="filter-tag" data-act="${act}">${act}</div>`;
            actFilter.innerHTML += actElement;
        });
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

    function updateTimeModeDisplay() {
        if (timeMode === 'realtime') {
            timeModeLabel.textContent = 'REAL TIME';
            timeModeStatus.textContent = 'Time Mode: Real Time (System Clock)';
            realtimeLabel.classList.add('active');
            midiLabel.classList.remove('active');
            timeModeToggle.checked = true;
            sourceBadge.style.display = 'none';
            globalFrameRateElement.textContent = 'Time Unit: Milliseconds';
            startRealTimeMode();
        } else {
            timeModeLabel.textContent = 'MIDI TIMECODE';
            timeModeStatus.textContent = 'Time Mode: MIDI Timecode';
            realtimeLabel.classList.remove('active');
            midiLabel.classList.add('active');
            timeModeToggle.checked = false;
            sourceBadge.style.display = 'inline-block';
            globalFrameRateElement.textContent = `Frame Rate: ${currentGlobalTimecode.frameRate} fps`;
            stopRealTimeMode();
            updateGlobalTimecodeDisplay(currentGlobalTimecode);
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
            currentUser.frozenTimecode = { ...currentGlobalTimecode, displayMode: 'midi' };
        }
        currentUser.frozenLxCue = currentGlobalLxCue;
        updatePersonalTimecodeDisplay(currentUser.frozenTimecode);
        updatePersonalLxCueDisplay(currentUser.frozenLxCue);
        personalTimecodeContainer.classList.add('frozen');
        window.socket.emit('typing-start', {
            timecode: currentUser.frozenTimecode,
            lxCue: currentUser.frozenLxCue
        });
        userStatus.textContent = 'Timecode and LX Cue frozen - writing note...';
    }

    function cancelNote() {
        noteInput.value = '';
        sendNoteBtn.disabled = true;
        currentUser.isTyping = false;
        currentUser.frozenTimecode = null;
        currentUser.frozenLxCue = null;
        personalTimecodeContainer.classList.remove('frozen');
        userStatus.textContent = 'Auto-resumed. Ready for next note.';
        selectedTags = [];
        document.querySelectorAll('.tag-checkbox:checked').forEach(cb => cb.checked = false);
        window.socket.emit('typing-stop');
        clearAutoResumeTimer();
    }

    function startAutoResumeTimer() {
        clearAutoResumeTimer();
        autoResumeTimer = setTimeout(function() {
            if (noteInput.value.trim() === '' && document.activeElement !== noteInput) cancelNote();
        }, 15000);
    }

    function clearAutoResumeTimer() {
        if (autoResumeTimer) {
            clearTimeout(autoResumeTimer);
            autoResumeTimer = null;
        }
    }

    // --- Name modal timeout functions ---
    function startNameTimeout() {
        if (nameTimeout) clearTimeout(nameTimeout);
        const warningTimeout = setTimeout(() => {
            if (!nameSet && nameModal.style.display !== 'none') showNameWarning();
        }, 600000); // 10 minutes
        nameTimeout = setTimeout(() => {
            clearTimeout(warningTimeout);
            if (!nameSet) autoCloseTab();
        }, 900000); // 15 minutes
    }

    function autoCloseTab() {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.95); color: white; display: flex;
            flex-direction: column; justify-content: center; align-items: center;
            z-index: 10000; font-family: 'Segoe UI', sans-serif; text-align: center;
            padding: 2rem;
        `;
        overlay.innerHTML = `
            <h1 style="font-size: 2.5rem; margin-bottom: 1rem; color: #ff9800;">Session Expired</h1>
            <p style="font-size: 1.2rem; margin-bottom: 2rem;">You didn't set a display name within 15 minutes. This tab will close automatically.</p>
            <div style="display: flex; gap: 1rem;">
                <button id="setNameNow" style="padding: 1rem 2rem; background: #4CAF50; color: white; border: none; border-radius: 5px;">Set Name Now</button>
                <button id="closeNow" style="padding: 1rem 2rem; background: #f44336; color: white; border: none; border-radius: 5px;">Close Now</button>
            </div>
        `;
        document.body.appendChild(overlay);
        document.getElementById('setNameNow').addEventListener('click', () => {
            document.body.removeChild(overlay);
            nameModal.style.display = 'flex';
            nameInput.focus();
            startNameTimeout();
        });
        document.getElementById('closeNow').addEventListener('click', () => window.close());
        setTimeout(() => { if (document.body.contains(overlay)) window.close(); }, 30000);
    }

    function showNameWarning() {
        nameModal.classList.add('warning');
        if (!document.getElementById('nameWarning')) {
            const warning = document.createElement('div');
            warning.id = 'nameWarning';
            warning.innerHTML = '⚠️ Please set your name soon. This tab will close in 5 minutes if no name is set.';
            document.querySelector('.modal-content').appendChild(warning);
        }
    }

    // --- Chat functions ---
    function updateChatMessages() {
        chatCount.textContent = `${chatMessagesList.length} shitpost${chatMessagesList.length !== 1 ? 's' : ''}`;
        if (chatMessagesList.length === 0) {
            chatMessages.innerHTML = '<div style="text-align: center; opacity: 0.7; padding: 2rem;">No chat messages yet. Start the conversation!</div>';
            return;
        }
        const sorted = [...chatMessagesList].sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
        chatMessages.innerHTML = sorted.map(msg => {
            const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return `
                <div class="chat-message">
                    <div class="chat-message-header">
                        <span class="chat-message-user">${escapeHtml(msg.user)}</span>
                        <span class="chat-message-time">${time}</span>
                    </div>
                    <div class="chat-message-text">${escapeHtml(msg.text)}</div>
                </div>
            `;
        }).join('');
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
    function isNearBottom() {
        const scrollHeight = notesList.scrollHeight;
        const scrollTop = notesList.scrollTop;
        const clientHeight = notesList.clientHeight;
        return scrollHeight - (scrollTop + clientHeight) < 50;
    }

    function toggleScrollButton() {
        if (isNearBottom()) scrollToBottomBtn.style.display = 'none';
        else scrollToBottomBtn.style.display = 'flex';
    }

    function scrollToBottom() {
        notesList.scrollTo({ top: notesList.scrollHeight, behavior: 'smooth' });
    }

    // --- Incremental DOM update functions ---
    function getTagElements(tags) {
        return tags.map(tagId => {
            const tag = availableTags.find(t => t.id === tagId);
            return tag ? `<span class="note-tag" style="background-color: ${tag.color}; color: #000;">${tag.name}</span>`
                       : `<span class="note-tag" style="background-color: #cccccc; color: #000;">${tagId}</span>`;
        }).join('');
    }

    function getNoteHTML(note) {
        let timecodeDisplay;
        if (note.frameRate === 'ms') {
            const ms = Math.floor((note.timecode.milliseconds || 0) / 10);
            timecodeDisplay = `${note.timecode.hours.toString().padStart(2, '0')}:${note.timecode.minutes.toString().padStart(2, '0')}:${note.timecode.seconds.toString().padStart(2, '0')}:${ms.toString().padStart(2, '0')}`;
        } else {
            timecodeDisplay = formatTimecode(note.timecode);
        }
        const tagElements = getTagElements(note.tags);
        const editButton = `<button class="small edit-tags-btn" data-action="edit-tags" data-note-id="${note.id}">Edit Tags</button>`;
        const editNoteButton = `<button class="small edit-note-btn" data-action="edit-note" data-note-id="${note.id}">Edit Note</button>`;
        const editedIndicator = note.lastEdited ? `<div class="note-edited">Last edited by ${escapeHtml(note.lastEditedBy || 'unknown')} at ${new Date(note.lastEdited).toLocaleTimeString()}</div>` : '';
        const isCommentsExpanded = expandedCommentSections.has(note.id);
        const commentCount = note.comments ? note.comments.length : 0;

        const commentsSection = `
            <div class="comments-section">
                <button class="comments-toggle ${isCommentsExpanded ? 'expanded' : ''}" data-action="toggle-comments" data-note-id="${note.id}">
                    <span>Comments</span>
                    <span class="count">${commentCount}</span>
                    <span class="arrow">▼</span>
                </button>
                <div class="comments-container ${isCommentsExpanded ? 'expanded' : ''}" id="comments-${note.id}">
                    ${note.comments ? note.comments.map(comment => `
                        <div class="comment-item" data-comment-id="${comment.id}">
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
                            <div class="comment-actions" style="margin-top: 0.5rem;">
                                <button class="small edit-comment-btn" data-action="edit-comment" data-note-id="${note.id}" data-comment-id="${comment.id}">Edit</button>
                                <button class="small delete-comment-btn" data-action="delete-comment" data-note-id="${note.id}" data-comment-id="${comment.id}">Delete</button>
                                <button class="small save-comment-btn" data-action="save-comment" data-note-id="${note.id}" data-comment-id="${comment.id}" style="display: none">Save</button>
                                <button class="small cancel-comment-btn" data-action="cancel-comment" data-note-id="${note.id}" data-comment-id="${comment.id}" style="display: none">Cancel</button>
                            </div>
                        </div>
                    `).join('') : ''}
                </div>
                <div class="comment-input-area ${isCommentsExpanded ? 'expanded' : ''}" id="comment-input-${note.id}">
                    <textarea class="comment-input" data-action="comment-input" data-note-id="${note.id}" placeholder="Add a comment..."></textarea>
                    <div class="comment-actions">
                        <button class="small secondary cancel-comment" data-action="cancel-comment-input" data-note-id="${note.id}">Cancel</button>
                        <button class="small primary submit-comment" data-action="submit-comment" data-note-id="${note.id}" disabled>Submit</button>
                    </div>
                </div>
            </div>
        `;

        return `
            <div class="note-item" data-tags="${note.tags.join(',')}" data-act="${note.act || 'Preshow'}" data-note-id="${note.id}">
                <div class="note-header">
                    <span class="note-act">${note.act || 'Preshow'}</span>
                    <span class="note-user">${escapeHtml(note.user)}</span>
                    <span class="note-timecode">
                        ${timecodeDisplay} 
                        <span class="note-lx-cue">LX: ${note.lxCue || 'N/A'}</span>
                        @ ${note.frameRate || '30 fps'}
                    </span>
                </div>
                <div class="note-text">
                    <span class="note-text-display">${escapeHtml(note.text)}</span>
                    <textarea class="note-text-edit" style="display: none">${escapeHtml(note.text)}</textarea>
                </div>
                ${editedIndicator}
                ${note.tags.length > 0 ? `<div class="note-tags">${tagElements}</div>` : ''}
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
        wrapper.innerHTML = getNoteHTML(note).trim();
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
        const shouldShow = (filterTag === 'all' || note.tags.includes(filterTag)) &&
                           (filterAct === 'all' || (note.act || 'Preshow') === filterAct);
        newElement.style.display = shouldShow ? 'block' : 'none';
    }

    function insertNoteInOrder(noteElement, note) {
        const container = notesList;
        const children = Array.from(container.children).filter(child => child.classList && child.classList.contains('note-item'));
        let inserted = false;
        for (let i = 0; i < children.length; i++) {
            const childId = children[i].getAttribute('data-note-id');
            const childNote = allNotes.find(n => n.id === childId);
            if (childNote) {
                const childTime = childNote.timestamp ? new Date(childNote.timestamp) : timecodeToSeconds(childNote.timecode);
                const newTime = note.timestamp ? new Date(note.timestamp) : timecodeToSeconds(note.timecode);
                if (newTime < childTime) {
                    container.insertBefore(noteElement, children[i]);
                    inserted = true;
                    break;
                }
            }
        }
        if (!inserted) container.appendChild(noteElement);
        const shouldShow = (filterTag === 'all' || note.tags.includes(filterTag)) &&
                           (filterAct === 'all' || (note.act || 'Preshow') === filterAct);
        noteElement.style.display = shouldShow ? 'block' : 'none';
    }

    function rebuildFullNotesList() {
        captureCommentInputs();                // Save any in‑progress comments
        notesList.innerHTML = '';
        noteElements.clear();
        const chronologicalNotes = [...allNotes].sort((a, b) => {
            if (a.timestamp && b.timestamp) return new Date(a.timestamp) - new Date(b.timestamp);
            return timecodeToSeconds(a.timecode) - timecodeToSeconds(b.timecode);
        });
        for (const note of chronologicalNotes) {
            const element = createNoteElement(note);
            notesList.appendChild(element);
        }
        updateActFilter();
        filterNotes();
        restoreCommentInputs();                // Restore comment text and focus
        toggleScrollButton();
    }

    function updateCommentsForNote(noteId) {
        const note = allNotes.find(n => n.id === noteId);
        if (note) updateNoteElement(note);
    }

    // --- Socket.io setup ---
    window.socket = io();

    window.socket.on('connect', () => {
        connectionStatus.textContent = 'Connected to Server';
        connectionStatus.className = 'status-connected';
        currentUser.id = window.socket.id;
    });

    window.socket.on('disconnect', () => {
        connectionStatus.textContent = 'Disconnected from Server';
        connectionStatus.className = 'status-disconnected';
    });

    window.socket.on('user-joined', (data) => updateUserCount(data.userCount));
    window.socket.on('user-left', (data) => updateUserCount(data.userCount));

    window.socket.on('users-update', (users) => {
        currentUsers = users;
        updateUserCount(users.length);
        usersList.innerHTML = '';
        users.forEach(user => {
            const userItem = document.createElement('li');
            userItem.className = 'user-item';
            userItem.innerHTML = `${escapeHtml(user.name)}${user.isTyping ? '<span class="user-typing"><span class="typing-indicator"></span>writing note</span>' : ''}`;
            usersList.appendChild(userItem);
        });
    });

    window.socket.on('name-change-error', (data) => alert(data.message));
    window.socket.on('name-change-success', (data) => {
        userStatus.textContent = data.message;
        setTimeout(() => { if (!currentUser.isTyping) userStatus.textContent = 'Ready to take notes'; }, 3000);
    });

    window.socket.on('act-update', (act) => {
        currentAct = act;
        currentActDisplay.textContent = act;
        userStatus.textContent = `Act changed to: ${act}`;
        setTimeout(() => { if (!currentUser.isTyping) userStatus.textContent = 'Ready to take notes'; }, 3000);
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
        if (data.midiAvailable && data.portCount > 0) {
            midiStatus.textContent = `MIDI Interface: ${data.portCount} port(s) available - ${data.currentPort}`;
            midiStatus.className = 'status-connected';
            timeModeToggle.disabled = false;
            midiLabel.style.opacity = '1';
            realtimeLabel.style.opacity = '1';
        } else {
            midiStatus.textContent = 'MIDI Interface: No MIDI devices found';
            midiStatus.className = 'status-disconnected';
            timeModeToggle.disabled = true;
            timeModeToggle.checked = true;
            midiLabel.style.opacity = '0.5';
            realtimeLabel.style.opacity = '1';
            timeMode = 'realtime';
            updateTimeModeDisplay();
            window.socket.emit('time-mode-change', 'realtime');
        }
        if (data.oscAvailable) {
            oscStatus.textContent = 'LX Cues: OSC Source Active (Auto-updating)';
            oscStatus.className = 'status-connected';
            lxCueInput.disabled = true;
            lxCueInput.placeholder = 'Auto-updated via OSC';
        } else {
            oscStatus.textContent = 'LX Cues: Manual Input';
            oscStatus.className = '';
            lxCueInput.disabled = false;
            lxCueInput.placeholder = 'Cue Number';
        }
    });

    window.socket.on('timecode-update', (data) => {
        if (timeMode === 'midi' && data.source === 'midi') {
            currentGlobalTimecode = data;
            currentUser.currentFrameRate = data.frameRate;
            updateGlobalTimecodeDisplay(data);
            if (!currentUser.isTyping) updatePersonalTimecodeDisplay(data);
            sourceBadge.textContent = 'LIVE MIDI';
            sourceBadge.className = 'source-badge source-midi';
            sourceBadge.style.display = 'inline-block';
        }
    });

    let isFirstLoad = true;

    window.socket.on('user-name-changed', ({ userId, newName }) => {
        // Update name in all notes
        allNotes.forEach(note => {
            let needsUpdate = false;
            if (note.userId === userId) {
                note.user = newName;
                needsUpdate = true;
            }
            if (note.comments) {
                note.comments.forEach(comment => {
                    if (comment.userId === userId) {
                        comment.user = newName;
                        needsUpdate = true;
                    }
                });
            }
            if (needsUpdate) {
                updateNoteElement(note);
            }
        });
        // Update users list (already handled by users-update event)
        // If current user changed their own name, update local references
        if (currentUser.id === userId) {
            currentUser.name = newName;
            currentUserName.textContent = newName;
            updateChatUserName();
        }
    });

    window.socket.on('notes-update', (notes) => {
        // Only rebuild if the notes array has changed (e.g., name change, import)
        if (allNotes.length === notes.length && allNotes.every((n, i) => n.id === notes[i].id)) {
            return;
        }
        allNotes = notes;
        rebuildFullNotesList();
    });

    window.socket.on('note-added', (note) => {
        const wasNearBottom = isNearBottom();   // Check BEFORE insertion
        allNotes.push(note);
        const element = createNoteElement(note);
        insertNoteInOrder(element, note);
        updateActFilter();
        if (wasNearBottom) {
            scrollToBottom();
        } else {
            toggleScrollButton();
        }
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
        const wasNearBottom = isNearBottom();
        const note = allNotes.find(n => n.id === noteId);
        if (note) {
            if (!note.comments) note.comments = [];
            note.comments.push(comment);
            updateCommentsForNote(noteId);
            if (wasNearBottom) scrollToBottom();
            else toggleScrollButton();
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

    window.socket.on('chat-message-added', (msg) => {
        chatMessagesList.push(msg);
        updateChatMessages();
    });

    window.socket.on('chat-messages-update', (msgs) => {
        chatMessagesList = msgs;
        updateChatMessages();
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
    confirmNameBtn.addEventListener('click', () => {
        const name = nameInput.value.trim();
        if (name) {
            const taken = currentUsers.some(u => u.name.toLowerCase() === name.toLowerCase());
            if (taken) {
                alert(`Name "${name}" is already taken. Please choose a different name.`);
                nameInput.focus();
                return;
            }
            currentUser.name = name;
            updateChatUserName();
            currentUserName.textContent = name;
            nameModal.style.display = 'none';
            nameSet = true;
            nameModal.classList.remove('warning');
            const warn = document.getElementById('nameWarning');
            if (warn) warn.remove();
            if (nameTimeout) clearTimeout(nameTimeout);
            window.socket.emit('user-name-change', name);
        } else {
            alert('Please enter a name');
            nameInput.focus();
        }
    });

    nameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') confirmNameBtn.click(); });

    changeNameBtn.addEventListener('click', () => {
        const newName = prompt('Enter your new name:', currentUser.name);
        if (newName && newName.trim()) {
            const taken = currentUsers.some(u => u.id !== currentUser.id && u.name.toLowerCase() === newName.toLowerCase());
            if (taken) {
                alert(`Name "${newName}" is already taken. Please choose a different name.`);
                return;
            }
            currentUser.name = newName.trim();
            updateChatUserName();
            currentUserName.textContent = currentUser.name;
            nameSet = true;
            window.socket.emit('user-name-change', currentUser.name);
        }
    });

    timeModeToggle.addEventListener('change', () => {
        if (!timeModeToggle.disabled) {
            const newMode = timeModeToggle.checked ? 'realtime' : 'midi';
            window.socket.emit('time-mode-change', newMode);
        }
    });

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
        startAutoResumeTimer();
        if (!currentUser.isTyping && noteInput.value.length > 0) startTyping();
    });
    noteInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!sendNoteBtn.disabled) sendNoteBtn.click();
        }
    });
    noteInput.addEventListener('blur', startAutoResumeTimer);

    sendNoteBtn.addEventListener('click', () => {
        const text = noteInput.value.trim();
        if (text && currentUser.frozenTimecode) {
            window.socket.emit('note-submit', {
                text: text,
                timecode: currentUser.frozenTimecode,
                lxCue: currentUser.frozenLxCue,
                frameRate: timeMode === 'realtime' ? 'ms' : currentUser.currentFrameRate,
                tags: selectedTags,
            });
            noteInput.value = '';
            sendNoteBtn.disabled = true;
            currentUser.isTyping = false;
            currentUser.frozenTimecode = null;
            currentUser.frozenLxCue = null;
            personalTimecodeContainer.classList.remove('frozen');
            userStatus.textContent = 'Note sent! Ready for next note.';
            selectedTags = [];
            document.querySelectorAll('.tag-checkbox:checked').forEach(cb => cb.checked = false);
            window.socket.emit('typing-stop');
            clearAutoResumeTimer();
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

    scrollToBottomBtn.addEventListener('click', scrollToBottom);
    notesList.addEventListener('scroll', () => toggleScrollButton());

    // --- Initialization ---
    startNameTimeout();
    updateGlobalTimecodeDisplay(currentGlobalTimecode);
    updatePersonalTimecodeDisplay(currentGlobalTimecode);
    updateGlobalLxCueDisplay(currentGlobalLxCue);
    updatePersonalLxCueDisplay(currentGlobalLxCue);
    nameModal.style.display = 'flex';
    nameInput.focus();
});