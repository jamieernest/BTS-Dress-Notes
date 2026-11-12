// Explicit UTF-16 ranges into text; names are snapshots, identities are OIDC sub.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./safe-html.js'), require('./profile-photos.js'));
    else root.Mentions = factory(root.SafeHtml, root.ProfilePhotos);
}(typeof self !== 'undefined' ? self : this, function (SafeHtml, ProfilePhotos) {
    function clean(text, raw) {
        if (typeof text !== 'string' || !Array.isArray(raw)) return [];
        const result = [];
        for (const m of raw.slice(0, 50)) {
            if (!m || typeof m.userId !== 'string' || !m.userId.trim() || m.userId.length > 200 ||
                typeof m.name !== 'string' || !m.name.trim() || m.name.length > 200 || /[\r\n]/.test(m.name) ||
                !Number.isSafeInteger(m.start) || !Number.isSafeInteger(m.end) || m.start < 0 || m.end > text.length ||
                text.slice(m.start, m.end) !== '@' + m.name || m.end <= m.start ||
                result.some(n => m.start < n.end && m.end > n.start)) continue;
            result.push({ userId: m.userId, name: m.name, start: m.start, end: m.end });
            if (result.length === 20) break;
        }
        return result.sort((a, b) => a.start - b.start);
    }
    function has(item, userId) { return !!userId && clean(item.text, item.mentions).some(m => m.userId === userId); }
    function html(text, raw, composing = false) {
        text = String(text || '');
        let at = 0;
        let result = '';
        for (const m of clean(text, raw)) {
            result += SafeHtml.escapeHtml(text.slice(at, m.start)) + (composing ? `<span class="mention-compose">${SafeHtml.escapeHtml(text.slice(m.start, m.end))}</span>` : `<strong class="mention">${SafeHtml.escapeHtml(text.slice(m.start, m.end))}</strong>`);
            at = m.end;
        }
        return result + SafeHtml.escapeHtml(text.slice(at));
    }
    // Scene labels arrive over OSC with no picker, so `@username` (the profile-photo username) is resolved at draw time only; the stored label never changes.
    function labelHandles(label) {
        const found = [];
        for (const m of String(label || '').matchAll(/(^|\s)@([A-Za-z0-9_][A-Za-z0-9_.]{0,99})/g)) {
            const handle = m[2].replace(/\.+$/, '');
            if (ProfilePhotos.validUsername(handle.toLowerCase())) found.push({ handle: handle.toLowerCase(), start: m.index + m[1].length, end: m.index + m[1].length + 1 + handle.length });
        }
        return found;
    }
    // Same token rule as the highlight, so "My scenes" matches exactly what is highlighted for the viewer.
    function labelMentions(label, handle) {
        handle = String(handle || '').toLowerCase();
        return !!handle && labelHandles(label).some(h => h.handle === handle);
    }
    function labelHtml(label, people = [], me = null) {
        label = String(label || '');
        const known = new Set(people.map(p => String(p.emailPrefix || '').toLowerCase()).filter(Boolean));
        const mine = String(me?.emailPrefix || '').toLowerCase();
        if (mine) known.add(mine);
        let at = 0, result = '';
        for (const h of labelHandles(label)) {
            if (!known.has(h.handle)) continue;
            result += SafeHtml.escapeHtml(label.slice(at, h.start)) + `<strong class="mention${h.handle === mine ? ' mention-me' : ''}">${SafeHtml.escapeHtml(label.slice(h.start, h.end))}</strong>`;
            at = h.end;
        }
        return result + SafeHtml.escapeHtml(label.slice(at));
    }
    // Keep only untouched ranges when the text is edited. Never infer identity from names.
    function rebase(before, after, raw) {
        let start = 0;
        while (start < before.length && start < after.length && before[start] === after[start]) start++;
        let end = before.length, nextEnd = after.length;
        while (end > start && nextEnd > start && before[end - 1] === after[nextEnd - 1]) { end--; nextEnd--; }
        const delta = nextEnd - end;
        return clean(after, clean(before, raw).flatMap(m => m.end <= start ? [m] : m.start >= end ? [{ ...m, start: m.start + delta, end: m.end + delta }] : []));
    }
    function accounts(notes, chat, online) {
        const people = new Map();
        const add = (id, name, emailPrefix) => { if (typeof id === 'string' && id && id.length <= 200 && typeof name === 'string' && name.trim() && name.length <= 200 && !/[\r\n]/.test(name)) people.set(id, { userId: id, name, ...(ProfilePhotos.validUsername(emailPrefix) ? { emailPrefix } : people.get(id)?.emailPrefix ? { emailPrefix: people.get(id).emailPrefix } : {}) }); };
        for (const n of [...notes, ...chat]) { add(n.userId, n.user, n.emailPrefix); for (const c of n.comments || []) add(c.userId, c.user, c.emailPrefix); }
        for (const u of online) add(u.id, u.name, u.emailPrefix);
        return [...people.values()].sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
    }
    function createUnread(storage) {
        let seen = new Set(), pending = new Set(), account;
        function save() { try { if (account) storage?.setItem('mention-seen:' + account, JSON.stringify({ seen: [...seen], pending: [...pending] })); } catch (_) { /* storage unavailable */ } }
        function load(sub) {
            if (account === sub) return;
            account = sub; seen = new Set(); pending = new Set();
            try { const data = JSON.parse(storage?.getItem('mention-seen:' + sub)); if (Array.isArray(data?.seen)) seen = new Set(data.seen); if (Array.isArray(data?.pending)) pending = new Set(data.pending); } catch (_) { /* old or unavailable */ }
        }
        return {
            receive(log, sub, viewing) {
                load(sub);
                for (const m of log) {
                    if (!seen.has(m.id) && m.userId !== sub && has(m, sub) && !viewing) pending.add(m.id);
                    seen.add(m.id);
                }
                if (viewing) pending.clear();
                save(); return pending.size;
            },
            clear() { pending.clear(); save(); return 0; },
            reset() { seen.clear(); pending.clear(); save(); }
        };
    }
    // A background mirror highlights explicit mention ranges while the native
    // textarea keeps text, selection, undo, IME and screen-reader behavior.
    function composerHighlighter() {
        const mirrors = new WeakMap();
        function attach(el) {
            if (mirrors.has(el)) return mirrors.get(el);
            const focused = document.activeElement === el;
            const selection = [el.selectionStart, el.selectionEnd, el.selectionDirection];
            const wrapper = document.createElement('div'); wrapper.className = 'mention-editor';
            const viewport = document.createElement('div'); viewport.className = 'mention-mirror';
            viewport.setAttribute('aria-hidden', 'true');
            const text = document.createElement('div'); viewport.append(text);
            el.before(wrapper); wrapper.append(viewport, el);
            const entry = { wrapper, viewport, text, mentions: [] };
            mirrors.set(el, entry);
            const sync = () => {
                const style = getComputedStyle(el);
                for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textIndent', 'textAlign', 'textTransform', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) text.style[property] = style[property];
                viewport.style.left = `${el.offsetLeft + el.clientLeft}px`;
                viewport.style.top = `${el.offsetTop + el.clientTop}px`;
                viewport.style.width = `${el.clientWidth}px`;
                viewport.style.height = `${el.clientHeight}px`;
                text.style.width = `${el.clientWidth}px`;
                text.style.transform = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`;
            };
            entry.sync = sync;
            // Only the background is mirrored. Text remains native and opaque.
            entry.background = getComputedStyle(el).backgroundColor;
            el.addEventListener('scroll', sync, { passive: true });
            new ResizeObserver(sync).observe(el);
            sync();
            if (focused) { el.focus({ preventScroll: true }); el.setSelectionRange(...selection); }
            return entry;
        }
        return {
            render(el, mentions) {
                const entry = attach(el);
                const selected = clean(el.value, mentions);
                entry.wrapper.classList.toggle('has-mentions', selected.length > 0);
                entry.wrapper.style.backgroundColor = selected.length ? entry.background : 'transparent';
                SafeHtml.setHtml(entry.text, selected.length ? html(el.value, selected, true) + '\n' : '');
                entry.sync();
            }
        };
    }
    function install({ getAccounts, seed, avatarHTML, place }) {
        const states = new Map();
        const histories = new Map();
        let choosing = false;
        const highlighter = composerHighlighter();
        const menu = document.createElement('div');
        menu.className = 'popover mention-picker'; menu.hidden = true; menu.id = 'mention-picker'; menu.setAttribute('role', 'listbox'); menu.setAttribute('aria-label', 'Mention a person');
        document.body.append(menu);
        let active, match, choices = [], selected = 0;
        const eligible = el => el?.matches?.('#noteInput, #chatInput, textarea[data-field]');
        document.querySelectorAll('#noteInput, #chatInput').forEach(el => highlighter.render(el, []));
        const key = el => el.id || [el.closest('[data-note-id]')?.dataset.noteId, el.dataset.field, el.dataset.commentId || ''].join('/');
        function remember(id, value) {
            let history = histories.get(id);
            if (!history) histories.set(id, history = new Map());
            history.delete(value.text);
            history.set(value.text, clean(value.text, value.mentions));
            if (history.size > 20) history.delete(history.keys().next().value);
        }
        function state(el, inputType) {
            const id = key(el);
            let s = states.get(id);
            if (!s) { const initial = seed(el) || {}; s = { text: initial.text || el.value, mentions: initial.mentions || [] }; }
            const restored = /^history(?:Undo|Redo)$/.test(inputType || '') && histories.get(id)?.get(el.value);
            s = { text: el.value, mentions: restored || rebase(s.text, el.value, s.mentions) };
            states.set(id, s); remember(id, s); highlighter.render(el, s.mentions); return s;
        }
        function close() { menu.hidden = true; active?.removeAttribute('aria-controls'); active?.removeAttribute('aria-activedescendant'); }
        function choose(i) {
            const person = choices[i]; if (!active || !person) return;
            const el = active, s = state(el), name = '@' + person.name;
            const text = el.value.slice(0, match.index) + name + ' ' + el.value.slice(el.selectionStart);
            const mentions = rebase(el.value, text, s.mentions);
            mentions.push({ ...person, start: match.index, end: match.index + name.length });
            // Native insertion retains textarea undo/redo. execCommand is the
            // browser API that records a programmatic textarea edit; browsers
            // without it still get the same selection and input semantics.
            remember(key(el), s);
            el.focus(); el.setSelectionRange(match.index, el.selectionStart);
            choosing = true;
            try {
                try {
                    if (typeof document.execCommand === 'function') document.execCommand('insertText', false, name + ' ');
                } catch (_) { /* use the same safe fallback as an unsupported command */ }
                if (el.value !== text) el.value = text;
            } finally { choosing = false; }
            const next = { text, mentions: clean(text, mentions) };
            states.set(key(el), next); remember(key(el), next);
            el.setSelectionRange(match.index + name.length + 1, match.index + name.length + 1);
            close(); el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        function draw(el, inputType) {
            state(el, inputType); active = el;
            const prefix = el.value.slice(0, el.selectionStart);
            match = /(?:^|\s)@([^@\n]{0,60})$/.exec(prefix);
            if (!match || el.selectionStart !== el.selectionEnd) return close();
            match.index = prefix.lastIndexOf('@');
            choices = getAccounts().filter(p => p.name.toLowerCase().includes(match[1].toLowerCase())).slice(0, 8);
            if (!choices.length) return close();
            selected = 0;
            el.setAttribute('aria-controls', menu.id);
            el.setAttribute('aria-autocomplete', 'list');
            paint(); place(menu, el);
        }
        function paint() {
            active?.setAttribute('aria-activedescendant', `mention-choice-${selected}`);
            SafeHtml.setHtml(menu, choices.map((p, i) => `<button type="button" role="option" id="mention-choice-${i}" aria-selected="${i === selected}" data-choice="${i}">${avatarHTML(p.userId, p.name, 'sm', p.emailPrefix)}<span>${SafeHtml.escapeHtml(p.name)}${choices.filter(c => c.name === p.name).length > 1 ? `<small>Account ${choices.filter(c => c.name === p.name).findIndex(c => c.userId === p.userId) + 1}</small>` : ''}</span></button>`).join(''));
        }
        // Choose on click, not pointerdown, so a touch drag-scroll over a row doesn't pick it; mousedown keeps textarea focus.
        menu.addEventListener('mousedown', e => e.preventDefault());
        menu.addEventListener('click', e => { const b = e.target.closest('[data-choice]'); if (b) choose(Number(b.dataset.choice)); });
        document.addEventListener('input', e => {
            if (!eligible(e.target)) return;
            // The completion dispatches one final input event once its identity
            // ranges are in place; suppress the native intermediate event.
            if (choosing) { e.stopImmediatePropagation(); return; }
            if (e.isComposing) { state(e.target); close(); return; }
            draw(e.target, e.inputType);
        }, true);
        document.addEventListener('compositionstart', e => { if (eligible(e.target)) close(); });
        document.addEventListener('compositionend', e => { if (eligible(e.target)) draw(e.target); });
        document.addEventListener('focusin', e => { if (eligible(e.target)) state(e.target); else if (!menu.contains(e.target)) close(); });
        document.addEventListener('keydown', e => {
            if (menu.hidden || e.target !== active || e.isComposing || e.keyCode === 229 || e.ctrlKey || e.altKey || e.metaKey) return;
            if (e.key === 'Tab' && e.shiftKey) { close(); return; }
            if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'].includes(e.key)) {
                e.preventDefault(); e.stopImmediatePropagation();
                if (e.key === 'Escape') close();
                else if (e.key === 'Enter' || e.key === 'Tab') choose(selected);
                else { selected = (selected + (e.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length; paint(); }
            }
        }, true);
        document.addEventListener('pointerdown', e => { if (!menu.contains(e.target) && e.target !== active) close(); });
        window.addEventListener('resize', close); document.addEventListener('scroll', e => { if (!menu.contains(e.target)) close(); }, true);
        return {
            get(el, trimmed = true) { if (!el) return []; const s = state(el); const trim = trimmed ? el.value.length - el.value.trimStart().length : 0; return clean(trimmed ? el.value.trim() : el.value, s.mentions.map(m => ({ ...m, start: m.start - trim, end: m.end - trim }))); },
            set(el, mentions) { const selected = clean(el.value, mentions); const next = { text: el.value, mentions: selected }; states.set(key(el), next); histories.delete(key(el)); remember(key(el), next); highlighter.render(el, selected); },
            clear(el) { states.delete(key(el)); histories.delete(key(el)); highlighter.render(el, []); close(); }
        };
    }
    return { clean, has, html, labelHtml, labelMentions, rebase, accounts, createUnread, install };
}));
