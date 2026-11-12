// Shows past notes the way the notes page does, read-only, with search and
// scene/tag filters: either a show saved on the server from the settings page
// (/shows, saved-shows.js), or a notes file exported from the main page
// ("Download notes (JSON)"), which is read here and never sent anywhere.
// A saved show and its filters are kept in the URL, so a reload stays on it.
document.addEventListener('DOMContentLoaded', function() {
    const $ = id => document.getElementById(id);
    const fileInput = $('fileInput');
    const dropZone = $('dropZone');
    const fileError = $('fileError');
    const notesSection = $('notesSection');
    const searchInput = $('searchInput');
    const actFilter = $('actFilter');
    const tagFilter = $('tagFilter');
    const notesCount = $('notesCount');
    const clearFiltersBtn = $('clearFilters');
    const notesList = $('notesList');
    const notesNoMatch = $('notesNoMatch');
    const savedShows = $('savedShows');
    const showName = $('showName');
    const pageTitle = document.title;

    // Drawn with the notes page's own templates (public/note-view.js). Note text
    // comes from other people, and the file from anywhere: everything is escaped.
    const { setHtml, plural } = NoteView;

    let allNotes = [];
    let showLog = [];
    let tagsById = new Map();
    const tagById = (id) => tagsById.get(id) || NoteView.unknownTag(id);
    const filters = { act: 'all', tag: 'all', search: '', author: '', mentionedUserId: '' };
    let currentAccountId = null;
    let currentAccountName = null;
    let currentAccountUsername = null;
    const me = () => ({ emailPrefix: currentAccountUsername });
    NoteView.watchNavigation();
    // Scene headers stick just below the toolbar, so they need its real height (as on the notes page).
    const notesToolbar = document.querySelector('#notesSection > .toolbar');
    new ResizeObserver(() => document.documentElement.style.setProperty('--toolbar-h', `${notesToolbar.offsetHeight}px`)).observe(notesToolbar);
    const filterDropdown = (button, popover, key) => NoteView.createDropdown({
        button, popover,
        beforeOpen: () => { actDropdown.close(); tagDropdown.close(); authorSearch.close(); },
        onChange: (value) => {
            filters[key] = value;
            render();
            keepInUrl();
        }
    });
    const actDropdown = filterDropdown(actFilter, $('actFilterPopover'), 'act');
    const tagDropdown = filterDropdown(tagFilter, $('tagFilterPopover'), 'tag');
    const authorSearch = NoteView.createAuthorSearch({ input: searchInput, chip: $('authorFilter'), mentionChip: $('mentionedFilter'),
        getCurrentUserId: () => currentAccountId, getCurrentUserName: () => currentAccountName,
        popover: $('authorSuggestions'), filters, getNotes: () => allNotes,
        beforeOpen: () => { actDropdown.close(); tagDropdown.close(); },
        onChange: () => { render(); keepInUrl(); } });
    window.addEventListener('scroll', () => { actDropdown.reposition(); tagDropdown.reposition(); }, { passive: true });
    fetch('/session', { cache: 'no-store' }).then(response => response.ok ? response.json() : null).then(user => {
        currentAccountId = typeof user?.sub === 'string' && user.sub ? user.sub : null;
        currentAccountName = typeof user?.name === 'string' ? user.name : null;
        currentAccountUsername = typeof user?.emailPrefix === 'string' && user.emailPrefix ? user.emailPrefix : null;
        authorSearch.refresh();
        if (!notesSection.hidden) render();
    }).catch(() => { /* The identity shortcut remains absent until a fresh page load. */ });
    let scenes = [];
    let usedTags = [];
    let openShowId = null; // the saved show on screen; null for a file or the chooser
    let fileKey = null;
    const source = () => openShowId ? { show: openShowId } : { file: fileKey };
    const playbackHref = noteId => PlaybackContext.playbackUrl(source(), noteId, location.pathname + location.search);

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
            openShowId = null;
            fileKey = PlaybackContext.saveFile(data, file.name, sessionStorage, PlaybackContext.newFileKey());
            if (!fileKey) {
                showError('There is not enough space to keep this file open between views. Try a smaller notes file.');
                return;
            }
            history.replaceState(null, '', `?file=${encodeURIComponent(fileKey)}`);
            load(data);
            showName.textContent = file.name;
            showName.hidden = false;
            document.title = `${file.name} · ${pageTitle}`;
        };
        reader.onerror = () => showError(`"${file.name}" couldn't be opened.`);
        reader.readAsText(file);
    }

    $('chooseFile').addEventListener('click', () => fileInput.click());
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

    // --- Saved shows ---
    const params = new URLSearchParams(location.search);

    function showSavedList(shows) {
        const date = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
        setHtml($('savedShowsList'), shows.map(show => `
            <a class="saved-show" href="?show=${encodeURIComponent(show.id)}">
                <span class="saved-show-name">${NoteView.esc(show.name)}</span>
                <span class="muted">${NoteView.esc(date(show.savedAt))} · ${NoteView.esc(plural(show.totalNotes, 'note'))}${show.recordingParts ? ' · <i data-icon="video" data-class="saved-show-video"></i> Video' : ''}</span>
            </a>`).join(''));
        savedShows.hidden = shows.length === 0;
    }

    async function getJson(url) {
        const res = await fetch(url, { headers: { accept: 'application/json' } });
        if (res.status === 401) {
            window.location.href = loginUrl();
            return null;
        }
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
    }

    async function openShow(id) {
        dropZone.hidden = true;
        const loading = createLoadingState($('showLoading'));
        try {
            const data = await getJson(`/shows/${encodeURIComponent(id)}`);
            if (!data) return;
            await loading.finish();
            openShowId = id;
            load(data, { act: params.get('scene'), tag: params.get('tag'), search: params.get('q'), author: params.get('author'), mentionedUserId: params.get('mentioned') });
            showName.textContent = data.name;
            showName.hidden = false;
            document.title = `${data.name} · ${pageTitle}`;
        } catch (error) {
            history.replaceState(null, '', location.pathname);
            dropZone.hidden = false;
            showError("That saved show couldn't be found. It may have been removed.");
            listShows();
        } finally {
            loading.finish({ immediate: true });
            document.documentElement.classList.remove('opening-show'); // see recall-boot.js
        }
    }

    async function listShows() {
        try {
            const shows = await getJson('/shows');
            if (shows) showSavedList(shows);
        } catch (error) {
            savedShows.hidden = true;
        }
    }

    // The open show and its filters, so a reload or a shared link shows the same.
    function keepInUrl() {
        if (!openShowId && !fileKey) return;
        const next = new URLSearchParams(source());
        NoteView.writeFilters(next, filters, searchInput.value);
        history.replaceState(null, '', `?${next}${location.hash}`);
        $('playbackLink').href = playbackHref();
        notesList.querySelectorAll('.note-playback').forEach(link => {
            link.href = playbackHref(link.closest('[data-note-id]').dataset.noteId);
        });
    }

    // --- Loaded notes ---
    // `start` is the filters to open with (from the URL); one that matches nothing in this file is dropped.
    function load(data, start = {}) {
        showLog = Array.isArray(data.showLog) ? data.showLog : [];
        allNotes = data.notes.filter(note => note && typeof note === 'object').map(note => ({
            ...note,
            userId: NoteView.storedAuthorId(note, data.authors),
            text: String(note.text || ''),
            user: String(note.user || 'Unknown'),
            act: String(note.act || 'Preshow'),
            tags: Array.isArray(note.tags) ? note.tags.filter(tag => typeof tag === 'string') : [],
            comments: Array.isArray(note.comments) ? note.comments.filter(c => c && typeof c === 'object') : []
        }));

        NoteNumbers.migrate(allNotes, data.nextNoteNumber);

        // Newer files carry the tag list with names and colours; older ones only the ids on each note.
        tagsById = new Map();
        (Array.isArray(data.tags) ? data.tags : []).forEach(tag => {
            if (tag && tag.id) tagsById.set(tag.id, { id: tag.id, name: String(tag.name || tag.id), color: tag.color });
        });
        scenes = [...new Set(allNotes.map(note => note.act))];
        // Only tags some note has, in the file's order, then any it doesn't list.
        const used = new Set(allNotes.flatMap(note => note.tags));
        usedTags = [...new Set([...tagsById.keys(), ...used])].filter(id => used.has(id)).map(tagById);

        filters.act = scenes.includes(start.act) || start.act === NoteView.MY_SCENES ? start.act : 'all';
        filters.tag = usedTags.some(tag => tag.id === start.tag) ? start.tag : 'all';
        filters.author = NoteView.authorOptions(allNotes).some(p => p.userId === start.author) ? start.author : '';
        filters.mentionedUserId = start.mentionedUserId || '';
        filters.search = (start.search || '').trim().toLowerCase();
        searchInput.value = start.search || '';

        dropZone.hidden = true;
        savedShows.hidden = true;
        notesSection.hidden = false;
        $('openAnother').hidden = false;
        $('playbackLink').hidden = false;
        $('playbackLink').href = playbackHref();
        render();
        PlaybackContext.restoreNote(notesList);
    }

    function noteHTML(note) {
        return NoteView.noteHTML(note, {
            attrs: `data-note-id="${NoteView.esc(note.id)}"`,
            side: `<span class="row-actions">${NoteView.playbackLinkHTML(playbackHref(note.id))}</span>`,
            foot: NoteView.tagChipsHTML(note.tags, tagById),
            thread: note.comments.map(comment => NoteView.commentHTML(comment)).join('')
        });
    }

    // Newest first and grouped by scene with counts, as on the notes page (the file itself stays oldest first).
    function render() {
        authorSearch.refresh();
        actDropdown.render(NoteView.sceneOptions(scenes, currentAccountUsername), filters.act);
        actFilter.hidden = scenes.length < 2;
        tagDropdown.render(NoteView.tagOptions(usedTags), filters.tag);
        tagFilter.hidden = usedTags.length === 0;

        // Group the full list first so filtering cannot move scene headings.
        const sceneTimes = NoteView.sceneStartTimes(allNotes, showLog);
        const allGroups = NoteView.groupNotes(NoteOrder.newestFirst(allNotes));
        const starts = NoteView.groupStartTimes(allGroups, sceneTimes);
        const groups = allGroups
            .map((group, i) => ({ act: group.act, at: starts[i], notes: group.notes.filter(note => NoteView.noteMatches(note, filters, tagById, currentAccountUsername)) }))
            .filter(group => group.notes.length);
        const shown = groups.flatMap(group => group.notes);
        setHtml(notesList, groups.map(group => NoteView.groupHeadHTML(group.act, group.at, '', Mentions.accounts(allNotes, [], []), me()) + group.notes.map(noteHTML).join('')).join(''));
        notesList.querySelectorAll('.group-head').forEach(head => { head.setAttribute('role', 'button'); head.tabIndex = 0; head.title = 'Scroll to the start of this scene'; });
        notesList.querySelectorAll('.group-count').forEach((count, i) => { count.textContent = plural(groups[i].notes.length, 'note'); });

        const filtered = NoteView.filtersActive(filters);
        clearFiltersBtn.hidden = !filtered;
        notesNoMatch.hidden = shown.length > 0 || allNotes.length === 0;
        notesCount.textContent = filtered ? `${shown.length} of ${plural(allNotes.length, 'note')}` : '';
    }

    function clearFilters() {
        filters.act = 'all';
        filters.tag = 'all';
        filters.search = '';
        filters.author = '';
        filters.mentionedUserId = '';
        authorSearch.close();
        searchInput.value = '';
        render();
        keepInUrl();
    }

    searchInput.addEventListener('input', () => {
        filters.search = searchInput.value.trim().toLowerCase();
        render();
        keepInUrl();
    });
    // A scene heading scrolls to the first note of its visit (newest first here), under the pinned heading.
    function goToSceneStart(head) {
        const rows = [...notesList.children];
        const row = rows[NoteView.visitStartRow(rows.map(el => ({ head: el.classList.contains('group-head') })), rows.indexOf(head), false)];
        if (!row) return;
        const pinned = (parseFloat(getComputedStyle(head).top) || 0) + head.offsetHeight;
        window.scrollBy({ top: row.getBoundingClientRect().top - pinned, behavior: 'smooth' });
    }
    notesList.addEventListener('click', (e) => { const head = e.target.closest('.group-head'); if (head) goToSceneStart(head); });
    notesList.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('group-head')) { e.preventDefault(); goToSceneStart(e.target); }
    });
    clearFiltersBtn.addEventListener('click', clearFilters);
    notesNoMatch.querySelector('[data-action="clear-filters"]').addEventListener('click', clearFilters);

    if (params.get('show')) openShow(params.get('show'));
    else if (params.get('file')) {
        fileKey = params.get('file');
        const data = PlaybackContext.readFile(fileKey, sessionStorage);
        if (data) {
            load(data, { act: params.get('scene'), tag: params.get('tag'), search: params.get('q'), author: params.get('author'), mentionedUserId: params.get('mentioned') });
            showName.textContent = data.name || 'Notes file';
            showName.hidden = false;
        } else {
            fileKey = null;
            showError('That local notes file is no longer open in this tab. Choose it again to continue.');
            listShows();
        }
        document.documentElement.classList.remove('opening-show');
    } else listShows();
});
