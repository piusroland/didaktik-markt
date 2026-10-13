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
1. Sag NIEMALS Wörter wie "Adjektiv", "Grammatik", "Endung" oder "Regel". Zitiere NIEMALS die direkte Eingabe des Kunden (z.B. sag nicht "Du hast X gesagt").
2. Erwähne NIEMALS, dass der Kunde 3 Dinge kaufen muss.
3. BEWERTUNG DER GRAMMATIK: Ignoriere kleine Tippfehler bei Verben oder Pronomen (z.B. "wolle" statt "will"). Solange das Nomen und das Adjektiv die richtige Endung haben (z.B. "die grüne Tomate" im Akkusativ), MUSST du die Eingabe als korrekt akzeptieren!
4. WENN KORREKT: Setze "grammar_correct": true, lass "didactic_feedback" komplett leer und verkaufe den Artikel sofort mit einer natürlichen Reaktion.
5. WENN FALSCH (falsches/fehlendes Adjektiv): Setze "grammar_correct": false. Tu natürlich verwirrt und biete Optionen aus dem INVENTAR an (z.B. "Hä? Welche Tomate? Ich habe rote und grüne.").
6. Wenn der Artikel NICHT im INVENTAR ist: Sag, dass du ihn nicht hast.
7. Wenn der Artikel schon im Korb ist: Sag, dass er ihn schon gekauft hat.
8. Wenn 3 Dinge im Korb sind: Beende das Gespräch ("Danke für den Einkauf! Tschüss!").

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