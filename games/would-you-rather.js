const dilemmas = require('../data/dilemmas')

// In-memory store (use Redis in production)
const rooms = new Map()

function generateCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase()
}

function setupWYRNamespace(io) {
    const wyr = io.of('/would-you-rather')

    wyr.on('connection', (socket) => {
        console.log(`[wyr] connected: ${socket.id}`)

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
            console.log(`[wyr] room created: ${code}`)
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
            wyr.to(roomCode).emit('room-update', { players: room.players })

            // Auto-start when 2 players
            if (room.players.length === 2) {
                setTimeout(() => {
                    room.status = 'playing'
                    wyr.to(roomCode).emit('game-start', { dilemmas })
                    console.log(`[wyr] game started in room ${roomCode}`)
                }, 1500)
            }
        })

        // Get room state (for reconnects)
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
            console.log(`[wyr] player ${playerName} submitted answers in ${roomCode}`)

            // Notify partner
            socket.to(roomCode).emit('partner-answered')

            // If both answered, calculate results
            if (room.answers.length === 2) {
                const results = calculateResults(room)
                room.results = results
                room.status = 'finished'
                wyr.to(roomCode).emit('show-results')
                console.log(`[wyr] results calculated for ${roomCode}: ${results.percentage}%`)
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
            console.log(`[wyr] disconnected: ${socket.id}`)
            for (const [code, room] of rooms.entries()) {
                const idx = room.players.findIndex(p => p.id === socket.id)
                if (idx !== -1) {
                    room.players.splice(idx, 1)
                    wyr.to(code).emit('room-update', { players: room.players })
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
    const breakdown = dilemmas.map(d => {
        const ans1 = a1.answers[d.id] // 'A' or 'B'
        const ans2 = a2.answers[d.id]
        const isMatch = ans1 === ans2
        if (isMatch) matched++
        return {
            dilemmaId: d.id,
            emoji: d.emoji,
            optionA: d.optionA,
            optionB: d.optionB,
            player1Choice: ans1 ?? null,
            player2Choice: ans2 ?? null,
            matched: isMatch
        }
    })

    return {
        percentage: Math.round((matched / dilemmas.length) * 100),
        matchedCount: matched,
        totalCount: dilemmas.length,
        breakdown,
        players: [
            { name: p1?.name || a1.playerName },
            { name: p2?.name || a2.playerName }
        ]
    }
}

module.exports = { setupWYRNamespace }