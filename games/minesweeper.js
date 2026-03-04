/**
 * Minesweeper Competitive — Server Logic
 *
 * Mechanics:
 * - All players share the SAME mine layout (seeded generation)
 * - Each player reveals cells independently on their own board copy
 * - Server authoritative: clients send actions, server computes results
 * - Scoring: +10 per cell, +5 cascade bonus, +25 correct flag, -50 mine hit
 * - 3 lives per player, eliminated at 0
 * - Game ends: someone clears all safe cells, all eliminated, or timer expires
 */

// ── Board Generation ──────────────────────────────────────────────

const DIFFICULTIES = {
    easy:   { rows: 9,  cols: 9,  mines: 10 },
    medium: { rows: 16, cols: 16, mines: 40 },
    hard:   { rows: 16, cols: 30, mines: 99 },
}

const GAME_DURATION = 5 * 60 * 1000 // 5 minutes

function seededRandom(seed) {
    let s = seed
    return function () {
        s = (s * 1664525 + 1013904223) & 0xffffffff
        return (s >>> 0) / 0xffffffff
    }
}

function generateBoard(difficulty, seed) {
    const config = DIFFICULTIES[difficulty] || DIFFICULTIES.medium
    const { rows, cols, mines } = config
    const rng = seededRandom(seed)

    // Create empty board
    const board = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => ({ hasMine: false, adjacent: 0 }))
    )

    // Place mines
    let placed = 0
    while (placed < mines) {
        const r = Math.floor(rng() * rows)
        const c = Math.floor(rng() * cols)
        if (!board[r][c].hasMine) {
            board[r][c].hasMine = true
            placed++
        }
    }

    // Calculate adjacencies
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (board[r][c].hasMine) continue
            let count = 0
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    if (dr === 0 && dc === 0) continue
                    const nr = r + dr, nc = c + dc
                    if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && board[nr][nc].hasMine) {
                        count++
                    }
                }
            }
            board[r][c].adjacent = count
        }
    }

    return { board, rows, cols, mines }
}

function floodReveal(board, rows, cols, startR, startC, alreadyRevealed) {
    const revealed = []
    const queue = [[startR, startC]]
    const visited = new Set(alreadyRevealed)

    while (queue.length > 0) {
        const [r, c] = queue.shift()
        const key = `${r},${c}`
        if (visited.has(key)) continue
        if (r < 0 || r >= rows || c < 0 || c >= cols) continue

        const cell = board[r][c]
        if (cell.hasMine) continue

        visited.add(key)
        revealed.push({ row: r, col: c, value: cell.adjacent })

        if (cell.adjacent === 0) {
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    if (dr === 0 && dc === 0) continue
                    queue.push([r + dr, c + dc])
                }
            }
        }
    }

    return revealed
}

// ── Scoring Constants ─────────────────────────────────────────────

const SCORE = {
    REVEAL_CELL: 10,
    CASCADE_BONUS: 5,
    CORRECT_FLAG: 25,
    MINE_HIT: -50,
    CLEAR_BONUS: 500,
    TIME_BONUS_PER_SECOND: 2,
}

// ── Room Management ───────────────────────────────────────────────

const rooms = new Map()

function generateCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase()
}

function createPlayerState() {
    return {
        revealed: new Set(),
        flagged: new Set(),
        score: 0,
        lives: 3,
        status: 'playing',        // playing | eliminated | cleared
        cellsRevealed: 0,
        correctFlags: 0,
        minesHit: 0,
    }
}

function getPlayerStats(room) {
    return room.players.map(p => {
        const ps = room.playerStates.get(p.id)
        return {
            id: p.id,
            name: p.name,
            score: ps?.score ?? 0,
            lives: ps?.lives ?? 3,
            status: ps?.status ?? 'playing',
            cellsRevealed: ps?.cellsRevealed ?? 0,
            correctFlags: ps?.correctFlags ?? 0,
            progress: ps ? Math.round((ps.cellsRevealed / room.safeCells) * 100) : 0,
        }
    })
}

function checkGameEnd(room) {
    const activePlayers = room.players.filter(p => {
        const ps = room.playerStates.get(p.id)
        return ps && ps.status === 'playing'
    })

    // Someone cleared all safe cells
    const winner = room.players.find(p => {
        const ps = room.playerStates.get(p.id)
        return ps && ps.status === 'cleared'
    })

    if (winner || activePlayers.length === 0) {
        return true
    }

    return false
}

function calculateFinalResults(room) {
    const elapsed = Date.now() - room.startTime
    const players = room.players.map(p => {
        const ps = room.playerStates.get(p.id)
        if (!ps) return { name: p.name, score: 0, lives: 0, status: 'eliminated', cellsRevealed: 0, correctFlags: 0, minesHit: 0, progress: 0 }

        // Time bonus for players who cleared
        let finalScore = ps.score
        if (ps.status === 'cleared') {
            const secondsRemaining = Math.max(0, (GAME_DURATION - elapsed) / 1000)
            finalScore += Math.round(secondsRemaining * SCORE.TIME_BONUS_PER_SECOND)
        }

        return {
            name: p.name,
            score: finalScore,
            lives: ps.lives,
            status: ps.status,
            cellsRevealed: ps.cellsRevealed,
            correctFlags: ps.correctFlags,
            minesHit: ps.minesHit,
            progress: Math.round((ps.cellsRevealed / room.safeCells) * 100),
        }
    })

    // Sort by score descending
    players.sort((a, b) => b.score - a.score)

    return {
        players,
        duration: elapsed,
        difficulty: room.difficulty,
        boardSize: `${room.boardData.rows}x${room.boardData.cols}`,
        totalMines: room.boardData.mines,
        safeCells: room.safeCells,
    }
}

// ── Socket.IO Namespace ───────────────────────────────────────────

function setupMinesweeperNamespace(io) {
    const ns = io.of('/minesweeper')

    ns.on('connection', (socket) => {
        console.log(`[minesweeper] connected: ${socket.id}`)

        // ── Create Room ──
        socket.on('create-room', ({ playerName, difficulty = 'medium' }) => {
            const code = generateCode()
            const room = {
                code,
                status: 'waiting',
                difficulty,
                host: socket.id,
                players: [{ id: socket.id, name: playerName, ready: false }],
                playerStates: new Map(),
                boardData: null,
                safeCells: 0,
                startTime: null,
                timer: null,
                results: null,
            }
            rooms.set(code, room)
            socket.join(code)
            socket.emit('room-created', { code, playerId: socket.id })
            console.log(`[minesweeper] room created: ${code} (${difficulty})`)
        })

        // ── Join Room ──
        socket.on('join-room', ({ roomCode, playerName }) => {
            const room = rooms.get(roomCode)
            if (!room) return socket.emit('error', { message: 'Sala no encontrada. Verifica el código.' })
            if (room.players.length >= 8) return socket.emit('error', { message: 'La sala está llena (máx. 8).' })
            if (room.status !== 'waiting') return socket.emit('error', { message: 'El juego ya comenzó.' })
            if (room.players.find(p => p.name === playerName)) {
                return socket.emit('error', { message: 'Ese nombre ya está en uso en esta sala.' })
            }

            room.players.push({ id: socket.id, name: playerName, ready: false })
            socket.join(roomCode)
            socket.emit('room-joined', { code: roomCode, playerId: socket.id })

            ns.to(roomCode).emit('room-update', {
                players: room.players,
                difficulty: room.difficulty,
                host: room.host,
            })
            console.log(`[minesweeper] ${playerName} joined ${roomCode}`)
        })

        // ── Toggle Ready ──
        socket.on('toggle-ready', ({ roomCode }) => {
            const room = rooms.get(roomCode)
            if (!room) return

            const player = room.players.find(p => p.id === socket.id)
            if (player) player.ready = !player.ready

            ns.to(roomCode).emit('room-update', {
                players: room.players,
                difficulty: room.difficulty,
                host: room.host,
            })
        })

        // ── Change Difficulty (host only) ──
        socket.on('change-difficulty', ({ roomCode, difficulty }) => {
            const room = rooms.get(roomCode)
            if (!room || room.host !== socket.id) return
            if (!DIFFICULTIES[difficulty]) return

            room.difficulty = difficulty
            ns.to(roomCode).emit('room-update', {
                players: room.players,
                difficulty: room.difficulty,
                host: room.host,
            })
        })

        // ── Start Game (host only, min 2 players, all ready) ──
        socket.on('start-game', ({ roomCode }) => {
            const room = rooms.get(roomCode)
            if (!room || room.host !== socket.id) return
            if (room.players.length < 2) {
                return socket.emit('error', { message: 'Se necesitan al menos 2 jugadores.' })
            }

            const allReady = room.players.every(p => p.id === room.host || p.ready)
            if (!allReady) {
                return socket.emit('error', { message: 'No todos los jugadores están listos.' })
            }

            // Generate board
            const seed = Date.now()
            const boardData = generateBoard(room.difficulty, seed)
            room.boardData = boardData
            room.safeCells = (boardData.rows * boardData.cols) - boardData.mines
            room.status = 'playing'
            room.startTime = Date.now()

            // Init player states
            room.players.forEach(p => {
                room.playerStates.set(p.id, createPlayerState())
            })

            // Send game start (NO mine positions sent to client!)
            ns.to(roomCode).emit('game-start', {
                rows: boardData.rows,
                cols: boardData.cols,
                mines: boardData.mines,
                duration: GAME_DURATION,
                players: getPlayerStats(room),
            })

            // Game timer
            room.timer = setTimeout(() => {
                if (room.status !== 'playing') return
                room.status = 'finished'
                const results = calculateFinalResults(room)
                room.results = results
                ns.to(roomCode).emit('game-over', { reason: 'timeout', results })
                console.log(`[minesweeper] game timed out in ${roomCode}`)
            }, GAME_DURATION)

            console.log(`[minesweeper] game started in ${roomCode} (${room.difficulty}, ${room.players.length} players)`)
        })

        // ── Reveal Cell ──
        socket.on('reveal-cell', ({ roomCode, row, col }) => {
            const room = rooms.get(roomCode)
            if (!room || room.status !== 'playing') return

            const ps = room.playerStates.get(socket.id)
            if (!ps || ps.status !== 'playing') return

            const { board, rows, cols } = room.boardData
            const key = `${row},${col}`

            // Can't reveal flagged or already revealed
            if (ps.revealed.has(key) || ps.flagged.has(key)) return
            if (row < 0 || row >= rows || col < 0 || col >= cols) return

            const cell = board[row][col]

            if (cell.hasMine) {
                // Hit a mine!
                ps.lives--
                ps.minesHit++
                ps.score += SCORE.MINE_HIT
                ps.revealed.add(key)

                socket.emit('mine-hit', {
                    row, col,
                    lives: ps.lives,
                    score: ps.score,
                })

                if (ps.lives <= 0) {
                    ps.status = 'eliminated'
                    socket.emit('player-eliminated', { reason: 'No te quedan vidas' })
                }

                // Broadcast updated stats
                ns.to(roomCode).emit('player-stats-update', { players: getPlayerStats(room) })

                // Check game end
                if (checkGameEnd(room)) {
                    clearTimeout(room.timer)
                    room.status = 'finished'
                    const results = calculateFinalResults(room)
                    room.results = results
                    ns.to(roomCode).emit('game-over', { reason: 'end', results })
                }
                return
            }

            // Safe cell — flood reveal if 0
            const newlyRevealed = floodReveal(board, rows, cols, row, col, ps.revealed)

            if (newlyRevealed.length === 0) return

            newlyRevealed.forEach(c => ps.revealed.add(`${c.row},${c.col}`))
            ps.cellsRevealed += newlyRevealed.length

            // Score: base + cascade bonus
            ps.score += SCORE.REVEAL_CELL
            if (newlyRevealed.length > 1) {
                ps.score += (newlyRevealed.length - 1) * SCORE.CASCADE_BONUS
            }

            socket.emit('cells-revealed', {
                cells: newlyRevealed,
                score: ps.score,
                cellsRevealed: ps.cellsRevealed,
            })

            // Check if cleared all safe cells
            if (ps.cellsRevealed >= room.safeCells) {
                ps.status = 'cleared'
                ps.score += SCORE.CLEAR_BONUS
                socket.emit('board-cleared', { score: ps.score, bonus: SCORE.CLEAR_BONUS })
            }

            // Broadcast updated stats
            ns.to(roomCode).emit('player-stats-update', { players: getPlayerStats(room) })

            // Check game end
            if (checkGameEnd(room)) {
                clearTimeout(room.timer)
                room.status = 'finished'
                const results = calculateFinalResults(room)
                room.results = results
                ns.to(roomCode).emit('game-over', { reason: 'cleared', results })
            }
        })

        // ── Toggle Flag ──
        socket.on('toggle-flag', ({ roomCode, row, col }) => {
            const room = rooms.get(roomCode)
            if (!room || room.status !== 'playing') return

            const ps = room.playerStates.get(socket.id)
            if (!ps || ps.status !== 'playing') return

            const { board, rows, cols } = room.boardData
            const key = `${row},${col}`

            if (row < 0 || row >= rows || col < 0 || col >= cols) return
            if (ps.revealed.has(key)) return

            if (ps.flagged.has(key)) {
                // Remove flag
                ps.flagged.delete(key)
                socket.emit('flag-update', { row, col, flagged: false, score: ps.score, correctFlags: ps.correctFlags })
            } else {
                // Place flag
                ps.flagged.add(key)

                if (board[row][col].hasMine) {
                    ps.correctFlags++
                    ps.score += SCORE.CORRECT_FLAG
                }

                socket.emit('flag-update', { row, col, flagged: true, score: ps.score, correctFlags: ps.correctFlags })
            }

            ns.to(roomCode).emit('player-stats-update', { players: getPlayerStats(room) })
        })

        // ── Get Results ──
        socket.on('get-results', ({ roomCode }) => {
            const room = rooms.get(roomCode)
            if (room?.results) {
                socket.emit('results-data', room.results)
            }
        })

        // ── Get Room State (reconnect) ──
        socket.on('get-room-state', ({ roomCode }) => {
            const room = rooms.get(roomCode)
            if (room) {
                socket.emit('room-update', {
                    players: room.players,
                    difficulty: room.difficulty,
                    host: room.host,
                })
            }
        })

        // ── Disconnect ──
        socket.on('disconnect', () => {
            console.log(`[minesweeper] disconnected: ${socket.id}`)
            for (const [code, room] of rooms.entries()) {
                const idx = room.players.findIndex(p => p.id === socket.id)
                if (idx !== -1) {
                    const wasHost = room.host === socket.id
                    room.players.splice(idx, 1)
                    room.playerStates.delete(socket.id)

                    // Transfer host
                    if (wasHost && room.players.length > 0) {
                        room.host = room.players[0].id
                    }

                    ns.to(code).emit('room-update', {
                        players: room.players,
                        difficulty: room.difficulty,
                        host: room.host,
                    })

                    if (room.status === 'playing') {
                        ns.to(code).emit('player-stats-update', { players: getPlayerStats(room) })
                        if (checkGameEnd(room)) {
                            clearTimeout(room.timer)
                            room.status = 'finished'
                            const results = calculateFinalResults(room)
                            room.results = results
                            ns.to(code).emit('game-over', { reason: 'disconnect', results })
                        }
                    }

                    // Cleanup empty rooms
                    if (room.players.length === 0) {
                        clearTimeout(room.timer)
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

module.exports = { setupMinesweeperNamespace }