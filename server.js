const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const BASE_SYSTEM_PROMPT = `Rolle:Marktverkäufer(A1/A2). Inventar=Nominativ. Kunde MUSS ganzen Satz(mit Verb) & richtige Endung(Akkusativ) nutzen.
REGELN: Nie Grammatik/Regeln/Zahl 3 erwähnen. Keine Kunden-Tippfehler zitieren.
BEISPIELE:
1.Kein Verb("rote Tomate"): {"vendor_reply":"Eine Tomate? Was möchtest du damit machen? Kaufen?","grammar_correct":false,"item_bought":null,"checkout_complete":false}
2.Falsche Endung("einen grünen Tomate"): {"vendor_reply":"Wie bitte? Welche meinst du?","grammar_correct":false,"item_bought":null,"checkout_complete":false}
3.Korrekt("Ich nehme die grüne Tomate"): {"vendor_reply":"Sehr gerne! Hier.","grammar_correct":true,"item_bought":"🍅 Grüne Tomate","checkout_complete":false}
4.Schon im Korb: {"vendor_reply":"Das hast du schon!","grammar_correct":false,"item_bought":null,"checkout_complete":false}
Antworte NUR in JSON!`;

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

// --- ÜBUNG 1, 2 & 3: Global State ---
let activeExercise = 'u1';       // NEU: Steuert, welcher Tab aktiv ist ('u1', 'u2', 'u3')
let wimmelbildMode = 'nom';      
let classroomState = 'practice'; 
let players = {};
let teams = {};
let teamSizes = {};
let globalTimer = 60;
let timerInterval = null;

io.on('connection', (socket) => {
    // Send initial state to tablets connecting late
    socket.emit('state_update', { 
        state: classroomState, 
        timer: globalTimer, 
        teams, 
        wimmelbildMode,
        activeExercise: activeExercise 
    });
    socket.emit('teacher_update', { players, teams, state: classroomState });

    // --- NEU: Teacher Action für Übung 1 ---
    socket.on('set_wimmelbild_mode', (mode) => {
        wimmelbildMode = mode;
        io.emit('wimmelbild_update', wimmelbildMode); // Send to all tablets
    });

    socket.on('set_active_exercise', (exerciseId) => {
        activeExercise = exerciseId;
        io.emit('exercise_update', activeExercise);
    });

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