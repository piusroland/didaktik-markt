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

// --- ÜBUNG 2: Lobby & Teacher Pairing Logic ---
const players = {}; // socket.id -> { name, team }
const teams = {};   // teamName -> score

io.on('connection', (socket) => {
    console.log('Verbunden:', socket.id);
    
    // Send current state to teacher dashboard
    socket.emit('teacher_update', { players, teams });
    socket.emit('leaderboard_update', teams);

    // 1. Student enters their name
    socket.on('student_join', (name) => {
        players[socket.id] = { name: name, team: null };
        io.emit('teacher_update', { players, teams }); // Update teacher screen
    });

    // 2. Teacher pairs students into a team
    socket.on('assign_team', (data) => {
        const { teamName, studentIds } = data;
        
        if (!teams[teamName]) teams[teamName] = 0; // Initialize score
        
        studentIds.forEach(id => {
            if (players[id]) {
                players[id].team = teamName;
                io.to(id).emit('team_assigned', teamName); // Wake up the student's tablet
            }
        });
        
        io.emit('teacher_update', { players, teams });
        io.emit('leaderboard_update', teams);
    });

    // 3. Gameplay scoring
    socket.on('add_point', (teamName) => {
        if (teams[teamName] !== undefined) {
            teams[teamName] += 10;
            io.emit('leaderboard_update', teams); 
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('teacher_update', { players, teams });
    });
});
// --------------------------------------------

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));