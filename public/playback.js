// Plays a Vor recording with the notes written during it (proof of concept).
// Notes come from the live session, a saved show or a local file. Recordings
// stay on this device. Timing: public/playback-timeline.js.
document.addEventListener('DOMContentLoaded', function() {
    const $ = id => document.getElementById(id);
    const T = PlaybackTimeline;
    const { esc, setHtml } = NoteView;
    const C = PlaybackContext;
    const params = new URLSearchParams(location.search);
    let source = params.get('show') ? { show: params.get('show') }
        : params.get('file') ? { file: params.get('file') } : { source: 'live' };
    let returnTo = params.get('returnTo');
    let requestedNoteId = params.get('note');
    let liveSocket = null;
    const safeColor = (color) => SafeHtml.safeColour(color, '#8a8f98');

    const video = $('video');
    const track = $('track');
    const hoverCard = $('hoverCard');

    const PREROLL_MS = 3000;       // jumping to a note starts this far before it
    const NO_TAG = '';             // filter key for notes from before every note had a tag

    let data = null;               // the notes file: { notes, tags, showLog }
    let tagsById = new Map();
    let videoUrl = null;
    let videoStart = null;         // clock time of the video's first frame
    let duration = 0;              // seconds
    let placed = [];               // notes in the video, in time order: { note, at }
    let scenes = [];               // scene changes: { value, at }
    let cues = [];                 // LX cues, only when the file has them exactly
    let shownTags = new Set();     // tag filter; empty shows everything
    let selectedId = requestedNoteId;
    let currentId = null;
    let scrub = null;              // the active pointer press on the timeline
    let pendingSeek = null;        // seconds to go to once the video finishes its current seek
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

    function openFiles(files) {
        $('demoBadge').hidden = true;
        $('fileError').hidden = true;
        for (const file of files) {
            if (/\.json$/i.test(file.name)) openNotes(file);
            else if (/^video\//.test(file.type) || /\.(mov|mp4|m4v)$/i.test(file.name)) openVideo(file);
            else showError(`"${file.name}" isn't a notes file or a video.`);
        }
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
            if (liveSocket) liveSocket.disconnect();
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
        ready();
    }

    function openVideo(file) {
        requestedNoteId = selectedId || requestedNoteId;
        pendingSeek = null;
        if (videoUrl) URL.revokeObjectURL(videoUrl);
        videoUrl = URL.createObjectURL(file);
        duration = 0;
        video.src = videoUrl;
        videoStart = T.vorStartFromName(file.name);
        document.title = `${T.vorTitleFromName(file.name) || file.name} · Playback`;
        setStatus('videoStatus', T.vorTitleFromName(file.name) || file.name);
        // Without a start time the notes can't be placed until it is matched by hand.
        setTimingOpen(!videoStart);
        ready();
    }

    function setStatus(id, text) {
        $(id).textContent = text;
        $(id).classList.add('ready');
    }

    // Keep the notes visible while the person chooses the recording.
    function ready() {
        const both = !!(data && videoUrl);
        $('dropZone').hidden = !!data;
        $('player').hidden = !data;
        video.hidden = !videoUrl;
        $('recordingPrompt').hidden = !!videoUrl;
        $('recordingTitle').textContent = selectedId ? 'Choose the recording to watch this note' : 'Choose the recording for this show';
        track.closest('.timeline').hidden = !duration;
        $('timingToggle').hidden = !both;
        if (data) render();
    }

    function setMenuOpen(open) {
        $('playbackMenu').hidden = !open;
        $('optionsToggle').setAttribute('aria-expanded', String(open));
        if (open) {
            setTimingOpen(false);
            setHelpOpen(false);
            $('playbackMenu').querySelector('button:not([hidden])').focus();
        }
    }
    $('optionsToggle').addEventListener('click', () => setMenuOpen($('playbackMenu').hidden));
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.options-wrap')) setMenuOpen(false);
        if (!e.target.closest('.options-wrap, #timingPanel')) setTimingOpen(false);
        if (!e.target.closest('.options-wrap, #helpPanel')) setHelpOpen(false);
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
    $('openVideo').addEventListener('click', () => { setMenuOpen(false); $('optionsToggle').focus(); $('videoInput').click(); });
    $('chooseRecording').addEventListener('click', () => $('videoInput').click());
    for (const id of ['notesInput', 'videoInput']) {
        $(id).addEventListener('change', (e) => { openFiles(e.target.files); e.target.value = ''; });
    }
    // Files dropped anywhere on the page open.
    document.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('drag-over'); });
    document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('drag-over'); });
    document.addEventListener('drop', (e) => {
        e.preventDefault();
        document.body.classList.remove('drag-over');
        openFiles(e.dataTransfer.files);
    });

    video.addEventListener('loadedmetadata', () => { duration = video.duration || 0; ready(); });
    video.addEventListener('error', () => {
        showError('This browser can\'t play that video. Try Safari or Chrome.');
        videoUrl = null;
        duration = 0;
        ready();
    });

    function togglePlayback() {
        if (!duration) return;
        if (video.paused) video.play().catch(() => {});
        else video.pause();
    }

    video.addEventListener('click', togglePlayback);
    for (const event of ['play', 'pause', 'ended', 'emptied']) {
        video.addEventListener(event, () => video.setAttribute('aria-label', video.paused || video.ended ? 'Play video' : 'Pause video'));
    }

    async function getNotes(url) {
        const response = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' });
        if (response.status === 401) { window.location.href = loginUrl(); throw new Error('Login required'); }
        if (!response.ok) throw new Error('Notes unavailable');
        const result = await response.json();
        if (!result || !Array.isArray(result.notes)) throw new Error('Invalid notes');
        return result;
    }

    async function loadSampleVideo() {
        const response = await fetch('playback-demo/recording.mp4');
        if (!response.ok) throw new Error('Sample video unavailable');
        const movie = await response.blob();
        const hasTarget = !!requestedNoteId;
        video.addEventListener('loadedmetadata', () => {
            if (!hasTarget) seekTo(245);
        }, { once: true });
        openVideo(new File([movie], 'Sample Show.2026-10-07 19-30-00.mp4', { type: 'video/mp4' }));
        videoStart = Date.parse(data.showLog[0].at);
    }

    function followLiveNotes() {
        liveSocket = io({ auth: { page: 'playback' } });
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
        for (const event of ['connect', 'notes-update', 'note-added', 'note-edit-text', 'note-update-tags', 'note-delete', 'tags-update', 'show-log-update']) liveSocket.on(event, refresh);
        liveSocket.on('logged-out', () => { window.location.href = loggedOutUrl(); });
        window.addEventListener('pagehide', () => liveSocket.disconnect());
        window.addEventListener('pageshow', () => { if (source.source === 'live') liveSocket.connect(); });
    }

    async function loadSource() {
        const loading = createLoadingState($('sourceLoading'));
        try {
            let notes;
            if (params.get('demo') === '1') {
                notes = await getNotes('playback-demo/show.json');
                const key = C.saveFile(notes, 'Sample show', sessionStorage, C.newFileKey());
                if (key) source = { file: key };
            } else if (source.show) notes = await getNotes(`/shows/${encodeURIComponent(source.show)}`);
            else if (source.file) {
                notes = C.readFile(source.file, sessionStorage);
                if (!notes) throw new Error('File no longer open');
            } else notes = await getNotes('/playback/live');
            await loading.finish();
            $('playbackTitle').textContent = notes.name || (notes.demo ? 'Sample show' : source.show ? 'Saved show' : source.file ? 'Notes file' : 'Live notes');
            document.title = `${$('playbackTitle').textContent} · Playback`;
            $('demoBadge').hidden = !notes.demo || /sample/i.test($('playbackTitle').textContent);
            loadNotes(notes);
            updateNotesLink();
            if (source.source === 'live' && params.get('demo') !== '1') followLiveNotes();
            if (notes.demo) await loadSampleVideo();
        } catch (error) {
            showError(source.file ? 'That local notes file is no longer open in this tab. Open it again to continue.'
                : source.show ? 'That saved show could not be opened. Choose another show from Past notes.'
                : 'These notes could not be opened. Try again or choose a notes file.');
        } finally {
            loading.finish({ immediate: true });
            document.documentElement.classList.remove('opening-playback');
        }
    }

    // --- Times ---
    const pad = (n) => String(n).padStart(2, '0');

    function clockText(ms) {
        return TimecodeFormat.formatTimecode(TimecodeFormat.timeOfDay(new Date(ms)));
    }

    function videoTimeText(seconds) {
        const s = Math.max(0, Math.floor(seconds));
        const h = Math.floor(s / 3600);
        const m = Math.floor(s / 60) % 60;
        return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
    }

    const toVideo = (clock) => (clock - videoStart) / 1000;
    // While scrubbing, where the pointer is rather than the frame still being fetched.
    const nowClock = () => videoStart + (pendingSeek !== null ? pendingSeek : video.currentTime) * 1000;
    // Position along the track, as a percentage so it needs no redraw on resize.
    const pct = (clock) => `${Math.min(100, Math.max(0, (toVideo(clock) / duration) * 100)).toFixed(3)}%`;
    const timed = () => !!(videoStart && duration);

    // --- Lining up ---
    function setTimingOpen(open) {
        $('timingPanel').hidden = !open;
        $('timingToggle').setAttribute('aria-expanded', String(open));
    }
    $('timingToggle').addEventListener('click', () => {
        setMenuOpen(false);
        setTimingOpen(true);
        $('timingPanel').querySelector('button').focus();
    });

    function setStart(ms) {
        videoStart = ms;
        render();
    }

    // A rough "near" for reading a clock without a date: the video's start, else the notes'.
    function nearTime() {
        if (videoStart) return videoStart;
        const sent = data.notes.map(n => Date.parse(n.timestamp)).filter(Number.isFinite).sort((a, b) => a - b);
        return sent.length ? sent[Math.floor(sent.length / 2)] : Date.now();
    }

    document.querySelectorAll('[data-nudge]').forEach(btn => btn.addEventListener('click', () => {
        if (videoStart) setStart(videoStart + Number(btn.dataset.nudge));
    }));

    // Vor's clock overlay read off the paused frame sets the start exactly.
    $('clockForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const input = $('clockInput');
        const ms = T.parseClock(input.value, nearTime());
        input.classList.toggle('invalid', ms === null);
        input.setAttribute('aria-invalid', String(ms === null));
        $('clockError').hidden = ms !== null;
        if (ms === null) return;
        input.value = '';
        setStart(ms - video.currentTime * 1000);
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
        const chip = (id, dot, name, color) =>
            `<button type="button" class="chip" data-tag="${esc(id)}" aria-pressed="${shownTags.has(id)}"${color ? ` style="--tag:${safeColor(color)}"` : ''}><span class="${dot}"></span>${esc(name)}</button>`;
        setHtml($('tagFilters'), tags.map(tag => chip(tag.id, 'dot', tag.name, tag.color)).join('') +
            (used.has(NO_TAG) ? chip(NO_TAG, 'dot ring', 'No tag') : ''));
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

    // Playhead, the scene under it, and which notes are behind it.
    function update() {
        if (duration) {
            const seconds = pendingSeek !== null ? pendingSeek : video.currentTime;
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
        const atById = new Map(placed.map(p => [p.note.id, p.at]));
        $('sideList').querySelectorAll('.side-note').forEach(el => {
            const past = atById.get(el.dataset.id) <= now;
            el.classList.toggle('past', past);
            if (past) latest = el;
        });
        const id = latest ? latest.dataset.id : null;
        if (id !== currentId) {
            currentId = id;
            $('sideList').querySelectorAll('.side-note').forEach(el => el.classList.toggle('current', el === latest));
            // Follow along while playing, unless someone is reading the list.
            if (latest && !video.paused && !$('sideList').matches(':hover')) latest.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    video.addEventListener('timeupdate', update);
    video.addEventListener('seeked', () => { flushSeek(); update(); });
    (function tick() {
        if (!video.paused) update();
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
        pendingSeek = Math.min(Math.max(0, seconds), duration);
        if (!video.seeking) flushSeek();
        update();
    }

    function flushSeek() {
        if (pendingSeek === null) return;
        const seconds = pendingSeek;
        pendingSeek = null;
        video.currentTime = seconds;
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
        else {
            requestedNoteId = id;
            $('recordingTitle').textContent = 'Choose the recording to watch this note';
        }
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
        scrub = { pointerId: e.pointerId, x: e.clientX, moved: false, wasPlaying: !video.paused, mark: markAt(e) };
    });

    track.addEventListener('pointermove', (e) => {
        if (!scrub || e.pointerId !== scrub.pointerId) return;
        if (!scrub.moved) {
            if (Math.abs(e.clientX - scrub.x) < DRAG_PX) return;
            scrub.moved = true;
            track.classList.add('scrubbing');
            hideCard();
            video.pause();
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
            if (press.wasPlaying) video.play().catch(() => {});
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
        if (e.key === 'Escape') { hideCard(); return; }
        if (e.target.closest('input, select, textarea, button, a, .options-wrap, #timingPanel, #helpPanel') || e.metaKey || e.ctrlKey || e.altKey || $('player').hidden) return;
        if (e.key === ' ' || (e.key === 'Enter' && e.target === video)) {
            e.preventDefault();
            togglePlayback();
        } else if (e.target !== track || !timed()) return;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            hideCard();
            seekTo(toVideo(nowClock()) + (e.key === 'ArrowLeft' ? -5 : 5));
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
