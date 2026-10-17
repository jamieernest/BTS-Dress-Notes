// Plays a Vor recording with the notes written during it. Notes come from the
// live session, a saved show or a local file. The recording is either
// uploaded for those notes on the settings page (shared with everyone who
// opens them, recordings.js on the server) or chosen from this device, and may come in several parts:
// public/playback-program.js lays them out on one timeline with blank gaps
// where the recording stopped. Timing: public/playback-timeline.js.
document.addEventListener('DOMContentLoaded', function() {
    const $ = id => document.getElementById(id);
    const T = PlaybackTimeline;
    const P = PlaybackProgram;
    const { esc, setHtml, safeColor } = NoteView;
    const C = PlaybackContext;
    const params = new URLSearchParams(location.search);
    const demo = params.get('demo') === '1';
    let source = params.get('show') ? { show: params.get('show') }
        : params.get('file') ? { file: params.get('file') } : { source: 'live' };
    let returnTo = params.get('returnTo');
    let requestedNoteId = params.get('note');
    let socket = null;

    const video = $('video');
    const track = $('track');
    const hoverCard = $('hoverCard');

    const PREROLL_MS = 3000;       // jumping to a note starts this far before it
    const NO_TAG = '';             // filter key for notes from before every note had a tag
    const SAVE_TIMING_MS = 600;    // a shared part's new start is saved once the nudging stops

    let data = null;               // the notes file: { notes, tags, showLog }
    let tagsById = new Map();
    // The recording being watched. kind: 'shared' (uploaded for these notes),
    // 'local' (chosen on this device) or null. parts: { id, name, startAt (ms
    // or null), duration (s), url, ... }.
    let recording = { kind: null, collection: null, parts: [] };
    let sharedParts = [];          // the uploaded parts, even while watching a local video
    let program = P.layout([]);    // the parts on one timeline
    let videoStart = null;         // clock time of the timeline's start
    let duration = 0;              // the timeline's length, seconds
    let loadedId = null;           // the part in the <video>
    let loadTarget = null;         // seconds into it to start, while it loads
    let gapAt = null;              // timeline position while between parts (or past the end)
    let gapSince = 0;              // when gapAt last moved on, while playing
    let playing = false;           // whether playback should be running, across parts and gaps
    const broken = new Set();      // parts this browser can't play, treated as gaps
    const pendingStarts = new Map(); // shared part id -> start being saved, not yet echoed back
    const startTimers = new Map();
    let placed = [];               // notes in the video, in time order: { note, at }
    let placedAt = new Map();      // note id -> at, for the per-frame update
    let scenes = [];               // scene changes: { value, at }
    let cues = [];                 // LX cues, only when the file has them exactly
    let shownTags = new Set();     // tag filter; empty shows everything
    let selectedId = requestedNoteId;
    let currentId = null;
    let scrub = null;              // the active pointer press on the timeline
    let pendingSeek = null;        // timeline seconds to go to once the video finishes its current seek
    let cardPinned = false;        // taps and keyboard cue jumps keep details open
    let initialSelectionShown = false;

    // --- Opening files ---
    function showError(message) {
        $('fileError').textContent = message;
        $('fileError').hidden = false;
    }

    function updateNotesLink() {
        $('notesViewLink').href = C.notesUrl(source, selectedId, returnTo);
    }
    updateNotesLink();
    keepLoginAlive(() => { window.location.href = loginUrl(); });

    // Where these notes' uploaded recording lives: 'live', a saved show's id,
    // or null for a local notes file (nothing to share it with).
    const collection = () => (source.show ? source.show : source.source === 'live' && !demo ? 'live' : null);
    const { isVideo, probeDuration } = VideoFile;
    // Live notes and saved shows stay what they are; another notes file only
    // opens over a local one, or when nothing could be loaded.
    const canOpenNotes = () => !data || !!source.file;

    function openFiles(files) {
        $('demoBadge').hidden = true;
        $('fileError').hidden = true;
        const videos = [];
        for (const file of files) {
            if (/\.json$/i.test(file.name) && canOpenNotes()) openNotes(file);
            else if (isVideo(file)) videos.push(file);
            else showError(canOpenNotes() ? `"${file.name}" isn't a notes file or a video.` : `"${file.name}" isn't a video.`);
        }
        if (videos.length) openLocalVideos(videos);
    }

    function openNotes(file) {
        const reader = new FileReader();
        reader.onload = () => {
            let parsed;
            try { parsed = JSON.parse(reader.result); } catch (error) { parsed = null; }
            if (!parsed || !Array.isArray(parsed.notes)) {
                showError(`"${file.name}" isn't a notes file. Use "Download notes (JSON)" on the notes page.`);
                return;
            }
            const key = C.saveFile(parsed, file.name, sessionStorage, C.newFileKey());
            if (!key) {
                showError('There is not enough space to keep this file open between views. Try a smaller notes file.');
                return;
            }
            if (socket) socket.disconnect();
            socket = null;
            sharedParts = [];
            source = { file: key };
            returnTo = null;
            history.replaceState(null, '', C.playbackUrl(source));
            $('playbackTitle').textContent = file.name;
            updateNotesLink();
            loadNotes(parsed);
        };
        reader.onerror = () => showError(`"${file.name}" couldn't be opened.`);
        reader.readAsText(file);
    }

    function loadNotes(parsed, preserveFilters = false) {
        data = parsed;
        tagsById = new Map((data.tags || []).map(tag => [tag.id, tag]));
        scenes = T.changes(data, 'scene').list;
        const lx = T.changes(data, 'cue');
        cues = lx.exact ? lx.list : [];
        if (!preserveFilters) shownTags = new Set();
        setStatus('notesStatus', `${data.notes.length} notes`);
        $('openNotes').hidden = !canOpenNotes();
        ready();
    }

    // Videos from this device, as the parts of one recording. Vor's file
    // names carry when each part started.
    async function openLocalVideos(files) {
        requestedNoteId = selectedId || requestedNoteId;
        const parts = [];
        for (const file of files) {
            const url = URL.createObjectURL(file);
            try {
                const seconds = await probeDuration(url);
                parts.push({ id: `local-${C.newFileKey()}`, name: file.name, startAt: T.vorStartFromName(file.name), duration: seconds, url });
            } catch (error) {
                URL.revokeObjectURL(url);
                showError(`This browser can't play "${file.name}". Try Safari or Chrome.`);
            }
        }
        if (!parts.length) return;
        const name = parts[0].name;
        if (!data) document.title = `${T.vorTitleFromName(name) || name} · Playback`;
        setStatus('videoStatus', parts.length > 1 ? `${parts.length} video parts` : (T.vorTitleFromName(name) || name));
        setParts('local', parts);
        // Without a start time the notes can't be placed until it is matched by hand.
        setTimingOpen(!videoStart && !!data);
    }

    function setStatus(id, text) {
        $(id).textContent = text;
        $(id).classList.add('ready');
    }

    // --- The recording's parts ---
    const loadedSegment = () => program.segments.find(s => s.id === loadedId) || null;

    // Where playback is along the timeline, in seconds. While scrubbing, where
    // the pointer is rather than the frame still being fetched.
    function position() {
        if (pendingSeek !== null) return pendingSeek;
        if (gapAt !== null) return gapAt;
        const segment = loadedSegment();
        if (!segment) return 0;
        return Math.min(segment.end, segment.offset + (loadTarget !== null ? loadTarget : video.currentTime));
    }

    // What plays at `pos`, with parts this browser can't play counted as gaps.
    function place(pos) {
        const at = P.locate(program, pos);
        if (!at.segment || !broken.has(at.segment.id)) return at;
        return { segment: null, next: program.segments.find(s => s.offset > pos && !broken.has(s.id)) || null };
    }

    // Swaps in a new set of parts, keeping the place when the part playing stays.
    function setParts(kind, parts) {
        const before = position();
        for (const old of recording.parts) {
            if (old.url.startsWith('blob:') && !parts.some(p => p.url === old.url)) URL.revokeObjectURL(old.url);
        }
        recording = { kind: parts.length ? kind : null, collection: kind === 'shared' ? collection() : null, parts };
        relayout();
        if (loadedId && !loadedSegment()) unload();
        if (!loadedId && duration) seekTo(gapAt !== null ? gapAt : Math.min(before, duration));
        else if (!duration) { gapAt = null; playing = false; }
        ready();
    }

    function relayout() {
        program = P.layout(recording.parts);
        videoStart = program.origin;
        duration = program.total;
    }

    function unload() {
        loadedId = null;
        loadTarget = null;
        video.removeAttribute('src');
        video.load();
    }

    function load(segment, local) {
        loadedId = segment.id;
        loadTarget = local;
        gapAt = null;
        video.src = segment.url;
    }

    video.addEventListener('loadedmetadata', () => {
        if (loadTarget === null) return;
        const local = loadTarget;
        loadTarget = null;
        video.currentTime = local;
        if (pendingSeek !== null) flushSeek();
        else if (playing) video.play().catch(() => pause());
        update();
    });
    video.addEventListener('error', () => {
        const segment = loadedSegment();
        if (!segment || !video.getAttribute('src')) return;
        const at = position();
        broken.add(segment.id);
        showError(`This browser can't play "${segment.name}". Try Safari or Chrome.`);
        unload();
        pause();
        enterGap(at);
        renderGrid();
    });
    // The end of a part carries on into whatever comes after it.
    video.addEventListener('ended', () => {
        const segment = loadedSegment();
        if (segment && playing) partEnded(segment);
    });

    // Goes straight to `pos`: into a part (loading it if needed) or a gap.
    function moveTo(pos) {
        const at = place(pos);
        if (!at.segment) { enterGap(pos); return; }
        if (at.segment.id !== loadedId) { load(at.segment, at.local); return; }
        gapAt = null;
        video.currentTime = at.local;
        if (playing && video.paused) video.play().catch(() => pause());
    }

    // Between two parts the timeline still runs, over a blank screen.
    function enterGap(pos) {
        gapAt = Math.min(Math.max(0, pos), duration);
        gapSince = performance.now();
        if (!video.paused) video.pause();
        if (!place(gapAt).next && gapAt >= duration) playing = false;
        syncPlayState();
    }

    function play() {
        if (!duration) return;
        if (position() >= duration - 0.05) seekTo(0);
        playing = true;
        gapSince = performance.now();
        if (gapAt === null && loadTarget === null && pendingSeek === null && loadedId) video.play().catch(() => pause());
        syncPlayState();
    }

    function pause() {
        playing = false;
        if (!video.paused) video.pause();
        syncPlayState();
    }

    function togglePlayback() {
        if (playing) pause(); else play();
    }

    function syncPlayState() {
        video.setAttribute('aria-label', playing ? 'Pause video' : 'Play video');
    }

    video.addEventListener('click', togglePlayback);
    $('gapNotice').addEventListener('click', (e) => { if (!e.target.closest('button')) togglePlayback(); });
    $('skipGap').addEventListener('click', () => {
        const next = place(position()).next;
        if (next) seekTo(next.offset);
    });
    // Paused some other way (the system's media keys, picture in picture).
    video.addEventListener('pause', () => {
        if (playing && gapAt === null && loadTarget === null && !video.ended && !video.seeking) { playing = false; syncPlayState(); }
    });
    video.addEventListener('play', () => { if (!playing) { playing = true; syncPlayState(); } });

    // --- Shared recordings ---
    const fromServer = (part) => ({
        ...part,
        startAt: pendingStarts.has(part.id) ? pendingStarts.get(part.id) : (part.startAt ? Date.parse(part.startAt) : null),
        shared: true
    });

    function applyShared(list) {
        sharedParts = list.map(fromServer);
        if (recording.kind !== 'local') setParts('shared', sharedParts);
        else renderRecordingPanel();
    }

    async function getRecordings(col) {
        const response = await fetch(`/recordings/${encodeURIComponent(col)}`, { headers: { accept: 'application/json' }, cache: 'no-store' });
        if (response.status === 401) { window.location.href = loginUrl(); throw new Error('Login required'); }
        if (!response.ok) return [];
        const result = await response.json();
        return Array.isArray(result.recordings) ? result.recordings : [];
    }

    async function refreshShared() {
        const col = collection();
        if (!col) return;
        try {
            const list = await getRecordings(col);
            if (col === collection()) applyShared(list);
        } catch (_) { /* the next update or reconnect brings it */ }
    }

    // A hand-matched start on a shared part is kept for everyone.
    function saveStart(part) {
        if (recording.kind !== 'shared' || recording.collection !== collection()) return;
        pendingStarts.set(part.id, part.startAt);
        clearTimeout(startTimers.get(part.id));
        startTimers.set(part.id, setTimeout(async () => {
            const startAt = part.startAt;
            try {
                const response = await fetch(`/recordings/${encodeURIComponent(recording.collection)}/${part.id}`, {
                    method: 'PATCH',
                    headers: { 'content-type': 'application/json', accept: 'application/json' },
                    body: JSON.stringify({ startAt })
                });
                if (response.status === 401) { window.location.href = loginUrl(); return; }
                if (!response.ok && response.status !== 404) throw new Error('Not saved');
            } catch (error) {
                showError('The new timing is only on this device for now. Adjust it again to keep it for everyone.');
            } finally {
                if (pendingStarts.get(part.id) === startAt) pendingStarts.delete(part.id);
            }
        }, SAVE_TIMING_MS));
    }

    // --- The recording panel ---
    const wallText = (ms) => clockText(ms).slice(0, 8);

    function renderRecordingPanel() {
        const kind = recording.kind;
        const heading = kind === 'shared' ? 'Recording for these notes' : kind === 'local' ? 'Video from this device' : 'No recording yet';
        const gapBefore = new Map(P.gaps(program).map(g => [g.to, g]));
        const rows = program.segments.map((s, i) => {
            const gap = gapBefore.get(s.offset);
            const when = s.start !== null ? `${wallText(s.start)}–${wallText(s.start + s.duration * 1000)}` : `Part ${i + 1}`;
            const by = s.uploadedBy ? ` · added by ${s.uploadedBy}` : '';
            return (gap ? `<li class="part-gap muted">No recording for ${esc(videoTimeText(gap.to - gap.from))}</li>` : '') +
                `<li class="part"><span class="part-name">${esc(s.name)}</span>
                    <span class="muted mono">${esc(when)}</span>
                    <span class="muted">${esc(videoTimeText(s.duration))}${esc(by)}${broken.has(s.id) ? ' · can\'t play here' : ''}</span></li>`;
        }).join('');
        const actions = [
            '<button type="button" class="btn outline" data-action="choose">Choose from this device</button>',
            kind === 'local' && sharedParts.length ? '<button type="button" class="btn outline" data-action="use-shared">Watch the uploaded recording</button>' : ''
        ].join('');
        setHtml($('recordingPanel'), `<strong>${esc(heading)}</strong>
            ${rows ? `<ul class="parts">${rows}</ul>` : ''}
            <div class="recording-actions">${actions}</div>`);
    }

    $('recordingPanel').addEventListener('click', (e) => {
        const button = e.target.closest('button[data-action]');
        if (!button) return;
        const action = button.dataset.action;
        if (action === 'choose') $('videoInput').click();
        else if (action === 'use-shared') setParts('shared', sharedParts);
    });

    function setRecordingOpen(open) {
        $('recordingPanel').hidden = !open;
        $('recordingToggle').setAttribute('aria-expanded', String(open));
    }
    $('recordingToggle').addEventListener('click', () => {
        setMenuOpen(false);
        renderRecordingPanel();
        setRecordingOpen(true);
        $('recordingPanel').querySelector('button').focus();
    });

    // Keep the notes visible while the person chooses the recording.
    function ready() {
        const hasVideo = recording.parts.length > 0;
        $('dropZone').hidden = !!data;
        $('player').hidden = !data;
        $('screen').hidden = !hasVideo;
        $('recordingPrompt').hidden = hasVideo;
        track.closest('.timeline').hidden = !duration;
        $('timingToggle').hidden = !(data && hasVideo);
        if (!$('recordingPanel').hidden) renderRecordingPanel();
        if (data) render();
    }

    function setMenuOpen(open) {
        $('playbackMenu').hidden = !open;
        $('optionsToggle').setAttribute('aria-expanded', String(open));
        if (open) {
            setTimingOpen(false);
            setHelpOpen(false);
            setRecordingOpen(false);
            $('playbackMenu').querySelector('button:not([hidden])').focus();
        }
    }
    $('optionsToggle').addEventListener('click', () => setMenuOpen($('playbackMenu').hidden));
    document.addEventListener('click', (e) => {
        // A button redrawn by its own click is no longer on the page.
        if (!e.target.isConnected) return;
        if (!e.target.closest('.options-wrap')) setMenuOpen(false);
        if (!e.target.closest('.options-wrap, #timingPanel')) setTimingOpen(false);
        if (!e.target.closest('.options-wrap, #helpPanel')) setHelpOpen(false);
        if (!e.target.closest('.options-wrap, #recordingPanel')) setRecordingOpen(false);
        if (!e.target.closest('#track')) hideCard();
    });
    function setHelpOpen(open) {
        $('helpPanel').hidden = !open;
        $('helpToggle').setAttribute('aria-expanded', String(open));
    }
    $('helpToggle').addEventListener('click', () => {
        setMenuOpen(false);
        setTimingOpen(false);
        setHelpOpen(true);
        $('closeHelp').focus();
    });
    $('closeHelp').addEventListener('click', () => { setHelpOpen(false); $('optionsToggle').focus(); });
    $('openNotes').addEventListener('click', () => { setMenuOpen(false); $('optionsToggle').focus(); $('notesInput').click(); });
    $('chooseRecording').addEventListener('click', () => $('videoInput').click());
    for (const id of ['notesInput', 'videoInput']) {
        $(id).addEventListener('change', (e) => { openFiles([...e.target.files]); e.target.value = ''; });
    }
    // Files dropped anywhere on the page open.
    document.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('drag-over'); });
    document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('drag-over'); });
    document.addEventListener('drop', (e) => {
        e.preventDefault();
        document.body.classList.remove('drag-over');
        openFiles([...e.dataTransfer.files]);
    });

    async function getNotes(url) {
        const response = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' });
        if (response.status === 401) { window.location.href = loginUrl(); throw new Error('Login required'); }
        if (!response.ok) throw new Error('Notes unavailable');
        const result = await response.json();
        if (!result || !Array.isArray(result.notes)) throw new Error('Invalid notes');
        return result;
    }

    // The sample show's recording, when nobody has uploaded one for it.
    async function loadSampleVideo() {
        const url = 'playback-demo/recording.mp4';
        const seconds = await probeDuration(url);
        setStatus('videoStatus', 'Sample Show');
        setParts('local', [{ id: 'sample', name: 'Sample Show.2026-10-07 19-30-00.mp4', startAt: Date.parse(data.showLog[0].at), duration: seconds, url }]);
        if (!requestedNoteId && !selectedId) seekTo(245);
    }

    // Live notes follow every change; any shared notes follow their recording.
    function follow() {
        const live = source.source === 'live';
        socket = io({ auth: { page: 'playback' } });
        let refreshTimer;
        let generation = 0;
        const refresh = () => {
            clearTimeout(refreshTimer);
            const mine = ++generation;
            refreshTimer = setTimeout(async () => {
                try {
                    const latest = await getNotes('/playback/live');
                    if (mine === generation && source.source === 'live') loadNotes(latest, true);
                } catch (_) { /* keep the last notes; reconnect will refresh them */ }
            }, 100);
        };
        if (live) {
            for (const event of ['connect', 'notes-update', 'note-added', 'note-edit-text', 'note-update-tags', 'note-delete', 'tags-update', 'show-log-update']) socket.on(event, refresh);
        }
        socket.on('connect', refreshShared);
        socket.on('recordings-update', (update) => {
            if (update && update.collection === collection() && Array.isArray(update.recordings)) applyShared(update.recordings);
        });
        socket.on('logged-out', () => { window.location.href = loggedOutUrl(); });
        const mine = socket;
        window.addEventListener('pagehide', () => mine.disconnect());
        window.addEventListener('pageshow', () => { if (socket === mine) mine.connect(); });
    }

    async function loadSource() {
        const loading = createLoadingState($('sourceLoading'));
        try {
            let notes;
            if (demo) {
                notes = await getNotes('playback-demo/show.json');
                const key = C.saveFile(notes, 'Sample show', sessionStorage, C.newFileKey());
                if (key) source = { file: key };
            } else if (source.show) notes = await getNotes(`/shows/${encodeURIComponent(source.show)}`);
            else if (source.file) {
                notes = C.readFile(source.file, sessionStorage);
                if (!notes) throw new Error('File no longer open');
            } else notes = await getNotes('/playback/live');
            const col = collection();
            const shared = col ? await getRecordings(col).catch(() => []) : [];
            await loading.finish();
            $('playbackTitle').textContent = notes.name || (notes.demo ? 'Sample show' : source.show ? 'Saved show' : source.file ? 'Notes file' : 'Live notes');
            document.title = `${$('playbackTitle').textContent} · Playback`;
            $('demoBadge').hidden = !notes.demo || /sample/i.test($('playbackTitle').textContent);
            loadNotes(notes);
            updateNotesLink();
            if (col) follow();
            if (shared.length) applyShared(shared);
            else if (notes.demo) await loadSampleVideo();
        } catch (error) {
            $('openNotes').hidden = false;
            showError(source.file ? 'That local notes file is no longer open in this tab. Open it again to continue.'
                : source.show ? 'That saved show could not be opened. Choose another show from Past notes.'
                : 'These notes could not be opened. Try again or choose a notes file.');
        } finally {
            loading.finish({ immediate: true });
            document.documentElement.classList.remove('opening-playback');
        }
    }

    // --- Times ---
    function clockText(ms) {
        return TimecodeFormat.formatTimecode(TimecodeFormat.timeOfDay(new Date(ms)));
    }

    const videoTimeText = TimecodeFormat.formatDuration;

    const toVideo = (clock) => (clock - videoStart) / 1000;
    const nowClock = () => videoStart + position() * 1000;
    // Position along the track, as a percentage so it needs no redraw on resize.
    const pct = (clock) => `${Math.min(100, Math.max(0, (toVideo(clock) / duration) * 100)).toFixed(3)}%`;
    const timed = () => !!(videoStart && duration);

    // --- Lining up ---
    // Timing moves the part being watched; the others keep their own times.
    function setTimingOpen(open) {
        $('timingPanel').hidden = !open;
        $('timingToggle').setAttribute('aria-expanded', String(open));
        if (open) describeTimingPart();
    }
    $('timingToggle').addEventListener('click', () => {
        setMenuOpen(false);
        setTimingOpen(true);
        $('timingPanel').querySelector('button').focus();
    });

    function timingSegment() {
        return place(position()).segment || loadedSegment() || program.segments[0] || null;
    }

    function describeTimingPart() {
        const segment = timingSegment();
        $('timingPart').hidden = !(segment && program.segments.length > 1);
        if (segment) $('timingPart').textContent = `Adjusts “${segment.name}”, the part under the playhead.`;
    }

    function setPartStart(segment, ms) {
        const part = recording.parts.find(p => p.id === segment.id);
        if (!part) return;
        part.startAt = Math.round(ms);
        relayout();
        render();
        saveStart(part);
    }

    // A rough "near" for reading a clock without a date: the video's start, else the notes'.
    function nearTime() {
        if (videoStart) return videoStart;
        const sent = data.notes.map(n => Date.parse(n.timestamp)).filter(Number.isFinite).sort((a, b) => a - b);
        return sent.length ? sent[Math.floor(sent.length / 2)] : Date.now();
    }

    document.querySelectorAll('[data-nudge]').forEach(btn => btn.addEventListener('click', () => {
        const segment = timingSegment();
        if (videoStart && segment) setPartStart(segment, segment.start + Number(btn.dataset.nudge));
    }));

    // Vor's clock overlay read off the paused frame sets the start exactly.
    $('clockForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const input = $('clockInput');
        const ms = T.parseClock(input.value, nearTime());
        const segment = gapAt === null && pendingSeek === null ? loadedSegment() : null;
        const problem = ms === null ? 'Enter a clock time such as 19:47:58.'
            : !segment ? 'Pause on a frame of the video first.' : null;
        input.classList.toggle('invalid', !!problem);
        input.setAttribute('aria-invalid', String(!!problem));
        $('clockError').textContent = problem || '';
        $('clockError').hidden = !problem;
        if (problem) return;
        input.value = '';
        setPartStart(segment, ms - video.currentTime * 1000);
    });

    window.addEventListener('resize', () => {
        hideCard();
        if (timed()) { renderGrid(); renderMarks(); update(); }
    });

    // --- Drawing ---
    const tagOf = (note) => tagsById.get((note.tags || [])[0]);
    const tagIds = (note) => (note.tags || []).length ? note.tags : [NO_TAG];
    const shown = (p) => !shownTags.size || tagIds(p.note).some(id => shownTags.has(id));

    function render() {
        if ($('player').hidden) return;
        const end = videoStart + duration * 1000;
        placed = data.notes.map(note => {
            const t = T.noteTimes(note);
            return { note, at: t.typed !== null ? t.typed : t.sent };
        }).filter(p => p.at !== null && (!timed() || (p.at >= videoStart && p.at <= end)))
            .sort((a, b) => a.at - b.at);
        placedAt = new Map(placed.map(p => [p.note.id, p.at]));
        // A tag no note in this video has can't be filtered by.
        const used = new Set(placed.flatMap(p => tagIds(p.note)));
        shownTags = new Set([...shownTags].filter(id => used.has(id)));
        renderFilters(used);
        renderGrid();
        renderMarks();
        renderSide();
        update();
        if (requestedNoteId && timed()) {
            const id = requestedNoteId;
            requestedNoteId = null;
            if (placed.some(p => p.note.id === id)) goToNote(id, true);
            else {
                const exists = data.notes.some(n => n.id === id);
                if (exists) requestedNoteId = id; // matching the clock or replacing the recording can recover it
                showError(exists ? 'This note falls outside this recording. Choose the recording that includes it or adjust its timing.'
                    : 'That note is no longer in this show. You can still browse its other notes.');
            }
        } else if (selectedId && !initialSelectionShown) {
            $('sideList').querySelector(`[data-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'center' });
            initialSelectionShown = true;
        }
    }

    function renderFilters(used) {
        const tags = (data.tags || []).filter(tag => used.has(tag.id));
        const attrs = (id) => `type="button" data-tag="${esc(id)}" aria-pressed="${shownTags.has(id)}"`;
        setHtml($('tagFilters'), tags.map(tag => NoteView.tagChipHTML(tag, attrs(tag.id))).join('') +
            (used.has(NO_TAG) ? `<button class="chip" ${attrs(NO_TAG)}>${NoteView.dotHTML('')}No tag</button>` : ''));
    }

    $('tagFilters').addEventListener('click', (e) => {
        const chip = e.target.closest('[data-tag]');
        if (!chip || !$('tagFilters').contains(chip)) return;
        const id = chip.dataset.tag;
        if (shownTags.has(id)) shownTags.delete(id); else shownTags.add(id);
        chip.setAttribute('aria-pressed', String(shownTags.has(id)));
        renderMarks();
        renderSide();
        update();
    });

    // Faint time guides; the axis only labels the ends and the playhead.
    function renderGrid() {
        $('axis').hidden = !duration;
        $('axisEnd').textContent = videoTimeText(duration);
        if (!timed()) { setHtml($('grid'), ''); return; }
        const end = videoStart + duration * 1000;
        const pxPerMin = track.clientWidth / (duration / 60);
        const step = [1, 5, 10, 15, 30].find(m => m * pxPerMin >= 32) || 60;
        const first = new Date(videoStart);
        first.setSeconds(0, 0);
        first.setMinutes(Math.ceil(first.getMinutes() / step) * step);
        if (first.getTime() < videoStart) first.setMinutes(first.getMinutes() + step);
        let lines = '';
        for (let t = first.getTime(); t <= end; t += step * 60000) {
            lines += `<span class="line" style="left:${pct(t)}"></span>`;
        }
        // Where nothing was recorded (or this browser can't play the part).
        const share = (seconds) => `${Math.min(100, Math.max(0, seconds / duration * 100)).toFixed(3)}%`;
        const blanks = [...P.gaps(program), ...program.segments.filter(s => broken.has(s.id)).map(s => ({ from: s.offset, to: s.end }))];
        lines += blanks.map(g => `<span class="gap" style="left:${share(g.from)};width:${share(g.to - g.from)}"></span>`).join('');
        setHtml($('grid'), lines);
    }

    // Each scene as a stretch of the video, from its start to the next one's.
    function sceneSpans() {
        const end = videoStart + duration * 1000;
        return scenes.map((s, i) => ({
            ...s,
            from: Math.max(s.at, videoStart),
            to: Math.min(i + 1 < scenes.length ? scenes[i + 1].at : end, end)
        })).filter(s => s.to > s.from);
    }

    function renderMarks() {
        track.setAttribute('aria-disabled', String(!timed()));
        hideCard();
        if (!timed()) { setHtml($('sceneStrip'), ''); setHtml($('laneMarks'), ''); return; }
        const end = videoStart + duration * 1000;
        const visibleCues = cues.filter(c => c.at >= videoStart && c.at <= end);
        const spans = sceneSpans();
        const width = (s) => `${(((s.to - s.from) / 1000 / duration) * 100).toFixed(3)}%`;
        setHtml($('sceneStrip'), spans.map(s =>
            `<span class="scene" data-scene="${s.at}" style="left:${pct(s.from)};width:${width(s)}">${esc(s.value)}</span>`
        ).join(''));
        const cueMarks = visibleCues.map(c =>
            `<span class="cue-mark" data-cue="${c.at}" style="left:${pct(c.at)}"></span>`
        ).join('');
        setHtml($('laneMarks'),
            spans.filter(s => s.at > videoStart).map(s => `<span class="scene-line" style="left:${pct(s.at)}"></span>`).join('') +
            cueMarks +
            placed.filter(shown).map(p =>
                `<span class="note-mark" data-id="${esc(p.note.id)}" style="left:${pct(p.at)};--tag:${safeColor((tagOf(p.note) || {}).color)}"></span>`
            ).join(''));
        markSelected();
    }

    function tagDots(note) {
        return (note.tags || []).map(id => tagsById.get(id)).filter(Boolean)
            .map(tag => `<span class="dot" title="${esc(tag.name)}" style="--tag:${safeColor(tag.color)}"></span>`).join('');
    }

    // The list beside the video, broken up by scene like the notes page.
    function renderSide() {
        const list = placed.filter(shown);
        $('sideCount').textContent = list.length === placed.length ? `${placed.length}` : `${list.length} of ${placed.length}`;
        if (!list.length) {
            const why = !videoStart ? 'Pause on a frame showing the clock, then choose Adjust timing in Playback options.'
                : !placed.length ? 'None of these notes were written during this video.'
                : 'No notes with these tags.';
            setHtml($('sideList'), `<p class="side-empty muted">${esc(why)}</p>`);
            return;
        }
        let html = '';
        let group = null;
        list.forEach((p, i) => {
            const scene = p.note.act || '';
            if (i === 0 || scene !== group) {
                group = scene;
                let count = 0;
                for (let j = i; j < list.length && (list[j].note.act || '') === scene; j++) count++;
                html += `<div class="group-head">${esc(scene || 'No scene')}<span class="group-count muted">${count}</span></div>`;
            }
            const n = p.note;
            html += `<button type="button" class="side-note" data-id="${esc(n.id)}">
                <span class="body">
                    <span class="meta"><span class="author">${esc(n.user)}</span><span class="dots">${tagDots(n)}</span><span class="when mono">${esc(timed() ? videoTimeText(toVideo(p.at)) : clockText(p.at))}</span></span>
                    <span class="text">${esc(n.text)}</span>
                </span>
            </button>`;
        });
        setHtml($('sideList'), html);
        currentId = null;
        markSelected();
    }

    function markSelected() {
        document.querySelectorAll('.note-mark, .side-note').forEach(el => el.classList.toggle('selected', el.dataset.id === selectedId));
    }

    // Between parts: what's missing and when the next part starts.
    function showGap() {
        const inGap = gapAt !== null && !!duration;
        $('gapNotice').hidden = !inGap;
        if (!inGap) return;
        const next = place(gapAt).next;
        const from = Math.max(0, ...program.segments.filter(s => !broken.has(s.id) && s.end <= gapAt + 0.001).map(s => s.end));
        const to = next ? next.offset : duration;
        $('gapText').textContent = timed() ? `No recording from ${wallText(videoStart + from * 1000)} to ${wallText(videoStart + to * 1000)}` : 'No recording here';
        $('gapNext').textContent = next ? `“${next.name}” starts in ${videoTimeText(Math.ceil(next.offset - gapAt))}` : 'The recording ends here';
        $('skipGap').hidden = !next;
    }

    // Playhead, the scene under it, and which notes are behind it.
    function update() {
        showGap();
        if (duration) {
            const seconds = position();
            const x = seconds / duration * $('axis').clientWidth;
            $('axisNow').textContent = videoTimeText(seconds);
            $('axisNow').style.left = `${Math.min(Math.max(24, x), $('axis').clientWidth - 24)}px`;
            $('axisStart').hidden = x < 65;
            $('axisEnd').hidden = $('axis').clientWidth - x < 65;
            track.setAttribute('aria-valuemax', String(duration));
            track.setAttribute('aria-valuenow', String(Math.floor(seconds)));
            track.setAttribute('aria-valuetext', `${videoTimeText(seconds)} of ${videoTimeText(duration)}`);
        }
        if (!timed()) return;
        const now = nowClock();
        $('playhead').style.left = pct(now);
        const scene = T.valueAt(scenes, now);
        $('sceneStrip').querySelectorAll('.scene').forEach(el =>
            el.classList.toggle('current', !!scene && Number(el.dataset.scene) === scene.at));
        const cue = T.valueAt(cues, now);
        track.setAttribute('aria-valuetext', `${videoTimeText(toVideo(now))} of ${videoTimeText(duration)}${scene ? `, ${scene.value}` : ''}${cue ? `, LX ${cue.value}` : ''}`);
        track.querySelectorAll('.cue-mark').forEach(el =>
            el.classList.toggle('current', !!cue && Number(el.dataset.cue) === cue.at));
        let latest = null;
        $('sideList').querySelectorAll('.side-note').forEach(el => {
            const past = placedAt.get(el.dataset.id) <= now;
            el.classList.toggle('past', past);
            if (past) latest = el;
        });
        const id = latest ? latest.dataset.id : null;
        if (id !== currentId) {
            currentId = id;
            $('sideList').querySelectorAll('.side-note').forEach(el => el.classList.toggle('current', el === latest));
            // Follow along while playing, unless someone is reading the list.
            if (latest && playing && !$('sideList').matches(':hover')) latest.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    // At the end of a part, on to whatever follows; after the last, stop.
    function partEnded(segment) {
        const after = place(segment.end);
        if (after.segment || after.next) moveTo(segment.end);
        else { pause(); update(); }
    }

    video.addEventListener('timeupdate', update);
    video.addEventListener('seeked', () => { if (loadTarget === null) flushSeek(); update(); });
    // Time keeps running through a gap, and a part longer than it said it was
    // still hands over where the next one starts.
    (function tick() {
        if (playing && pendingSeek === null && duration) {
            if (gapAt !== null) {
                const now = performance.now();
                const pos = gapAt + (now - gapSince) / 1000;
                gapSince = now;
                const next = place(gapAt).next;
                if (next && pos >= next.offset) moveTo(next.offset);
                else if (!next && pos >= duration) { gapAt = duration; pause(); }
                else gapAt = pos;
            } else if (loadTarget === null) {
                const segment = loadedSegment();
                if (segment && video.currentTime >= segment.duration) partEnded(segment);
            }
            update();
        }
        requestAnimationFrame(tick);
    })();

    // --- Hovering the timeline ---
    function hoverHtml(el) {
        if (el.classList.contains('note-mark')) {
            const p = placed.find(x => x.note.id === el.dataset.id);
            if (!p) return '';
            const n = p.note;
            const cue = T.cueLabel(n.lxCue);
            return `<div class="who"><strong>${esc(n.user)}</strong><span class="dots">${tagDots(n)}</span><span class="muted mono">${esc(clockText(p.at))}</span></div>
                <div class="text">${esc(n.text)}</div>
                ${cue ? `<div class="muted">LX ${esc(cue)}</div>` : ''}`;
        }
        if (el.classList.contains('scene')) {
            return `<div class="muted">${esc(clockText(Number(el.dataset.scene)))}</div><strong>${esc((T.valueAt(scenes, Number(el.dataset.scene)) || {}).value || '')}</strong>`;
        }
        const at = Number(el.dataset.cue);
        return `<div class="muted">${esc(clockText(at))}</div><strong>LX ${esc((T.valueAt(cues, at) || {}).value || '')}</strong>`;
    }

    // Invisible target padding can overlap in dense passages. Resolve to the
    // nearest horizontal centre. At an exact overlap the circle takes priority
    // inside its target; the note remains reachable on the stem above/below it.
    function markAt(e) {
        const scene = e.target.closest('.scene');
        if (scene) return scene;
        let closest = null;
        let distance = 12;
        track.querySelectorAll('.note-mark, .cue-mark').forEach(el => {
            const box = el.getBoundingClientRect();
            const dx = Math.abs(e.clientX - (box.left + box.width / 2));
            if (e.clientY >= box.top && e.clientY < box.bottom && dx <= distance &&
                (!closest || dx < distance || el.classList.contains('cue-mark'))) {
                closest = el;
                distance = dx;
            }
        });
        return closest;
    }

    // The card, centred over x (px from the track's left edge) but kept inside the track.
    function showCard(html, x) {
        setHtml(hoverCard, html);
        hoverCard.hidden = false;
        const w = hoverCard.offsetWidth;
        hoverCard.style.left = `${Math.max(0, Math.min(x - w / 2, track.clientWidth - w))}px`;
    }

    function hideCard() {
        cardPinned = false;
        hoverCard.hidden = true;
        track.querySelectorAll('.hover').forEach(el => el.classList.remove('hover'));
    }

    function describeMark(el, pinned = false) {
        hideCard();
        el.classList.add('hover');
        const box = el.getBoundingClientRect();
        showCard(hoverHtml(el), box.left + box.width / 2 - track.getBoundingClientRect().left);
        cardPinned = pinned;
    }
    track.addEventListener('pointermove', (e) => {
        if (scrub || cardPinned || e.pointerType === 'touch') return;
        const el = markAt(e);
        if (el) describeMark(el);
        else hideCard();
    });
    track.addEventListener('pointerleave', () => { if (!cardPinned && !scrub) hideCard(); });

    // --- Jumping around ---
    function seekClock(clock) {
        seekTo(toVideo(clock));
    }

    // A seek asked for while the video is still finding the last frame waits
    // for it, so dragging shows frames as fast as they come instead of queueing.
    function seekTo(seconds) {
        if (!duration) return;
        pendingSeek = Math.min(Math.max(0, seconds), duration);
        if (!video.seeking && loadTarget === null) flushSeek();
        update();
    }

    function flushSeek() {
        if (pendingSeek === null) return;
        const seconds = pendingSeek;
        pendingSeek = null;
        moveTo(seconds);
    }

    function goToNote(id, scroll) {
        const p = placed.find(x => x.note.id === id);
        if (!p) return;
        selectedId = id;
        const address = new URL(location.href);
        address.searchParams.set('note', id);
        history.replaceState(null, '', address.pathname + address.search);
        markSelected();
        updateNotesLink();
        if (timed()) {
            $('fileError').hidden = true;
            seekClock(p.at - PREROLL_MS);
        }
        else requestedNoteId = id;
        const item = $('sideList').querySelector(`[data-id="${CSS.escape(id)}"]`);
        if (scroll && item) item.scrollIntoView({ block: 'nearest' });
    }

    // Dragging along the timeline scrubs through the video; a press that
    // doesn't move is a click on whatever is under it.
    const DRAG_PX = 4;
    const secondsAt = (e) => {
        const rect = track.getBoundingClientRect();
        return Math.min(Math.max(0, (e.clientX - rect.left) / rect.width), 1) * duration;
    };

    track.addEventListener('pointerdown', (e) => {
        if (!timed() || e.button !== 0 || scrub) return;
        e.preventDefault();
        track.focus({ preventScroll: true });
        hideCard();
        track.setPointerCapture(e.pointerId);
        scrub = { pointerId: e.pointerId, x: e.clientX, moved: false, wasPlaying: playing, mark: markAt(e) };
    });

    track.addEventListener('pointermove', (e) => {
        if (!scrub || e.pointerId !== scrub.pointerId) return;
        if (!scrub.moved) {
            if (Math.abs(e.clientX - scrub.x) < DRAG_PX) return;
            scrub.moved = true;
            track.classList.add('scrubbing');
            hideCard();
            pause();
        }
        const seconds = secondsAt(e);
        seekTo(seconds);
        showCard(`<strong class="mono">${esc(clockText(videoStart + seconds * 1000))}</strong>`, (seconds / duration) * track.clientWidth);
    });

    function endScrub(e) {
        if (!scrub || e.pointerId !== scrub.pointerId) return null;
        const press = scrub;
        scrub = null;
        if (track.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId);
        track.classList.remove('scrubbing');
        if (press.moved) {
            if (e.type === 'pointerup') seekTo(secondsAt(e));
            hideCard();
            if (press.wasPlaying) play();
        }
        return press;
    }

    track.addEventListener('pointerup', (e) => {
        const press = endScrub(e);
        if (!press || press.moved) return;
        const mark = press.mark;
        if (mark && mark.classList.contains('note-mark')) goToNote(mark.dataset.id, true);
        else if (mark) seekClock(Number(mark.dataset.scene || mark.dataset.cue));
        else seekTo(secondsAt(e));
        if (mark) describeMark(mark, true);
    });
    track.addEventListener('pointercancel', endScrub);
    track.addEventListener('lostpointercapture', endScrub);

    $('sideList').addEventListener('click', (e) => {
        const item = e.target.closest('.side-note');
        if (item) goToNote(item.dataset.id, false);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !$('helpPanel').hidden) { setHelpOpen(false); $('optionsToggle').focus(); return; }
        if (e.key === 'Escape' && !$('playbackMenu').hidden) {
            setMenuOpen(false);
            $('optionsToggle').focus();
            return;
        }
        if (e.key === 'Escape' && !$('timingPanel').hidden) { setTimingOpen(false); $('optionsToggle').focus(); return; }
        if (e.key === 'Escape' && !$('recordingPanel').hidden) { setRecordingOpen(false); $('optionsToggle').focus(); return; }
        if (e.key === 'Escape') { hideCard(); return; }
        if (e.target.closest('input, select, textarea, button, a, .options-wrap, #timingPanel, #helpPanel, #recordingPanel, #gapNotice') || e.metaKey || e.ctrlKey || e.altKey || $('player').hidden) return;
        if (e.key === ' ' || (e.key === 'Enter' && e.target === video)) {
            e.preventDefault();
            togglePlayback();
        } else if (e.target !== track || !timed()) return;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            hideCard();
            seekTo(position() + (e.key === 'ArrowLeft' ? -5 : 5));
        } else if (e.key === 'Home' || e.key === 'End') {
            e.preventDefault();
            hideCard();
            seekTo(e.key === 'Home' ? 0 : duration);
        } else if (e.key === 'PageUp' || e.key === 'PageDown') {
            e.preventDefault();
            const list = cues.filter(c => toVideo(c.at) >= 0 && toVideo(c.at) <= duration);
            const now = nowClock();
            const next = e.key === 'PageDown' ? list.find(c => c.at > now + 1)
                : [...list].reverse().find(c => c.at < now - 1);
            if (next) {
                seekClock(next.at);
                const mark = track.querySelector(`[data-cue="${next.at}"]`);
                if (mark) describeMark(mark, true);
            }
        } else if ((e.key === '[' || e.key === ']') && timed()) {
            e.preventDefault();
            // Notes are reached at PREROLL_MS before them, so measure from just past that.
            const now = nowClock() + PREROLL_MS;
            const list = placed.filter(shown);
            const next = e.key === ']'
                ? list.find(p => p.at > now + 500)
                : [...list].reverse().find(p => p.at < now - 500);
            if (next) goToNote(next.note.id, true);
        }
    });

    if (['source', 'show', 'file', 'demo'].some(key => params.has(key))) loadSource();
});
