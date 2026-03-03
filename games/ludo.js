/**
 * ===================================================================
 *  LUDO — Socket.IO Namespace Handler
 *  File: server/games/ludo.js
 * ===================================================================
 *  Competitive Ludo for 2-4 players.
 *
 *  Flow:
 *    create-room -> join-room -> toggle-ready -> game-start
 *    -> roll-dice -> select-move (repeat) -> player-wins
 *
 *  Rules:
 *    - Roll 6 to exit base
 *    - Land on enemy token = capture (sent to base)
 *    - Capture grants bonus roll
 *    - Roll 6 = extra turn (max 3 consecutive, then lose turn)
 *    - Must roll exact to enter home
 *    - Safe squares protect tokens
 *    - First to get all 4 tokens home wins
 * ===================================================================
 */

const {
    COLORS, COLOR_DATA, TOKEN_STATE, getValidMoves,
    hasPlayerWon, countFinished, rollDice, getTokenCoords,
    relativeToAbsolute, MAIN_PATH, HOME_COLUMNS, BASE_POSITIONS,
    START_POSITIONS, SAFE_POSITIONS,
} = require('../data/ludo-board');

const rooms = new Map();

function generateCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function createInitialTokens() {
    return [TOKEN_STATE.IN_BASE, TOKEN_STATE.IN_BASE, TOKEN_STATE.IN_BASE, TOKEN_STATE.IN_BASE];
}

function getGameSnapshot(room) {
    const players = room.players.map(p => ({
        id: p.id,
        name: p.name,
        color: p.color,
        ready: p.ready,
        tokens: p.tokens,
        finished: p.tokens ? countFinished(p.tokens) : 0,
    }));

    return {
        code: room.code,
        status: room.status,
        players,
        currentTurn: room.currentTurn,
        currentPlayerColor: room.players[room.currentTurn]?.color || null,
        diceValue: room.diceValue,
        validMoves: room.validMoves || [],
        turnPhase: room.turnPhase,
        lastEvent: room.lastEvent,
        consecutiveSixes: room.consecutiveSixes,
        winner: room.winner,
        rankings: room.rankings || [],
    };
}

function getAllPlayerTokens(room) {
    const result = {};
    for (const p of room.players) {
        if (p.tokens) result[p.color] = p.tokens;
    }
    return result;
}

function nextTurn(room, grantExtra = false) {
    if (grantExtra) {
        // Same player goes again
        room.turnPhase = 'roll';
        room.diceValue = null;
        room.validMoves = [];
        return;
    }

    room.consecutiveSixes = 0;
    let next = (room.currentTurn + 1) % room.players.length;

    // Skip players who have won
    let attempts = 0;
    while (room.players[next].hasWon && attempts < room.players.length) {
        next = (next + 1) % room.players.length;
        attempts++;
    }

    room.currentTurn = next;
    room.turnPhase = 'roll';
    room.diceValue = null;
    room.validMoves = [];
}

function setupLudoNamespace(io) {
    const ludo = io.of('/ludo');

    ludo.on('connection', (socket) => {
        console.log(`[ludo] connected: ${socket.id}`);

        // ── Create room ──
        socket.on('create-room', ({ playerName, numPlayers }) => {
            const code = generateCode();
            const maxPlayers = Math.min(Math.max(numPlayers || 4, 2), 4);
            const room = {
                code,
                status: 'waiting',
                maxPlayers,
                players: [{
                    id: socket.id, name: playerName, color: COLORS[0],
                    ready: false, tokens: null, hasWon: false,
                }],
                currentTurn: 0,
                diceValue: null,
                validMoves: [],
                turnPhase: 'roll',
                consecutiveSixes: 0,
                lastEvent: null,
                winner: null,
                rankings: [],
            };
            rooms.set(code, room);
            socket.join(code);
            socket.emit('room-created', { code, playerId: socket.id, color: COLORS[0] });
            ludo.to(code).emit('game-state', getGameSnapshot(room));
            console.log(`[ludo] room created: ${code} (max ${maxPlayers} players)`);
        });

        // ── Join room ──
        socket.on('join-room', ({ roomCode, playerName }) => {
            const room = rooms.get(roomCode);
            if (!room) return socket.emit('error', { message: 'Sala no encontrada.' });
            if (room.players.length >= room.maxPlayers) return socket.emit('error', { message: 'Sala llena.' });
            if (room.status !== 'waiting') return socket.emit('error', { message: 'El juego ya empezo.' });
            if (room.players.some(p => p.name.toLowerCase() === playerName.toLowerCase())) {
                return socket.emit('error', { message: 'Nombre ya en uso.' });
            }

            const color = COLORS[room.players.length];
            room.players.push({
                id: socket.id, name: playerName, color,
                ready: false, tokens: null, hasWon: false,
            });
            socket.join(roomCode);
            socket.emit('room-joined', { code: roomCode, playerId: socket.id, color });
            ludo.to(roomCode).emit('game-state', getGameSnapshot(room));
            console.log(`[ludo] ${playerName} joined ${roomCode} as ${color}`);
        });

        // ── Toggle ready ──
        socket.on('toggle-ready', ({ roomCode }) => {
            const room = rooms.get(roomCode);
            if (!room) return;
            const player = room.players.find(p => p.id === socket.id);
            if (!player) return;

            player.ready = !player.ready;
            ludo.to(roomCode).emit('game-state', getGameSnapshot(room));

            // Check if all ready (min 2)
            if (room.players.length >= 2 && room.players.every(p => p.ready)) {
                startGame(ludo, roomCode, room);
            }
        });

        // ── Roll dice ──
        socket.on('roll-dice', ({ roomCode }) => {
            const room = rooms.get(roomCode);
            if (!room || room.status !== 'playing') return;
            if (room.turnPhase !== 'roll') return;

            const currentPlayer = room.players[room.currentTurn];
            if (currentPlayer.id !== socket.id) return;
            if (currentPlayer.hasWon) return;

            const dice = rollDice();
            room.diceValue = dice;

            // Check triple six
            if (dice === 6) {
                room.consecutiveSixes++;
                if (room.consecutiveSixes >= 3) {
                    room.lastEvent = { type: 'triple-six', player: currentPlayer.name, color: currentPlayer.color };
                    room.consecutiveSixes = 0;
                    nextTurn(room, false);
                    ludo.to(roomCode).emit('game-state', getGameSnapshot(room));
                    return;
                }
            } else {
                room.consecutiveSixes = 0;
            }

            // Calculate valid moves
            const allTokens = getAllPlayerTokens(room);
            const moves = getValidMoves(currentPlayer.color, currentPlayer.tokens, allTokens, dice);
            room.validMoves = moves;

            if (moves.length === 0) {
                // No valid moves, skip turn
                room.lastEvent = { type: 'no-moves', player: currentPlayer.name, color: currentPlayer.color, dice };
                room.turnPhase = 'roll';
                setTimeout(() => {
                    nextTurn(room, false);
                    ludo.to(roomCode).emit('game-state', getGameSnapshot(room));
                }, 1200);
                ludo.to(roomCode).emit('game-state', getGameSnapshot(room));
                return;
            }

            if (moves.length === 1) {
                // Auto-select only move
                room.turnPhase = 'moving';
                ludo.to(roomCode).emit('game-state', getGameSnapshot(room));
                setTimeout(() => executeMove(ludo, roomCode, room, moves[0]), 500);
                return;
            }

            room.turnPhase = 'select';
            ludo.to(roomCode).emit('game-state', getGameSnapshot(room));
        });

        // ── Select move ──
        socket.on('select-move', ({ roomCode, tokenIndex }) => {
            const room = rooms.get(roomCode);
            if (!room || room.status !== 'playing') return;
            if (room.turnPhase !== 'select') return;

            const currentPlayer = room.players[room.currentTurn];
            if (currentPlayer.id !== socket.id) return;

            const move = room.validMoves.find(m => m.tokenIndex === tokenIndex);
            if (!move) return socket.emit('error', { message: 'Movimiento invalido.' });

            room.turnPhase = 'moving';
            executeMove(ludo, roomCode, room, move);
        });

        // ── Get state ──
        socket.on('get-state', ({ roomCode }) => {
            const room = rooms.get(roomCode);
            if (!room) return;
            socket.emit('game-state', getGameSnapshot(room));
        });

        // ── Disconnect ──
        socket.on('disconnect', () => {
            console.log(`[ludo] disconnected: ${socket.id}`);
            for (const [code, room] of rooms.entries()) {
                const idx = room.players.findIndex(p => p.id === socket.id);
                if (idx === -1) continue;

                const playerName = room.players[idx].name;

                if (room.status === 'waiting') {
                    room.players.splice(idx, 1);
                    // Reassign colors
                    room.players.forEach((p, i) => { p.color = COLORS[i]; });
                } else {
                    // Mark as disconnected but don't remove (keep game going)
                    room.players[idx].disconnected = true;
                    room.lastEvent = {
                        type: 'player-disconnected',
                        player: playerName,
                        color: room.players[idx].color,
                    };

                    // If it's their turn, skip
                    if (room.currentTurn === idx && room.status === 'playing') {
                        nextTurn(room, false);
                    }

                    // Check if only 1 active player left
                    const active = room.players.filter(p => !p.disconnected && !p.hasWon);
                    if (active.length <= 1 && room.status === 'playing') {
                        room.status = 'finished';
                        if (active.length === 1) {
                            room.winner = active[0].color;
                            if (!room.rankings.includes(active[0].color)) {
                                room.rankings.push(active[0].color);
                            }
                        }
                    }
                }

                ludo.to(code).emit('game-state', getGameSnapshot(room));
                ludo.to(code).emit('player-left', { playerName });

                if (room.players.filter(p => !p.disconnected).length === 0) {
                    setTimeout(() => {
                        const r = rooms.get(code);
                        if (r && r.players.filter(p => !p.disconnected).length === 0) rooms.delete(code);
                    }, 5 * 60 * 1000);
                }
                break;
            }
        });
    });

    // ── Start game ──
    function startGame(wsNs, roomCode, room) {
        room.status = 'playing';
        room.currentTurn = 0;
        room.turnPhase = 'roll';
        room.players.forEach(p => {
            p.tokens = createInitialTokens();
            p.ready = false;
            p.hasWon = false;
        });
        room.rankings = [];
        room.lastEvent = { type: 'game-start', message: 'El juego ha comenzado!' };

        wsNs.to(roomCode).emit('game-started', getGameSnapshot(room));
        wsNs.to(roomCode).emit('game-state', getGameSnapshot(room));
        console.log(`[ludo] game started in ${roomCode} with ${room.players.length} players`);
    }

    // ── Execute a move ──
    function executeMove(wsNs, roomCode, room, move) {
        const currentPlayer = room.players[room.currentTurn];
        const { tokenIndex, to, isCapture, capturedColor, capturedTokenIdx, isFinish, isExit } = move;

        // Move token
        currentPlayer.tokens[tokenIndex] = to;

        let grantExtraTurn = false;
        const events = [];

        // Handle exit from base
        if (isExit) {
            events.push({
                type: 'token-exit',
                player: currentPlayer.name,
                color: currentPlayer.color,
                tokenIndex,
            });
        }

        // Handle capture
        if (isCapture && capturedColor && capturedTokenIdx !== null) {
            const capturedPlayer = room.players.find(p => p.color === capturedColor);
            if (capturedPlayer && capturedPlayer.tokens) {
                capturedPlayer.tokens[capturedTokenIdx] = TOKEN_STATE.IN_BASE;
                events.push({
                    type: 'capture',
                    player: currentPlayer.name,
                    color: currentPlayer.color,
                    capturedPlayer: capturedPlayer.name,
                    capturedColor,
                    capturedTokenIdx,
                });
                grantExtraTurn = true; // bonus turn for capture
            }
        }

        // Handle finish
        if (isFinish) {
            events.push({
                type: 'token-home',
                player: currentPlayer.name,
                color: currentPlayer.color,
                tokenIndex,
                finished: countFinished(currentPlayer.tokens),
            });
            grantExtraTurn = true; // bonus turn for getting home

            // Check win
            if (hasPlayerWon(currentPlayer.tokens)) {
                currentPlayer.hasWon = true;
                room.rankings.push(currentPlayer.color);
                events.push({
                    type: 'player-won',
                    player: currentPlayer.name,
                    color: currentPlayer.color,
                    rank: room.rankings.length,
                });

                if (!room.winner) room.winner = currentPlayer.color;

                // Check if game is over (only 1 or 0 players left)
                const remaining = room.players.filter(p => !p.hasWon && !p.disconnected);
                if (remaining.length <= 1) {
                    if (remaining.length === 1) {
                        room.rankings.push(remaining[0].color);
                    }
                    room.status = 'finished';
                    events.push({ type: 'game-over' });
                }

                grantExtraTurn = false; // no extra turn if won
            }
        }

        // Extra turn from rolling 6 (if no capture/finish bonus already)
        if (!grantExtraTurn && room.diceValue === 6 && !currentPlayer.hasWon) {
            grantExtraTurn = true;
        }

        room.lastEvent = events.length > 0 ? events[events.length - 1] : {
            type: 'move', player: currentPlayer.name, color: currentPlayer.color,
            tokenIndex, from: move.from, to: move.to, dice: room.diceValue,
        };

        if (room.status === 'finished') {
            wsNs.to(roomCode).emit('game-state', getGameSnapshot(room));
            return;
        }

        // Next turn
        if (currentPlayer.hasWon) {
            nextTurn(room, false);
        } else {
            nextTurn(room, grantExtraTurn);
        }

        wsNs.to(roomCode).emit('game-state', getGameSnapshot(room));
    }
}

module.exports = { setupLudoNamespace };