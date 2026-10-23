// A separate, repeatable development instance with invented live/saved notes.
// Login settings still come from .env; normal notes, tags and backups are separate.
const { spawn } = require('node:child_process');
const path = require('node:path');
const root = path.join(__dirname, '..');
const state = path.join(root, '.playback-dev');
const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'server.js'], {
    cwd: root, stdio: 'inherit', env: {
        ...process.env,
        PORT: process.env.PLAYBACK_PORT || '3030',
        PLAYBACK_DEMO: '1',
        BACKUPS_DIR: path.join(state, 'backups'),
        SAVED_SHOWS_DIR: path.join(state, 'saved-shows'),
        RESETS_DIR: path.join(state, 'reset-notes'),
        RECORDINGS_DIR: path.join(state, 'recordings'),
        TAGS_FILE: path.join(state, 'tags.json')
    }
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code || 0; });
