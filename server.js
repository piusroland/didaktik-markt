const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const BASE_SYSTEM_PROMPT = `Du bist ein lustiger Verkäufer auf einem Markt. Sprachniveau: A1/A2.
Regeln:
1. Der Kunde muss genau 3 Artikel kaufen. Er muss dafür IMMER ein Adjektiv benutzen.
2. Wenn das Adjektiv fehlt oder falsch dekliniert ist: Sag, dass du ihn nicht verstehst (z.B. "Wie bitte? Welchen möchtest du?"). 
3. WICHTIG: Nenne NIEMALS die korrekte grammatikalische Endung des Artikels als Tipp! Der Kunde muss selbst darauf kommen.
4. Verkaufe den Artikel nur, wenn das Adjektiv 100% korrekt dekliniert ist (meistens Akkusativ).
5. Wenn der Kunde erfolgreich kauft, reagiere erfreut.
6. Wenn der Status zeigt, dass der Kunde 3 Artikel im Korb hat, bedanke dich für den Einkauf und verabschiede dich ("Tschüss!").

Antworte AUSSCHLIESSLICH im JSON-Format:
{
  "vendor_reply": "Deine Antwort an den Kunden",
  "grammar_correct": true_oder_false,
  "didactic_feedback": "Erklärung des Fehlers für den Schüler (z.B. 'Akkusativ, Maskulinum = -en'). Leer lassen, wenn alles richtig ist.",
  "item_bought": "Name und Icon des gekauften Artikels (z.B. '🍎 Roter Apfel', '🥖 Altes Brot') ODER null, falls nichts verkauft wurde",
  "checkout_complete": true_oder_false (true wenn 3 Artikel im Korb sind und das Gespräch endet)
}`;

app.post('/api/chat', async (req, res) => {
    try {
        // Inject the current basket count into the AI's instructions
        const dynamicSystemPrompt = BASE_SYSTEM_PROMPT + `\nSTATUS: Der Kunde hat aktuell ${req.body.basketCount} Artikel im Korb.`;
        
        const messages = [
            { role: 'system', content: dynamicSystemPrompt },
            ...req.body.history // Spread the conversation history sent from the frontend
        ];

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'qwen/qwen3.8-27b',
                messages: messages,
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
let teamSizes = {}; // NEU: Speichert die Anzahl der Spieler pro Team
let globalTimer = 60;
let timerInterval = null;

io.on('connection', (socket) => {
    socket.emit('state_update', { state: classroomState, timer: globalTimer, teams });
    socket.emit('teacher_update', { players, teams, state: classroomState });

    // --- Student Actions ---
    socket.on('student_join', (name) => {
        players[socket.id] = { name: name, team: null };
        io.emit('teacher_update', { players, teams, state: classroomState });
    });

    socket.on('add_point', (data) => {
        if (classroomState === 'multiplayer' && teams[data.team] !== undefined) {
            let pointsToApply = data.points;
            
            // Balancing: Wenn das Team aus 3 Spielern besteht, Punkte mit 2/3 multiplizieren und abrunden
            if (teamSizes[data.team] === 3) {
                pointsToApply = Math.floor(pointsToApply * (2 / 3));
            }
            
            teams[data.team] += pointsToApply;
            io.emit('teacher_update', { players, teams, state: classroomState });
        }
    });

    // --- Teacher Actions ---
    socket.on('open_lobby', () => {
        classroomState = 'lobby';
        players = {}; 
        teams = {};
        teamSizes = {}; // Reset beim Start einer neuen Lobby
        io.emit('state_update', { state: classroomState, timer: 60, teams });
        io.emit('teacher_update', { players, teams, state: classroomState });
    });

    socket.on('assign_team', (studentIds) => {
        const studentNames = studentIds.map(id => players[id].name);
        const teamName = studentNames.join(' & ');
        
        teams[teamName] = 0;
        teamSizes[teamName] = studentIds.length; // Speichere, wie viele Spieler in diesem Team sind
        
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
// --------------------------------------------

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));