const questions = require('../data/questions')

// In-memory store (use Redis in production)
const rooms = new Map()

function generateCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase()
}

function setupQuizNamespace(io) {
    const quiz = io.of('/quiz')

    quiz.on('connection', (socket) => {
        console.log(`[quiz] connected: ${socket.id}`)

        // Create room
        socket.on('create-room', ({ playerName }) => {
            const code = generateCode()
            const room = {
                code,
                status: 'waiting',
                players: [{ id: socket.id, name: playerName, ready: false, answered: false }],
                answers: [],
                results: null
            }
            rooms.set(code, room)
            socket.join(code)
            socket.emit('room-created', { code, playerId: socket.id })
            console.log(`[quiz] room created: ${code}`)
        })

        // Join room
        socket.on('join-room', ({ roomCode, playerName }) => {
            const room = rooms.get(roomCode)
            if (!room) return socket.emit('error', { message: 'Sala no encontrada. Verifica el código.' })
            if (room.players.length >= 2) return socket.emit('error', { message: 'La sala ya está llena.' })
            if (room.status !== 'waiting') return socket.emit('error', { message: 'El juego ya comenzó.' })

            room.players.push({ id: socket.id, name: playerName, ready: false, answered: false })
            socket.join(roomCode)
            socket.emit('room-joined', { code: roomCode, playerId: socket.id })

            // Notify both players
            quiz.to(roomCode).emit('room-update', { players: room.players })

            // Auto-start when 2 players
            if (room.players.length === 2) {
                setTimeout(() => {
                    room.status = 'playing'
                    quiz.to(roomCode).emit('game-start', { questions })
                    console.log(`[quiz] game started in room ${roomCode}`)
                }, 1500)
            }
        })

        // Get room state (for reconnects or refresh)
        socket.on('get-room-state', ({ roomCode }) => {
            const room = rooms.get(roomCode)
            if (room) {
                socket.emit('room-update', { players: room.players })
            }
        })

        // Submit answers
        socket.on('submit-answers', ({ roomCode, playerName, answers }) => {
            const room = rooms.get(roomCode)
            if (!room) return

            const player = room.players.find(p => p.id === socket.id)
            if (player) player.answered = true

            room.answers.push({ playerId: socket.id, playerName, answers })
            console.log(`[quiz] player ${playerName} submitted answers in ${roomCode}`)

            // Notify partner that this player answered
            socket.to(roomCode).emit('partner-answered')

            // If both answered, calculate results
            if (room.answers.length === 2) {
                const results = calculateResults(room)
                room.results = results
                room.status = 'finished'
                quiz.to(roomCode).emit('show-results')
                console.log(`[quiz] results calculated for ${roomCode}: ${results.percentage}%`)
            }
        })

        // Get results
        socket.on('get-results', ({ roomCode }) => {
            const room = rooms.get(roomCode)
            if (room?.results) {
                socket.emit('results-data', room.results)
            }
        })

        // Disconnect cleanup
        socket.on('disconnect', () => {
            console.log(`[quiz] disconnected: ${socket.id}`)
            for (const [code, room] of rooms.entries()) {
                const idx = room.players.findIndex(p => p.id === socket.id)
                if (idx !== -1) {
                    room.players.splice(idx, 1)
                    quiz.to(code).emit('room-update', { players: room.players })
                    // Clean up empty rooms after 5 min
                    if (room.players.length === 0) {
                        setTimeout(() => {
                            if (rooms.get(code)?.players.length === 0) rooms.delete(code)
                        }, 5 * 60 * 1000)
                    }
                    break
                }
            }
        })
    })
}

function calculateResults(room) {
    const [a1, a2] = room.answers
    const [p1, p2] = room.players

    let matched = 0
    const breakdown = questions.map(q => {
        const ans1 = a1.answers[q.id]
        const ans2 = a2.answers[q.id]
        const isMatch = ans1 === ans2
        if (isMatch) matched++
        return {
            questionId: q.id,
            questionText: q.text,
            emoji: q.emoji,
            player1Answer: q.options[ans1] ?? 'Sin respuesta',
            player2Answer: q.options[ans2] ?? 'Sin respuesta',
            matched: isMatch
        }
    })

    return {
        percentage: Math.round((matched / questions.length) * 100),
        matchedQuestions: matched,
        totalQuestions: questions.length,
        breakdown,
        players: [
            { name: p1?.name || a1.playerName },
            { name: p2?.name || a2.playerName }
        ]
    }
}

module.exports = { setupQuizNamespace }