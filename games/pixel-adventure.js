const { v4: uuidv4 } = require('uuid')
const {
    BOARD,
    PLAYER_COLORS,
    PLAYER_SPRITES,
    getRandomEvent,
    getRandomItem,
    getRandomDecision,
    getRandomTrap,
} = require('../data/board-config')

const rooms = new Map()

const MAX_PLAYERS = 8
const MIN_PLAYERS = 2
const MAX_ITEMS = 3
const LAST_TILE = BOARD.length - 1
const DICE_SIDES = 12
const RECONNECT_GRACE = 90 * 1000

function generateCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase()
}

function rollDice(sides = DICE_SIDES) {
    return Math.floor(Math.random() * sides) + 1
}

function clampTile(pos) {
    return Math.max(0, Math.min(pos, LAST_TILE))
}

function getPlayersArray(room) {
    return Array.from(room.players.values()).map(p => ({
        id: p.id,
        name: p.name,
        position: p.position,
        score: p.score,
        items: [...p.items],
        connected: p.connected,
        isHost: p.id === room.hostId,
        colorIndex: p.colorIndex,
        spriteIndex: p.spriteIndex,
        skipNextTurn: p.skipNextTurn,
        hasShield: p.items.some(i => i.id === 'shield'),
        turboNext: p.turboNext,
    }))
}

function getConnectedPlayers(room) {
    return Array.from(room.players.values()).filter(p => p.connected)
}

function setupPixelAdventureNamespace(io) {
    const ns = io.of('/pixel-adventure')

    ns.on('connection', (socket) => {
        console.log(`[pixel] connected: ${socket.id}`)

        // ════════════════════════════════════
        //  CREATE ROOM
        // ════════════════════════════════════
        socket.on('create-room', ({ playerName }) => {
            const code = generateCode()
            const playerId = uuidv4()
            const room = {
                code,
                status: 'waiting', // waiting | playing | finished
                hostId: playerId,
                players: new Map(),
                turnOrder: [],
                currentTurnIndex: -1,
                currentPlayerId: null,
                turnPhase: 'idle', // idle | item_phase | rolling | moving | resolving | decision | targeting | finished
                ghostTraps: new Map(), // tileId -> { placedBy, damage }
                gameLog: [],
                pendingAction: null, // for decisions/targeting
            }

            room.players.set(playerId, createPlayer(playerId, playerName, 0))
            rooms.set(code, room)
            socket.join(code)
            socket.playerId = playerId
            socket.roomCode = code

            socket.emit('room-created', { code, playerId })
            broadcastRoomState(ns, room)
        })

        // ════════════════════════════════════
        //  JOIN ROOM
        // ════════════════════════════════════
        socket.on('join-room', ({ roomCode, playerName }) => {
            const room = rooms.get(roomCode)
            if (!room) return socket.emit('error', { message: 'Sala no encontrada.' })
            if (room.status !== 'waiting') return socket.emit('error', { message: 'El juego ya comenzó.' })
            if (room.players.size >= MAX_PLAYERS) return socket.emit('error', { message: 'Sala llena (máx 8).' })

            const playerId = uuidv4()
            const colorIdx = room.players.size
            room.players.set(playerId, createPlayer(playerId, playerName, colorIdx))

            socket.join(roomCode)
            socket.playerId = playerId
            socket.roomCode = roomCode

            socket.emit('room-joined', { code: roomCode, playerId })
            broadcastRoomState(ns, room)

            addLog(ns, room, 'system', `${playerName} se unió a la sala`)
        })

        // ════════════════════════════════════
        //  RECONNECT
        // ════════════════════════════════════
        socket.on('reconnect-player', ({ roomCode, playerId }) => {
            const room = rooms.get(roomCode)
            if (!room) return socket.emit('error', { message: 'Sala no encontrada.' })
            const player = room.players.get(playerId)
            if (!player) return socket.emit('error', { message: 'No estás en esta sala.' })

            player.socketId = socket.id
            player.connected = true
            socket.join(roomCode)
            socket.playerId = playerId
            socket.roomCode = roomCode

            socket.emit('room-joined', { code: roomCode, playerId })

            // Full state restore
            socket.emit('full-state', {
                board: BOARD,
                players: getPlayersArray(room),
                hostId: room.hostId,
                status: room.status,
                currentPlayerId: room.currentPlayerId,
                turnPhase: room.turnPhase,
                gameLog: room.gameLog.slice(-30),
                pendingAction: room.pendingAction,
                ghostTraps: Array.from(room.ghostTraps.entries()),
            })

            broadcastRoomState(ns, room)
            addLog(ns, room, 'system', `${player.name} se reconectó`)
        })

        // ════════════════════════════════════
        //  START GAME
        // ════════════════════════════════════
        socket.on('start-game', () => {
            const room = rooms.get(socket.roomCode)
            if (!room || socket.playerId !== room.hostId) return
            if (room.players.size < MIN_PLAYERS) return socket.emit('error', { message: 'Mínimo 2 jugadores.' })
            if (room.status !== 'waiting') return

            room.status = 'playing'
            room.turnOrder = [...room.players.keys()].sort(() => Math.random() - 0.5)
            room.currentTurnIndex = 0
            room.currentPlayerId = room.turnOrder[0]
            room.turnPhase = 'item_phase'

            ns.to(room.code).emit('game-started', {
                board: BOARD,
                players: getPlayersArray(room),
                turnOrder: room.turnOrder,
                currentPlayerId: room.currentPlayerId,
            })

            addLog(ns, room, 'system', '¡El juego ha comenzado!')
            emitTurnStart(ns, room)
        })

        // ════════════════════════════════════
        //  USE ITEM (before rolling)
        // ════════════════════════════════════
        socket.on('use-item', ({ itemIndex, targetPlayerId }) => {
            const room = rooms.get(socket.roomCode)
            if (!room || room.currentPlayerId !== socket.playerId) return
            if (room.turnPhase !== 'item_phase') return

            const player = room.players.get(socket.playerId)
            if (!player || !player.items[itemIndex]) return

            const item = player.items[itemIndex]
            player.items.splice(itemIndex, 1)

            let resolved = true

            switch (item.id) {
                case 'shield':
                    player.hasActiveShield = true
                    addLog(ns, room, 'item', `${player.name} activó un 🛡️ Escudo`)
                    break

                case 'precise_dice':
                    room.turnPhase = 'precise_dice'
                    resolved = false
                    ns.to(room.code).emit('precise-dice-prompt', { playerId: player.id })
                    addLog(ns, room, 'item', `${player.name} usó el 🎯 Dado preciso`)
                    break

                case 'swap_potion':
                    if (room.players.size <= 1) break
                    room.turnPhase = 'targeting'
                    room.pendingAction = { type: 'swap', sourceId: player.id }
                    resolved = false
                    ns.to(room.code).emit('target-prompt', {
                        playerId: player.id,
                        action: 'swap',
                        message: 'Elige un jugador para intercambiar posición',
                    })
                    addLog(ns, room, 'item', `${player.name} usó la 🔄 Poción intercambio`)
                    break

                case 'magnet':
                    player.magnetActive = true
                    addLog(ns, room, 'item', `${player.name} activó el 🧲 Imán (+3 extra)`)
                    break

                case 'bomb':
                    room.turnPhase = 'targeting'
                    room.pendingAction = { type: 'bomb', sourceId: player.id }
                    resolved = false
                    ns.to(room.code).emit('target-prompt', {
                        playerId: player.id,
                        action: 'bomb',
                        message: 'Elige un jugador para bombardear (-5 casillas)',
                    })
                    addLog(ns, room, 'item', `${player.name} usó la 💣 Bomba`)
                    break

                case 'freeze':
                    room.turnPhase = 'targeting'
                    room.pendingAction = { type: 'freeze', sourceId: player.id }
                    resolved = false
                    ns.to(room.code).emit('target-prompt', {
                        playerId: player.id,
                        action: 'freeze',
                        message: 'Elige un jugador para congelar (pierde 1 turno)',
                    })
                    addLog(ns, room, 'item', `${player.name} usó ❄️ Congelar`)
                    break

                case 'double_dice':
                    player.doubleDice = true
                    addLog(ns, room, 'item', `${player.name} usó el 🎲 Dado doble`)
                    break

                case 'mirror':
                    player.mirrorActive = true
                    addLog(ns, room, 'item', `${player.name} activó el 🪞 Espejo`)
                    break
            }

            if (resolved) {
                broadcastRoomState(ns, room)
            }
        })

        // ── Select precise dice value ──
        socket.on('precise-dice-value', ({ value }) => {
            const room = rooms.get(socket.roomCode)
            if (!room || room.currentPlayerId !== socket.playerId) return
            if (room.turnPhase !== 'precise_dice') return

            const val = Math.max(1, Math.min(DICE_SIDES, parseInt(value) || 1))
            executeDiceRoll(ns, room, val)
        })

        // ── Select target for item ──
        socket.on('select-target', ({ targetPlayerId }) => {
            const room = rooms.get(socket.roomCode)
            if (!room || room.currentPlayerId !== socket.playerId) return
            if (room.turnPhase !== 'targeting' || !room.pendingAction) return

            const source = room.players.get(room.pendingAction.sourceId)
            const target = room.players.get(targetPlayerId)
            if (!source || !target || targetPlayerId === socket.playerId) return

            // Check if target has mirror
            if (target.mirrorActive && (room.pendingAction.type === 'bomb' || room.pendingAction.type === 'freeze')) {
                target.mirrorActive = false
                // Reflect back to source
                addLog(ns, room, 'event', `🪞 ¡${target.name} reflejó el ataque de vuelta a ${source.name}!`)
                if (room.pendingAction.type === 'bomb') {
                    source.position = clampTile(source.position - 5)
                } else {
                    source.skipNextTurn = true
                }
            } else {
                switch (room.pendingAction.type) {
                    case 'swap':
                        const tempPos = source.position
                        source.position = target.position
                        target.position = tempPos
                        addLog(ns, room, 'event', `🔄 ${source.name} y ${target.name} intercambiaron posiciones`)
                        break
                    case 'bomb':
                        target.position = clampTile(target.position - 5)
                        addLog(ns, room, 'event', `💣 ${target.name} retrocedió 5 casillas`)
                        break
                    case 'freeze':
                        target.skipNextTurn = true
                        addLog(ns, room, 'event', `❄️ ${target.name} perderá su próximo turno`)
                        break
                }
            }

            room.pendingAction = null
            room.turnPhase = 'item_phase'
            broadcastRoomState(ns, room)
        })

        // ════════════════════════════════════
        //  SKIP ITEM PHASE → ROLL DICE
        // ════════════════════════════════════
        socket.on('roll-dice', () => {
            const room = rooms.get(socket.roomCode)
            if (!room || room.currentPlayerId !== socket.playerId) return
            if (room.turnPhase !== 'item_phase') return

            const player = room.players.get(socket.playerId)
            let diceValue = rollDice()

            if (player.doubleDice) {
                const dice2 = rollDice()
                diceValue += dice2
                player.doubleDice = false
                addLog(ns, room, 'dice', `${player.name} tiró dados dobles: ${diceValue - dice2} + ${dice2} = ${diceValue}`)
            }

            if (player.turboNext) {
                diceValue *= 2
                player.turboNext = false
                addLog(ns, room, 'dice', `🚀 ¡Turbo! El dado vale doble: ${diceValue}`)
            }

            executeDiceRoll(ns, room, diceValue)
        })

        // ════════════════════════════════════
        //  DECISION CHOICE
        // ════════════════════════════════════
        socket.on('make-decision', ({ choice }) => {
            const room = rooms.get(socket.roomCode)
            if (!room || room.currentPlayerId !== socket.playerId) return
            if (room.turnPhase !== 'decision') return

            resolveDecision(ns, room, choice)
        })

        // ════════════════════════════════════
        //  EVENT TARGET (swap/steal choosing)
        // ════════════════════════════════════
        socket.on('event-target', ({ targetPlayerId }) => {
            const room = rooms.get(socket.roomCode)
            if (!room || room.currentPlayerId !== socket.playerId) return
            if (room.turnPhase !== 'event_targeting') return

            resolveEventTarget(ns, room, targetPlayerId)
        })

        // ════════════════════════════════════
        //  KICK PLAYER
        // ════════════════════════════════════
        socket.on('kick-player', ({ targetPlayerId }) => {
            const room = rooms.get(socket.roomCode)
            if (!room || socket.playerId !== room.hostId) return
            if (targetPlayerId === room.hostId) return

            const target = room.players.get(targetPlayerId)
            if (!target) return

            const targetSocket = findSocket(ns, target.socketId)
            if (targetSocket) {
                targetSocket.emit('kicked')
                targetSocket.leave(room.code)
            }

            room.players.delete(targetPlayerId)
            room.turnOrder = room.turnOrder.filter(id => id !== targetPlayerId)

            addLog(ns, room, 'system', `${target.name} fue expulsado`)
            broadcastRoomState(ns, room)

            if (room.status === 'playing' && getConnectedPlayers(room).length < MIN_PLAYERS) {
                endGame(ns, room, 'not-enough-players')
            }
        })

        // ════════════════════════════════════
        //  DISCONNECT
        // ════════════════════════════════════
        socket.on('disconnect', () => {
            const room = rooms.get(socket.roomCode)
            if (!room) return

            const player = room.players.get(socket.playerId)
            if (!player) return

            player.connected = false
            addLog(ns, room, 'system', `${player.name} se desconectó`)

            // Migrate host
            if (socket.playerId === room.hostId) {
                const newHost = getConnectedPlayers(room).find(p => p.id !== socket.playerId)
                if (newHost) {
                    room.hostId = newHost.id
                    addLog(ns, room, 'system', `${newHost.name} es el nuevo host`)
                }
            }

            broadcastRoomState(ns, room)

            // If current player disconnected during their turn, skip
            if (room.status === 'playing' && room.currentPlayerId === socket.playerId) {
                setTimeout(() => {
                    const p = room.players.get(socket.playerId)
                    if (p && !p.connected && room.currentPlayerId === socket.playerId) {
                        addLog(ns, room, 'system', `${p.name} perdió su turno por desconexión`)
                        advanceTurn(ns, room)
                    }
                }, 10000)
            }

            if (room.status === 'playing' && getConnectedPlayers(room).length < MIN_PLAYERS) {
                endGame(ns, room, 'not-enough-players')
            }

            // Cleanup empty rooms
            if (getConnectedPlayers(room).length === 0) {
                setTimeout(() => {
                    if (rooms.has(room.code) && getConnectedPlayers(room).length === 0) {
                        rooms.delete(room.code)
                        console.log(`[pixel] room ${room.code} cleaned up`)
                    }
                }, RECONNECT_GRACE)
            }
        })
    })

    // ════════════════════════════════════════
    //  CORE GAME LOGIC
    // ════════════════════════════════════════

    function executeDiceRoll(ns, room, diceValue) {
        const player = room.players.get(room.currentPlayerId)
        if (!player) return

        room.turnPhase = 'moving'
        const prevPosition = player.position
        let newPosition = player.position + diceValue

        // Magnet bonus
        if (player.magnetActive) {
            newPosition += 3
            player.magnetActive = false
        }

        newPosition = clampTile(newPosition)
        player.position = newPosition

        if (!player.doubleDice && !player.turboNext) {
            addLog(ns, room, 'dice', `🎲 ${player.name} sacó ${diceValue} → casilla ${newPosition}`)
        }

        // Emit dice animation + movement
        ns.to(room.code).emit('dice-result', {
            playerId: player.id,
            diceValue,
            from: prevPosition,
            to: newPosition,
            players: getPlayersArray(room),
        })

        // Check for ghost trap on landing tile
        if (room.ghostTraps.has(newPosition)) {
            const trap = room.ghostTraps.get(newPosition)
            if (trap.placedBy !== player.id) {
                room.ghostTraps.delete(newPosition)
                if (player.hasActiveShield) {
                    player.hasActiveShield = false
                    player.items = player.items.filter(i => i.id !== 'shield')
                    addLog(ns, room, 'event', `🛡️ El escudo de ${player.name} bloqueó una trampa fantasma`)
                } else {
                    player.position = clampTile(player.position - trap.damage)
                    addLog(ns, room, 'event', `👻 ${player.name} cayó en una trampa fantasma! -${trap.damage} casillas`)
                }
            }
        }

        // Check win
        if (player.position >= LAST_TILE) {
            player.position = LAST_TILE
            setTimeout(() => {
                endGame(ns, room, 'winner', player.id)
            }, 1500)
            return
        }

        // Resolve tile after movement animation
        setTimeout(() => {
            resolveTile(ns, room)
        }, 1200)
    }

    function resolveTile(ns, room) {
        const player = room.players.get(room.currentPlayerId)
        if (!player) return

        const tile = BOARD[player.position]
        if (!tile) { advanceTurn(ns, room); return }

        room.turnPhase = 'resolving'

        switch (tile.type) {
            case 'normal':
                advanceTurn(ns, room)
                break

            case 'ladder': {
                const from = player.position
                player.position = tile.target
                addLog(ns, room, 'event', `🪜 ¡${player.name} subió por una escalera! ${from} → ${tile.target}`)
                ns.to(room.code).emit('tile-effect', {
                    type: 'ladder',
                    playerId: player.id,
                    from,
                    to: tile.target,
                    players: getPlayersArray(room),
                })
                setTimeout(() => advanceTurn(ns, room), 1500)
                break
            }

            case 'snake': {
                if (player.hasActiveShield) {
                    player.hasActiveShield = false
                    player.items = player.items.filter(i => i.id !== 'shield')
                    addLog(ns, room, 'event', `🛡️ El escudo de ${player.name} bloqueó la serpiente`)
                    ns.to(room.code).emit('tile-effect', { type: 'shield_block', playerId: player.id })
                    setTimeout(() => advanceTurn(ns, room), 1000)
                } else {
                    const from = player.position
                    player.position = tile.target
                    addLog(ns, room, 'event', `🐍 ¡${player.name} cayó por una serpiente! ${from} → ${tile.target}`)
                    ns.to(room.code).emit('tile-effect', {
                        type: 'snake',
                        playerId: player.id,
                        from,
                        to: tile.target,
                        players: getPlayersArray(room),
                    })
                    setTimeout(() => advanceTurn(ns, room), 1500)
                }
                break
            }

            case 'event': {
                const event = getRandomEvent()
                addLog(ns, room, 'event', `${event.emoji} ${event.name}: ${event.description}`)
                ns.to(room.code).emit('event-triggered', { event, playerId: player.id })
                resolveEvent(ns, room, event)
                break
            }

            case 'item': {
                if (player.items.length >= MAX_ITEMS) {
                    addLog(ns, room, 'event', `📦 ${player.name} encontró un cofre pero su inventario está lleno (${MAX_ITEMS}/${MAX_ITEMS})`)
                    setTimeout(() => advanceTurn(ns, room), 1000)
                } else {
                    const item = getRandomItem()
                    player.items.push({ ...item })
                    addLog(ns, room, 'item', `📦 ${player.name} obtuvo: ${item.emoji} ${item.name}`)
                    ns.to(room.code).emit('item-received', {
                        playerId: player.id,
                        item,
                        players: getPlayersArray(room),
                    })
                    setTimeout(() => advanceTurn(ns, room), 1200)
                }
                break
            }

            case 'decision': {
                const decision = getRandomDecision()
                room.turnPhase = 'decision'
                room.pendingAction = { type: 'decision', decision }
                ns.to(room.code).emit('decision-prompt', {
                    playerId: player.id,
                    decision,
                })
                addLog(ns, room, 'event', `${decision.emoji} ${decision.name}`)
                break
            }

            case 'trap': {
                const trap = getRandomTrap()
                if (player.hasActiveShield) {
                    player.hasActiveShield = false
                    player.items = player.items.filter(i => i.id !== 'shield')
                    addLog(ns, room, 'event', `🛡️ El escudo de ${player.name} bloqueó: ${trap.emoji} ${trap.name}`)
                    ns.to(room.code).emit('tile-effect', { type: 'shield_block', playerId: player.id })
                    setTimeout(() => advanceTurn(ns, room), 1000)
                } else {
                    addLog(ns, room, 'event', `${trap.emoji} ${trap.name}: ${trap.description}`)
                    ns.to(room.code).emit('trap-triggered', { trap, playerId: player.id })
                    resolveTrap(ns, room, trap)
                }
                break
            }

            case 'star': {
                addLog(ns, room, 'event', `⭐ ¡${player.name} encontró la estrella! Tira de nuevo + 3 extra`)
                player.position = clampTile(player.position + 3)
                ns.to(room.code).emit('tile-effect', {
                    type: 'star',
                    playerId: player.id,
                    players: getPlayersArray(room),
                })
                // Give another roll (don't advance turn, restart item phase)
                setTimeout(() => {
                    room.turnPhase = 'item_phase'
                    broadcastRoomState(ns, room)
                    emitTurnStart(ns, room)
                    addLog(ns, room, 'system', `${player.name} tira de nuevo por la ⭐ estrella`)
                }, 1500)
                break
            }

            default:
                advanceTurn(ns, room)
        }
    }

    function resolveEvent(ns, room, event) {
        const player = room.players.get(room.currentPlayerId)
        if (!player) return

        switch (event.effect) {
            case 'all_back':
                room.players.forEach(p => {
                    if (p.id !== player.id) p.position = clampTile(p.position - event.value)
                })
                broadcastRoomState(ns, room)
                setTimeout(() => advanceTurn(ns, room), 2000)
                break

            case 'self_advance':
                player.position = clampTile(player.position + event.value)
                broadcastRoomState(ns, room)
                if (player.position >= LAST_TILE) {
                    setTimeout(() => endGame(ns, room, 'winner', player.id), 1500)
                } else {
                    setTimeout(() => advanceTurn(ns, room), 1500)
                }
                break

            case 'all_advance':
                room.players.forEach(p => {
                    p.position = clampTile(p.position + event.value)
                })
                broadcastRoomState(ns, room)
                // Check if anyone won
                for (const [, p] of room.players) {
                    if (p.position >= LAST_TILE) {
                        setTimeout(() => endGame(ns, room, 'winner', p.id), 1500)
                        return
                    }
                }
                setTimeout(() => advanceTurn(ns, room), 2000)
                break

            case 'swap_choose':
                room.turnPhase = 'event_targeting'
                room.pendingAction = { type: 'event_swap' }
                ns.to(room.code).emit('target-prompt', {
                    playerId: player.id,
                    action: 'event_swap',
                    message: '¡Elige con quién intercambiar posición!',
                })
                break

            case 'steal_item': {
                const others = Array.from(room.players.values()).filter(
                    p => p.id !== player.id && p.items.length > 0 && p.connected
                )
                if (others.length === 0) {
                    addLog(ns, room, 'event', `Nadie tiene items para robar`)
                    setTimeout(() => advanceTurn(ns, room), 1000)
                } else if (player.items.length >= MAX_ITEMS) {
                    addLog(ns, room, 'event', `📦 Inventario lleno, no se puede robar`)
                    setTimeout(() => advanceTurn(ns, room), 1000)
                } else {
                    const victim = others[Math.floor(Math.random() * others.length)]
                    const stolenIdx = Math.floor(Math.random() * victim.items.length)
                    const stolen = victim.items.splice(stolenIdx, 1)[0]
                    player.items.push(stolen)
                    addLog(ns, room, 'event', `🦝 ${player.name} robó ${stolen.emoji} ${stolen.name} de ${victim.name}`)
                    broadcastRoomState(ns, room)
                    setTimeout(() => advanceTurn(ns, room), 1500)
                }
                break
            }

            case 'place_trap':
                room.ghostTraps.set(player.position, { placedBy: player.id, damage: event.value })
                broadcastRoomState(ns, room)
                setTimeout(() => advanceTurn(ns, room), 1500)
                break

            case 'double_next':
                player.turboNext = true
                setTimeout(() => advanceTurn(ns, room), 1500)
                break

            case 'last_to_self': {
                const sorted = Array.from(room.players.values())
                    .filter(p => p.connected && p.id !== player.id)
                    .sort((a, b) => a.position - b.position)
                if (sorted.length > 0) {
                    const last = sorted[0]
                    const tempPos = last.position
                    last.position = player.position
                    player.position = tempPos
                    addLog(ns, room, 'event', `🔃 ${last.name} (último) tomó el lugar de ${player.name}`)
                }
                broadcastRoomState(ns, room)
                setTimeout(() => advanceTurn(ns, room), 2000)
                break
            }

            case 'random_teleport': {
                const newPos = Math.floor(Math.random() * LAST_TILE)
                const direction = newPos > player.position ? 'adelante' : 'atrás'
                player.position = newPos
                addLog(ns, room, 'event', `🌀 Portal teletransportó a ${player.name} a casilla ${newPos} (${direction})`)
                broadcastRoomState(ns, room)
                if (player.position >= LAST_TILE) {
                    setTimeout(() => endGame(ns, room, 'winner', player.id), 1500)
                } else {
                    setTimeout(() => advanceTurn(ns, room), 1500)
                }
                break
            }

            case 'lose_item':
                if (player.items.length > 0) {
                    const lostIdx = Math.floor(Math.random() * player.items.length)
                    const lost = player.items.splice(lostIdx, 1)[0]
                    addLog(ns, room, 'event', `👑 ${player.name} perdió ${lost.emoji} ${lost.name}`)
                } else {
                    addLog(ns, room, 'event', `👑 ${player.name} no tiene items que perder`)
                }
                broadcastRoomState(ns, room)
                setTimeout(() => advanceTurn(ns, room), 1500)
                break

            default:
                setTimeout(() => advanceTurn(ns, room), 1000)
        }
    }

    function resolveEventTarget(ns, room, targetPlayerId) {
        const player = room.players.get(room.currentPlayerId)
        const target = room.players.get(targetPlayerId)
        if (!player || !target || targetPlayerId === player.id) return

        if (room.pendingAction?.type === 'event_swap') {
            const tempPos = player.position
            player.position = target.position
            target.position = tempPos
            addLog(ns, room, 'event', `🔄 ${player.name} y ${target.name} intercambiaron posiciones`)
        }

        room.pendingAction = null
        room.turnPhase = 'resolving'
        broadcastRoomState(ns, room)
        setTimeout(() => advanceTurn(ns, room), 1500)
    }

    function resolveTrap(ns, room, trap) {
        const player = room.players.get(room.currentPlayerId)
        if (!player) return

        switch (trap.effect) {
            case 'self_back':
                player.position = clampTile(player.position - trap.value)
                break
            case 'skip_turn':
                player.skipNextTurn = true
                break
            case 'lose_all_items':
                player.items = []
                break
        }

        broadcastRoomState(ns, room)
        setTimeout(() => advanceTurn(ns, room), 2000)
    }

    function resolveDecision(ns, room, choice) {
        const player = room.players.get(room.currentPlayerId)
        if (!player || !room.pendingAction?.decision) return

        const decision = room.pendingAction.decision
        const option = choice === 'A' ? decision.optionA : decision.optionB

        addLog(ns, room, 'event', `${player.name} eligió: ${option.label}`)
        room.pendingAction = null

        switch (option.effect) {
            case 'self_advance':
                player.position = clampTile(player.position + option.value)
                break

            case 'all_advance':
                room.players.forEach(p => { p.position = clampTile(p.position + option.value) })
                break

            case 'gamble': {
                const roll = rollDice()
                if (roll >= option.winThreshold) {
                    player.position = clampTile(player.position + option.winValue)
                    addLog(ns, room, 'event', `🎲 Sacó ${roll} — ¡Ganó! +${option.winValue} casillas`)
                } else {
                    player.position = clampTile(player.position + option.loseValue)
                    addLog(ns, room, 'event', `🎲 Sacó ${roll} — Perdió. ${option.loseValue} casillas`)
                }
                break
            }

            case 'steal_advance': {
                player.position = clampTile(player.position + option.selfValue)
                // Find closest player
                const others = Array.from(room.players.values())
                    .filter(p => p.id !== player.id && p.connected)
                    .sort((a, b) => Math.abs(a.position - player.position) - Math.abs(b.position - player.position))
                if (others.length > 0) {
                    others[0].position = clampTile(others[0].position + option.victimValue)
                    addLog(ns, room, 'event', `😈 ${others[0].name} retrocedió ${Math.abs(option.victimValue)} casillas`)
                }
                break
            }

            case 'bet_item':
                if (player.items.length > 0) {
                    player.items.pop()
                    player.position = clampTile(player.position + option.value)
                } else {
                    addLog(ns, room, 'event', `No tienes items para apostar`)
                }
                break

            case 'double_nothing': {
                const roll = rollDice()
                if (roll % 2 === 0) {
                    player.position = clampTile(player.position + roll)
                    addLog(ns, room, 'event', `🪙 Sacó ${roll} (par) — ¡Avanza ${roll}!`)
                } else {
                    const back = Math.floor(roll / 2)
                    player.position = clampTile(player.position - back)
                    addLog(ns, room, 'event', `🪙 Sacó ${roll} (impar) — Retrocede ${back}`)
                }
                break
            }

            case 'nothing':
                break
        }

        ns.to(room.code).emit('decision-result', {
            playerId: player.id,
            choice,
            players: getPlayersArray(room),
        })

        broadcastRoomState(ns, room)

        if (player.position >= LAST_TILE) {
            setTimeout(() => endGame(ns, room, 'winner', player.id), 1500)
        } else {
            setTimeout(() => advanceTurn(ns, room), 2000)
        }
    }

    function advanceTurn(ns, room) {
        if (room.status !== 'playing') return

        // Find next connected player
        let attempts = 0
        do {
            room.currentTurnIndex = (room.currentTurnIndex + 1) % room.turnOrder.length
            room.currentPlayerId = room.turnOrder[room.currentTurnIndex]
            attempts++
        } while (
            (!room.players.get(room.currentPlayerId)?.connected) &&
            attempts < room.turnOrder.length
        )

        if (attempts >= room.turnOrder.length) {
            endGame(ns, room, 'not-enough-players')
            return
        }

        const player = room.players.get(room.currentPlayerId)

        // Check skip turn
        if (player.skipNextTurn) {
            player.skipNextTurn = false
            addLog(ns, room, 'system', `⏭️ ${player.name} pierde su turno`)
            ns.to(room.code).emit('turn-skipped', { playerId: player.id, playerName: player.name })

            setTimeout(() => advanceTurn(ns, room), 2000)
            return
        }

        room.turnPhase = 'item_phase'
        room.pendingAction = null
        emitTurnStart(ns, room)
    }

    function emitTurnStart(ns, room) {
        const player = room.players.get(room.currentPlayerId)
        ns.to(room.code).emit('turn-start', {
            currentPlayerId: room.currentPlayerId,
            playerName: player?.name,
            turnPhase: room.turnPhase,
            players: getPlayersArray(room),
        })
    }

    function endGame(ns, room, reason, winnerId) {
        room.status = 'finished'
        room.turnPhase = 'finished'

        const finalScores = getPlayersArray(room).sort((a, b) => b.position - a.position)

        if (winnerId) {
            const winner = room.players.get(winnerId)
            addLog(ns, room, 'system', `🏆 ¡${winner?.name} ganó la partida!`)
        }

        ns.to(room.code).emit('game-over', {
            reason,
            winnerId,
            finalScores,
        })
    }

    function broadcastRoomState(ns, room) {
        ns.to(room.code).emit('room-update', {
            players: getPlayersArray(room),
            hostId: room.hostId,
            status: room.status,
            currentPlayerId: room.currentPlayerId,
            turnPhase: room.turnPhase,
        })
    }

    function addLog(ns, room, type, text) {
        const entry = { type, text, timestamp: Date.now() }
        room.gameLog.push(entry)
        if (room.gameLog.length > 100) room.gameLog.shift()
        ns.to(room.code).emit('game-log', entry)
    }

    function findSocket(ns, socketId) {
        return ns.sockets.get(socketId) || null
    }
}

function createPlayer(id, name, colorIndex) {
    return {
        id,
        name,
        position: 0,
        score: 0,
        items: [],
        connected: true,
        socketId: null,
        colorIndex,
        spriteIndex: colorIndex,
        skipNextTurn: false,
        turboNext: false,
        doubleDice: false,
        magnetActive: false,
        hasActiveShield: false,
        mirrorActive: false,
    }
}

module.exports = { setupPixelAdventureNamespace }