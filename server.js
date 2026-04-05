const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { Server, Message, encode } = require('node-osc');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const eosHost = process.env.EOS_HOST || '10.10.160.143'; 
const eosPort = process.env.EOS_PORT || 3037; 

app.set('trust proxy', true);
io.engine.trustProxy = true; 

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

app.get('/overlay.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'overlay.html'));
});

app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'favicon.ico'));
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
        { id: 'safety', name: 'Safety/Show Critical', color: '#E63946' },
        { id: 'lighting', name: 'Lighting', color: '#00B4D8' },
        { id: 'sound', name: 'Sound', color: '#06D6A0' },
        { id: 'stage', name: 'Stage', color: '#118AB2' },
        { id: 'dsm', name: 'DSM', color: '#8AC926' },
        { id: 'set', name: 'Set', color: '#FF6f91' }
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
        source: 'midi'
    },
    notes: [],
    chatMessages: [],
    users: new Map(),
    timeMode: 'midi',
    tags: tags,
    currentLxCue: '1',
    currentAct: 'Preshow',
    anonymousUsers: new Map()
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

const connectMessage = new Message('/eos/subscribe=1');
const buffer = encode(connectMessage);

function subscribeToEOS() {
    let eosClient = new net.Socket();
    eosClient.connect(eosPort, eosHost);

    eosClient.on('connect', function() {
        console.log('Connected to EOS');
        eosClient.write(buffer);
    });

    eosClient.on('data', function(data) {
        console.log('Received: ' + data.toString().replace(/[^\x20-\x7E]/g, '').trim());
        let value = data.toString().replace(/[^\x20-\x7E]/g, '').trim()
        if(value.startsWith('/eos/out/active/cue/text')) {
            const cueMatch = value.split('/')
            if (cueMatch && cueMatch[6]) {
                const cueName = cueMatch[6].trim();
                console.log(`Extracted active LX cue: ${cueName}`);
                
                // Update global state
                globalState.currentLxCue = cueName;
                
                // Notify all clients
                io.emit('lx-cue-update', cueName);
            }
        }
    });

    eosClient.on('error', function(err) {
        console.log('Error connecting to EOS via TCP:', err);
    });
}

// OSC Server for LX Cues and scenes from qlab
let oscServer = null;
try {
    oscServer = new Server(8001, '0.0.0.0', () => {
        console.log('OSC Server is listening on port 8001 for LX cues and Scene info');
    });

    oscServer.on('message', function (msg) {
        
        // Parse OSC message for active cues
        // Messages we're interested in:
        // /eos/out/active/cue/text,1/199 B/O 1.0 2%
        // /eos/out/pending/cue/text,1/201 Start 1.0
        const address = msg[0];
        const value = msg[1];
        if (address === '/eos/out/active/cue/text' && value) {
            // Extract cue name from value like "1/199 B/O 1.0 2%"
            const cueMatch = value.match(/[^/]+\/(.+)/);
            if (cueMatch && cueMatch[1]) {
                const cueName = cueMatch[1].trim();
                console.log(`Extracted active LX cue: ${cueName}`);
                
                // Update global state
                globalState.currentLxCue = cueName;
                
                // Notify all clients
                io.emit('lx-cue-update', cueName);
            }
        } else if (address === '/eos/out/pending/cue/text' && value) {
            // Optionally handle pending cues too
            const cueMatch = value.match(/[^/]+\/(.+)/);
            if (cueMatch && cueMatch[1]) {
                const cueName = cueMatch[1].trim();
                console.log(`Extracted pending LX cue: ${cueName}`);
                
                // You could choose to update for pending cues too, or just log them
                // globalState.currentLxCue = `Pending: ${cueName}`;
                // io.emit('lx-cue-update', `Pending: ${cueName}`);
            }
        } else if (address.startsWith('/bts/')) {
            const act = value;
            if (act && act !== globalState.currentAct) {
                globalState.currentAct = act;
                console.log(`Updated current act to: ${act}`);
                io.emit('act-update', act);
            }
        }
    });

    oscServer.on('error', (err) => {
        console.log('OSC Server error:', err);
    });

} catch (error) {
    console.log('OSC Server not available:', error.message);
    console.log('LX cues will need to be entered manually');
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

function backup() {
    let data;
    const exportData = {
        notes: globalState.notes,
        exportedAt: new Date().toISOString(),
        totalNotes: globalState.notes.length,
        users: Array.from(globalState.users.values()).filter(u => !u.isOverlay).map(u => ({
            name: u.name,
            joinedAt: u.joinedAt
        })),
        tags: globalState.tags
    };
    data = JSON.stringify(exportData, null, 2);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${timestamp}.json`;
    try {
        fs.mkdirSync(path.join(__dirname, 'backups'), { recursive: true });
        fs.writeFileSync(path.join(__dirname, 'backups', filename), data);
        console.log(`Backup saved to backups/${filename}`);
    } catch (error) {
        console.log('Error saving backup file:', error.message);
    }
}

// Schedule backups every minute
setInterval(backup, 1 * 60 * 1000);

// Delete backups older than 1 day
setInterval(() => {
    const backupDir = path.join(__dirname, 'backups');
    fs.readdir(backupDir, (err, files) => {
        if (err) return;
        const now = Date.now();
        files.forEach(file => {
            const filePath = path.join(backupDir, file);
            fs.stat(filePath, (err, stats) => {
                if (err) return;
                const age = now - stats.mtimeMs;
                if (age > 24 * 60 * 60 * 1000) {
                    fs.unlink(filePath, (error) => {
                        if (error) return;
                        console.log(`Deleted old backup file: ${file}`);
                    });
                }
            });
        });
    });
}, 24 * 60 * 60 * 1000);

// Backups on errors and graceful shutdown
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    backup();
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    backup();
    process.exit(1);
});

process.on('SIGINT', () => {
    console.log('Received SIGINT. Backing up and shutting down...');
    backup();
    process.exit(0);
});


// WebSocket connections
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    let clientIP = socket.handshake.address;
    const forwardedFor = socket.handshake.headers['x-forwarded-for'];
    if (forwardedFor) {
        // X-Forwarded-For may contain multiple IPs; the leftmost is the original client
        clientIP = forwardedFor.split(',')[0].trim();
    }
    const userIP = clientIP.replace(/^.*:/, '');
    const isOverlay = socket.handshake.headers.referer && 
                     (socket.handshake.headers.referer.includes('overlay.html') || socket.handshake.headers.referer.includes('overlay-cast.html'));
    
    const user = {
        id: socket.id,
        name: isOverlay ? `Overlay-${userIP}` : userIP,
        isTyping: false,
        currentTimecode: null,
        currentLxCue: null,
        joinedAt: new Date(),
        isOverlay: isOverlay,
        isAnonymous: !isOverlay // Regular users start as anonymous until they set a name
    };
    
    globalState.users.set(socket.id, user);
    
    // Track anonymous users for cleanup
    if (!isOverlay) {
        globalState.anonymousUsers.set(socket.id, {
            joinedAt: new Date(),
            ip: userIP
        });
        
        // Set timeout to remove anonymous users after 15 minutes
        setTimeout(() => {
            if (globalState.users.has(socket.id)) {
                const user = globalState.users.get(socket.id);
                if (user.isAnonymous && !user.isOverlay) {
                    console.log(`Automatically disconnecting anonymous user ${socket.id} after 15 minutes`);
                    socket.disconnect(true);
                }
            }
            globalState.anonymousUsers.delete(socket.id);
        }, 900000); // 15 minutes
    }

    // Send current state to newly connected client
    socket.emit('act-update', globalState.currentAct);
    socket.emit('timecode-update', globalState.timecode);
    socket.emit('notes-update', globalState.notes);
    socket.emit('tags-update', globalState.tags);
    socket.emit('time-mode-update', globalState.timeMode);
    socket.emit('lx-cue-update', globalState.currentLxCue);
    socket.emit('system-status', {
        midiAvailable: !!midiInput,
        portCount: midiInput ? require('easymidi').getInputs().length : 0,
        currentPort: openedPortName,
        mtcMessagesReceived: mtcMessagesReceived,
        oscAvailable: !!oscServer
    });

    // Only send user-related updates if this is NOT an overlay
    if (!isOverlay) {
        socket.emit('user-initial-name', userIP);
        
        // Send filtered users list (excluding overlay users)
        const filteredUsers = Array.from(globalState.users.values()).filter(u => !u.isOverlay);
        socket.emit('users-update', filteredUsers);
        
        // Notify about new user joining (only for non-overlay users)
        io.emit('user-joined', {
            user: user.name,
            userCount: filteredUsers.length
        });
    } else {
        // Overlay users get minimal user info
        socket.emit('users-update', []);
    }

    // Handle note tag updates
    socket.on('note-update-tags', (data) => {
        if (user.isOverlay) return;
        const { noteId, tags } = data;
        const note = globalState.notes.find(n => n.id === noteId);
        if (note) {
            note.tags = tags;
            io.emit('note-update-tags', { noteId, tags });
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
    
    // Handle user starting to type (only for non-overlay users)
    socket.on('typing-start', (data) => {
        if (user.isOverlay) return; // Overlay users can't type
        
        user.isTyping = true;
        user.currentTimecode = data.timecode || {...globalState.timecode};
        user.currentLxCue = data.lxCue || globalState.currentLxCue;
        
        // Send filtered users list (excluding overlay users)
        const filteredUsers = Array.from(globalState.users.values()).filter(u => !u.isOverlay);
        io.emit('users-update', filteredUsers);
    });
    
    // Handle user stopping typing (only for non-overlay users)
    socket.on('typing-stop', () => {
        if (user.isOverlay) return; // Overlay users can't type
        
        user.isTyping = false;
        user.currentTimecode = null;
        user.currentLxCue = null;
        
        // Send filtered users list (excluding overlay users)
        const filteredUsers = Array.from(globalState.users.values()).filter(u => !u.isOverlay);
        io.emit('users-update', filteredUsers);
    });
    
    // Handle time mode change (only for non-overlay users)
    socket.on('time-mode-change', (newMode) => {
        if (user.isOverlay) return; // Overlay users can't change time mode
        
        if (newMode === 'midi' || newMode === 'realtime') {
            globalState.timeMode = newMode;
            io.emit('time-mode-update', globalState.timeMode);
        }
    });

    // Handle LX Cue change (manual input - will be overridden by OSC)
    socket.on('lx-cue-change', (newCue) => {
        if (user.isOverlay) return; // Overlay users can't change LX cues
        
        // Only update if OSC is not available, or allow manual override
        if (!oscServer) {
            globalState.currentLxCue = newCue;
            io.emit('lx-cue-update', globalState.currentLxCue);
        } else {
            // OSC is available, so manual changes are temporary
            // You could choose to still update or ignore manual changes
            console.log('Manual LX cue change ignored - OSC source is active');
        }
    });
    
    // Handle note submission (only for non-overlay users)
    socket.on('note-submit', (data) => {
        if (user.isOverlay) return;
        
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
            act: globalState.currentAct, // Use current act from OSC
            comments: []
        };
        
        globalState.notes.push(note);
        
        io.emit('note-added', note);
    });

    // Handle comment submission (only for non-overlay users)
    socket.on('comment-submit', (data) => {
        if (user.isOverlay) return;
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
            if (!note.comments) note.comments = [];
            note.comments.push(comment);
            io.emit('comment-submit', { noteId, comment });
        }
    });

    // Handle chat message submission (only for non-overlay users)
    socket.on('chat-message', (data) => {
        if (user.isOverlay) return; // Overlay users can't chat
        
        const chatMessage = {
            id: Date.now() + Math.random().toString(36).substr(2, 9),
            user: user.name,
            userId: user.id,
            text: data.text,
            timestamp: new Date().toISOString()
        };
        
        globalState.chatMessages.push(chatMessage);
        
        // Keep only last 100 messages to prevent memory issues
        if (globalState.chatMessages.length > 100) {
            globalState.chatMessages = globalState.chatMessages.slice(-100);
        }
        
        io.emit('chat-message-added', chatMessage);
        io.emit('chat-messages-update', globalState.chatMessages);
    });

    // Send chat history to newly connected clients (only for non-overlay)
    if (!isOverlay) {
        socket.emit('chat-messages-update', globalState.chatMessages);
    }

    // Handle note text editing (only for non-overlay users)
    socket.on('note-edit-text', (data) => {
        if (user.isOverlay) return;
        const { noteId, newText } = data;
        const note = globalState.notes.find(n => n.id === noteId);
        if (note) {
            note.text = newText;
            note.lastEdited = new Date().toISOString();
            note.lastEditedBy = user.name;
            io.emit('note-edit-text', { 
                noteId, 
                newText, 
                lastEditedBy: user.name, 
                lastEdited: note.lastEdited 
            });
        }
    });
    // Handle comment editing (only for non-overlay users)
    socket.on('comment-edit', (data) => {
        if (user.isOverlay) return;
        const { noteId, commentId, newText } = data;
        const note = globalState.notes.find(n => n.id === noteId);
        if (note && note.comments) {
            const comment = note.comments.find(c => c.id === commentId);
            if (comment) {
                comment.text = newText;
                comment.lastEdited = new Date().toISOString();
                comment.lastEditedBy = user.name;
                io.emit('comment-edit', { 
                    noteId, 
                    commentId, 
                    newText, 
                    lastEditedBy: user.name, 
                    lastEdited: comment.lastEdited 
                });
            }
        }
    });
    // Handle comment deletion (only for non-overlay users)
    socket.on('comment-delete', (data) => {
        if (user.isOverlay) return;
        const { noteId, commentId } = data;
        const note = globalState.notes.find(n => n.id === noteId);
        if (note && note.comments) {
            note.comments = note.comments.filter(c => c.id !== commentId);
            io.emit('comment-delete', { noteId, commentId });
        }
    });
    
    // Handle user name changes with uniqueness check (only for non-overlay users)
    socket.on('user-name-change', (newName) => {
        if (user.isOverlay) return;
        const isNameTaken = Array.from(globalState.users.values()).some(
            u => u.id !== user.id && u.name.toLowerCase() === newName.toLowerCase() && !u.isOverlay
        );
        if (isNameTaken) {
            socket.emit('name-change-error', { message: `Name "${newName}" is already taken.` });
        } else {
            const oldName = user.name;
            user.name = newName;
            user.isAnonymous = false;
            globalState.anonymousUsers.delete(socket.id);
            
            // Update user's name in all notes and comments
            globalState.notes.forEach(note => {
                if (note.userId === user.id) note.user = newName;
                if (note.comments) {
                    note.comments.forEach(comment => {
                        if (comment.userId === user.id) comment.user = newName;
                    });
                }
            });
            
            io.emit('user-name-changed', {
                userId: user.id,
                oldName: oldName,
                newName: newName
            });
            
            const filteredUsers = Array.from(globalState.users.values()).filter(u => !u.isOverlay);
            io.emit('users-update', filteredUsers);
            socket.emit('name-change-success', { message: `Name changed from "${oldName}" to "${newName}"` });
        }
    });
    
    // Handle backup import (only for non‑overlay users)
    socket.on('import-backup', (data) => {
        if (user.isOverlay) return; // Overlay users can't import

        // Validate that the backup contains a notes array and optionally tags
        if (data && Array.isArray(data.notes)) {
            globalState.notes = data.notes;
            
            // Restore tags if present in backup
            if (data.tags && Array.isArray(data.tags)) {
                globalState.tags = data.tags;
                saveTagsToFile(); // Save to tags.json
            }

            // Broadcast updates to all clients
            io.emit('notes-update', globalState.notes);
            io.emit('tags-update', globalState.tags);

            // Notify the importer of success
            socket.emit('import-success', 'Backup imported successfully.');
        } else {
            socket.emit('import-error', 'Invalid backup format (missing notes array).');
        }
    });

    // Handle export requests (only for non-overlay users)
    socket.on('export-request', (format) => {
        if (user.isOverlay) return; // Overlay users can't export
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        let data, mimeType, filename;
        
        if (format === 'json') {
            const exportData = {
                notes: globalState.notes,
                exportedAt: new Date().toISOString(),
                totalNotes: globalState.notes.length,
                users: Array.from(globalState.users.values()).filter(u => !u.isOverlay).map(u => ({
                    name: u.name,
                    joinedAt: u.joinedAt
                })),
                tags: globalState.tags
            };
            data = JSON.stringify(exportData, null, 2);
            mimeType = 'application/json';
            filename = `timecoded-notes-${timestamp}.json`;
        }
        socket.emit('export-data', { data, mimeType, filename });
    });
    
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        const user = globalState.users.get(socket.id);
        if (user) {
            globalState.users.delete(socket.id);
            
            // Only notify if this was NOT an overlay user
            if (!user.isOverlay) {
                const filteredUsers = Array.from(globalState.users.values()).filter(u => !u.isOverlay);
                io.emit('user-left', {
                    user: user.name,
                    userCount: filteredUsers.length
                });
                io.emit('users-update', filteredUsers);
            }
        }
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

if (midiInput) {
    console.log('MIDI device detected - listening for timecode');
} else {
    console.log('No MIDI devices detected - MIDI timecode disabled');
    // Set time mode to realtime if no MIDI available
    globalState.timeMode = 'realtime';
}

const PORT = process.env.PORT || 80;
server.listen(PORT, () => {
    console.log(`MIDI Timecode Notes Server running on http://localhost:${PORT}`);
    if (oscServer) {
        console.log('OSC Server listening for LX cues on port 8001');
    }
    
    subscribeToEOS();
});

process.on('SIGINT', () => {
    if (midiInput) midiInput.close();
    if (oscServer) oscServer.close();
    process.exit();
});