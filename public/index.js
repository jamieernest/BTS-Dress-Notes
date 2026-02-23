
document.addEventListener('DOMContentLoaded', function() {
    // Existing variable declarations
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
    const exportCsvBtn = document.getElementById('exportCsv');
    const currentUserName = document.getElementById('currentUserName');
    const changeNameBtn = document.getElementById('changeNameBtn');
    
    // Time mode toggle elements
    const timeModeToggle = document.getElementById('timeModeToggle');
    const realtimeLabel = document.getElementById('realtimeLabel');
    const midiLabel = document.getElementById('midiLabel');
    
    // Modal elements
    const nameModal = document.getElementById('nameModal');
    const nameInput = document.getElementById('nameInput');
    const confirmNameBtn = document.getElementById('confirmName');
    
    // Tag elements
    const tagsContainer = document.getElementById('tagsContainer');
    const filterTagsContainer = document.getElementById('filterTags');
    const currentActDisplay = document.getElementById('currentActDisplay');
    let currentAct = 'Preshow'; // Track current act locally
    const actFilter = document.getElementById('actFilter');
    
    // Edit tags modal elements
    const editTagsModal = document.getElementById('editTagsModal');
    const editTagsContainer = document.getElementById('editTagsContainer');
    const cancelEditTagsBtn = document.getElementById('cancelEditTags');
    const saveEditTagsBtn = document.getElementById('saveEditTags');
    
    // User count element
    const userCount = document.getElementById('userCount');

    // Chat elements
    const chatInput = document.getElementById('chatInput');
    const sendChatBtn = document.getElementById('sendChat');
    const chatMessages = document.getElementById('chatMessages');
    const chatCount = document.getElementById('chatCount');
    const chatUserName = document.getElementById('chatUserName');

    function startTyping() {
        if (currentUser.isTyping) return; // Already typing

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
            currentUser.frozenTimecode = {
                ...currentGlobalTimecode,
                displayMode: 'midi'
            };
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

    let chatMessagesList = [];
    let expandedCommentSections = new Set(); // Track which note comments are expanded
    
    let nameTimeout = null;
    let nameSet = false;

    // Existing variable declarations
    let currentUser = {
        name: 'Guest',
        id: null,
        isTyping: false,
        frozenTimecode: null,
        frozenLxCue: null,
        currentFrameRate: 30
    };
    
    let currentGlobalTimecode = {
        hours: 0,
        minutes: 0,
        seconds: 0,
        frames: 0,
        frameRate: 30
    };
    
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
    
    // Tag persistence functions
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

    // Initialize tags when the page loads
    function initializeTags() {
        loadTagsFromStorage();
    }

    initializeTags();

    function startNameTimeout() {
        // Clear any existing timeout
        if (nameTimeout) {
            clearTimeout(nameTimeout);
        }
        
        // Set 10 minute warning (600,000 milliseconds)
        const warningTimeout = setTimeout(() => {
            if (!nameSet && nameModal.style.display !== 'none') {
                showNameWarning();
            }
        }, 600000); // 10 minutes
        
        // Set 15 minute auto-close (900,000 milliseconds)
        nameTimeout = setTimeout(() => {
            clearTimeout(warningTimeout);
            if (!nameSet) {
                autoCloseTab();
            }
        }, 900000); // 15 minutes
    }

    function autoCloseTab() {
        // Create a full-screen overlay with warning message
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.95);
            color: white;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            text-align: center;
            padding: 2rem;
        `;
        
        overlay.innerHTML = `
            <h1 style="font-size: 2.5rem; margin-bottom: 1rem; color: #ff9800;">Session Expired</h1>
            <p style="font-size: 1.2rem; margin-bottom: 2rem; max-width: 500px;">
                You didn't set a display name within 15 minutes. This tab will close automatically.
            </p>
            <div style="display: flex; gap: 1rem;">
                <button id="setNameNow" style="padding: 1rem 2rem; background: #4CAF50; color: white; border: none; border-radius: 5px; font-size: 1.1rem; cursor: pointer;">
                    Set Name Now
                </button>
                <button id="closeNow" style="padding: 1rem 2rem; background: #f44336; color: white; border: none; border-radius: 5px; font-size: 1.1rem; cursor: pointer;">
                    Close Now
                </button>
            </div>
        `;
        
        document.body.appendChild(overlay);
        
        // Add event listeners to buttons
        document.getElementById('setNameNow').addEventListener('click', () => {
            document.body.removeChild(overlay);
            nameModal.style.display = 'flex';
            nameInput.focus();
            // Restart the timer
            startNameTimeout();
        });
        
        document.getElementById('closeNow').addEventListener('click', () => {
            window.close();
        });
        
        // Auto-close after 30 seconds if no action
        setTimeout(() => {
            if (document.body.contains(overlay)) {
                window.close();
            }
        }, 30000);
    }

    function showNameWarning() {
        // Add warning class to modal for pulsing effect
        nameModal.classList.add('warning');
        
        // Add warning message to the name modal
        const warningElement = document.createElement('div');
        warningElement.id = 'nameWarning';
        warningElement.innerHTML = '⚠️ Please set your name soon. This tab will close in 5 minutes if no name is set.';
        
        const modalContent = document.querySelector('.modal-content');
        if (modalContent && !document.getElementById('nameWarning')) {
            modalContent.appendChild(warningElement);
        }
    }
    
    // Show name modal on load
    nameModal.style.display = 'flex';
    nameInput.focus();
    
    // Handle name confirmation
    confirmNameBtn.addEventListener('click', function() {
        const name = nameInput.value.trim();
        if (name) {
            // Check if name is already taken
            const isNameTaken = currentUsers.some(user => 
                user.name.toLowerCase() === name.toLowerCase()
            );
            
            if (isNameTaken) {
                alert(`Name "${name}" is already taken. Please choose a different name.`);
                nameInput.focus();
                return;
            }
            
            currentUser.name = name;
            updateChatUserName();
            currentUserName.textContent = name;
            nameModal.style.display = 'none';
            nameSet = true; // Mark name as set
            
            // Remove warning if it exists
            nameModal.classList.remove('warning');
            const warningElement = document.getElementById('nameWarning');
            if (warningElement) {
                warningElement.remove();
            }
            
            // Clear the auto-close timeout
            if (nameTimeout) {
                clearTimeout(nameTimeout);
                nameTimeout = null;
            }
            
            window.socket.emit('user-name-change', name);
        } else {
            alert('Please enter a name');
            nameInput.focus();
        }
    });
    
    // Allow pressing Enter to confirm name
    nameInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            confirmNameBtn.click();
        }
    });
    
    // Handle name change
    changeNameBtn.addEventListener('click', function() {
        const newName = prompt('Enter your new name:', currentUser.name);
        if (newName && newName.trim()) {
            // Check if name is already taken (excluding current user)
            const isNameTaken = currentUsers.some(user => 
                user.id !== currentUser.id && user.name.toLowerCase() === newName.toLowerCase()
            );
            
            if (isNameTaken) {
                alert(`Name "${newName}" is already taken. Please choose a different name.`);
                return;
            }
            
            currentUser.name = newName.trim();
            updateChatUserName();
            currentUserName.textContent = currentUser.name;
            nameSet = true; // Ensure flag remains set
            
            window.socket.emit('user-name-change', currentUser.name);
        }
    });
    
    // Handle time mode toggle - GLOBAL CHANGE
    timeModeToggle.addEventListener('change', function() {
        if (!this.disabled) { // Only allow change if not disabled
            const newMode = this.checked ? 'realtime' : 'midi';
            window.socket.emit('time-mode-change', newMode);
        }
    });
    
    // Handle LX Cue input changes
    lxCueInput.addEventListener('input', function() {
        window.socket.emit('lx-cue-change', this.value);
    });
    
    // Edit tags modal handlers
    cancelEditTagsBtn.addEventListener('click', function() {
        editTagsModal.style.display = 'none';
        currentlyEditingNoteId = null;
        editTagsSelected = [];
    });
    
    saveEditTagsBtn.addEventListener('click', function() {
        if (currentlyEditingNoteId) {
            window.socket.emit('note-update-tags', {
                noteId: currentlyEditingNoteId,
                tags: editTagsSelected
            });
            
            editTagsModal.style.display = 'none';
            currentlyEditingNoteId = null;
            editTagsSelected = [];
        }
    });
    
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
        if (realTimeInterval) {
            clearInterval(realTimeInterval);
        }
        
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
        const hours = now.getHours();
        const minutes = now.getMinutes();
        const seconds = now.getSeconds();
        const milliseconds = now.getMilliseconds();
        
        const realTimeTimecode = {
            hours: hours,
            minutes: minutes,
            seconds: seconds,
            milliseconds: milliseconds,
            displayMode: 'realtime'
        };
        
        updateGlobalTimecodeDisplay(realTimeTimecode);
        
        if (!currentUser.isTyping) {
            updatePersonalTimecodeDisplay(realTimeTimecode);
        }
    }
    
    function updateGlobalTimecodeDisplay(timecode) {
        let formattedTimecode;
        if (timecode.displayMode === 'realtime') {
            const ms = Math.floor((timecode.milliseconds || 0) / 10);
            formattedTimecode = 
                `${timecode.hours.toString().padStart(2, '0')}:` +
                `${timecode.minutes.toString().padStart(2, '0')}:` +
                `${timecode.seconds.toString().padStart(2, '0')}:` +
                `${ms.toString().padStart(2, '0')}`;
        } else {
            formattedTimecode = formatTimecode(timecode);
        }
        
        globalTimecodeElement.textContent = formattedTimecode;
    }
    
    function updatePersonalTimecodeDisplay(timecode) {
        let formattedTimecode;
        if (timecode.displayMode === 'realtime') {
            const ms = Math.floor((timecode.milliseconds || 0) / 10);
            formattedTimecode = 
                `${timecode.hours.toString().padStart(2, '0')}:` +
                `${timecode.minutes.toString().padStart(2, '0')}:` +
                `${timecode.seconds.toString().padStart(2, '0')}:` +
                `${ms.toString().padStart(2, '0')}`;
        } else {
            formattedTimecode = formatTimecode(timecode);
        }
        
        personalTimecodeElement.textContent = formattedTimecode;
    }
    
    function updateGlobalLxCueDisplay(cue) {
        globalLxCueElement.textContent = `LX Cue: ${cue}`;
    }
    
    function updatePersonalLxCueDisplay(cue) {
        personalLxCueElement.textContent = `LX Cue: ${cue}`;
    }
    
    function formatTimecode(tc) {
        if (!tc || typeof tc !== 'object') {
            return '00:00:00:00';
        }
        return `${(tc.hours || 0).toString().padStart(2, '0')}:${(tc.minutes || 0).toString().padStart(2, '0')}:${(tc.seconds || 0).toString().padStart(2, '0')}:${(tc.frames || 0).toString().padStart(2, '0')}`;
    }
    
    // Auto-resume functionality
    function startAutoResumeTimer() {
        clearAutoResumeTimer();
        autoResumeTimer = setTimeout(function() {
            if (noteInput.value.trim() === '' && document.activeElement !== noteInput) {
                cancelNote();
            }
        }, 15000); // 15 seconds
    }
    
    function clearAutoResumeTimer() {
        if (autoResumeTimer) {
            clearTimeout(autoResumeTimer);
            autoResumeTimer = null;
        }
    }
    
    // Tag functions
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
                    if (this.checked) {
                        selectedTags.push(this.value);
                    } else {
                        selectedTags = selectedTags.filter(t => t !== this.value);
                    }
                });
            }
        });
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
                    if (this.checked) {
                        editTagsSelected.push(this.value);
                    } else {
                        editTagsSelected = editTagsSelected.filter(t => t !== this.value);
                    }
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
                const tagId = this.getAttribute('data-tag');
                filterTag = tagId;
                
                document.querySelectorAll('.filter-tag').forEach(t => t.classList.remove('active'));
                this.classList.add('active');
                
                filterNotes();
            });
        });

        // Act filter event listeners
        document.querySelectorAll('.act-filter .filter-tag').forEach(tag => {
            tag.addEventListener('click', function() {
                const actValue = this.getAttribute('data-act');
                filterAct = actValue;
                
                document.querySelectorAll('.act-filter .filter-tag').forEach(t => t.classList.remove('active'));
                this.classList.add('active');
                
                filterNotes();
            });
        });
    }
    
    function filterNotes() {
        const noteItems = document.querySelectorAll('.note-item');
        noteItems.forEach(item => {
            let showNote = true;
            
            // Tag filtering
            if (filterTag !== 'all') {
                const itemTags = item.getAttribute('data-tags').split(',');
                if (!itemTags.includes(filterTag)) {
                    showNote = false;
                }
            }
            
            // Act filtering
            if (filterAct !== 'all') {
                const itemAct = item.getAttribute('data-act');
                if (itemAct !== filterAct) {
                    showNote = false;
                }
            }
            
            item.style.display = showNote ? 'block' : 'none';
        });
    }
    
    // Connect to WebSocket server
    window.socket = io();
    
    window.socket.on('connect', function() {
        connectionStatus.textContent = 'Connected to Server';
        connectionStatus.className = 'status-connected';
        currentUser.id = window.socket.id;
    });
    
    window.socket.on('disconnect', function() {
        connectionStatus.textContent = 'Disconnected from Server';
        connectionStatus.className = 'status-disconnected';
    });
    
    window.socket.on('user-joined', function(data) {
        updateUserCount(data.userCount);
    });
    
    window.socket.on('user-left', function(data) {
        updateUserCount(data.userCount);
    });
    
    window.socket.on('users-update', function(users) {
        currentUsers = users;
        updateUserCount(users.length);
        
        // Update users list in status panel
        usersList.innerHTML = '';
        users.forEach(user => {
            const userItem = document.createElement('li');
            userItem.className = 'user-item';
            userItem.innerHTML = `
                ${user.name}
                ${user.isTyping ? '<span class="user-typing"><span class="typing-indicator"></span>writing note</span>' : ''}
            `;
            usersList.appendChild(userItem);
        });
    });
    
    window.socket.on('name-change-error', function(data) {
        alert(data.message);
    });
    
    window.socket.on('name-change-success', function(data) {
        userStatus.textContent = data.message;
        setTimeout(() => {
            if (!currentUser.isTyping) {
                userStatus.textContent = 'Ready to take notes';
            }
        }, 3000);
    });

    window.socket.on('act-update', function(act) {
        currentAct = act;
        currentActDisplay.textContent = act;
        
        // Optional: show a notification when act changes
        userStatus.textContent = `Act changed to: ${act}`;
        setTimeout(() => {
            if (!currentUser.isTyping) {
                userStatus.textContent = 'Ready to take notes';
            }
        }, 3000);
    });
    
    function updateUserCount(count) {
        userCount.textContent = `${count} user${count !== 1 ? 's' : ''}`;
    }
    
    window.socket.on('time-mode-update', function(newMode) {
        timeMode = newMode;
        updateTimeModeDisplay();
    });
    
    window.socket.on('lx-cue-update', function(cue) {
        currentGlobalLxCue = cue;
        updateGlobalLxCueDisplay(cue);
        lxCueInput.value = cue;
        
        if (!currentUser.isTyping) {
            updatePersonalLxCueDisplay(cue);
        }
    });
    
    window.socket.on('tags-update', function(tags) {
        if (tags && tags.length > 0) {
            availableTags = tags;
            saveTagsToStorage();
            updateTagsDisplay();
            updateFilterTags();
        }
    });
    
    window.socket.on('system-status', function(data) {
        if (data.midiAvailable && data.portCount > 0) {
            midiStatus.textContent = `MIDI Interface: ${data.portCount} port(s) available - ${data.currentPort}`;
            midiStatus.className = 'status-connected';
            
            // Enable MIDI time mode option
            timeModeToggle.disabled = false;
            midiLabel.style.opacity = '1';
            realtimeLabel.style.opacity = '1';
        } else {
            midiStatus.textContent = 'MIDI Interface: No MIDI devices found';
            midiStatus.className = 'status-disconnected';
            
            // Disable MIDI time mode option and force realtime mode
            timeModeToggle.disabled = true;
            timeModeToggle.checked = true; // Force to realtime
            midiLabel.style.opacity = '0.5';
            realtimeLabel.style.opacity = '1';
            
            // Update time mode display
            timeMode = 'realtime';
            updateTimeModeDisplay();
            
            // Notify server about forced time mode change
            window.socket.emit('time-mode-change', 'realtime');
        }
        
        // OSC Status (keep existing)
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
    
    window.socket.on('timecode-update', function(data) {
        // Only process MIDI timecode if we're in MIDI mode AND data is from MIDI
        if (timeMode === 'midi' && data.source === 'midi') {
            currentGlobalTimecode = data;
            currentUser.currentFrameRate = data.frameRate;
            
            updateGlobalTimecodeDisplay(data);
            
            if (!currentUser.isTyping) {
                updatePersonalTimecodeDisplay(data);
            }
            
            // Show MIDI source badge
            sourceBadge.textContent = 'LIVE MIDI';
            sourceBadge.className = 'source-badge source-midi';
            sourceBadge.style.display = 'inline-block';
        }
        // In realtime mode, we don't use server timecode updates
    });
    
    window.socket.on('notes-update', function(notes) {
        allNotes = notes;
        updateNotesList();
    });
    
    window.socket.on('note-added', function(note) {
        updateNotesList();
    });
    
    // Handle chat messages
    window.socket.on('chat-message-added', function(chatMessage) {
        chatMessagesList.push(chatMessage);
        updateChatMessages();
    });

    window.socket.on('chat-messages-update', function(messages) {
        chatMessagesList = messages;
        updateChatMessages();
    });

    window.socket.on('export-data', function(data) {
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
    
    // Handle note input events
    noteInput.addEventListener('focus', function() {
        startTyping();
        startAutoResumeTimer();
    });
    
    noteInput.addEventListener('input', function() {
        sendNoteBtn.disabled = noteInput.value.trim().length === 0;
        startAutoResumeTimer();

        // If not currently typing and there is any text, enter typing mode
        if (!currentUser.isTyping && noteInput.value.length > 0) {
            startTyping();
        }
    });

    noteInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            if (e.shiftKey) {
                // Shift+Enter: insert newline (default behaviour)
                return; // Let the browser handle it
            } else {
                // Enter alone: send the note if it's not empty
                e.preventDefault();
                if (!sendNoteBtn.disabled) {
                    sendNoteBtn.click();
                }
            }
        }
    });
    
    noteInput.addEventListener('blur', function() {
        // Start auto-resume timer when input loses focus
        startAutoResumeTimer();
    });
    
    // Send note
    sendNoteBtn.addEventListener('click', function() {
        const noteText = noteInput.value.trim();
        if (noteText && currentUser.frozenTimecode) {
            window.socket.emit('note-submit', {
                text: noteText,
                timecode: currentUser.frozenTimecode,
                lxCue: currentUser.frozenLxCue,
                frameRate: timeMode === 'realtime' ? 'ms' : currentUser.currentFrameRate,
                tags: selectedTags,
            });

            // Reset form
            noteInput.value = '';
            sendNoteBtn.disabled = true;
            currentUser.isTyping = false;
            currentUser.frozenTimecode = null;
            currentUser.frozenLxCue = null;
            personalTimecodeContainer.classList.remove('frozen');
            userStatus.textContent = 'Note sent! Ready for next note.';

            // Reset tags only (act is displayed, not editable)
            selectedTags = [];
            document.querySelectorAll('.tag-checkbox:checked').forEach(checkbox => {
                checkbox.checked = false;
            });

            window.socket.emit('typing-stop');
            clearAutoResumeTimer();
        }
    });
    
    // Cancel note
    function cancelNote() {
        noteInput.value = '';
        sendNoteBtn.disabled = true;
        currentUser.isTyping = false;
        currentUser.frozenTimecode = null;
        currentUser.frozenLxCue = null;
        personalTimecodeContainer.classList.remove('frozen');
        userStatus.textContent = 'Auto-resumed. Ready for next note.';
        
        selectedTags = [];
        document.querySelectorAll('.tag-checkbox:checked').forEach(checkbox => {
            checkbox.checked = false;
        });
        
        window.socket.emit('typing-stop');
        clearAutoResumeTimer();
    }
    
    cancelNoteBtn.addEventListener('click', cancelNote);
    
    // Export buttons
    exportJsonBtn.addEventListener('click', function() {
        window.socket.emit('export-request', 'json');
    });
    
    exportCsvBtn.addEventListener('click', function() {
        window.socket.emit('export-request', 'csv');
    });
    
    // Update notes list
    function updateNotesList() {
        if (allNotes.length === 0) {
            notesList.innerHTML = '<div style="text-align: center; opacity: 0.7; padding: 2rem;">No notes yet. Be the first to add one!</div>';
            return;
        }

        const chronologicalNotes = [...allNotes].sort((a, b) => {
            if (a.timestamp && b.timestamp) {
                return new Date(a.timestamp) - new Date(b.timestamp);
            }
            return timecodeToSeconds(a.timecode) - timecodeToSeconds(b.timecode);
        });

        notesList.innerHTML = chronologicalNotes.map(note => {
            let timecodeDisplay;
            if (note.frameRate === 'ms') {
                const ms = Math.floor((note.timecode.milliseconds || 0) / 10);
                timecodeDisplay = 
                    `${note.timecode.hours.toString().padStart(2, '0')}:` +
                    `${note.timecode.minutes.toString().padStart(2, '0')}:` +
                    `${note.timecode.seconds.toString().padStart(2, '0')}:` +
                    `${ms.toString().padStart(2, '0')}`;
            } else {
                timecodeDisplay = formatTimecode(note.timecode);
            }   
            
            const tagElements = note.tags.map(tagId => {
                const tag = availableTags.find(t => t.id === tagId);
                return tag ? `<span class="note-tag" style="background-color: ${tag.color}; color: #000;">${tag.name}</span>`
                        : `<span class="note-tag" style="background-color: #cccccc; color: #000;">${tagId}</span>`;
            }).join('');

            const editButton = `<button class="small edit-tags-btn" data-action="edit-tags" data-note-id="${note.id}">Edit Tags</button>`;
            const editNoteButton = `<button class="small edit-note-btn" data-action="edit-note" data-note-id="${note.id}">Edit Note</button>`;

            const editedIndicator = note.lastEdited ? 
                `<div class="note-edited">Last edited by ${note.lastEditedBy || 'unknown'} at ${new Date(note.lastEdited).toLocaleTimeString()}</div>` : '';

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
                                    <span class="comment-user">${comment.user}</span>
                                    <span class="comment-time">
                                        ${formatCommentTime(comment.timestamp)}
                                        ${comment.lastEdited ? `(edited by ${comment.lastEditedBy || 'unknown'} at ${new Date(comment.lastEdited).toLocaleTimeString()})` : ''}
                                    </span>
                                </div>
                                <div class="comment-text">
                                    <span class="comment-text-display">${comment.text}</span>
                                    <textarea class="comment-text-edit" style="display: none">${comment.text}</textarea>
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
                <div class="note-item" data-tags="${note.tags.join(',')}" data-act="${note.act || 'Preshow'}">
                    <div class="note-header">
                        <span class="note-act">${note.act || 'Preshow'}</span>
                        <span class="note-user">${note.user}</span>
                        <span class="note-timecode">
                            ${timecodeDisplay} 
                            <span class="note-lx-cue">LX: ${note.lxCue || 'N/A'}</span>
                            @ ${note.frameRate || '30 fps'}
                        </span>
                    </div>
                    <div class="note-text">
                        <span class="note-text-display">${note.text}</span>
                        <textarea class="note-text-edit" style="display: none">${note.text}</textarea>
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
        }).join('');

        updateActFilter();
        filterNotes();

        // No more individual event listeners here!
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
    
    function timecodeToSeconds(tc) {
        if (!tc) return 0;
        const hours = tc.hours || 0;
        const minutes = tc.minutes || 0;
        const seconds = tc.seconds || 0;
        const frames = tc.frames || 0;
        const frameRate = tc.frameRate || 30;
        
        return hours * 3600 + minutes * 60 + seconds + frames / frameRate;
    }            
    // Chat functionality
    function updateChatMessages() {
        chatCount.textContent = `${chatMessagesList.length} shitpost${chatMessagesList.length !== 1 ? 's' : ''}`;
        
        if (chatMessagesList.length === 0) {
            chatMessages.innerHTML = '<div style="text-align: center; opacity: 0.7; padding: 2rem;">No chat messages yet. Start the conversation!</div>';
            return;
        }
        
        // Sort by timestamp (oldest first) - FIXED
        const sortedMessages = [...chatMessagesList].sort((a, b) => 
            new Date(a.timestamp) - new Date(b.timestamp)
        );
        
        chatMessages.innerHTML = sortedMessages.map(msg => {
            const time = new Date(msg.timestamp);
            const timeString = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            return `
                <div class="chat-message">
                    <div class="chat-message-header">
                        <span class="chat-message-user">${msg.user}</span>
                        <span class="chat-message-time">${timeString}</span>
                    </div>
                    <div class="chat-message-text">${msg.text}</div>
                </div>
            `;
        }).join('');
        
        // Auto-scroll to bottom to show latest messages - FIXED
        setTimeout(() => {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }, 100);
    }

    // Chat input handling
    chatInput.addEventListener('input', function() {
        sendChatBtn.disabled = chatInput.value.trim().length === 0;
    });

    chatInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && e.ctrlKey) {
            sendChatMessage();
        }
    });

    sendChatBtn.addEventListener('click', sendChatMessage);

    // Delegate clicks on the notes list
    notesList.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button) return;

        const action = button.dataset.action;
        if (!action) return;

        const noteId = button.dataset.noteId;

        // --- Edit Tags ---
        if (action === 'edit-tags') {
            const note = allNotes.find(n => n.id === noteId);
            if (note) {
                currentlyEditingNoteId = noteId;
                updateEditTagsDisplay(note.tags);
                editTagsModal.style.display = 'flex';
            }
        }

        // --- Toggle Comments ---
        if (action === 'toggle-comments') {
            const commentsContainer = document.getElementById(`comments-${noteId}`);
            const commentInputArea = document.getElementById(`comment-input-${noteId}`);
            if (commentsContainer.classList.contains('expanded')) {
                commentsContainer.classList.remove('expanded');
                commentInputArea.classList.remove('expanded');
                button.classList.remove('expanded');
                expandedCommentSections.delete(noteId);
            } else {
                commentsContainer.classList.add('expanded');
                commentInputArea.classList.add('expanded');
                button.classList.add('expanded');
                expandedCommentSections.add(noteId);
            }
        }

        // --- Edit Note (toggle edit mode) ---
        if (action === 'edit-note') {
            const noteItem = button.closest('.note-item');
            const display = noteItem.querySelector('.note-text-display');
            const textarea = noteItem.querySelector('.note-text-edit');
            if (display.style.display !== 'none') {
                // Switch to edit mode
                display.style.display = 'none';
                textarea.style.display = 'block';
                textarea.focus();
                button.textContent = 'Save Note';
                button.dataset.action = 'save-note'; // Change action for next click
            } else {
                // Already in edit mode – treat as save (should not happen because button now has action 'save-note')
            }
        }

        // --- Save Note (after editing) ---
        if (action === 'save-note') {
            const noteItem = button.closest('.note-item');
            const display = noteItem.querySelector('.note-text-display');
            const textarea = noteItem.querySelector('.note-text-edit');
            const newText = textarea.value.trim();
            if (newText && newText !== display.textContent) {
                window.socket.emit('note-edit-text', {
                    noteId: noteId,
                    newText: newText
                });
            }
            // Switch back to view mode
            display.textContent = newText || display.textContent; // fallback to old if empty
            display.style.display = 'block';
            textarea.style.display = 'none';
            button.textContent = 'Edit Note';
            button.dataset.action = 'edit-note';
        }

        // --- Edit Comment ---
        if (action === 'edit-comment') {
            const commentId = button.dataset.commentId;
            const commentItem = button.closest('.comment-item');
            const display = commentItem.querySelector('.comment-text-display');
            const textarea = commentItem.querySelector('.comment-text-edit');
            const editBtn = commentItem.querySelector('[data-action="edit-comment"]');
            const deleteBtn = commentItem.querySelector('[data-action="delete-comment"]');
            const saveBtn = commentItem.querySelector('[data-action="save-comment"]');
            const cancelBtn = commentItem.querySelector('[data-action="cancel-comment"]');

            display.style.display = 'none';
            textarea.style.display = 'block';
            textarea.focus();
            editBtn.style.display = 'none';
            deleteBtn.style.display = 'none';
            saveBtn.style.display = 'inline-block';
            cancelBtn.style.display = 'inline-block';
        }

        // --- Save Comment ---
        if (action === 'save-comment') {
            const commentId = button.dataset.commentId;
            const commentItem = button.closest('.comment-item');
            const display = commentItem.querySelector('.comment-text-display');
            const textarea = commentItem.querySelector('.comment-text-edit');
            const newText = textarea.value.trim();
            if (newText) {
                window.socket.emit('comment-edit', {
                    noteId: noteId,
                    commentId: commentId,
                    newText: newText
                });
            }
            // Switch back to view mode
            display.style.display = 'block';
            textarea.style.display = 'none';
            // Hide save/cancel, show edit/delete
            const editBtn = commentItem.querySelector('[data-action="edit-comment"]');
            const deleteBtn = commentItem.querySelector('[data-action="delete-comment"]');
            const saveBtn = commentItem.querySelector('[data-action="save-comment"]');
            const cancelBtn = commentItem.querySelector('[data-action="cancel-comment"]');
            editBtn.style.display = 'inline-block';
            deleteBtn.style.display = 'inline-block';
            saveBtn.style.display = 'none';
            cancelBtn.style.display = 'none';
        }

        // --- Cancel Comment Edit ---
        if (action === 'cancel-comment') {
            const commentId = button.dataset.commentId;
            const commentItem = button.closest('.comment-item');
            const display = commentItem.querySelector('.comment-text-display');
            const textarea = commentItem.querySelector('.comment-text-edit');
            // Reset textarea to original value
            textarea.value = display.textContent;
            display.style.display = 'block';
            textarea.style.display = 'none';
            const editBtn = commentItem.querySelector('[data-action="edit-comment"]');
            const deleteBtn = commentItem.querySelector('[data-action="delete-comment"]');
            const saveBtn = commentItem.querySelector('[data-action="save-comment"]');
            const cancelBtn = commentItem.querySelector('[data-action="cancel-comment"]');
            editBtn.style.display = 'inline-block';
            deleteBtn.style.display = 'inline-block';
            saveBtn.style.display = 'none';
            cancelBtn.style.display = 'none';
        }

        // --- Delete Comment ---
        if (action === 'delete-comment') {
            const commentId = button.dataset.commentId;
            if (confirm('Are you sure you want to delete this comment?')) {
                window.socket.emit('comment-delete', {
                    noteId: noteId,
                    commentId: commentId
                });
            }
        }

        // --- Submit Comment ---
        if (action === 'submit-comment') {
            const commentInput = document.querySelector(`.comment-input[data-note-id="${noteId}"]`);
            const text = commentInput.value.trim();
            if (text) {
                window.socket.emit('comment-submit', {
                    noteId: noteId,
                    text: text
                });
                commentInput.value = '';
                // Disable submit button
                button.disabled = true;
                // Ensure comments stay expanded
                expandedCommentSections.add(noteId);
            }
        }

        // --- Cancel Comment Input (clears text) ---
        if (action === 'cancel-comment-input') {
            const commentInput = document.querySelector(`.comment-input[data-note-id="${noteId}"]`);
            commentInput.value = '';
            const submitBtn = document.querySelector(`[data-action="submit-comment"][data-note-id="${noteId}"]`);
            if (submitBtn) submitBtn.disabled = true;
        }
    });

    // Delegate input events on the notes list (for comment input enable/disable)
    notesList.addEventListener('input', (e) => {
        const target = e.target;
        if (target.dataset.action === 'comment-input') {
            const noteId = target.dataset.noteId;
            const submitBtn = document.querySelector(`[data-action="submit-comment"][data-note-id="${noteId}"]`);
            if (submitBtn) {
                submitBtn.disabled = target.value.trim().length === 0;
            }
        }
    });

    // Delegate keydown on the notes list (for comment Enter-to-submit)
    notesList.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            const target = e.target;
            if (target.dataset.action === 'comment-input') {
                e.preventDefault(); // Prevent newline
                const noteId = target.dataset.noteId;
                const submitBtn = document.querySelector(`[data-action="submit-comment"][data-note-id="${noteId}"]`);
                if (submitBtn && !submitBtn.disabled) {
                    submitBtn.click();
                }
            }
        }
    });

    function sendChatMessage() {
        const messageText = chatInput.value.trim();
        if (messageText) {
            window.socket.emit('chat-message', {
                text: messageText
            });
            
            chatInput.value = '';
            sendChatBtn.disabled = true;
        }
    }

    // Update chat username when name changes
    function updateChatUserName() {
        chatUserName.textContent = currentUser.name;
    }

    function updateActFilter() {
        // Get unique acts from all notes
        const uniqueActs = [...new Set(allNotes.map(note => note.act))];
        
        const actFilterContainer = document.getElementById('actFilter');
        actFilterContainer.innerHTML = '<div class="filter-tag active" data-act="all">All Acts</div>';
        
        uniqueActs.forEach(act => {
            const actElement = `
                <div class="filter-tag" data-act="${act}">${act}</div>
            `;
            actFilterContainer.innerHTML += actElement;
        });
        
        // Re-attach event listeners
        document.querySelectorAll('.act-filter .filter-tag').forEach(tag => {
            tag.addEventListener('click', function() {
                const actValue = this.getAttribute('data-act');
                filterAct = actValue;
                
                document.querySelectorAll('.act-filter .filter-tag').forEach(t => t.classList.remove('active'));
                this.classList.add('active');
                
                filterNotes();
            });
        });
    }
    
    // Initial state
    startNameTimeout();
    updateGlobalTimecodeDisplay(currentGlobalTimecode);
    updatePersonalTimecodeDisplay(currentGlobalTimecode);
    updateGlobalLxCueDisplay(currentGlobalLxCue);
    updatePersonalLxCueDisplay(currentGlobalLxCue);
});