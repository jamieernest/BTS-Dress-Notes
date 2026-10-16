// All the JavaScript code remains exactly the same as in the previous version
// Only the CSS has been changed for the background
document.addEventListener('DOMContentLoaded', function() {
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');
    const fileInfo = document.getElementById('fileInfo');
    const fileName = document.getElementById('fileName');
    const fileType = document.getElementById('fileType');
    const fileNotesCount = document.getElementById('fileNotesCount');
    const filterTagsContainer = document.getElementById('filterTags');
    const filterActContainer = document.getElementById('recallActFilter');
    const notesList = document.getElementById('notesList');
    const totalNotes = document.getElementById('totalNotes');
    const filteredNotes = document.getElementById('filteredNotes');

    let allNotes = [];
    let availableTags = [];
    let filterTag = 'all';
    let filterAct = 'all';

    // Drag and drop functionality
    uploadArea.addEventListener('dragover', function(e) {
        e.preventDefault();
        uploadArea.classList.add('drag-over');
    });

    uploadArea.addEventListener('dragleave', function() {
        uploadArea.classList.remove('drag-over');
    });

    uploadArea.addEventListener('drop', function(e) {
        e.preventDefault();
        uploadArea.classList.remove('drag-over');

        if (e.dataTransfer.files.length) {
            handleFile(e.dataTransfer.files[0]);
        }
    });

    uploadArea.addEventListener('click', function() {
        fileInput.click();
    });

    fileInput.addEventListener('change', function() {
        if (fileInput.files.length) {
            handleFile(fileInput.files[0]);
        }
    });
    recallActFilter.addEventListener('click', function(e) {
        if (e.target.classList.contains('filter-tag')) {
            const actValue = e.target.getAttribute('data-act');
            filterAct = actValue;

            document.querySelectorAll('.act-filter .filter-tag').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');

            updateNotesList();
            updateStats();
        }
    });

    function handleFile(file) {
        const fileExtension = file.name.split('.').pop().toLowerCase();

        if (fileExtension !== 'json') {
            alert('Please select a JSON file');
            return;
        }

        fileName.textContent = file.name;
        fileType.textContent = fileExtension.toUpperCase();

        const reader = new FileReader();

        reader.onload = function(e) {
            try {
                if (fileExtension === 'json') {
                    const data = JSON.parse(e.target.result);
                    processJsonData(data);
                }
            } catch (error) {
                alert('Error parsing file: ' + error.message);
            }
        };

        reader.readAsText(file);
    }

    function processJsonData(data) {
        if (data.notes && Array.isArray(data.notes)) {
            allNotes = data.notes;
            fileNotesCount.textContent = allNotes.length;
            fileInfo.style.display = 'block';

            // Extract tags from notes
            extractTags();
            updateNotesList();
            updateFilterTags();
            updateFilterActs();
            updateStats();
        } else {
            alert('Invalid JSON format: Expected "notes" array');
        }
    }

    function parseTimecode(timecodeStr) {
        if (!timecodeStr) return { hours: 0, minutes: 0, seconds: 0, frames: 0 };

        const parts = timecodeStr.replace(/"/g, '').split(':');
        if (parts.length === 4) {
            return {
                hours: parseInt(parts[0]) || 0,
                minutes: parseInt(parts[1]) || 0,
                seconds: parseInt(parts[2]) || 0,
                frames: parseInt(parts[3]) || 0
            };
        }

        return { hours: 0, minutes: 0, seconds: 0, frames: 0 };
    }

    // Note text comes from other people (and the file from anywhere): see public/safe-html.js.
    const { escapeHtml, safeColour, setHtml } = SafeHtml;

    function extractTags() {
        availableTags = [];
        const tagMap = new Map();

        allNotes.forEach(note => {
            if (note.tags && Array.isArray(note.tags)) {
                note.tags.forEach(tag => {
                    if (typeof tag === 'string') {
                        if (!tagMap.has(tag)) {
                            tagMap.set(tag, {
                                id: tag,
                                name: tag,
                                color: getRandomColor()
                            });
                        }
                    } else if (tag.id && tag.name) {
                        if (!tagMap.has(tag.id)) {
                            tagMap.set(tag.id, {
                                id: tag.id,
                                name: tag.name,
                                color: tag.color || getRandomColor()
                            });
                        }
                    }
                });
            }
        });

        availableTags = Array.from(tagMap.values());
    }

    function updateFilterTags() {
        setHtml(filterTagsContainer, '<div class="filter-tag active" data-tag="all">All Notes</div>' + availableTags.map(tag => `
                <div class="filter-tag" data-tag="${escapeHtml(tag.id)}" style="background-color: ${safeColour(tag.color)}; color: #000;">
                    ${escapeHtml(tag.name)}
                </div>
            `).join(''));

        document.querySelectorAll('.filter-tag').forEach(tag => {
            tag.addEventListener('click', function() {
                const tagId = this.getAttribute('data-tag');
                filterTag = tagId;

                document.querySelectorAll('.filter-tag').forEach(t => t.classList.remove('active'));
                this.classList.add('active');

                updateNotesList();
                updateStats();
                updateFilterActs();
            });
        });
    }

    function updateFilterActs() {
        // Get unique acts from imported notes
        const uniqueActs = [...new Set(allNotes.map(note => note.act))];

        const actFilterContainer = document.getElementById('recallActFilter');
        setHtml(actFilterContainer, '<div class="filter-tag active" data-act="all">All Acts</div>' +
            uniqueActs.map(act => `<div class="filter-tag" data-act="${escapeHtml(act)}">${escapeHtml(act)}</div>`).join(''));
    }

    function updateNotesList() {
        if (allNotes.length === 0) {
            setHtml(notesList, '<div style="text-align: center; opacity: 0.7; padding: 2rem;">No notes to display</div>');
            return;
        }

        // Filter notes
        let filteredNotes = allNotes;
        if (filterTag !== 'all') {
            filteredNotes = allNotes.filter(note => 
                note.tags && note.tags.includes(filterTag)
            );
        }

        if (filterAct !== 'all') {
            filteredNotes = filteredNotes.filter(note => 
                note.act === filterAct
            );
        }
        // Newest first, as on the main page (the exported file stays oldest first)
        const chronologicalNotes = NoteOrder.newestFirst(filteredNotes);

        setHtml(notesList, chronologicalNotes.map(note => {
            const timecodeDisplay = formatTimecode(note.timecode);

            const tagElements = (note.tags || []).map(tagId => {
                const tag = availableTags.find(t => t.id === tagId);
                if (tag) {
                    return `<span class="note-tag" style="background-color: ${safeColour(tag.color)}; color: #000;">${escapeHtml(tag.name)}</span>`;
                }
                return `<span class="note-tag" style="background-color: #cccccc; color: #000;">${escapeHtml(tagId)}</span>`;
            }).join('');

            const commentElements = (note.comments || []).map(comment => {
                const commentTime = new Date(comment.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                return `
                    <div class="comment" style="background: rgba(255,255,255,0.1); padding: 0.5rem; border-radius: 5px; margin-top: 0.3rem; border-left: 2px solid rgba(76, 175, 80, 0.5);">
                        <div style="display: flex; justify-content: space-between; font-size: 0.8rem; opacity: 0.8; margin-bottom: 0.2rem;">
                            <span style="font-weight: bold; color: #4CAF50;">${escapeHtml(comment.user)}</span>
                            <span>${escapeHtml(commentTime)}</span>
                        </div>
                        <div style="font-size: 0.9rem;">${escapeHtml(comment.text)}</div>
                    </div>
                `;
            }).join('');

            return `
                <div class="note-item" data-tags="${escapeHtml((note.tags || []).join(','))}" data-act="${escapeHtml(note.act || 'Act 1')}">
                    <div class="note-header">
                        <span class="note-user">${escapeHtml(note.user)}</span>
                        <span class="note-timecode">
                            ${escapeHtml(timecodeDisplay)}
                            <span class="note-lx-cue">LX: ${escapeHtml(note.lxCue || 'N/A')}</span>
                            @ ${escapeHtml(note.frameRate || '30 fps')}
                        </span>
                        <span class="note-act">${escapeHtml(note.act || 'Act 1')}</span>
                    </div>
                    <div class="note-text">${escapeHtml(note.text)}</div>
                    ${(note.tags || []).length > 0 ? `<div class="note-tags">${tagElements}</div>` : ''}
                    ${(note.comments || []).length > 0 ? `
                        <div class="comments-section" style="margin-top: 1rem;">
                            <div style="font-size: 0.9rem; opacity: 0.8; margin-bottom: 0.5rem;">Comments:</div>
                            ${commentElements}
                        </div>
                    ` : ''}
                </div>
            `;
        }).join(''));
    }

    function updateStats() {
        totalNotes.textContent = `Total: ${allNotes.length} notes`;

        let filteredNotes = allNotes;
        if (filterTag !== 'all') {
            filteredNotes = filteredNotes.filter(note => 
                note.tags && note.tags.includes(filterTag)
            );
        }
        if (filterAct !== 'all') {
            filteredNotes = filteredNotes.filter(note => 
                note.act === filterAct
            );
        }

        filteredNotes.textContent = `Showing notes`;
    }

    function formatTimecode(tc) {
        if (!tc || typeof tc !== 'object') {
            return '00:00:00:00';
        }
        return `${(tc.hours || 0).toString().padStart(2, '0')}:${(tc.minutes || 0).toString().padStart(2, '0')}:${(tc.seconds || 0).toString().padStart(2, '0')}:${(tc.frames || 0).toString().padStart(2, '0')}`;
    }

    function updateActFilter() {
        // Get unique acts from imported notes
        const uniqueActs = [...new Set(allNotes.map(note => note.act))];

        const actFilterContainer = document.getElementById('recallActFilter');
        setHtml(actFilterContainer, '<div class="filter-tag active" data-act="all">All Acts</div>' +
            uniqueActs.map(act => `<div class="filter-tag" data-act="${escapeHtml(act)}">${escapeHtml(act)}</div>`).join(''));

        // Re-attach event listeners
        document.querySelectorAll('.act-filter .filter-tag').forEach(tag => {
            tag.addEventListener('click', function() {
                const actValue = this.getAttribute('data-act');
                filterAct = actValue;

                document.querySelectorAll('.act-filter .filter-tag').forEach(t => t.classList.remove('active'));
                this.classList.add('active');

                updateNotesList();
                updateStats();
            });
        });
    }

    function getRandomColor() {
        const colors = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', 
            '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
            '#E63946', '#F4A261', '#9B5DE5', '#00B4D8',
            '#06D6A0', '#118AB2', '#8AC926', '#FF6F91'
        ];
        return colors[Math.floor(Math.random() * colors.length)];
    }
});
