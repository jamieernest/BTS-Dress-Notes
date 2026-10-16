// Reads a notes file exported from the main page ("Download notes (JSON)") and shows it the same way,
// read-only, with search and scene/tag filters. Nothing is sent to the server.
document.addEventListener('DOMContentLoaded', function() {
    const $ = id => document.getElementById(id);
    const fileInput = $('fileInput');
    const dropZone = $('dropZone');
    const fileError = $('fileError');
    const notesSection = $('notesSection');
    const fileInfo = $('fileInfo');
    const searchInput = $('searchInput');
    const sceneFilter = $('sceneFilter');
    const tagFilter = $('tagFilter');
    const notesCount = $('notesCount');
    const clearFiltersBtn = $('clearFilters');
    const notesList = $('notesList');
    const notesNoMatch = $('notesNoMatch');

    // Note text comes from other people (and the file from anywhere): see public/safe-html.js.
    const { escapeHtml: esc, setHtml } = SafeHtml;
    const safeColor = (color) => SafeHtml.safeColour(color, '#8a8f98');

    let allNotes = [];
    let tagsById = new Map();

    // --- Opening a file ---
    function showError(message) {
        fileError.textContent = message;
        fileError.hidden = false;
    }

    function openFile(file) {
        if (!file) return;
        fileError.hidden = true;
        if (!/\.json$/i.test(file.name)) {
            showError(`"${file.name}" isn't a notes file. Choose the .json file downloaded from the notes page.`);
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            let data;
            try {
                data = JSON.parse(reader.result);
            } catch (error) {
                showError(`"${file.name}" couldn't be read. It may be damaged or not a notes file.`);
                return;
            }
            if (!data || !Array.isArray(data.notes)) {
                showError(`"${file.name}" has no notes in it. Choose the file downloaded from the notes page.`);
                return;
            }
            load(file.name, data);
        };
        reader.onerror = () => showError(`"${file.name}" couldn't be opened.`);
        reader.readAsText(file);
    }

    $('chooseFile').addEventListener('click', () => fileInput.click());
    $('openAnother').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
        openFile(fileInput.files[0]);
        fileInput.value = '';
    });

    // Dropping works anywhere on the page, not only on the box.
    document.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });
    document.addEventListener('dragleave', (e) => {
        if (!e.relatedTarget) dropZone.classList.remove('drag-over');
    });
    document.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        openFile(e.dataTransfer.files[0]);
    });

    // --- Loaded notes ---
    function hashHue(text) {
        let h = 0;
        for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        return h % 360;
    }

    function initials(name) {
        const parts = String(name || '?').trim().split(/\s+/);
        return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
    }

    // Same colours as the notes page, so a person looks the same on both.
    function avatarHTML(key, name, extraClass) {
        return `<span class="avatar${extraClass ? ` ${extraClass}` : ''}" style="background:hsl(${hashHue(key)}, 45%, 42%)" aria-hidden="true">${esc(initials(name))}</span>`;
    }

    function load(name, data) {
        allNotes = data.notes.filter(note => note && typeof note === 'object').map(note => ({
            ...note,
            text: String(note.text || ''),
            user: String(note.user || 'Unknown'),
            act: String(note.act || 'Preshow'),
            tags: Array.isArray(note.tags) ? note.tags.filter(tag => typeof tag === 'string') : [],
            comments: Array.isArray(note.comments) ? note.comments.filter(c => c && typeof c === 'object') : []
        }));

        // Newer files carry the tag list with names and colours; older ones only the ids on each note.
        tagsById = new Map();
        (Array.isArray(data.tags) ? data.tags : []).forEach(tag => {
            if (tag && tag.id) tagsById.set(tag.id, { id: tag.id, name: String(tag.name || tag.id), color: tag.color });
        });
        allNotes.forEach(note => note.tags.forEach(id => {
            if (!tagsById.has(id)) tagsById.set(id, { id, name: id, color: `hsl(${hashHue(id)}, 55%, 60%)` });
        }));

        const exported = data.exportedAt ? new Date(data.exportedAt) : null;
        const parts = [name];
        if (exported && !isNaN(exported)) parts.push(`exported ${exported.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`);
        parts.push(`${allNotes.length} ${allNotes.length === 1 ? 'note' : 'notes'}`);
        fileInfo.textContent = parts.join(' · ');

        const scenes = [...new Set(allNotes.map(note => note.act))];
        fillSelect(sceneFilter, [['all', 'All scenes'], ...scenes.map(scene => [scene, scene])]);
        const usedTags = [...tagsById.values()].filter(tag => allNotes.some(note => note.tags.includes(tag.id)));
        fillSelect(tagFilter, [['all', 'All tags'], ...usedTags.map(tag => [tag.id, tag.name])]);
        searchInput.value = '';

        dropZone.hidden = true;
        notesSection.hidden = false;
        $('openAnother').hidden = false;
        render();
    }

    function fillSelect(select, options) {
        select.replaceChildren(...options.map(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            return option;
        }));
        select.value = 'all';
    }

    function pad(n) {
        return String(n || 0).padStart(2, '0');
    }

    function formatNoteTimecode(note) {
        const tc = note.timecode && typeof note.timecode === 'object' ? note.timecode : {};
        const base = `${pad(tc.hours)}:${pad(tc.minutes)}:${pad(tc.seconds)}`;
        return note.frameRate === 'ms' ? base : `${base}:${pad(tc.frames)}`;
    }

    function clockTime(timestamp) {
        const date = new Date(timestamp);
        return isNaN(date) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function matches(note) {
        if (sceneFilter.value !== 'all' && note.act !== sceneFilter.value) return false;
        if (tagFilter.value !== 'all' && !note.tags.includes(tagFilter.value)) return false;
        const query = searchInput.value.trim().toLowerCase();
        if (!query) return true;
        const haystack = [note.text, note.user, note.lxCue, note.act,
            ...note.tags.map(id => (tagsById.get(id) || {}).name),
            ...note.comments.map(c => `${c.user} ${c.text}`)].join(' ').toLowerCase();
        return haystack.includes(query);
    }

    function noteHTML(note) {
        const rate = note.frameRate === 'ms' ? 'real time' : `${note.frameRate || 30} fps`;
        const title = note.timestamp ? `${rate} · sent ${new Date(note.timestamp).toLocaleString()}` : rate;
        const chips = note.tags.map(id => {
            const tag = tagsById.get(id);
            return `<span class="chip" style="--tag: ${safeColor(tag.color)}"><span class="dot"></span>${esc(tag.name)}</span>`;
        }).join('');
        const comments = note.comments.map(comment => `
            <div class="comment">
                ${avatarHTML(comment.userId || comment.user, comment.user, 'sm')}
                <div class="comment-main">
                    <div class="comment-head">
                        <span class="comment-user">${esc(comment.user)}</span>
                        <span>${esc(clockTime(comment.timestamp))}</span>
                    </div>
                    <div class="comment-text">${esc(comment.text)}</div>
                </div>
            </div>`).join('');
        const edited = note.lastEdited
            ? `<div class="note-edited">Edited by ${esc(note.lastEditedBy || 'unknown')} at ${esc(clockTime(note.lastEdited))}</div>` : '';
        return `
            <article class="note">
                ${avatarHTML(note.userId || note.user, note.user)}
                <div class="note-main">
                    <div class="note-head">
                        <span class="note-author">${esc(note.user)}</span>
                        <span class="note-cue">Cue ${esc(note.lxCue || '–')}</span>
                        <span class="note-tc mono" title="${esc(title)}">${esc(formatNoteTimecode(note))}</span>
                    </div>
                    <div class="note-text">${esc(note.text)}</div>
                    ${edited}
                    ${chips ? `<div class="note-foot">${chips}</div>` : ''}
                    ${comments ? `<div class="comments">${comments}</div>` : ''}
                </div>
            </article>`;
    }

    // Newest first and grouped by scene, as on the notes page (the file itself stays oldest first).
    function render() {
        const shown = NoteOrder.newestFirst(allNotes.filter(matches));
        let html = '';
        let lastScene = null;
        shown.forEach(note => {
            if (note.act !== lastScene) {
                html += `<div class="group-head"><span>${esc(note.act)}</span></div>`;
                lastScene = note.act;
            }
            html += noteHTML(note);
        });
        setHtml(notesList, html);

        const filtered = sceneFilter.value !== 'all' || tagFilter.value !== 'all' || searchInput.value.trim() !== '';
        sceneFilter.classList.toggle('active', sceneFilter.value !== 'all');
        tagFilter.classList.toggle('active', tagFilter.value !== 'all');
        clearFiltersBtn.hidden = !filtered;
        notesNoMatch.hidden = shown.length > 0 || allNotes.length === 0;
        notesCount.textContent = filtered
            ? `${shown.length} of ${allNotes.length} notes`
            : `${allNotes.length} ${allNotes.length === 1 ? 'note' : 'notes'}`;
    }

    function clearFilters() {
        sceneFilter.value = 'all';
        tagFilter.value = 'all';
        searchInput.value = '';
        render();
    }

    searchInput.addEventListener('input', render);
    sceneFilter.addEventListener('change', render);
    tagFilter.addEventListener('change', render);
    clearFiltersBtn.addEventListener('click', clearFilters);
    notesNoMatch.querySelector('[data-action="clear-filters"]').addEventListener('click', clearFilters);
});
