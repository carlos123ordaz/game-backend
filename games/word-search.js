/**
 * ═══════════════════════════════════════════
 *  WORD SEARCH — Socket.IO Namespace
 * ═══════════════════════════════════════════
 *
 *  Competitive multiplayer word search game.
 *  2–8 players race to find words in a shared grid.
 *
 *  Flow:
 *    create-room → join-room → ready-up → game-start
 *    → find-word (repeat) → round-end → (next round or final results)
 *
 *  Scoring:
 *    - Base points per word = word.length * 10
 *    - First finder bonus = +25 points
 *    - Speed bonus = remaining_seconds / 2
 *    - All words found bonus = +100
 * ═══════════════════════════════════════════
 */

const categories = require('../data/words')
const { generateGrid } = require('../utils/gridGenerator')

const rooms = new Map()

const ROUND_DURATION = 90 // seconds per round
const MAX_ROUNDS = 3
const MIN_WORDS = 8
const MAX_WORDS = 12
const GRID_SIZE = 14
const COUNTDOWN_SECONDS = 3

function generateCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase()
}

function pickCategory(excludeIds = []) {
    const available = categories.filter(c => !excludeIds.includes(c.id))
    const pool = available.length > 0 ? available : categories
    return pool[Math.floor(Math.random() * pool.length)]
}

function pickWords(category) {
    const count = MIN_WORDS + Math.floor(Math.random() * (MAX_WORDS - MIN_WORDS + 1))
    const shuffled = [...category.words].sort(() => Math.random() - 0.5)
    // Filter words that fit in grid
    return shuffled.filter(w => w.length <= GRID_SIZE).slice(0, count)
}

function createRound(usedCategoryIds) {
    const category = pickCategory(usedCategoryIds)
    const words = pickWords(category)
    const gridData = generateGrid(words, GRID_SIZE)

    return {
        category: { id: category.id, name: category.name, emoji: category.emoji },
        words: gridData.placedWords,
        grid: gridData.grid,
        placements: gridData.placements,
        gridSize: gridData.size,
        foundWords: new Map(), // word → { playerId, playerName, timestamp }
        startTime: null,
        timer: null,
    }
}

function calculateScores(room) {
    const scores = {}

    // Initialize scores
    for (const player of room.players) {
        if (!scores[player.id]) {
            scores[player.id] = { name: player.name, total: 0, wordsFound: 0, rounds: [] }
        }
    }

    for (let ri = 0; ri < room.rounds.length; ri++) {
        const round = room.rounds[ri]
        const roundScores = {}

        for (const player of room.players) {
            roundScores[player.id] = { points: 0, words: [] }
        }

        // Track which words were found first
        const wordsByTime = [...round.foundWords.entries()]
            .sort((a, b) => a[1].timestamp - b[1].timestamp)

        const firstFinderPerWord = {}
        for (const [word, info] of wordsByTime) {
            if (!firstFinderPerWord[word]) {
                firstFinderPerWord[word] = info.playerId
            }
        }

        for (const [word, info] of round.foundWords.entries()) {
            if (!roundScores[info.playerId]) continue

            const basePoints = word.length * 10
            const isFirst = firstFinderPerWord[word] === info.playerId
            const firstBonus = isFirst ? 25 : 0
            const elapsed = (info.timestamp - round.startTime) / 1000
            const remaining = Math.max(0, ROUND_DURATION - elapsed)
            const speedBonus = Math.round(remaining / 2)
            const total = basePoints + firstBonus + speedBonus

            roundScores[info.playerId].points += total
            roundScores[info.playerId].words.push({
                word,
                basePoints,
                firstBonus,
                speedBonus,
                total,
                isFirst,
            })
        }

        // Check all-words bonus
        for (const player of room.players) {
            const playerWords = [...round.foundWords.entries()]
                .filter(([, info]) => info.playerId === player.id)
            if (playerWords.length === round.words.length && round.words.length > 0) {
                roundScores[player.id].points += 100
            }
        }

        for (const player of room.players) {
            const rs = roundScores[player.id]
            if (scores[player.id]) {
                scores[player.id].total += rs.points
                scores[player.id].wordsFound += rs.words.length
                scores[player.id].rounds.push({
                    roundIndex: ri,
                    category: round.category.name,
                    points: rs.points,
                    words: rs.words,
                })
            }
        }
    }

    // Convert to sorted array
    return Object.entries(scores)
        .map(([id, data]) => ({ playerId: id, ...data }))
        .sort((a, b) => b.total - a.total)
}

function getPlayerScoresSnapshot(room) {
    const snapshot = {}
    for (const player of room.players) {
        snapshot[player.id] = { name: player.name, score: 0, wordsFound: 0 }
    }

    for (const round of room.rounds) {
        for (const [word, info] of round.foundWords.entries()) {
            if (snapshot[info.playerId]) {
                const basePoints = word.length * 10
                snapshot[info.playerId].score += basePoints
                snapshot[info.playerId].wordsFound++
            }
        }
    }

    return Object.entries(snapshot)
        .map(([id, data]) => ({ playerId: id, ...data }))
        .sort((a, b) => b.score - a.score)
}

function setupWordSearchNamespace(io) {
    const ws = io.of('/word-search')

    ws.on('connection', (socket) => {
        console.log(`[word-search] connected: ${socket.id}`)

        // ── Create room ──
        socket.on('create-room', ({ playerName, rounds }) => {
            const code = generateCode()
            const room = {
                code,
                status: 'waiting',
                players: [{ id: socket.id, name: playerName, ready: false }],
                maxRounds: Math.min(Math.max(rounds || MAX_ROUNDS, 1), 5),
                currentRound: -1,
                rounds: [],
                usedCategoryIds: [],
            }
            rooms.set(code, room)
            socket.join(code)
            socket.emit('room-created', { code, playerId: socket.id })
            console.log(`[word-search] room created: ${code}`)
        })

        // ── Join room ──
        socket.on('join-room', ({ roomCode, playerName }) => {
            const room = rooms.get(roomCode)
            if (!room) return socket.emit('error', { message: 'Sala no encontrada. Verifica el código.' })
            if (room.players.length >= 8) return socket.emit('error', { message: 'La sala está llena (máx. 8).' })
            if (room.status !== 'waiting') return socket.emit('error', { message: 'El juego ya comenzó.' })
            if (room.players.some(p => p.name.toLowerCase() === playerName.toLowerCase())) {
                return socket.emit('error', { message: 'Ya hay un jugador con ese nombre.' })
            }

            room.players.push({ id: socket.id, name: playerName, ready: false })
            socket.join(roomCode)
            socket.emit('room-joined', { code: roomCode, playerId: socket.id })

            ws.to(roomCode).emit('room-update', {
                players: room.players,
                status: room.status,
                maxRounds: room.maxRounds,
            })

            console.log(`[word-search] ${playerName} joined ${roomCode} (${room.players.length} players)`)
        })

        // ── Toggle ready ──
        socket.on('toggle-ready', ({ roomCode }) => {
            const room = rooms.get(roomCode)
            if (!room) return

            const player = room.players.find(p => p.id === socket.id)
            if (player) {
                player.ready = !player.ready
                ws.to(roomCode).emit('room-update', {
                    players: room.players,
                    status: room.status,
                    maxRounds: room.maxRounds,
                })

                // Check if all players ready (min 2)
                if (room.players.length >= 2 && room.players.every(p => p.ready)) {
                    startNextRound(ws, roomCode, room)
                }
            }
        })

        // ── Find word ──
        socket.on('find-word', ({ roomCode, word, cells }) => {
            const room = rooms.get(roomCode)
            if (!room || room.status !== 'playing') return

            const round = room.rounds[room.currentRound]
            if (!round) return

            const upperWord = word.toUpperCase()

            // Validate word is in the round's word list
            if (!round.words.includes(upperWord)) {
                return socket.emit('find-word-result', { success: false, word: upperWord, reason: 'not-in-list' })
            }

            // Check if already found by anyone
            if (round.foundWords.has(upperWord)) {
                return socket.emit('find-word-result', { success: false, word: upperWord, reason: 'already-found' })
            }

            // Validate cells match the placement
            const placement = round.placements.find(p => p.word === upperWord)
            if (!placement) {
                return socket.emit('find-word-result', { success: false, word: upperWord, reason: 'invalid' })
            }

            // Validate the cells array matches
            if (cells && cells.length === placement.cells.length) {
                const cellsMatch = cells.every((c, i) =>
                    c.row === placement.cells[i].row && c.col === placement.cells[i].col
                )
                if (!cellsMatch) {
                    // Also check reverse order
                    const reversedCells = [...cells].reverse()
                    const reverseMatch = reversedCells.every((c, i) =>
                        c.row === placement.cells[i].row && c.col === placement.cells[i].col
                    )
                    if (!reverseMatch) {
                        return socket.emit('find-word-result', { success: false, word: upperWord, reason: 'wrong-cells' })
                    }
                }
            }

            const player = room.players.find(p => p.id === socket.id)
            const playerName = player?.name || 'Desconocido'

            round.foundWords.set(upperWord, {
                playerId: socket.id,
                playerName,
                timestamp: Date.now(),
            })

            const isFirst = true // By definition, we checked already-found above
            const basePoints = upperWord.length * 10
            const elapsed = (Date.now() - round.startTime) / 1000
            const remaining = Math.max(0, ROUND_DURATION - elapsed)
            const speedBonus = Math.round(remaining / 2)
            const points = basePoints + 25 + speedBonus // first finder always gets bonus here

            // Notify the finder
            socket.emit('find-word-result', {
                success: true,
                word: upperWord,
                points,
                cells: placement.cells,
            })

            // Notify all players
            ws.to(roomCode).emit('word-found', {
                word: upperWord,
                playerId: socket.id,
                playerName,
                cells: placement.cells,
                remainingWords: round.words.length - round.foundWords.size,
                scores: getPlayerScoresSnapshot(room),
            })

            // Check if all words found
            if (round.foundWords.size === round.words.length) {
                endRound(ws, roomCode, room, 'all-found')
            }
        })

        // ── Request hint ──
        socket.on('request-hint', ({ roomCode }) => {
            const room = rooms.get(roomCode)
            if (!room || room.status !== 'playing') return

            const round = room.rounds[room.currentRound]
            if (!round) return

            // Find a word not yet found
            const unfound = round.words.filter(w => !round.foundWords.has(w))
            if (unfound.length === 0) return

            const randomWord = unfound[Math.floor(Math.random() * unfound.length)]
            const placement = round.placements.find(p => p.word === randomWord)
            if (!placement) return

            // Reveal first letter position
            socket.emit('hint', {
                firstCell: placement.cells[0],
                wordLength: randomWord.length,
                direction: placement.direction,
            })
        })

        // ── Get current state ──
        socket.on('get-room-state', ({ roomCode }) => {
            const room = rooms.get(roomCode)
            if (!room) return

            socket.emit('room-update', {
                players: room.players,
                status: room.status,
                maxRounds: room.maxRounds,
            })

            if (room.status === 'playing' && room.currentRound >= 0) {
                const round = room.rounds[room.currentRound]
                const elapsed = (Date.now() - round.startTime) / 1000
                const remaining = Math.max(0, ROUND_DURATION - elapsed)

                socket.emit('round-data', {
                    roundIndex: room.currentRound,
                    maxRounds: room.maxRounds,
                    category: round.category,
                    grid: round.grid,
                    gridSize: round.gridSize,
                    words: round.words,
                    foundWords: Object.fromEntries(round.foundWords),
                    timeRemaining: Math.round(remaining),
                    scores: getPlayerScoresSnapshot(room),
                })
            }
        })

        // ── Get final results ──
        socket.on('get-results', ({ roomCode }) => {
            const room = rooms.get(roomCode)
            if (!room || room.status !== 'finished') return

            socket.emit('results-data', {
                scores: calculateScores(room),
                rounds: room.rounds.map(r => ({
                    category: r.category,
                    totalWords: r.words.length,
                    foundWords: r.foundWords.size,
                })),
            })
        })

        // ── Disconnect ──
        socket.on('disconnect', () => {
            console.log(`[word-search] disconnected: ${socket.id}`)
            for (const [code, room] of rooms.entries()) {
                const idx = room.players.findIndex(p => p.id === socket.id)
                if (idx !== -1) {
                    const playerName = room.players[idx].name
                    room.players.splice(idx, 1)

                    ws.to(code).emit('room-update', {
                        players: room.players,
                        status: room.status,
                        maxRounds: room.maxRounds,
                    })

                    ws.to(code).emit('player-left', { playerName })

                    if (room.players.length === 0) {
                        // Clear any active timers
                        const round = room.rounds[room.currentRound]
                        if (round?.timer) clearTimeout(round.timer)
                        setTimeout(() => {
                            if (rooms.get(code)?.players.length === 0) rooms.delete(code)
                        }, 5 * 60 * 1000)
                    }

                    // If playing and only 1 player left, end game
                    if (room.status === 'playing' && room.players.length < 2) {
                        endRound(ws, code, room, 'player-left')
                        room.status = 'finished'
                        ws.to(code).emit('game-over', {
                            reason: 'player-left',
                            message: `${playerName} se desconectó. El juego terminó.`,
                            scores: calculateScores(room),
                        })
                    }

                    break
                }
            }
        })
    })

    // ── Round management ──
    function startNextRound(wsNs, roomCode, room) {
        room.currentRound++

        if (room.currentRound >= room.maxRounds) {
            room.status = 'finished'
            wsNs.to(roomCode).emit('game-finished', {
                scores: calculateScores(room),
                rounds: room.rounds.map(r => ({
                    category: r.category,
                    totalWords: r.words.length,
                    foundWords: r.foundWords.size,
                })),
            })
            console.log(`[word-search] game finished in ${roomCode}`)
            return
        }

        // Reset ready states
        room.players.forEach(p => (p.ready = false))

        // Create new round
        const round = createRound(room.usedCategoryIds)
        room.usedCategoryIds.push(round.category.id)
        room.rounds.push(round)

        // Send countdown
        room.status = 'countdown'
        wsNs.to(roomCode).emit('round-countdown', {
            roundIndex: room.currentRound,
            maxRounds: room.maxRounds,
            category: round.category,
            countdown: COUNTDOWN_SECONDS,
        })

        // After countdown, start round
        setTimeout(() => {
            room.status = 'playing'
            round.startTime = Date.now()

            wsNs.to(roomCode).emit('round-start', {
                roundIndex: room.currentRound,
                maxRounds: room.maxRounds,
                category: round.category,
                grid: round.grid,
                gridSize: round.gridSize,
                words: round.words,
                duration: ROUND_DURATION,
            })

            // Timer
            round.timer = setTimeout(() => {
                endRound(wsNs, roomCode, room, 'timeout')
            }, ROUND_DURATION * 1000)

            console.log(`[word-search] round ${room.currentRound + 1} started in ${roomCode} (${round.category.name})`)
        }, COUNTDOWN_SECONDS * 1000)
    }

    function endRound(wsNs, roomCode, room, reason) {
        const round = room.rounds[room.currentRound]
        if (!round) return

        if (round.timer) {
            clearTimeout(round.timer)
            round.timer = null
        }

        const roundScores = getPlayerScoresSnapshot(room)

        // Reveal all placements
        wsNs.to(roomCode).emit('round-end', {
            reason,
            roundIndex: room.currentRound,
            placements: round.placements,
            foundWords: Object.fromEntries(round.foundWords),
            scores: roundScores,
        })

        // Check if more rounds
        if (room.currentRound + 1 < room.maxRounds) {
            // Wait a bit then start next round
            setTimeout(() => {
                // Reset ready for next round
                room.players.forEach(p => (p.ready = false))
                room.status = 'between-rounds'
                wsNs.to(roomCode).emit('waiting-next-round', {
                    nextRound: room.currentRound + 1,
                    maxRounds: room.maxRounds,
                    scores: roundScores,
                })
            }, 3000)

            // Auto-start next round after review period
            setTimeout(() => {
                if (room.status === 'between-rounds') {
                    startNextRound(wsNs, roomCode, room)
                }
            }, 8000)
        } else {
            // Game over
            setTimeout(() => {
                room.status = 'finished'
                wsNs.to(roomCode).emit('game-finished', {
                    scores: calculateScores(room),
                    rounds: room.rounds.map(r => ({
                        category: r.category,
                        totalWords: r.words.length,
                        foundWords: r.foundWords.size,
                    })),
                })
                console.log(`[word-search] game finished in ${roomCode}`)
            }, 3000)
        }
    }
}

module.exports = { setupWordSearchNamespace }