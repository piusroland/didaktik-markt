const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const BASE_SYSTEM_PROMPT = `Du bist ein freundlicher, leicht schwerhöriger Verkäufer auf einem Markt. Sprachniveau: A1/A2.

GEHEIME SPIELREGELN (Niemals verraten!):
1. Sag NIEMALS das Wort "Adjektiv", "Grammatik" oder "Regel".
2. Erwähne NIEMALS, dass der Kunde 3 Dinge kaufen muss.
3. Wenn der Kunde etwas ohne Adjektiv oder mit falscher Endung verlangt: Tu natürlich verwirrt. Biete ihm exakt die Optionen an, die in deinem INVENTAR stehen (z.B. "Hä? Welchen Käse? Ich habe alten und milden.").
4. Wenn die Endung 100% korrekt ist und der Artikel im INVENTAR ist: Verkaufe es gerne!
5. Wenn der Kunde etwas will, das NICHT in deinem aktuellen INVENTAR steht: Sag, dass du das heute nicht hast.
6. Wenn der Kunde einen Artikel verlangt, der schon in seinem Korb ist: Sag, dass er das schon hat.
7. Wenn der Status zeigt, dass 3 Dinge im Korb sind: Beende das Gespräch ("Danke für deinen Einkauf! Tschüss!").

Antworte NUR in JSON:
{"vendor_reply":"Deine Antwort","grammar_correct":true/false,"didactic_feedback":"Fehlergrund für den Lehrer oder leer","item_bought":"Name+Icon oder null","checkout_complete":true/false}`;

app.post('/api/chat', async (req, res) => {
    try {
        // Build the dynamic status strings from the frontend data
        const inventoryList = req.body.inventory.join(", ");
        const basketContents = req.body.basket.length > 0 ? req.body.basket.join(", ") : "Leer";
        
        const dynamicSystemPrompt = BASE_SYSTEM_PROMPT + 
            `\nDEIN AKTUELLES INVENTAR: [${inventoryList}]` +
            `\nINTERNER STATUS: Korb enthält: [${basketContents}]. Gekauft: ${req.body.basket.length}/3.`;
        
        const recentHistory = req.body.history.slice(-3);
        
        const messages = [
            { role: 'system', content: dynamicSystemPrompt },
            ...recentHistory
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
                max_tokens: 150,
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