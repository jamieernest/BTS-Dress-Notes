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

// Test endpoints for debugging
app.get('/test-timecode', (req, res) => {
    const testTimecode = {
        hours: 1,
        minutes: 23,
        seconds: 45,
        frames: 15,
        frameRate: 30,
        source: 'test'
    };
    
    globalState.timecode = testTimecode;
    io.emit('timecode-update', testTimecode);
    
    console.log(`🧪 Sent test timecode: ${formatTimecode(testTimecode)}`);
    res.send(`Test timecode sent: ${formatTimecode(testTimecode)}`);
});

app.get('/server-status', (req, res) => {
    res.json({
        timecode: globalState.timecode,
        midiConnected: !!midiInput,
        portName: openedPortName,
        mtcMessagesReceived: mtcMessagesReceived,
        connectedClients: globalState.users.size
    });
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
    // Default tags if file doesn't exist
    tags = [
        { id: 'safety', name: 'Safety', color: '#96CEB4' },
        { id: 'technical', name: 'Technical', color: '#FFEAA7' },
        { id: 'artistic', name: 'Artistic', color: '#DDA0DD' },
        { id: 'lighting', name: 'Lighting', color: '#FF6B6B' },
        { id: 'sound', name: 'Sound', color: '#4ECDC4' },
        { id: 'stage', name: 'Stage', color: '#45B7D1' },
        { id: 'dsm', name: 'DSM', color: '#98D8C8' }
    ];
    
    // Save default tags to tags.json for future use
    try {
        fs.writeFileSync(path.join(__dirname, 'tags.json'), JSON.stringify({ tags: tags }, null, 2));
        console.log('Created tags.json with default tags');
    } catch (writeError) {
        console.log('Could not create tags.json:', writeError.message);
    }
}

// Function to save tags to file
function saveTagsToFile() {
    try {
        fs.writeFileSync(path.join(__dirname, 'tags.json'), JSON.stringify({ tags: tags }, null, 2));
        console.log('Tags saved to tags.json');
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
    notes: [], // Array of note objects with timestamps
    users: new Map(),
    timeMode: 'midi', // 'midi' or 'realtime'
    tags: tags
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
        // Try to use the second input
        const inputName = inputs[1];
        console.log(`Trying to open: "${inputName}"`);
        
        midiInput = new easymidi.Input(inputName);
        openedPortName = inputName;
        console.log(`✓ Successfully opened MIDI input: "${inputName}"`);
        globalState.timecode.source = 'midi';
        
    } else if (inputs.length > 0) {
        // Fallback to first input
        const inputName = inputs[0];
        console.log(`Only one input available, using: "${inputName}"`);
        
        midiInput = new easymidi.Input(inputName);
        openedPortName = inputName;
        console.log(`✓ Successfully opened MIDI input: "${inputName}"`);
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

// Frame rate mapping from MTC
const frameRates = {
    0: 24,
    1: 25,
    2: 29.97,
    3: 30
};

// NEW: Function to handle EasyMIDI's MTC format
function parseEasyMIDIMTC(messageType, value) {
    
    quarterFrameData[messageType] = value;
    mtcMessagesReceived++;
    
    // Don't do sequence checking for now - just accept all quarter frames
    lastQuarterFrame = messageType;
    
    // If we have all 8 quarter frames, parse the complete timecode
    if (messageType === 7) {
        parseCompleteMTC();
    }
}

function parseCompleteMTC() {
    // Reconstruct timecode from quarter frames
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
    
    // Only update if timecode actually changed
    if (!lastFullTimecode || 
        lastFullTimecode.hours !== newTimecode.hours ||
        lastFullTimecode.minutes !== newTimecode.minutes ||
        lastFullTimecode.seconds !== newTimecode.seconds ||
        lastFullTimecode.frames !== newTimecode.frames) {
        
        globalState.timecode = newTimecode;
        lastFullTimecode = {...newTimecode};
        
        // Broadcast to all connected clients
        io.emit('timecode-update', globalState.timecode);
    }
}

// Safe timecode formatting function
function formatTimecode(tc) {
    if (!tc || typeof tc !== 'object') {
        return '00:00:00:00';
    }
    return `${(tc.hours || 0).toString().padStart(2, '0')}:${(tc.minutes || 0).toString().padStart(2, '0')}:${(tc.seconds || 0).toString().padStart(2, '0')}:${(tc.frames || 0).toString().padStart(2, '0')}`;
}

// EasyMIDI message handler - UPDATED for EasyMIDI format
if (midiInput) {
    midiInput.on('message', (msg) => {
        
        // Handle EasyMIDI's MTC format directly
        if (msg._type === 'mtc' && typeof msg.type === 'number' && typeof msg.value === 'number') {
            parseEasyMIDIMTC(msg.type, msg.value);
        }
        // Handle raw bytes format (backup)
        else if (msg.bytes && Array.isArray(msg.bytes)) {
            const [status, data1] = msg.bytes;
            
            // Check for MTC Quarter Frame messages (0xF1)
            if (status === 0xF1) {
                const messageType = data1 >> 4;
                const value = data1 & 0x0F;
                console.log(`✅ Raw MTC: type=${messageType}, value=${value}`);
                parseEasyMIDIMTC(messageType, value);
            }
        }
        // Log other message types for debugging
        else {
            console.log('📝 Other MIDI message:', msg);
        }
    });
}

// WebSocket connections
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    // Create user object
    const user = {
        id: socket.id,
        name: `User${Math.floor(Math.random() * 1000)}`,
        isTyping: false,
        currentTimecode: null,
        joinedAt: new Date()
    };
    globalState.users.set(socket.id, user);

    // Send current state to newly connected client
    console.log('Sending initial state to client:', socket.id);
    socket.emit('timecode-update', globalState.timecode);
    socket.emit('notes-update', globalState.notes);
    socket.emit('users-update', Array.from(globalState.users.values()));
    socket.emit('tags-update', globalState.tags);
    socket.emit('time-mode-update', globalState.timeMode);
    socket.emit('system-status', {
        midiAvailable: !!midiInput,
        portCount: midiInput ? require('easymidi').getInputs().length : 0,
        currentPort: openedPortName,
        mtcMessagesReceived: mtcMessagesReceived
    });

    // Handle note tag updates - ALLOW ANYONE TO EDIT
    socket.on('note-update-tags', (data) => {
        const { noteId, tags } = data;
        const note = globalState.notes.find(n => n.id === noteId);
        
        if (note) {
            note.tags = tags;
            
            // Broadcast updated notes to all clients
            io.emit('notes-update', globalState.notes);
            console.log(`${user.name} updated tags for note ${noteId}: ${tags.join(', ')}`);
        }
    });

    // Handle tag creation/updates
    socket.on('create-tag', (tagData) => {
        const newTag = {
            id: tagData.id || generateId(),
            name: tagData.name,
            color: tagData.color || getRandomColor()
        };
        
        // Check if tag already exists
        const existingIndex = globalState.tags.findIndex(tag => tag.id === newTag.id);
        if (existingIndex >= 0) {
            globalState.tags[existingIndex] = newTag;
        } else {
            globalState.tags.push(newTag);
        }
        
        // Save to file
        saveTagsToFile();
        
        // Broadcast to all clients
        io.emit('tags-update', globalState.tags);
        console.log(`${user.name} ${existingIndex >= 0 ? 'updated' : 'created'} tag: ${newTag.name}`);
    });

    // Handle tag deletion
    socket.on('delete-tag', (tagId) => {
        globalState.tags = globalState.tags.filter(tag => tag.id !== tagId);
        
        // Save to file
        saveTagsToFile();
        
        // Broadcast to all clients
        io.emit('tags-update', globalState.tags);
        console.log(`${user.name} deleted tag: ${tagId}`);
    });
    
    // Handle user starting to type
    socket.on('typing-start', (timecode) => {
        user.isTyping = true;
        user.currentTimecode = timecode || {...globalState.timecode};
        io.emit('users-update', Array.from(globalState.users.values()));
        console.log(`${user.name} started typing at ${formatTimecode(user.currentTimecode)}`);
    });
    
    // Handle user stopping typing
    socket.on('typing-stop', () => {
        user.isTyping = false;
        user.currentTimecode = null;
        io.emit('users-update', Array.from(globalState.users.values()));
    });
    
    // Handle time mode change (GLOBAL)
    socket.on('time-mode-change', (newMode) => {
        if (newMode === 'midi' || newMode === 'realtime') {
            globalState.timeMode = newMode;
            // Broadcast to ALL clients
            io.emit('time-mode-update', globalState.timeMode);
            console.log(`Time mode changed to: ${newMode} (by ${user.name})`);
        }
    });
    
    // Handle note submission
    socket.on('note-submit', (data) => {
        // Ensure we have valid timecode data
        const noteTimecode = data.timecode || {...globalState.timecode};
        
        const note = {
            id: Date.now() + Math.random().toString(36).substr(2, 9),
            user: user.name,
            userId: user.id,
            text: data.text,
            timecode: noteTimecode,
            timestamp: new Date().toISOString(),
            frameRate: data.frameRate || globalState.timecode.frameRate,
            tags: data.tags || [] // Add tags to note
        };
        
        globalState.notes.push(note);
        
        // Broadcast new note to all clients
        io.emit('note-added', note);
        io.emit('notes-update', globalState.notes);
        
        console.log(`${user.name} added note at ${formatTimecode(noteTimecode)} with tags: ${note.tags.join(', ')} - ${data.text.substring(0, 50)}...`);
    });
    
    // Handle user name changes
    socket.on('user-name-change', (newName) => {
        user.name = newName;
        io.emit('users-update', Array.from(globalState.users.values()));
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
            // Create CSV header
            let csvContent = 'User,Timecode,Frame Rate,Note,Tags,Timestamp\n';
            
            // Add each note as a row
            globalState.notes.forEach(note => {
                const row = [
                    `"${note.user}"`,
                    `"${formatTimecode(note.timecode)}"`,
                    `"${note.frameRate}"`,
                    `"${note.text.replace(/"/g, '""')}"`,
                    `"${note.tags.join(', ')}"`,
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

// Demo mode for testing without MIDI hardware - ONLY RUN IF NO MIDI PORTS
let demoInterval;
function startDemoMode() {
    console.log('Starting demo mode with simulated MTC');
    
    if (demoInterval) {
        clearInterval(demoInterval);
    }
    
    demoInterval = setInterval(() => {
        globalState.timecode.frames++;
        
        // Handle frame rollover based on frame rate
        let maxFrames = globalState.timecode.frameRate;
        if (globalState.timecode.frameRate === 29.97) {
            maxFrames = 30; // Simplified for demo
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

// Start demo mode ONLY if no MIDI inputs are available
if (!midiInput) {
    startDemoMode();
} else {
    console.log('MIDI device detected - demo mode disabled');
    console.log('Waiting for MTC messages on port:', openedPortName);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`=================================`);
    console.log(`MIDI Timecode Notes Server`);
    console.log(`Running on http://localhost:${PORT}`);
    console.log(`=================================`);
    console.log(`Debug endpoints:`);
    console.log(`  Test timecode: http://localhost:${PORT}/test-timecode`);
    console.log(`  Server status: http://localhost:${PORT}/server-status`);
});

// Cleanup on exit
process.on('SIGINT', () => {
    console.log('Shutting down...');
    if (demoInterval) clearInterval(demoInterval);
    if (midiInput) midiInput.close();
    process.exit();
});