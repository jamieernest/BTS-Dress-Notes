const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Add explicit route for root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Add route for recall page
app.get('/recall.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'recall.html'));
});

// Load tags from JSON file
let tags = [];
try {
    const tagsData = fs.readFileSync(path.join(__dirname, 'tags.json'), 'utf8');
    const tagsConfig = JSON.parse(tagsData);
    tags = tagsConfig.tags;
    console.log(`Loaded ${tags.length} tags from tags.json`);
} catch (error) {
    console.log('Error loading tags.json, using default tags:', error.message);
    tags = [
        { id: 'lighting', name: 'Lighting', color: '#FF6B6B' },
        { id: 'sound', name: 'Sound', color: '#4ECDC4' },
        { id: 'stage', name: 'Stage', color: '#45B7D1' },
        { id: 'general', name: 'General', color: '#F7DC6F' }
    ];
}

// Function to save tags to file
function saveTagsToFile() {
    try {
        fs.writeFileSync(path.join(__dirname, 'tags.json'), JSON.stringify({ tags: tags }, null, 2));
    } catch (error) {
        console.log('Error saving tags to file:', error.message);
    }
}

// Global state
const globalState = {
    timecode: {
        hours: 0,
        minutes: 0,
        seconds: 0,
        frames: 0,
        frameRate: 30,
        source: 'demo'
    },
    notes: [],
    users: new Map(),
    timeMode: 'midi',
    tags: tags,
    currentLxCue: '1' // Start with cue 1
};

// Try to use EasyMIDI
let midiInput = null;
let openedPortName = 'None';
let mtcMessagesReceived = 0;

try {
    const easymidi = require('easymidi');
    console.log('EasyMIDI module loaded successfully');
    
    const inputs = easymidi.getInputs();
    console.log('Available MIDI inputs:', inputs);
    
    if (inputs.length > 1) {
        const inputName = inputs[1];
        midiInput = new easymidi.Input(inputName);
        openedPortName = inputName;
        globalState.timecode.source = 'midi';
    } else if (inputs.length > 0) {
        const inputName = inputs[0];
        midiInput = new easymidi.Input(inputName);
        openedPortName = inputName;
        globalState.timecode.source = 'midi';
    } else {
        console.log('No MIDI inputs available. Running in demo mode.');
    }
} catch (error) {
    console.log('EasyMIDI not available:', error.message);
}

// MIDI Timecode parsing
let quarterFrameData = new Array(8).fill(0);
let lastQuarterFrame = -1;
let lastFullTimecode = null;

const frameRates = {
    0: 24,
    1: 25,
    2: 29.97,
    3: 30
};

function parseEasyMIDIMTC(messageType, value) {
    quarterFrameData[messageType] = value;
    mtcMessagesReceived++;
    
    lastQuarterFrame = messageType;
    
    if (messageType === 7) {
        parseCompleteMTC();
    }
}

function parseCompleteMTC() {
    const frames = (quarterFrameData[1] << 4) | quarterFrameData[0];
    const seconds = (quarterFrameData[3] << 4) | quarterFrameData[2];
    const minutes = (quarterFrameData[5] << 4) | quarterFrameData[4];
    const hoursAndRate = (quarterFrameData[7] << 4) | quarterFrameData[6];
    
    const hours = hoursAndRate & 0x1F;
    const rateCode = (hoursAndRate >> 5) & 0x03;
    
    const newTimecode = {
        hours: hours,
        minutes: minutes,
        seconds: seconds,
        frames: frames,
        frameRate: frameRates[rateCode] || 30,
        source: 'midi'
    };
    
    if (!lastFullTimecode || 
        lastFullTimecode.hours !== newTimecode.hours ||
        lastFullTimecode.minutes !== newTimecode.minutes ||
        lastFullTimecode.seconds !== newTimecode.seconds ||
        lastFullTimecode.frames !== newTimecode.frames) {
        
        globalState.timecode = newTimecode;
        lastFullTimecode = {...newTimecode};
        
        io.emit('timecode-update', globalState.timecode);
    }
}

function formatTimecode(tc) {
    if (!tc || typeof tc !== 'object') {
        return '00:00:00:00';
    }
    return `${(tc.hours || 0).toString().padStart(2, '0')}:${(tc.minutes || 0).toString().padStart(2, '0')}:${(tc.seconds || 0).toString().padStart(2, '0')}:${(tc.frames || 0).toString().padStart(2, '0')}`;
}

// EasyMIDI message handler
if (midiInput) {
    midiInput.on('message', (msg) => {
        if (msg._type === 'mtc' && typeof msg.type === 'number' && typeof msg.value === 'number') {
            parseEasyMIDIMTC(msg.type, msg.value);
        }
        else if (msg.bytes && Array.isArray(msg.bytes)) {
            const [status, data1] = msg.bytes;
            if (status === 0xF1) {
                const messageType = data1 >> 4;
                const value = data1 & 0x0F;
                parseEasyMIDIMTC(messageType, value);
            }
        }
    });
}

// WebSocket connections
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    const user = {
        id: socket.id,
        name: `User${Math.floor(Math.random() * 1000)}`,
        isTyping: false,
        currentTimecode: null,
        currentLxCue: null,
        joinedAt: new Date()
    };
    globalState.users.set(socket.id, user);

    // Send current state to newly connected client
    socket.emit('timecode-update', globalState.timecode);
    socket.emit('notes-update', globalState.notes);
    socket.emit('users-update', Array.from(globalState.users.values()));
    socket.emit('tags-update', globalState.tags);
    socket.emit('time-mode-update', globalState.timeMode);
    socket.emit('lx-cue-update', globalState.currentLxCue);
    socket.emit('system-status', {
        midiAvailable: !!midiInput,
        portCount: midiInput ? require('easymidi').getInputs().length : 0,
        currentPort: openedPortName,
        mtcMessagesReceived: mtcMessagesReceived
    });

    // Notify about new user joining
    io.emit('user-joined', {
        user: user.name,
        userCount: globalState.users.size
    });

    // Handle note tag updates
    socket.on('note-update-tags', (data) => {
        const { noteId, tags } = data;
        const note = globalState.notes.find(n => n.id === noteId);
        
        if (note) {
            note.tags = tags;
            io.emit('notes-update', globalState.notes);
        }
    });

    // Handle tag creation/updates
    socket.on('create-tag', (tagData) => {
        const newTag = {
            id: tagData.id || generateId(),
            name: tagData.name,
            color: tagData.color || getRandomColor()
        };
        
        const existingIndex = globalState.tags.findIndex(tag => tag.id === newTag.id);
        if (existingIndex >= 0) {
            globalState.tags[existingIndex] = newTag;
        } else {
            globalState.tags.push(newTag);
        }
        
        saveTagsToFile();
        io.emit('tags-update', globalState.tags);
    });

    // Handle tag deletion
    socket.on('delete-tag', (tagId) => {
        globalState.tags = globalState.tags.filter(tag => tag.id !== tagId);
        saveTagsToFile();
        io.emit('tags-update', globalState.tags);
    });
    
    // Handle user starting to type
    socket.on('typing-start', (data) => {
        user.isTyping = true;
        user.currentTimecode = data.timecode || {...globalState.timecode};
        user.currentLxCue = data.lxCue || globalState.currentLxCue;
        io.emit('users-update', Array.from(globalState.users.values()));
    });
    
    // Handle user stopping typing
    socket.on('typing-stop', () => {
        user.isTyping = false;
        user.currentTimecode = null;
        user.currentLxCue = null;
        io.emit('users-update', Array.from(globalState.users.values()));
    });
    
    // Handle time mode change
    socket.on('time-mode-change', (newMode) => {
        if (newMode === 'midi' || newMode === 'realtime') {
            globalState.timeMode = newMode;
            io.emit('time-mode-update', globalState.timeMode);
        }
    });

    // Handle LX Cue change
    socket.on('lx-cue-change', (newCue) => {
        globalState.currentLxCue = newCue;
        io.emit('lx-cue-update', globalState.currentLxCue);
    });
    
    // Handle note submission
    socket.on('note-submit', (data) => {
        const noteTimecode = data.timecode || {...globalState.timecode};
        
        const note = {
            id: Date.now() + Math.random().toString(36).substr(2, 9),
            user: user.name,
            userId: user.id,
            text: data.text,
            timecode: noteTimecode,
            lxCue: data.lxCue || globalState.currentLxCue,
            timestamp: new Date().toISOString(),
            frameRate: data.frameRate || globalState.timecode.frameRate,
            tags: data.tags || [],
            comments: [] // Initialize empty comments array
        };
        
        globalState.notes.push(note);
        
        io.emit('note-added', note);
        io.emit('notes-update', globalState.notes);
    });

    // Handle comment submission
    socket.on('comment-submit', (data) => {
        const { noteId, text } = data;
        const note = globalState.notes.find(n => n.id === noteId);
        
        if (note) {
            const comment = {
                id: Date.now() + Math.random().toString(36).substr(2, 9),
                user: user.name,
                userId: user.id,
                text: text,
                timestamp: new Date().toISOString()
            };
            
            if (!note.comments) {
                note.comments = [];
            }
            
            note.comments.push(comment);
            io.emit('notes-update', globalState.notes);
        }
    });
    
    // Handle user name changes with uniqueness check
    socket.on('user-name-change', (newName) => {
        // Check if name is already taken by another user
        const isNameTaken = Array.from(globalState.users.values()).some(
            u => u.id !== user.id && u.name.toLowerCase() === newName.toLowerCase()
        );
        
        if (isNameTaken) {
            socket.emit('name-change-error', {
                message: `Name "${newName}" is already taken. Please choose a different name.`
            });
        } else {
            const oldName = user.name;
            user.name = newName;
            
            // Update the user's name in all their notes and comments
            globalState.notes.forEach(note => {
                if (note.userId === user.id) {
                    note.user = newName;
                }
                // Update user name in comments
                if (note.comments) {
                    note.comments.forEach(comment => {
                        if (comment.userId === user.id) {
                            comment.user = newName;
                        }
                    });
                }
            });
            
            io.emit('users-update', Array.from(globalState.users.values()));
            io.emit('notes-update', globalState.notes);
            
            socket.emit('name-change-success', {
                message: `Name changed from "${oldName}" to "${newName}"`
            });
        }
    });
    
    // Handle export requests
    socket.on('export-request', (format) => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        let data, mimeType, filename;
        
        if (format === 'json') {
            const exportData = {
                notes: globalState.notes,
                exportedAt: new Date().toISOString(),
                totalNotes: globalState.notes.length,
                users: Array.from(globalState.users.values()).map(u => ({
                    name: u.name,
                    joinedAt: u.joinedAt
                })),
                tags: globalState.tags
            };
            data = JSON.stringify(exportData, null, 2);
            mimeType = 'application/json';
            filename = `timecoded-notes-${timestamp}.json`;
        } else if (format === 'csv') {
            let csvContent = 'User,Timecode,LX Cue,Frame Rate,Note,Tags,Comments,Timestamp\n';
            
            globalState.notes.forEach(note => {
                const commentsStr = note.comments ? note.comments.map(c => `${c.user}: ${c.text}`).join('; ') : '';
                const row = [
                    `"${note.user}"`,
                    `"${formatTimecode(note.timecode)}"`,
                    `"${note.lxCue || ''}"`,
                    `"${note.frameRate}"`,
                    `"${note.text.replace(/"/g, '""')}"`,
                    `"${note.tags.join(', ')}"`,
                    `"${commentsStr}"`,
                    `"${note.timestamp}"`
                ].join(',');
                csvContent += row + '\n';
            });
            
            data = csvContent;
            mimeType = 'text/csv';
            filename = `timecoded-notes-${timestamp}.csv`;
        }
        
        socket.emit('export-data', { data, mimeType, filename });
    });
    
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        const user = globalState.users.get(socket.id);
        if (user) {
            io.emit('user-left', {
                user: user.name,
                userCount: globalState.users.size - 1
            });
        }
        globalState.users.delete(socket.id);
        io.emit('users-update', Array.from(globalState.users.values()));
    });
});

// Helper functions for tags
function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

function getRandomColor() {
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F'];
    return colors[Math.floor(Math.random() * colors.length)];
}

// Demo mode
let demoInterval;
function startDemoMode() {
    if (demoInterval) {
        clearInterval(demoInterval);
    }
    
    demoInterval = setInterval(() => {
        globalState.timecode.frames++;
        
        let maxFrames = globalState.timecode.frameRate;
        if (globalState.timecode.frameRate === 29.97) {
            maxFrames = 30;
        }
        
        if (globalState.timecode.frames >= maxFrames) {
            globalState.timecode.frames = 0;
            globalState.timecode.seconds++;
        }
        
        if (globalState.timecode.seconds >= 60) {
            globalState.timecode.seconds = 0;
            globalState.timecode.minutes++;
        }
        
        if (globalState.timecode.minutes >= 60) {
            globalState.timecode.minutes = 0;
            globalState.timecode.hours++;
        }
        
        if (globalState.timecode.hours >= 24) {
            globalState.timecode.hours = 0;
        }
        
        globalState.timecode.source = 'demo';
        io.emit('timecode-update', globalState.timecode);
    }, 1000 / globalState.timecode.frameRate);
}

if (!midiInput) {
    startDemoMode();
} else {
    console.log('MIDI device detected - demo mode disabled');
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`MIDI Timecode Notes Server running on http://localhost:${PORT}`);
});

process.on('SIGINT', () => {
    if (demoInterval) clearInterval(demoInterval);
    if (midiInput) midiInput.close();
    process.exit();
});