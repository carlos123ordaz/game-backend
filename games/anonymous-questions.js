/**
 * Anonymous Questions — Server Logic
 *
 * Flow:
 *   lobby → writing → answering → guessing → reveal
 *
 * Mechanics:
 * - Each player writes N anonymous questions
 * - All questions are shuffled and shown to everyone
 * - Everyone answers every question
 * - Players guess who wrote each question
 * - Reveal shows authorship + correct guesses + scores
 *
 * Robustness:
 * - Reconnection with full state recovery
 * - Graceful mid-game disconnects (player marked absent, game continues)
 * - Phase timers with auto-advance
 * - Leave room at any point
 */

const rooms = new Map()

// ── Constants ─────────────────────────────────────────────────────

const PHASE_TIMERS = {
    writing: 3 * 60 * 1000,    // 3 min to write questions
    answering: 5 * 60 * 1000,  // 5 min to answer all
    guessing: 4 * 60 * 1000,   // 4 min to guess authors
}

const SCORE = {
    CORRECT_GUESS: 100,         // Guessed who wrote a question
    FOOLED_PLAYER: 50,          // Someone couldn't guess your question
    ANSWERED_ALL: 25,           // Bonus for answering everything
    POPULAR_QUESTION: 75,       // Your question got the most diverse answers
}

const DEFAULT_SETTINGS = {
    questionsPerPlayer: 2,
    allowSkipGuess: true,
    showTimers: true,
}

// ── Helpers ───────────────────────────────────────────────────────

function generateCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase()
}

function shuffleArray(arr) {
    const shuffled = [...arr]
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled
}

function generateQuestionId() {
    return 'q_' + Math.random().toString(36).substring(2, 10)
}

// ── Room State Builder ────────────────────────────────────────────

function createRoom(code, hostId, hostName, settings) {
    return {
        code,
        phase: 'lobby',
        host: hostId,
        settings: { ...DEFAULT_SETTINGS, ...settings },
        players: new Map([[hostId, createPlayer(hostId, hostName)]]),
        disconnected: new Map(),   // id → { player, disconnectedAt }

        // Game data
        questions: [],              // { id, text, authorId, authorName }
        shuffledQuestions: [],      // Same but shuffled (no author info sent to client)
        answers: new Map(),         // playerId → { questionId: answerText }
        guesses: new Map(),         // playerId → { questionId: guessedPlayerId }

        // Phase tracking
        questionsSubmitted: new Set(),
        answersSubmitted: new Set(),
        guessesSubmitted: new Set(),

        // Timers
        phaseTimer: null,
        phaseStartTime: null,
        phaseTimeLimit: null,

        // Results cache
        results: null,
    }
}

function createPlayer(id, name) {
    return {
        id,
        name,
        ready: false,
        connected: true,
        score: 0,
    }
}

function getActivePlayers(room) {
    return [...room.players.values()].filter(p => p.connected)
}

function getAllPlayers(room) {
    return [...room.players.values()]
}

function getPlayerList(room) {
    return getAllPlayers(room).map(p => ({
        id: p.id,
        name: p.name,
        ready: p.ready,
        connected: p.connected,
        score: p.score,
    }))
}

function getRoomInfo(room) {
    return {
        players: getPlayerList(room),
        settings: room.settings,
        host: room.host,
        phase: room.phase,
        timeRemaining: room.phaseTimeLimit && room.phaseStartTime
            ? Math.max(0, room.phaseTimeLimit - (Date.now() - room.phaseStartTime))
            : null,
    }
}

// Build client-safe question list (no author info)
function getClientQuestions(room) {
    return room.shuffledQuestions.map(q => ({
        id: q.id,
        text: q.text,
    }))
}

// ── Phase Management ──────────────────────────────────────────────

function startPhaseTimer(room, phase, ns, roomCode) {
    if (room.phaseTimer) clearTimeout(room.phaseTimer)

    const timeLimit = PHASE_TIMERS[phase]
    if (!timeLimit) return

    room.phaseStartTime = Date.now()
    room.phaseTimeLimit = timeLimit

    room.phaseTimer = setTimeout(() => {
        handlePhaseTimeout(room, phase, ns, roomCode)
    }, timeLimit)
}

function handlePhaseTimeout(room, phase, ns, roomCode) {
    switch (phase) {
        case 'writing':
            // Auto-advance even if not all submitted
            transitionToAnswering(room, ns, roomCode)
            break
        case 'answering':
            transitionToGuessing(room, ns, roomCode)
            break
        case 'guessing':
            transitionToReveal(room, ns, roomCode)
            break
    }
}

function transitionToWriting(room, ns, roomCode) {
    room.phase = 'writing'
    room.questions = []
    room.questionsSubmitted.clear()
    startPhaseTimer(room, 'writing', ns, roomCode)

    ns.to(roomCode).emit('phase-change', {
        phase: 'writing',
        questionsPerPlayer: room.settings.questionsPerPlayer,
        timeLimit: PHASE_TIMERS.writing,
    })
    console.log(`[anon-q] writing phase started in ${roomCode}`)
}

function transitionToAnswering(room, ns, roomCode) {
    if (room.phaseTimer) clearTimeout(room.phaseTimer)

    // Shuffle questions
    room.shuffledQuestions = shuffleArray(room.questions)
    room.phase = 'answering'
    room.answers.clear()
    room.answersSubmitted.clear()
    startPhaseTimer(room, 'answering', ns, roomCode)

    ns.to(roomCode).emit('phase-change', {
        phase: 'answering',
        questions: getClientQuestions(room),
        timeLimit: PHASE_TIMERS.answering,
        totalQuestions: room.shuffledQuestions.length,
    })
    console.log(`[anon-q] answering phase started in ${roomCode} (${room.shuffledQuestions.length} questions)`)
}

function transitionToGuessing(room, ns, roomCode) {
    if (room.phaseTimer) clearTimeout(room.phaseTimer)

    room.phase = 'guessing'
    room.guesses.clear()
    room.guessesSubmitted.clear()
    startPhaseTimer(room, 'guessing', ns, roomCode)

    // Send questions + all collected answers (still anonymous authorship)
    const questionsWithAnswers = room.shuffledQuestions.map(q => {
        const answersForQ = []
        for (const [playerId, playerAnswers] of room.answers) {
            const player = room.players.get(playerId)
            if (player && playerAnswers[q.id]) {
                answersForQ.push({
                    playerId,
                    playerName: player.name,
                    answer: playerAnswers[q.id],
                })
            }
        }
        return {
            id: q.id,
            text: q.text,
            answers: answersForQ,
        }
    })

    // Send player list (possible authors)
    const possibleAuthors = getAllPlayers(room).map(p => ({
        id: p.id,
        name: p.name,
    }))

    ns.to(roomCode).emit('phase-change', {
        phase: 'guessing',
        questions: questionsWithAnswers,
        possibleAuthors,
        timeLimit: PHASE_TIMERS.guessing,
    })
    console.log(`[anon-q] guessing phase started in ${roomCode}`)
}

function transitionToReveal(room, ns, roomCode) {
    if (room.phaseTimer) clearTimeout(room.phaseTimer)

    room.phase = 'reveal'
    const results = calculateResults(room)
    room.results = results

    ns.to(roomCode).emit('phase-change', { phase: 'reveal' })
    ns.to(roomCode).emit('results-data', results)
    console.log(`[anon-q] reveal phase in ${roomCode}`)
}

// ── Scoring ───────────────────────────────────────────────────────

function calculateResults(room) {
    const players = getAllPlayers(room)

    // Reset scores
    players.forEach(p => { p.score = 0 })

    const questionResults = room.shuffledQuestions.map(q => {
        const author = room.players.get(q.authorId)
        const guessResults = []
        let correctGuessCount = 0
        let totalGuessers = 0

        for (const [guesserId, playerGuesses] of room.guesses) {
            const guesser = room.players.get(guesserId)
            if (!guesser) continue
            if (guesserId === q.authorId) continue // Can't guess your own

            totalGuessers++
            const guessedId = playerGuesses[q.id]
            const isCorrect = guessedId === q.authorId

            if (isCorrect) {
                correctGuessCount++
                guesser.score += SCORE.CORRECT_GUESS
            }

            guessResults.push({
                guesserId,
                guesserName: guesser.name,
                guessedId: guessedId || null,
                guessedName: guessedId ? room.players.get(guessedId)?.name || '?' : 'No adivinó',
                correct: isCorrect,
            })
        }

        // Author gets points for each player who got it wrong
        if (author) {
            const fooledCount = totalGuessers - correctGuessCount
            author.score += fooledCount * SCORE.FOOLED_PLAYER
        }

        // Collect answers
        const answersForQ = []
        for (const [playerId, playerAnswers] of room.answers) {
            const player = room.players.get(playerId)
            if (player && playerAnswers[q.id]) {
                answersForQ.push({
                    playerId,
                    playerName: player.name,
                    answer: playerAnswers[q.id],
                })
            }
        }

        return {
            questionId: q.id,
            questionText: q.text,
            authorId: q.authorId,
            authorName: author?.name || 'Desconocido',
            answers: answersForQ,
            guesses: guessResults,
            correctGuessCount,
            totalGuessers,
        }
    })

    // Bonus: answered all questions
    for (const [playerId, playerAnswers] of room.answers) {
        const player = room.players.get(playerId)
        if (!player) continue
        const answeredCount = Object.keys(playerAnswers).length
        if (answeredCount >= room.shuffledQuestions.length) {
            player.score += SCORE.ANSWERED_ALL
        }
    }

    // Build leaderboard
    const leaderboard = players
        .map(p => ({
            id: p.id,
            name: p.name,
            score: p.score,
            connected: p.connected,
            questionsWritten: room.questions.filter(q => q.authorId === p.id).length,
            correctGuesses: [...room.guesses.entries()].reduce((count, [gId, guesses]) => {
                if (gId !== p.id) return count
                return count + room.shuffledQuestions.filter(q =>
                    guesses[q.id] === q.authorId && q.authorId !== p.id
                ).length
            }, 0),
            timesFooled: questionResults.reduce((count, qr) => {
                if (qr.authorId !== p.id) return count
                return count + qr.guesses.filter(g => !g.correct).length
            }, 0),
        }))
        .sort((a, b) => b.score - a.score)

    return {
        questions: questionResults,
        leaderboard,
        totalPlayers: players.length,
        totalQuestions: room.shuffledQuestions.length,
    }
}

// ── Check if phase can advance ────────────────────────────────────

function checkWritingComplete(room, ns, roomCode) {
    const active = getActivePlayers(room)
    if (room.questionsSubmitted.size >= active.length) {
        transitionToAnswering(room, ns, roomCode)
    }
}

function checkAnsweringComplete(room, ns, roomCode) {
    const active = getActivePlayers(room)
    if (room.answersSubmitted.size >= active.length) {
        transitionToGuessing(room, ns, roomCode)
    }
}

function checkGuessingComplete(room, ns, roomCode) {
    const active = getActivePlayers(room)
    if (room.guessesSubmitted.size >= active.length) {
        transitionToReveal(room, ns, roomCode)
    }
}

// ── Socket.IO Namespace ───────────────────────────────────────────

function setupAnonQuestionsNamespace(io) {
    const ns = io.of('/anonymous-questions')

    ns.on('connection', (socket) => {
        console.log(`[anon-q] connected: ${socket.id}`)

        // ── Create Room ──────────────────────────────────────────
        socket.on('create-room', ({ playerName, settings = {} }) => {
            if (!playerName?.trim()) return socket.emit('error', { message: 'Nombre requerido.' })

            const code = generateCode()
            const room = createRoom(code, socket.id, playerName.trim(), settings)
            rooms.set(code, room)
            socket.join(code)

            socket.emit('room-created', { code, playerId: socket.id })
            ns.to(code).emit('room-update', getRoomInfo(room))
            console.log(`[anon-q] room created: ${code} by ${playerName}`)
        })

        // ── Join Room ────────────────────────────────────────────
        socket.on('join-room', ({ roomCode, playerName }) => {
            if (!playerName?.trim()) return socket.emit('error', { message: 'Nombre requerido.' })
            const name = playerName.trim()
            const room = rooms.get(roomCode)

            if (!room) return socket.emit('error', { message: 'Sala no encontrada. Verifica el código.' })
            if (room.players.size >= 12) return socket.emit('error', { message: 'La sala está llena (máx. 12).' })

            // Check for name collision
            const nameExists = [...room.players.values()].some(
                p => p.name.toLowerCase() === name.toLowerCase() && p.id !== socket.id
            )
            if (nameExists) return socket.emit('error', { message: 'Ese nombre ya está en uso.' })

            // Check if reconnecting
            const disconnectedEntry = [...room.disconnected.entries()].find(
                ([_, d]) => d.player.name.toLowerCase() === name.toLowerCase()
            )

            if (disconnectedEntry) {
                // Reconnection
                const [oldId, { player: oldPlayer }] = disconnectedEntry
                room.disconnected.delete(oldId)

                // Update player ID
                room.players.delete(oldId)
                oldPlayer.id = socket.id
                oldPlayer.connected = true
                room.players.set(socket.id, oldPlayer)

                // Migrate data references
                migratePlayerId(room, oldId, socket.id)

                // If was host, restore
                if (room.host === oldId) room.host = socket.id

                socket.join(roomCode)
                socket.emit('room-joined', { code: roomCode, playerId: socket.id, reconnected: true })

                // Send full state for reconnection
                sendFullState(socket, room)

                ns.to(roomCode).emit('room-update', getRoomInfo(room))
                ns.to(roomCode).emit('player-reconnected', { playerName: oldPlayer.name })
                console.log(`[anon-q] ${name} reconnected to ${roomCode}`)
                return
            }

            // Only allow join during lobby
            if (room.phase !== 'lobby') {
                return socket.emit('error', { message: 'La partida ya comenzó. No se puede unir.' })
            }

            room.players.set(socket.id, createPlayer(socket.id, name))
            socket.join(roomCode)

            socket.emit('room-joined', { code: roomCode, playerId: socket.id, reconnected: false })
            ns.to(roomCode).emit('room-update', getRoomInfo(room))
            console.log(`[anon-q] ${name} joined ${roomCode}`)
        })

        // ── Leave Room ───────────────────────────────────────────
        socket.on('leave-room', ({ roomCode }) => {
            const room = rooms.get(roomCode)
            if (!room) return

            handlePlayerLeave(room, socket.id, ns, roomCode, true)
            socket.leave(roomCode)
            socket.emit('left-room')
        })

        // ── Toggle Ready ─────────────────────────────────────────
        socket.on('toggle-ready', ({ roomCode }) => {
            const room = rooms.get(roomCode)
            if (!room || room.phase !== 'lobby') return

            const player = room.players.get(socket.id)
            if (player) {
                player.ready = !player.ready
                ns.to(roomCode).emit('room-update', getRoomInfo(room))
            }
        })

        // ── Change Settings (host only) ──────────────────────────
        socket.on('change-settings', ({ roomCode, settings }) => {
            const room = rooms.get(roomCode)
            if (!room || room.host !== socket.id || room.phase !== 'lobby') return

            if (settings.questionsPerPlayer) {
                room.settings.questionsPerPlayer = Math.min(Math.max(1, settings.questionsPerPlayer), 5)
            }
            if (typeof settings.showTimers === 'boolean') {
                room.settings.showTimers = settings.showTimers
            }

            ns.to(roomCode).emit('room-update', getRoomInfo(room))
        })

        // ── Start Game (host only) ───────────────────────────────
        socket.on('start-game', ({ roomCode }) => {
            const room = rooms.get(roomCode)
            if (!room || room.host !== socket.id) return

            const active = getActivePlayers(room)
            if (active.length < 2) {
                return socket.emit('error', { message: 'Se necesitan al menos 2 jugadores.' })
            }

            const allReady = active.every(p => p.id === room.host || p.ready)
            if (!allReady) {
                return socket.emit('error', { message: 'No todos los jugadores están listos.' })
            }

            transitionToWriting(room, ns, roomCode)
        })

        // ── Submit Questions ─────────────────────────────────────
        socket.on('submit-questions', ({ roomCode, questions: playerQuestions }) => {
            const room = rooms.get(roomCode)
            if (!room || room.phase !== 'writing') return
            if (room.questionsSubmitted.has(socket.id)) return

            const player = room.players.get(socket.id)
            if (!player || !player.connected) return

            // Validate and add questions
            const validQuestions = (playerQuestions || [])
                .slice(0, room.settings.questionsPerPlayer)
                .filter(q => typeof q === 'string' && q.trim().length > 0)
                .map(text => ({
                    id: generateQuestionId(),
                    text: text.trim(),
                    authorId: socket.id,
                    authorName: player.name,
                }))

            if (validQuestions.length === 0) {
                return socket.emit('error', { message: 'Envía al menos una pregunta.' })
            }

            room.questions.push(...validQuestions)
            room.questionsSubmitted.add(socket.id)

            socket.emit('questions-accepted', { count: validQuestions.length })

            // Notify progress
            const active = getActivePlayers(room)
            ns.to(roomCode).emit('phase-progress', {
                phase: 'writing',
                completed: room.questionsSubmitted.size,
                total: active.length,
            })

            checkWritingComplete(room, ns, roomCode)
            console.log(`[anon-q] ${player.name} submitted ${validQuestions.length} questions in ${roomCode}`)
        })

        // ── Submit Answers ───────────────────────────────────────
        socket.on('submit-answers', ({ roomCode, answers }) => {
            const room = rooms.get(roomCode)
            if (!room || room.phase !== 'answering') return
            if (room.answersSubmitted.has(socket.id)) return

            const player = room.players.get(socket.id)
            if (!player || !player.connected) return

            // Validate answers: { questionId: answerText }
            const validAnswers = {}
            for (const q of room.shuffledQuestions) {
                if (answers[q.id] && typeof answers[q.id] === 'string') {
                    validAnswers[q.id] = answers[q.id].trim()
                }
            }

            room.answers.set(socket.id, validAnswers)
            room.answersSubmitted.add(socket.id)

            socket.emit('answers-accepted', { count: Object.keys(validAnswers).length })

            const active = getActivePlayers(room)
            ns.to(roomCode).emit('phase-progress', {
                phase: 'answering',
                completed: room.answersSubmitted.size,
                total: active.length,
            })

            checkAnsweringComplete(room, ns, roomCode)
            console.log(`[anon-q] ${player.name} submitted answers in ${roomCode}`)
        })

        // ── Submit Guesses ───────────────────────────────────────
        socket.on('submit-guesses', ({ roomCode, guesses }) => {
            const room = rooms.get(roomCode)
            if (!room || room.phase !== 'guessing') return
            if (room.guessesSubmitted.has(socket.id)) return

            const player = room.players.get(socket.id)
            if (!player || !player.connected) return

            // Validate guesses: { questionId: guessedPlayerId }
            const validGuesses = {}
            for (const q of room.shuffledQuestions) {
                if (q.authorId === socket.id) continue // Can't guess own question
                if (guesses[q.id] && room.players.has(guesses[q.id])) {
                    validGuesses[q.id] = guesses[q.id]
                }
            }

            room.guesses.set(socket.id, validGuesses)
            room.guessesSubmitted.add(socket.id)

            socket.emit('guesses-accepted', { count: Object.keys(validGuesses).length })

            const active = getActivePlayers(room)
            ns.to(roomCode).emit('phase-progress', {
                phase: 'guessing',
                completed: room.guessesSubmitted.size,
                total: active.length,
            })

            checkGuessingComplete(room, ns, roomCode)
            console.log(`[anon-q] ${player.name} submitted guesses in ${roomCode}`)
        })

        // ── Get Results ──────────────────────────────────────────
        socket.on('get-results', ({ roomCode }) => {
            const room = rooms.get(roomCode)
            if (room?.results) {
                socket.emit('results-data', room.results)
            }
        })

        // ── Get Room State (reconnect) ───────────────────────────
        socket.on('get-room-state', ({ roomCode }) => {
            const room = rooms.get(roomCode)
            if (!room) return
            sendFullState(socket, room)
        })

        // ── Play Again (host) ────────────────────────────────────
        socket.on('play-again', ({ roomCode }) => {
            const room = rooms.get(roomCode)
            if (!room || room.host !== socket.id) return

            // Reset game state
            room.phase = 'lobby'
            room.questions = []
            room.shuffledQuestions = []
            room.answers.clear()
            room.guesses.clear()
            room.questionsSubmitted.clear()
            room.answersSubmitted.clear()
            room.guessesSubmitted.clear()
            room.results = null
            if (room.phaseTimer) clearTimeout(room.phaseTimer)

            // Reset player readiness
            for (const p of room.players.values()) {
                p.ready = false
                p.score = 0
            }

            ns.to(roomCode).emit('room-update', getRoomInfo(room))
            ns.to(roomCode).emit('phase-change', { phase: 'lobby' })
            console.log(`[anon-q] play again in ${roomCode}`)
        })

        // ── Disconnect ───────────────────────────────────────────
        socket.on('disconnect', () => {
            console.log(`[anon-q] disconnected: ${socket.id}`)

            for (const [code, room] of rooms.entries()) {
                if (!room.players.has(socket.id)) continue

                const player = room.players.get(socket.id)

                if (room.phase === 'lobby') {
                    // In lobby: remove completely
                    handlePlayerLeave(room, socket.id, ns, code, false)
                } else {
                    // In-game: mark as disconnected, allow reconnection
                    player.connected = false
                    room.disconnected.set(socket.id, {
                        player: { ...player },
                        disconnectedAt: Date.now(),
                    })

                    ns.to(code).emit('room-update', getRoomInfo(room))
                    ns.to(code).emit('player-disconnected', {
                        playerName: player.name,
                    })

                    // Auto-advance if this player was the last one blocking
                    if (room.phase === 'writing') checkWritingComplete(room, ns, code)
                    if (room.phase === 'answering') checkAnsweringComplete(room, ns, code)
                    if (room.phase === 'guessing') checkGuessingComplete(room, ns, code)
                }

                // Cleanup if empty
                if (getActivePlayers(room).length === 0) {
                    if (room.phaseTimer) clearTimeout(room.phaseTimer)
                    setTimeout(() => {
                        const r = rooms.get(code)
                        if (r && getActivePlayers(r).length === 0) {
                            rooms.delete(code)
                            console.log(`[anon-q] room ${code} cleaned up`)
                        }
                    }, 10 * 60 * 1000) // 10 min grace period
                }

                break
            }
        })
    })
}

// ── Helper: Handle player leave ───────────────────────────────────

function handlePlayerLeave(room, playerId, ns, roomCode, voluntary) {
    const player = room.players.get(playerId)
    if (!player) return

    const wasHost = room.host === playerId
    room.players.delete(playerId)
    room.disconnected.delete(playerId)

    // Transfer host
    if (wasHost) {
        const remaining = getActivePlayers(room)
        if (remaining.length > 0) {
            room.host = remaining[0].id
        }
    }

    ns.to(roomCode).emit('room-update', getRoomInfo(room))
    if (voluntary) {
        ns.to(roomCode).emit('player-left', { playerName: player.name })
    }

    // Check if game should advance
    if (room.phase === 'writing') checkWritingComplete(room, ns, roomCode)
    if (room.phase === 'answering') checkAnsweringComplete(room, ns, roomCode)
    if (room.phase === 'guessing') checkGuessingComplete(room, ns, roomCode)

    // End game if less than 2 active
    const active = getActivePlayers(room)
    if (active.length < 2 && room.phase !== 'lobby' && room.phase !== 'reveal') {
        if (room.phaseTimer) clearTimeout(room.phaseTimer)
        room.phase = 'reveal'
        const results = calculateResults(room)
        room.results = results
        ns.to(roomCode).emit('phase-change', { phase: 'reveal' })
        ns.to(roomCode).emit('results-data', results)
        ns.to(roomCode).emit('error', { message: 'No hay suficientes jugadores. Mostrando resultados.' })
    }

    // Cleanup empty
    if (room.players.size === 0) {
        if (room.phaseTimer) clearTimeout(room.phaseTimer)
        setTimeout(() => {
            if (rooms.get(roomCode)?.players.size === 0) rooms.delete(roomCode)
        }, 5 * 60 * 1000)
    }
}

// ── Helper: Migrate player ID (for reconnection) ─────────────────

function migratePlayerId(room, oldId, newId) {
    // Migrate answers
    if (room.answers.has(oldId)) {
        room.answers.set(newId, room.answers.get(oldId))
        room.answers.delete(oldId)
    }

    // Migrate guesses
    if (room.guesses.has(oldId)) {
        room.guesses.set(newId, room.guesses.get(oldId))
        room.guesses.delete(oldId)
    }

    // Migrate submitted flags
    if (room.questionsSubmitted.has(oldId)) {
        room.questionsSubmitted.delete(oldId)
        room.questionsSubmitted.add(newId)
    }
    if (room.answersSubmitted.has(oldId)) {
        room.answersSubmitted.delete(oldId)
        room.answersSubmitted.add(newId)
    }
    if (room.guessesSubmitted.has(oldId)) {
        room.guessesSubmitted.delete(oldId)
        room.guessesSubmitted.add(newId)
    }

    // Migrate question authorship
    room.questions.forEach(q => {
        if (q.authorId === oldId) q.authorId = newId
    })
    room.shuffledQuestions.forEach(q => {
        if (q.authorId === oldId) q.authorId = newId
    })

    // Host
    if (room.host === oldId) room.host = newId
}

// ── Helper: Send full state to reconnecting player ────────────────

function sendFullState(socket, room) {
    const info = getRoomInfo(room)
    socket.emit('room-update', info)

    switch (room.phase) {
        case 'writing':
            socket.emit('phase-change', {
                phase: 'writing',
                questionsPerPlayer: room.settings.questionsPerPlayer,
                timeLimit: PHASE_TIMERS.writing,
            })
            // Tell them if already submitted
            if (room.questionsSubmitted.has(socket.id)) {
                socket.emit('already-submitted', { phase: 'writing' })
            }
            break

        case 'answering':
            socket.emit('phase-change', {
                phase: 'answering',
                questions: getClientQuestions(room),
                timeLimit: PHASE_TIMERS.answering,
                totalQuestions: room.shuffledQuestions.length,
            })
            if (room.answersSubmitted.has(socket.id)) {
                socket.emit('already-submitted', { phase: 'answering' })
            }
            break

        case 'guessing': {
            const questionsWithAnswers = room.shuffledQuestions.map(q => {
                const answersForQ = []
                for (const [pid, pa] of room.answers) {
                    const p = room.players.get(pid)
                    if (p && pa[q.id]) {
                        answersForQ.push({ playerId: pid, playerName: p.name, answer: pa[q.id] })
                    }
                }
                return { id: q.id, text: q.text, answers: answersForQ }
            })
            const possibleAuthors = getAllPlayers(room).map(p => ({ id: p.id, name: p.name }))
            socket.emit('phase-change', {
                phase: 'guessing',
                questions: questionsWithAnswers,
                possibleAuthors,
                timeLimit: PHASE_TIMERS.guessing,
            })
            if (room.guessesSubmitted.has(socket.id)) {
                socket.emit('already-submitted', { phase: 'guessing' })
            }
            break
        }

        case 'reveal':
            socket.emit('phase-change', { phase: 'reveal' })
            if (room.results) {
                socket.emit('results-data', room.results)
            }
            break
    }
}

module.exports = { setupAnonQuestionsNamespace }