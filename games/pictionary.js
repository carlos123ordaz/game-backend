const { pickWordOptions } = require('../data/pictionary-words')
const { v4: uuidv4 } = require('uuid')

const rooms = new Map()

// ── Constants ──
const MAX_PLAYERS = 8
const MIN_PLAYERS = 2
const DEFAULT_DRAW_TIME = 80 // seconds
const DEFAULT_ROUNDS_PER_PLAYER = 2
const WORD_SELECT_TIME = 15 // seconds to pick a word
const MAX_POINTS_GUESS = 500
const MIN_POINTS_GUESS = 100
const DRAWER_POINTS_PER_GUESS = 75
const FIRST_GUESS_BONUS = 50
const HINT_INTERVALS = [0.3, 0.6] // reveal letters at 30% and 60% of time
const RECONNECT_GRACE_PERIOD = 60 * 1000 // 60s to reconnect

function generateCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase()
}

function createHint(word, revealCount) {
    const chars = word.split('')
    const letterIndices = chars
        .map((ch, i) => (ch !== ' ' ? i : -1))
        .filter(i => i !== -1)

    // Shuffle and pick which to reveal
    const shuffled = [...letterIndices].sort(() => Math.random() - 0.5)
    const toReveal = new Set(shuffled.slice(0, revealCount))

    return chars.map((ch, i) => {
        if (ch === ' ') return '  '
        return toReveal.has(i) ? ch : '_'
    }).join(' ')
}

function calculateGuessPoints(elapsed, totalTime) {
    // More time left = more points (linear scale)
    const ratio = Math.max(0, 1 - (elapsed / totalTime))
    return Math.round(MIN_POINTS_GUESS + (MAX_POINTS_GUESS - MIN_POINTS_GUESS) * ratio)
}

function getPlayersArray(room) {
    return Array.from(room.players.values()).map(p => ({
        id: p.id,
        name: p.name,
        score: p.score,
        connected: p.connected,
        isHost: p.id === room.hostId
    }))
}

function setupPictionaryNamespace(io) {
    const ns = io.of('/pictionary')

    ns.on('connection', (socket) => {
        console.log(`[pictionary] connected: ${socket.id}`)

        // ════════════════════════════════════
        //  CREATE ROOM
        // ════════════════════════════════════
        socket.on('create-room', ({ playerName }) => {
            const code = generateCode()
            const playerId = uuidv4()
            const room = {
                code,
                status: 'waiting',
                hostId: playerId,
                players: new Map(),
                settings: {
                    maxPlayers: MAX_PLAYERS,
                    roundsPerPlayer: DEFAULT_ROUNDS_PER_PLAYER,
                    drawTime: DEFAULT_DRAW_TIME,
                },
                // Game state
                currentRound: 0,
                totalRounds: 0,
                turnOrder: [],
                currentTurnIndex: -1,
                currentDrawerId: null,
                currentWord: null,
                wordOptions: [],
                usedWords: [],
                strokes: [],
                guessedPlayers: new Set(),
                messages: [],
                turnTimer: null,
                wordSelectTimer: null,
                turnStartTime: 0,
                hintLevel: 0,
                hintTimers: [],
                roundScores: [],
            }

            room.players.set(playerId, {
                id: playerId,
                name: playerName,
                score: 0,
                socketId: socket.id,
                connected: true,
            })

            rooms.set(code, room)
            socket.join(code)
            socket.playerId = playerId
            socket.roomCode = code

            socket.emit('room-created', { code, playerId })
            ns.to(code).emit('room-update', {
                players: getPlayersArray(room),
                hostId: room.hostId,
                status: room.status,
            })
            console.log(`[pictionary] room ${code} created by ${playerName}`)
        })

        // ════════════════════════════════════
        //  JOIN ROOM
        // ════════════════════════════════════
        socket.on('join-room', ({ roomCode, playerName }) => {
            const room = rooms.get(roomCode)
            if (!room) return socket.emit('error', { message: 'Sala no encontrada. Verifica el código.' })
            if (room.status !== 'waiting') return socket.emit('error', { message: 'El juego ya comenzó. No puedes unirte.' })
            if (room.players.size >= room.settings.maxPlayers) return socket.emit('error', { message: 'La sala está llena.' })

            const playerId = uuidv4()
            room.players.set(playerId, {
                id: playerId,
                name: playerName,
                score: 0,
                socketId: socket.id,
                connected: true,
            })

            socket.join(roomCode)
            socket.playerId = playerId
            socket.roomCode = roomCode

            socket.emit('room-joined', { code: roomCode, playerId })
            ns.to(roomCode).emit('room-update', {
                players: getPlayersArray(room),
                hostId: room.hostId,
                status: room.status,
            })
            console.log(`[pictionary] ${playerName} joined room ${roomCode}`)
        })

        // ════════════════════════════════════
        //  RECONNECT
        // ════════════════════════════════════
        socket.on('reconnect-player', ({ roomCode, playerId }) => {
            const room = rooms.get(roomCode)
            if (!room) return socket.emit('error', { message: 'Sala no encontrada.' })

            const player = room.players.get(playerId)
            if (!player) return socket.emit('error', { message: 'No estás en esta sala.' })

            // Restore connection
            player.socketId = socket.id
            player.connected = true
            socket.join(roomCode)
            socket.playerId = playerId
            socket.roomCode = roomCode

            socket.emit('room-joined', { code: roomCode, playerId })

            // Send full game state for recovery
            const gameState = {
                players: getPlayersArray(room),
                hostId: room.hostId,
                status: room.status,
            }

            if (room.status === 'playing') {
                const isDrawer = room.currentDrawerId === playerId
                const drawerPlayer = room.players.get(room.currentDrawerId)

                gameState.gameData = {
                    currentRound: room.currentRound,
                    totalRounds: room.totalRounds,
                    drawerId: room.currentDrawerId,
                    drawerName: drawerPlayer?.name || '',
                    isDrawing: isDrawer,
                    word: isDrawer ? room.currentWord : null,
                    hint: isDrawer ? null : (room.currentWord ? createHint(room.currentWord, room.hintLevel) : null),
                    wordLength: room.currentWord ? room.currentWord.length : 0,
                    strokes: room.strokes,
                    messages: room.messages.slice(-50),
                    guessedPlayerIds: Array.from(room.guessedPlayers),
                    timeLeft: room.turnStartTime
                        ? Math.max(0, room.settings.drawTime - Math.floor((Date.now() - room.turnStartTime) / 1000))
                        : room.settings.drawTime,
                }
            }

            socket.emit('game-state-restore', gameState)

            ns.to(roomCode).emit('room-update', {
                players: getPlayersArray(room),
                hostId: room.hostId,
                status: room.status,
            })

            ns.to(roomCode).emit('chat-message', {
                type: 'system',
                text: `${player.name} se reconectó`,
            })
            console.log(`[pictionary] ${player.name} reconnected to ${roomCode}`)
        })

        // ════════════════════════════════════
        //  START GAME (host only)
        // ════════════════════════════════════
        socket.on('start-game', () => {
            const room = rooms.get(socket.roomCode)
            if (!room) return
            if (socket.playerId !== room.hostId) return socket.emit('error', { message: 'Solo el host puede iniciar.' })
            if (room.players.size < MIN_PLAYERS) return socket.emit('error', { message: `Se necesitan al menos ${MIN_PLAYERS} jugadores.` })
            if (room.status !== 'waiting') return

            room.status = 'playing'
            room.turnOrder = [...room.players.keys()].sort(() => Math.random() - 0.5)
            room.totalRounds = room.turnOrder.length * room.settings.roundsPerPlayer
            room.currentRound = 0
            room.currentTurnIndex = -1

            ns.to(room.code).emit('game-started', {
                totalRounds: room.totalRounds,
                players: getPlayersArray(room),
            })

            console.log(`[pictionary] game started in ${room.code} (${room.totalRounds} rounds)`)
            startNextTurn(ns, room)
        })

        // ════════════════════════════════════
        //  SELECT WORD
        // ════════════════════════════════════
        socket.on('select-word', ({ wordIndex }) => {
            const room = rooms.get(socket.roomCode)
            if (!room || room.currentDrawerId !== socket.playerId) return
            if (!room.wordOptions[wordIndex]) return

            clearTimeout(room.wordSelectTimer)

            const selected = room.wordOptions[wordIndex]
            room.currentWord = selected.word
            room.usedWords.push(selected.word)
            room.wordOptions = []
            room.hintLevel = 0

            // Tell drawer the word
            const drawerSocket = getSocketForPlayer(ns, room, room.currentDrawerId)
            if (drawerSocket) {
                drawerSocket.emit('word-confirmed', { word: selected.word })
            }

            // Tell guessers the word length + initial hint
            const hint = createHint(selected.word, 0)
            socket.to(room.code).emit('word-selected', {
                wordLength: selected.word.length,
                hint,
                category: selected.category,
            })

            // Start the drawing timer
            startDrawingTimer(ns, room)

            console.log(`[pictionary] word selected in ${room.code}: ${selected.word}`)
        })

        // ════════════════════════════════════
        //  DRAWING EVENTS
        // ════════════════════════════════════
        socket.on('draw-stroke', (stroke) => {
            const room = rooms.get(socket.roomCode)
            if (!room || room.currentDrawerId !== socket.playerId) return

            room.strokes.push(stroke)
            socket.to(room.code).emit('draw-stroke', stroke)
        })

        socket.on('clear-canvas', () => {
            const room = rooms.get(socket.roomCode)
            if (!room || room.currentDrawerId !== socket.playerId) return

            room.strokes = []
            socket.to(room.code).emit('clear-canvas')
        })

        socket.on('undo-stroke', () => {
            const room = rooms.get(socket.roomCode)
            if (!room || room.currentDrawerId !== socket.playerId) return

            room.strokes.pop()
            ns.to(room.code).emit('undo-stroke', { strokes: room.strokes })
        })

        // ════════════════════════════════════
        //  GUESS
        // ════════════════════════════════════
        socket.on('guess', ({ text }) => {
            const room = rooms.get(socket.roomCode)
            if (!room || !room.currentWord) return
            if (socket.playerId === room.currentDrawerId) return
            if (room.guessedPlayers.has(socket.playerId)) return

            const player = room.players.get(socket.playerId)
            if (!player) return

            const guess = text.trim()
            if (!guess) return

            const isCorrect = guess.toLowerCase() === room.currentWord.toLowerCase()

            if (isCorrect) {
                room.guessedPlayers.add(socket.playerId)

                const elapsed = (Date.now() - room.turnStartTime) / 1000
                const guessPoints = calculateGuessPoints(elapsed, room.settings.drawTime)
                const isFirst = room.guessedPlayers.size === 1
                const totalPoints = guessPoints + (isFirst ? FIRST_GUESS_BONUS : 0)

                player.score += totalPoints

                // Drawer gets points too
                const drawer = room.players.get(room.currentDrawerId)
                if (drawer) drawer.score += DRAWER_POINTS_PER_GUESS

                room.roundScores.push({
                    playerId: player.id,
                    playerName: player.name,
                    points: totalPoints,
                    isFirst,
                })

                ns.to(room.code).emit('correct-guess', {
                    playerId: player.id,
                    playerName: player.name,
                    points: totalPoints,
                    isFirst,
                    players: getPlayersArray(room),
                })

                ns.to(room.code).emit('chat-message', {
                    type: 'correct',
                    playerName: player.name,
                    text: `${player.name} adivinó la palabra! (+${totalPoints})`,
                })

                console.log(`[pictionary] ${player.name} guessed correctly in ${room.code} (+${totalPoints})`)

                // Check if all guessers have answered
                const alivePlayers = Array.from(room.players.values()).filter(
                    p => p.connected && p.id !== room.currentDrawerId
                )
                if (room.guessedPlayers.size >= alivePlayers.length) {
                    endTurn(ns, room, 'all-guessed')
                }
            } else {
                // Close guess detection
                const isClose = isCloseGuess(guess, room.currentWord)

                ns.to(room.code).emit('chat-message', {
                    type: isClose ? 'close' : 'guess',
                    playerId: player.id,
                    playerName: player.name,
                    text: guess,
                    isClose,
                })

                room.messages.push({
                    type: isClose ? 'close' : 'guess',
                    playerId: player.id,
                    playerName: player.name,
                    text: guess,
                    isClose,
                    timestamp: Date.now(),
                })
            }
        })

        // ════════════════════════════════════
        //  KICK PLAYER (host only)
        // ════════════════════════════════════
        socket.on('kick-player', ({ targetPlayerId }) => {
            const room = rooms.get(socket.roomCode)
            if (!room || socket.playerId !== room.hostId) return
            if (targetPlayerId === room.hostId) return

            const target = room.players.get(targetPlayerId)
            if (!target) return

            // Find target's socket and disconnect them
            const targetSocket = getSocketForPlayer(ns, room, targetPlayerId)
            if (targetSocket) {
                targetSocket.emit('kicked', { message: 'Has sido expulsado de la sala.' })
                targetSocket.leave(room.code)
            }

            room.players.delete(targetPlayerId)

            ns.to(room.code).emit('room-update', {
                players: getPlayersArray(room),
                hostId: room.hostId,
                status: room.status,
            })

            ns.to(room.code).emit('chat-message', {
                type: 'system',
                text: `${target.name} fue expulsado`,
            })
        })

        // ════════════════════════════════════
        //  DISCONNECT
        // ════════════════════════════════════
        socket.on('disconnect', () => {
            console.log(`[pictionary] disconnected: ${socket.id}`)
            const room = rooms.get(socket.roomCode)
            if (!room) return

            const player = room.players.get(socket.playerId)
            if (!player) return

            player.connected = false

            ns.to(room.code).emit('room-update', {
                players: getPlayersArray(room),
                hostId: room.hostId,
                status: room.status,
            })

            ns.to(room.code).emit('chat-message', {
                type: 'system',
                text: `${player.name} se desconectó`,
            })

            // If game is playing and disconnected player is drawing, skip turn
            if (room.status === 'playing' && room.currentDrawerId === socket.playerId) {
                setTimeout(() => {
                    const p = room.players.get(socket.playerId)
                    if (p && !p.connected) {
                        endTurn(ns, room, 'drawer-left')
                    }
                }, 5000)
            }

            // Migrate host if host disconnected
            if (socket.playerId === room.hostId) {
                const newHost = Array.from(room.players.values()).find(p => p.connected && p.id !== socket.playerId)
                if (newHost) {
                    room.hostId = newHost.id
                    ns.to(room.code).emit('room-update', {
                        players: getPlayersArray(room),
                        hostId: room.hostId,
                        status: room.status,
                    })
                    ns.to(room.code).emit('chat-message', {
                        type: 'system',
                        text: `${newHost.name} es el nuevo host`,
                    })
                }
            }

            // Check if enough players to continue
            const connectedCount = Array.from(room.players.values()).filter(p => p.connected).length
            if (connectedCount < MIN_PLAYERS && room.status === 'playing') {
                clearAllTimers(room)
                room.status = 'finished'
                ns.to(room.code).emit('game-end', {
                    reason: 'not-enough-players',
                    finalScores: getPlayersArray(room).sort((a, b) => b.score - a.score),
                })
            }

            // Cleanup empty rooms after grace period
            if (connectedCount === 0) {
                setTimeout(() => {
                    const r = rooms.get(room.code)
                    if (r) {
                        const stillConnected = Array.from(r.players.values()).filter(p => p.connected).length
                        if (stillConnected === 0) {
                            clearAllTimers(r)
                            rooms.delete(room.code)
                            console.log(`[pictionary] room ${room.code} cleaned up`)
                        }
                    }
                }, RECONNECT_GRACE_PERIOD)
            }
        })
    })

    // ════════════════════════════════════════
    //  GAME FLOW HELPERS
    // ════════════════════════════════════════

    function startNextTurn(ns, room) {
        room.currentTurnIndex++
        room.currentRound++

        if (room.currentRound > room.totalRounds) {
            endGame(ns, room)
            return
        }

        // Rotate drawer
        const drawerIndex = room.currentTurnIndex % room.turnOrder.length
        let drawerId = room.turnOrder[drawerIndex]

        // Skip disconnected players
        let attempts = 0
        while (!room.players.get(drawerId)?.connected && attempts < room.turnOrder.length) {
            room.currentTurnIndex++
            const nextIndex = room.currentTurnIndex % room.turnOrder.length
            drawerId = room.turnOrder[nextIndex]
            attempts++
        }

        if (attempts >= room.turnOrder.length) {
            endGame(ns, room)
            return
        }

        room.currentDrawerId = drawerId
        room.currentWord = null
        room.strokes = []
        room.guessedPlayers = new Set()
        room.messages = []
        room.roundScores = []
        room.hintLevel = 0

        const drawer = room.players.get(drawerId)
        const wordOptions = pickWordOptions(room.usedWords)
        room.wordOptions = wordOptions

        // Notify everyone about the new turn
        ns.to(room.code).emit('turn-start', {
            drawerId,
            drawerName: drawer.name,
            currentRound: room.currentRound,
            totalRounds: room.totalRounds,
            players: getPlayersArray(room),
        })

        // Send word options only to drawer
        const drawerSocket = getSocketForPlayer(ns, room, drawerId)
        if (drawerSocket) {
            drawerSocket.emit('word-options', {
                options: wordOptions.map(w => ({
                    word: w.word,
                    category: w.category,
                    difficulty: w.difficulty,
                })),
            })
        }

        // Auto-select random word if drawer doesn't pick in time
        room.wordSelectTimer = setTimeout(() => {
            if (!room.currentWord && room.wordOptions.length > 0) {
                const randomIdx = Math.floor(Math.random() * room.wordOptions.length)
                const selected = room.wordOptions[randomIdx]
                room.currentWord = selected.word
                room.usedWords.push(selected.word)
                room.wordOptions = []

                if (drawerSocket) {
                    drawerSocket.emit('word-confirmed', { word: selected.word })
                }

                const hint = createHint(selected.word, 0)
                ns.to(room.code).emit('word-selected', {
                    wordLength: selected.word.length,
                    hint,
                    category: selected.category,
                })

                ns.to(room.code).emit('chat-message', {
                    type: 'system',
                    text: 'Se eligió una palabra automáticamente',
                })

                startDrawingTimer(ns, room)
            }
        }, WORD_SELECT_TIME * 1000)

        console.log(`[pictionary] turn ${room.currentRound}/${room.totalRounds} in ${room.code} - drawer: ${drawer.name}`)
    }

    function startDrawingTimer(ns, room) {
        room.turnStartTime = Date.now()
        let timeLeft = room.settings.drawTime

        // Clear any existing timers
        clearTimeout(room.turnTimer)
        room.hintTimers.forEach(t => clearTimeout(t))
        room.hintTimers = []

        // Main countdown
        room.turnTimer = setInterval(() => {
            timeLeft--
            ns.to(room.code).emit('timer-update', { timeLeft })

            if (timeLeft <= 0) {
                endTurn(ns, room, 'time-up')
            }
        }, 1000)

        // Schedule hint reveals
        if (room.currentWord) {
            const wordLetters = room.currentWord.replace(/ /g, '').length
            HINT_INTERVALS.forEach((ratio, i) => {
                const delay = room.settings.drawTime * ratio * 1000
                const revealCount = Math.min(Math.ceil(wordLetters * (i + 1) * 0.25), wordLetters - 1)

                const timer = setTimeout(() => {
                    if (room.currentWord) {
                        room.hintLevel = revealCount
                        const hint = createHint(room.currentWord, revealCount)
                        // Only send to non-drawers who haven't guessed
                        for (const [pid, p] of room.players) {
                            if (pid !== room.currentDrawerId && !room.guessedPlayers.has(pid) && p.connected) {
                                const s = getSocketForPlayer(ns, room, pid)
                                if (s) s.emit('hint-update', { hint })
                            }
                        }
                    }
                }, delay)
                room.hintTimers.push(timer)
            })
        }
    }

    function endTurn(ns, room, reason) {
        clearAllTimers(room)

        const word = room.currentWord || '???'

        ns.to(room.code).emit('turn-end', {
            word,
            reason,
            scores: room.roundScores,
            players: getPlayersArray(room),
        })

        room.currentWord = null
        room.wordOptions = []

        // Next turn after a delay
        setTimeout(() => {
            if (room.status === 'playing') {
                startNextTurn(ns, room)
            }
        }, 4000)
    }

    function endGame(ns, room) {
        clearAllTimers(room)
        room.status = 'finished'

        const finalScores = getPlayersArray(room).sort((a, b) => b.score - a.score)

        ns.to(room.code).emit('game-end', {
            reason: 'complete',
            finalScores,
        })

        console.log(`[pictionary] game ended in ${room.code}`)
    }

    function clearAllTimers(room) {
        if (room.turnTimer) {
            clearInterval(room.turnTimer)
            room.turnTimer = null
        }
        if (room.wordSelectTimer) {
            clearTimeout(room.wordSelectTimer)
            room.wordSelectTimer = null
        }
        room.hintTimers.forEach(t => clearTimeout(t))
        room.hintTimers = []
    }

    function getSocketForPlayer(ns, room, playerId) {
        const player = room.players.get(playerId)
        if (!player || !player.socketId) return null
        return ns.sockets.get(player.socketId) || null
    }
}

/**
 * Check if a guess is close to the word (Levenshtein distance <= 2)
 */
function isCloseGuess(guess, word) {
    const a = guess.toLowerCase()
    const b = word.toLowerCase()
    if (a === b) return false
    if (Math.abs(a.length - b.length) > 2) return false

    const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
        Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    )

    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            )
        }
    }

    return matrix[a.length][b.length] <= 2 && matrix[a.length][b.length] > 0
}

module.exports = { setupPictionaryNamespace }