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

// Try to require midi, but provide fallback if not available
let midi;
let input;
try {
    midi = require('midi');
    console.log('MIDI module loaded successfully');
    
    // Create a new MIDI input
    input = new midi.Input();
    
    // Count available MIDI ports
    const portCount = input.getPortCount();
    console.log(`Found ${portCount} MIDI ports:`);
    
    // List available ports
    for (let i = 0; i < portCount; i++) {
        console.log(`${i}: ${input.getPortName(i)}`);
    }
    
    // Try to open the first available port
    if (portCount > 0) {
        input.openPort(0);
        console.log(`Opened MIDI port: ${input.getPortName(0)}`);
    } else {
        console.log('No MIDI ports available. Running in demo mode.');
    }
} catch (error) {
    console.log('MIDI module not available, running in demo mode:', error.message);
    input = null;
}

// MIDI Timecode parsing
let quarterFrameData = new Array(8).fill(0);
let lastQuarterFrame = -1;

// Frame rate mapping from MTC
const frameRates = {
    0: 24,
    1: 25,
    2: 29.97,
    3: 30
};

function parseMTCQuarterFrame(data) {
    const messageType = data >> 4;
    const value = data & 0x0F;
    
    quarterFrameData[messageType] = value;
    
    // Check if we have a complete timecode frame (8 quarter frames)
    if (lastQuarterFrame !== -1 && messageType !== (lastQuarterFrame + 1) % 8) {
        // Out of sequence, reset
        quarterFrameData = new Array(8).fill(0);
    }
    
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
    
    globalState.timecode = {
        hours: hours,
        minutes: minutes,
        seconds: seconds,
        frames: frames,
        frameRate: frameRates[rateCode] || 30,
        source: 'midi'
    };
    
    // Broadcast to all connected clients
    io.emit('timecode-update', globalState.timecode);
    console.log(`MTC: ${formatTimecode(globalState.timecode)} (${globalState.timecode.frameRate} fps)`);
}

// Safe timecode formatting function
function formatTimecode(tc) {
    if (!tc || typeof tc !== 'object') {
        return '00:00:00:00';
    }
    return `${(tc.hours || 0).toString().padStart(2, '0')}:${(tc.minutes || 0).toString().padStart(2, '0')}:${(tc.seconds || 0).toString().padStart(2, '0')}:${(tc.frames || 0).toString().padStart(2, '0')}`;
}

// MIDI message handler
if (input) {
    input.on('message', (deltaTime, message) => {
        const [status, data1, data2] = message;
        
        // Check for MTC Quarter Frame messages (0xF1)
        if (status === 0xF1) {
            parseMTCQuarterFrame(data1);
        }
        // Check for Full Timecode messages (0xF0 SysEx)
        else if (status === 0xF0 && message.length >= 10) {
            console.log('Full MTC SysEx message received');
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
    
    // Send current state to newly connected client
    socket.emit('timecode-update', globalState.timecode);
    socket.emit('notes-update', globalState.notes);
    socket.emit('users-update', Array.from(globalState.users.values()));
    socket.emit('tags-update', globalState.tags);
    socket.emit('time-mode-update', globalState.timeMode);
    socket.emit('system-status', {
        midiAvailable: !!input,
        portCount: input ? input.getPortCount() : 0
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

// Demo mode for testing without MIDI hardware
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

// Start demo mode if no MIDI ports available
if (!input || input.getPortCount() === 0) {
    startDemoMode();
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`=================================`);
    console.log(`MIDI Timecode Notes Server`);
    console.log(`Running on http://localhost:${PORT}`);
    console.log(`=================================`);
});

// Cleanup on exit
process.on('SIGINT', () => {
    console.log('Shutting down...');
    if (demoInterval) clearInterval(demoInterval);
    if (input) input.closePort();
    process.exit();
});