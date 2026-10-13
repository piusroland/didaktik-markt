const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const SYSTEM_PROMPT = `Du bist ein lauter, lustiger Verkäufer auf einem Markt. 
Sprachniveau: A1/A2. 
Regel: Verkaufe NUR, wenn der Kunde ein Adjektiv benutzt (z.B. "den roten Apfel"). 
Wenn kein Adjektiv benutzt wird, frage nach (z.B. "Einen roten oder grünen?").
Antworte AUSSCHLIESSLICH im JSON-Format:
{
  "vendor_reply": "Deine Antwort",
  "grammar_check": true_oder_false,
  "didactic_feedback": "Kurze Erklärung"
}`;

app.post('/api/chat', async (req, res) => {
    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'qwen/qwen3.8-27b',
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: req.body.message }
                ],
                temperature: 0.3,
                response_format: { type: "json_object" }
            })
        });
        const data = await response.json();
        res.json(JSON.parse(data.choices[0].message.content));
    } catch (error) {
        res.status(500).json({ error: "Fehler bei der KI-Verbindung" });
    }
});

// --- ÜBUNG 2: Dual-Mode Logic ---
let classroomState = 'practice'; // 'practice', 'lobby', 'multiplayer', 'scoreboard'
let players = {};
let teams = {};
let globalTimer = 60;
let timerInterval = null;

io.on('connection', (socket) => {
    // Send current state immediately upon connection
    socket.emit('state_update', { state: classroomState, timer: globalTimer, teams });
    socket.emit('teacher_update', { players, teams, state: classroomState });

    // --- Student Actions ---
    socket.on('student_join', (name) => {
        players[socket.id] = { name: name, team: null };
        io.emit('teacher_update', { players, teams, state: classroomState });
    });

    socket.on('add_point', (data) => {
        // Only count server points if multiplayer is active
        if (classroomState === 'multiplayer' && teams[data.team] !== undefined) {
            teams[data.team] += data.points;
            io.emit('teacher_update', { players, teams, state: classroomState });
        }
    });

    // --- Teacher Actions ---
    socket.on('open_lobby', () => {
        classroomState = 'lobby';
        players = {}; // Reset for new session
        teams = {};
        io.emit('state_update', { state: classroomState, timer: 60, teams });
        io.emit('teacher_update', { players, teams, state: classroomState });
    });

    socket.on('assign_team', (studentIds) => {
        // Auto-generate name: "Name 1 & Name 2"
        const studentNames = studentIds.map(id => players[id].name);
        const teamName = studentNames.join(' & ');
        
        teams[teamName] = 0;
        
        studentIds.forEach(id => {
            if (players[id]) {
                players[id].team = teamName;
                io.to(id).emit('team_assigned', teamName);
            }
        });
        io.emit('teacher_update', { players, teams, state: classroomState });
    });

    socket.on('start_multiplayer', () => {
        classroomState = 'multiplayer';
        globalTimer = 60;
        io.emit('state_update', { state: classroomState, timer: globalTimer, teams });
        
        clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            globalTimer--;
            io.emit('timer_tick', globalTimer);
            
            if (globalTimer <= 0) {
                clearInterval(timerInterval);
                classroomState = 'scoreboard';
                io.emit('state_update', { state: classroomState, timer: 0, teams });
            }
        }, 1000);
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('teacher_update', { players, teams, state: classroomState });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));