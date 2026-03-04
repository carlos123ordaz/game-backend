/**
 * ═══════════════════════════════════════════
 *  PUZZLE GAME — Server namespace
 * ═══════════════════════════════════════════
 *
 *  Competitive jigsaw puzzle:
 *  - 2 players race to complete the same puzzle
 *  - Same image + same shuffle (seed-based)
 *  - Real-time progress sync
 *  - Winner = first to complete (or higher % at timeout)
 */

// ── Puzzle image catalog (real photos) ──
const PUZZLE_IMAGES = [
    { id: 0, name: 'Aurora Boreal', emoji: '🌌', url: 'https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=800&h=800&fit=crop&crop=center' },
    { id: 1, name: 'Atardecer', emoji: '🌅', url: 'https://images.unsplash.com/photo-1495616811223-4d98c6e9c869?w=800&h=800&fit=crop&crop=center' },
    { id: 2, name: 'Océano', emoji: '🌊', url: 'https://images.unsplash.com/photo-1518837695005-2083093ee35b?w=800&h=800&fit=crop&crop=center' },
    { id: 3, name: 'Bosque', emoji: '🌲', url: 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=800&h=800&fit=crop&crop=center' },
    { id: 4, name: 'Galaxia', emoji: '🪐', url: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=800&h=800&fit=crop&crop=center' },
    { id: 5, name: 'Desierto', emoji: '🏜️', url: 'https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?w=800&h=800&fit=crop&crop=center' },
    { id: 6, name: 'Montañas', emoji: '🏔️', url: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&h=800&fit=crop&crop=center' },
    { id: 7, name: 'Ciudad', emoji: '🌃', url: 'https://images.unsplash.com/photo-1514565131-fce0801e5785?w=800&h=800&fit=crop&crop=center' },
    { id: 8, name: 'Flores', emoji: '🌸', url: 'https://images.unsplash.com/photo-1490750967868-88aa4f44baee?w=800&h=800&fit=crop&crop=center' },
]

const DIFFICULTY = {
    easy: { gridSize: 3, timeLimit: 120 },
    medium: { gridSize: 4, timeLimit: 180 },
    hard: { gridSize: 5, timeLimit: 300 },
}

// In-memory store
const rooms = new Map()

function generateCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase()
}

function generateSeed() {
    return Math.floor(Math.random() * 2147483647)
}

/**
 * Seeded shuffle — deterministic so both players get same scramble
 * Uses Mulberry32 PRNG
 */
function seededShuffle(array, seed) {
    const arr = [...array]
    let s = seed

    function mulberry32() {
        s |= 0; s = s + 0x6D2B79F5 | 0
        let t = Math.imul(s ^ s >>> 15, 1 | s)
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
        return ((t ^ t >>> 14) >>> 0) / 4294967296
    }

    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(mulberry32() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]]
    }

    // Ensure puzzle is not already solved
    const isSolved = arr.every((val, idx) => val === idx)
    if (isSolved && arr.length > 1) {
        [arr[0], arr[1]] = [arr[1], arr[0]]
    }

    return arr
}

function setupPuzzleNamespace(io) {
    const puzzle = io.of('/puzzle')

    puzzle.on('connection', (socket) => {
        console.log(`[puzzle] connected: ${socket.id}`)

        // ── Create room ──
        socket.on('create-room', ({ playerName }) => {
            const code = generateCode()
            const room = {
                code,
                status: 'waiting',       // waiting | countdown | playing | finished
                difficulty: 'medium',
                imageIndex: Math.floor(Math.random() * PUZZLE_IMAGES.length),
                seed: generateSeed(),
                host: socket.id,
                players: [{
                    id: socket.id,
                    name: playerName,
                    ready: false,
                    answered: false,
                    progress: 0,
                    moves: 0,
                    completed: false,
                    completionTime: null,
                    pieces: null,           // track each player's board state
                }],
                startTime: null,
                results: null,
                timer: null,
            }
            rooms.set(code, room)
            socket.join(code)
            socket.emit('room-created', { code, playerId: socket.id })

            // Send room state so host sees themselves in the player list
            socket.emit('room-update', {
                players: room.players.map(p => ({
                    id: p.id, name: p.name, ready: p.ready, answered: p.answered
                })),
                difficulty: room.difficulty,
                imageIndex: room.imageIndex,
            })
            console.log(`[puzzle] room created: ${code}`)
        })

        // ── Join room ──
        socket.on('join-room', ({ roomCode, playerName }) => {
            const room = rooms.get(roomCode)
            if (!room) return socket.emit('error', { message: 'Sala no encontrada. Verifica el código.' })
            if (room.players.length >= 2) return socket.emit('error', { message: 'La sala ya está llena.' })
            if (room.status !== 'waiting') return socket.emit('error', { message: 'El juego ya comenzó.' })

            room.players.push({
                id: socket.id,
                name: playerName,
                ready: false,
                answered: false,
                progress: 0,
                moves: 0,
                completed: false,
                completionTime: null,
                pieces: null,
            })
            socket.join(roomCode)
            socket.emit('room-joined', { code: roomCode, playerId: socket.id })

            puzzle.to(roomCode).emit('room-update', {
                players: room.players.map(p => ({
                    id: p.id, name: p.name, ready: p.ready, answered: p.answered
                })),
                difficulty: room.difficulty,
                imageIndex: room.imageIndex,
            })

            // Auto-start countdown when 2 players join
            if (room.players.length === 2) {
                startCountdown(puzzle, room)
            }
        })

        // ── Host changes settings (while waiting) ──
        socket.on('change-settings', ({ roomCode, difficulty, imageIndex }) => {
            const room = rooms.get(roomCode)
            if (!room || room.host !== socket.id || room.status !== 'waiting') return

            if (difficulty && DIFFICULTY[difficulty]) room.difficulty = difficulty
            if (imageIndex !== undefined && PUZZLE_IMAGES[imageIndex]) room.imageIndex = imageIndex

            puzzle.to(roomCode).emit('settings-updated', {
                difficulty: room.difficulty,
                imageIndex: room.imageIndex,
            })
        })

        // ── Get room state (reconnects) ──
        socket.on('get-room-state', ({ roomCode }) => {
            const room = rooms.get(roomCode)
            if (!room) return

            socket.emit('room-update', {
                players: room.players.map(p => ({
                    id: p.id, name: p.name, ready: p.ready, answered: p.answered
                })),
                difficulty: room.difficulty,
                imageIndex: room.imageIndex,
            })
        })

        // ── Player moves a piece ──
        socket.on('move-piece', ({ roomCode, fromIndex, toIndex, pieces, correctCount, moveCount }) => {
            const room = rooms.get(roomCode)
            if (!room || room.status !== 'playing') return

            const player = room.players.find(p => p.id === socket.id)
            if (!player || player.completed) return

            const totalPieces = DIFFICULTY[room.difficulty].gridSize ** 2
            player.moves = moveCount
            player.progress = Math.round((correctCount / totalPieces) * 100)
            player.pieces = pieces

            // Broadcast progress to opponent
            socket.to(roomCode).emit('opponent-progress', {
                playerId: socket.id,
                playerName: player.name,
                progress: player.progress,
                moves: player.moves,
            })

            // Check if player completed the puzzle
            if (correctCount === totalPieces) {
                player.completed = true
                player.completionTime = Date.now() - room.startTime

                // Notify opponent
                socket.to(roomCode).emit('opponent-completed', {
                    playerName: player.name,
                    time: player.completionTime,
                })

                // Check if game is over
                const allCompleted = room.players.every(p => p.completed)
                if (allCompleted || room.players.length === 2) {
                    // Game ends when first player completes
                    endGame(puzzle, room)
                }
            }
        })

        // ── Get results ──
        socket.on('get-results', ({ roomCode }) => {
            const room = rooms.get(roomCode)
            if (room?.results) {
                socket.emit('results-data', room.results)
            }
        })

        // ── Disconnect ──
        socket.on('disconnect', () => {
            console.log(`[puzzle] disconnected: ${socket.id}`)
            for (const [code, room] of rooms.entries()) {
                const idx = room.players.findIndex(p => p.id === socket.id)
                if (idx !== -1) {
                    const playerName = room.players[idx].name
                    room.players.splice(idx, 1)

                    puzzle.to(code).emit('room-update', {
                        players: room.players.map(p => ({
                            id: p.id, name: p.name, ready: p.ready, answered: p.answered
                        })),
                        difficulty: room.difficulty,
                        imageIndex: room.imageIndex,
                    })

                    puzzle.to(code).emit('player-left', { playerName })

                    // If game was in progress and only 1 player left, they win
                    if (room.status === 'playing' && room.players.length === 1) {
                        room.players[0].completed = true
                        room.players[0].completionTime = Date.now() - room.startTime
                        endGame(puzzle, room)
                    }

                    // Clean up empty rooms
                    if (room.players.length === 0) {
                        if (room.timer) clearTimeout(room.timer)
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

function startCountdown(namespace, room) {
    room.status = 'countdown'
    const config = DIFFICULTY[room.difficulty]
    const totalPieces = config.gridSize ** 2
    const indices = Array.from({ length: totalPieces }, (_, i) => i)
    const shuffled = seededShuffle(indices, room.seed)

    namespace.to(room.code).emit('game-countdown', { seconds: 3 })

    setTimeout(() => {
        room.status = 'playing'
        room.startTime = Date.now()

        namespace.to(room.code).emit('game-start', {
            gridSize: config.gridSize,
            timeLimit: config.timeLimit,
            imageIndex: room.imageIndex,
            image: PUZZLE_IMAGES[room.imageIndex],
            seed: room.seed,
            shuffledPieces: shuffled,
        })

        // Time limit
        room.timer = setTimeout(() => {
            if (room.status === 'playing') {
                endGame(namespace, room)
            }
        }, config.timeLimit * 1000)

        console.log(`[puzzle] game started in room ${room.code} (${room.difficulty}, ${config.gridSize}x${config.gridSize})`)
        console.log(`[puzzle] image sent:`, JSON.stringify(PUZZLE_IMAGES[room.imageIndex]))
    }, 3500)
}

function endGame(namespace, room) {
    if (room.status === 'finished') return
    room.status = 'finished'
    if (room.timer) clearTimeout(room.timer)

    const results = calculateResults(room)
    room.results = results

    namespace.to(room.code).emit('game-over', results)
    console.log(`[puzzle] game over in ${room.code} — winner: ${results.winner?.name || 'empate'}`)
}

function calculateResults(room) {
    const sortedPlayers = [...room.players].sort((a, b) => {
        // Completed players first
        if (a.completed && !b.completed) return -1
        if (!a.completed && b.completed) return 1
        // Among completed, faster wins
        if (a.completed && b.completed) return a.completionTime - b.completionTime
        // Among incomplete, higher progress wins
        return b.progress - a.progress
    })

    const winner = sortedPlayers[0]

    return {
        winner: {
            name: winner.name,
            time: winner.completionTime,
            moves: winner.moves,
            progress: winner.progress,
            completed: winner.completed,
        },
        players: room.players.map(p => ({
            id: p.id,
            name: p.name,
            progress: p.progress,
            moves: p.moves,
            completed: p.completed,
            completionTime: p.completionTime,
        })),
        difficulty: room.difficulty,
        gridSize: DIFFICULTY[room.difficulty].gridSize,
        imageIndex: room.imageIndex,
        imageName: PUZZLE_IMAGES[room.imageIndex].name,
    }
}

module.exports = { setupPuzzleNamespace }