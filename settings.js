// Settings changed from the config page, kept in a local JSON file so they
// survive a restart. A missing or unreadable file means no saved settings.
const fs = require('fs');

function loadSettings(file) {
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.log(`Settings: ignoring unreadable ${file}: ${error.message}`);
        }
        return {};
    }
}

function saveSettings(file, settings) {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n');
    fs.renameSync(tmp, file);
}

module.exports = { loadSettings, saveSettings };
