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

io.on('connection', (socket) => {
    console.log('Tablet verbunden:', socket.id);
    
    socket.on('team_score_update', (data) => {
        io.emit('board_update', data); 
    });

    socket.on('disconnect', () => {
        console.log('Tablet getrennt');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));