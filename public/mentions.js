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
    function html(text, raw) {
        text = String(text || '');
        let at = 0;
        let result = '';
        for (const m of clean(text, raw)) {
            result += SafeHtml.escapeHtml(text.slice(at, m.start)) + `<strong class="mention">${SafeHtml.escapeHtml(text.slice(m.start, m.end))}</strong>`;
            at = m.end;
        }
        return result + SafeHtml.escapeHtml(text.slice(at));
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
    function install({ getAccounts, seed, avatarHTML, place }) {
        const states = new Map();
        const menu = document.createElement('div');
        menu.className = 'popover mention-picker'; menu.hidden = true; menu.id = 'mention-picker'; menu.setAttribute('role', 'listbox'); menu.setAttribute('aria-label', 'Mention a person');
        document.body.append(menu);
        let active, match, choices = [], selected = 0;
        const eligible = el => el?.matches?.('#noteInput, #chatInput, textarea[data-field]');
        const key = el => el.id || [el.closest('[data-note-id]')?.dataset.noteId, el.dataset.field, el.dataset.commentId || ''].join('/');
        function state(el) {
            const id = key(el);
            let s = states.get(id);
            if (!s) { const initial = seed(el) || {}; s = { text: initial.text || el.value, mentions: initial.mentions || [] }; }
            s = { text: el.value, mentions: rebase(s.text, el.value, s.mentions) };
            states.set(id, s); return s;
        }
        function close() { menu.hidden = true; active?.removeAttribute('aria-controls'); }
        function choose(i) {
            const person = choices[i]; if (!active || !person) return;
            const el = active, s = state(el), name = '@' + person.name;
            const text = el.value.slice(0, match.index) + name + ' ' + el.value.slice(el.selectionStart);
            const mentions = rebase(el.value, text, s.mentions);
            mentions.push({ ...person, start: match.index, end: match.index + name.length });
            el.value = text; states.set(key(el), { text, mentions });
            el.focus(); el.setSelectionRange(match.index + name.length + 1, match.index + name.length + 1);
            close(); el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        function draw(el) {
            state(el); active = el;
            const prefix = el.value.slice(0, el.selectionStart);
            match = /(?:^|\s)@([^@\n]{0,60})$/.exec(prefix);
            if (!match || el.selectionStart !== el.selectionEnd) return close();
            match.index = prefix.lastIndexOf('@');
            choices = getAccounts().filter(p => p.name.toLowerCase().includes(match[1].toLowerCase())).slice(0, 8);
            if (!choices.length) return close();
            selected = 0;
            el.setAttribute('aria-controls', menu.id);
            paint(); place(menu, el);
        }
        function paint() {
            SafeHtml.setHtml(menu, choices.map((p, i) => `<button type="button" role="option" aria-selected="${i === selected}" data-choice="${i}">${avatarHTML(p.userId, p.name, 'sm', p.emailPrefix)}<span>${SafeHtml.escapeHtml(p.name)}${choices.filter(c => c.name === p.name).length > 1 ? `<small>Account ${SafeHtml.escapeHtml(p.userId)}</small>` : ''}</span></button>`).join(''));
        }
        menu.addEventListener('pointerdown', e => { const b = e.target.closest('[data-choice]'); if (b) { e.preventDefault(); choose(Number(b.dataset.choice)); } });
        document.addEventListener('input', e => { if (eligible(e.target)) draw(e.target); }, true);
        document.addEventListener('focusin', e => { if (eligible(e.target)) state(e.target); else if (!menu.contains(e.target)) close(); });
        document.addEventListener('keydown', e => {
            if (menu.hidden || e.target !== active || e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return;
            if (e.key === 'Tab' && e.shiftKey) { close(); return; }
            if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'].includes(e.key)) {
                e.preventDefault(); e.stopImmediatePropagation();
                if (e.key === 'Escape') close();
                else if (e.key === 'Enter' || e.key === 'Tab') choose(selected);
                else { selected = (selected + (e.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length; paint(); }
            }
        }, true);
        document.addEventListener('pointerdown', e => { if (!menu.contains(e.target) && e.target !== active) close(); });
        window.addEventListener('resize', close); document.addEventListener('scroll', close, true);
        return {
            get(el, trimmed = true) { if (!el) return []; const s = state(el); const trim = trimmed ? el.value.length - el.value.trimStart().length : 0; return clean(trimmed ? el.value.trim() : el.value, s.mentions.map(m => ({ ...m, start: m.start - trim, end: m.end - trim }))); },
            set(el, mentions) { states.set(key(el), { text: el.value, mentions: clean(el.value, mentions) }); },
            clear(el) { states.delete(key(el)); close(); }
        };
    }
    return { clean, has, html, rebase, accounts, createUnread, install };
}));
