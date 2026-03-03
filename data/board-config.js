/**
 * Pixel Adventure — Board & Game Configuration
 *
 * 50-tile serpentine board with 8 tile types:
 *   normal, ladder, snake, event, item, decision, trap, star
 */

// ── Tile Types ──
const TILE_TYPES = {
    NORMAL: 'normal',
    LADDER: 'ladder',
    SNAKE: 'snake',
    EVENT: 'event',
    ITEM: 'item',
    DECISION: 'decision',
    TRAP: 'trap',
    STAR: 'star',
}

// ── Board Layout (50 tiles, index 0-49) ──
// Each tile has: type, label (pixel icon), and optional config
const BOARD = [
    { id: 0, type: 'normal', icon: '🏁', label: 'Inicio' },
    { id: 1, type: 'normal', icon: '·' },
    { id: 2, type: 'event', icon: '⚡' },
    { id: 3, type: 'normal', icon: '·' },
    { id: 4, type: 'item', icon: '📦' },
    { id: 5, type: 'normal', icon: '·' },
    { id: 6, type: 'ladder', icon: '🪜', target: 12 },
    { id: 7, type: 'normal', icon: '·' },
    { id: 8, type: 'event', icon: '⚡' },
    { id: 9, type: 'decision', icon: '❓' },
    { id: 10, type: 'normal', icon: '·' },
    { id: 11, type: 'snake', icon: '🐍', target: 4 },
    { id: 12, type: 'normal', icon: '·' },
    { id: 13, type: 'item', icon: '📦' },
    { id: 14, type: 'trap', icon: '💀' },
    { id: 15, type: 'normal', icon: '·' },
    { id: 16, type: 'event', icon: '⚡' },
    { id: 17, type: 'ladder', icon: '🪜', target: 24 },
    { id: 18, type: 'normal', icon: '·' },
    { id: 19, type: 'normal', icon: '·' },
    { id: 20, type: 'item', icon: '📦' },
    { id: 21, type: 'event', icon: '⚡' },
    { id: 22, type: 'normal', icon: '·' },
    { id: 23, type: 'snake', icon: '🐍', target: 15 },
    { id: 24, type: 'normal', icon: '·' },
    { id: 25, type: 'star', icon: '⭐' },
    { id: 26, type: 'decision', icon: '❓' },
    { id: 27, type: 'normal', icon: '·' },
    { id: 28, type: 'item', icon: '📦' },
    { id: 29, type: 'event', icon: '⚡' },
    { id: 30, type: 'trap', icon: '💀' },
    { id: 31, type: 'normal', icon: '·' },
    { id: 32, type: 'ladder', icon: '🪜', target: 38 },
    { id: 33, type: 'normal', icon: '·' },
    { id: 34, type: 'snake', icon: '🐍', target: 27 },
    { id: 35, type: 'event', icon: '⚡' },
    { id: 36, type: 'item', icon: '📦' },
    { id: 37, type: 'decision', icon: '❓' },
    { id: 38, type: 'normal', icon: '·' },
    { id: 39, type: 'normal', icon: '·' },
    { id: 40, type: 'event', icon: '⚡' },
    { id: 41, type: 'trap', icon: '💀' },
    { id: 42, type: 'ladder', icon: '🪜', target: 47 },
    { id: 43, type: 'snake', icon: '🐍', target: 36 },
    { id: 44, type: 'normal', icon: '·' },
    { id: 45, type: 'decision', icon: '❓' },
    { id: 46, type: 'event', icon: '⚡' },
    { id: 47, type: 'item', icon: '📦' },
    { id: 48, type: 'normal', icon: '·' },
    { id: 49, type: 'normal', icon: '🏆', label: 'Meta' },
]

// ── Random Events ──
const EVENTS = [
    {
        id: 'earthquake',
        name: '¡Terremoto!',
        emoji: '🌋',
        description: 'La tierra tiembla... ¡Todos retroceden 2 casillas!',
        effect: 'all_back',
        value: 2,
    },
    {
        id: 'tailwind',
        name: '¡Viento a favor!',
        emoji: '💨',
        description: 'Una brisa mágica te empuja hacia adelante.',
        effect: 'self_advance',
        value: 3,
    },
    {
        id: 'swap',
        name: '¡Intercambio!',
        emoji: '🔄',
        description: 'Un portal misterioso... ¡Elige un jugador para intercambiar posición!',
        effect: 'swap_choose',
        value: 0,
    },
    {
        id: 'steal',
        name: '¡Robo!',
        emoji: '🦝',
        description: 'Un mapache ladrón te trae un item de otro jugador.',
        effect: 'steal_item',
        value: 0,
    },
    {
        id: 'party',
        name: '¡Fiesta!',
        emoji: '🎉',
        description: '¡Todos celebran! Cada jugador avanza 1 casilla.',
        effect: 'all_advance',
        value: 1,
    },
    {
        id: 'ghost_trap',
        name: '¡Trampa fantasma!',
        emoji: '👻',
        description: 'Dejas una trampa invisible. El próximo en pasar retrocede 3.',
        effect: 'place_trap',
        value: 3,
    },
    {
        id: 'turbo',
        name: '¡Turbo!',
        emoji: '🚀',
        description: '¡Tu siguiente dado valdrá el doble!',
        effect: 'double_next',
        value: 0,
    },
    {
        id: 'reverse',
        name: '¡Reversa!',
        emoji: '🔃',
        description: 'El último jugador toma tu lugar. ¡La tortuga se vuelve liebre!',
        effect: 'last_to_self',
        value: 0,
    },
    {
        id: 'portal',
        name: '¡Portal aleatorio!',
        emoji: '🌀',
        description: 'Un portal te teletransporta a una casilla aleatoria...',
        effect: 'random_teleport',
        value: 0,
    },
    {
        id: 'tax',
        name: '¡Impuesto real!',
        emoji: '👑',
        description: 'El rey exige un impuesto. Pierdes un item al azar.',
        effect: 'lose_item',
        value: 0,
    },
]

// ── Items / Power-ups ──
const ITEMS = [
    {
        id: 'shield',
        name: 'Escudo',
        emoji: '🛡️',
        description: 'Ignora el próximo efecto negativo.',
        rarity: 'common',
    },
    {
        id: 'precise_dice',
        name: 'Dado preciso',
        emoji: '🎯',
        description: 'Elige el número del dado (1-12).',
        rarity: 'rare',
    },
    {
        id: 'swap_potion',
        name: 'Poción intercambio',
        emoji: '🔄',
        description: 'Cambia posición con cualquier jugador.',
        rarity: 'rare',
    },
    {
        id: 'magnet',
        name: 'Imán',
        emoji: '🧲',
        description: 'Después de tirar, avanza 3 casillas extra.',
        rarity: 'common',
    },
    {
        id: 'bomb',
        name: 'Bomba',
        emoji: '💣',
        description: 'Elige un jugador, retrocede 5 casillas.',
        rarity: 'epic',
    },
    {
        id: 'freeze',
        name: 'Congelar',
        emoji: '❄️',
        description: 'Un jugador pierde su próximo turno.',
        rarity: 'epic',
    },
    {
        id: 'double_dice',
        name: 'Dado doble',
        emoji: '🎲',
        description: 'Tira dos dados en vez de uno.',
        rarity: 'rare',
    },
    {
        id: 'mirror',
        name: 'Espejo',
        emoji: '🪞',
        description: 'Refleja cualquier item usado contra ti de vuelta al atacante.',
        rarity: 'epic',
    },
]

// ── Decisions ──
const DECISIONS = [
    {
        id: 'safe_vs_risk',
        name: 'Camino seguro o arriesgado',
        emoji: '🎰',
        description: '¿Juegas seguro o te arriesgas?',
        optionA: {
            label: '🛤️ Seguro: Avanza 2',
            effect: 'self_advance',
            value: 2,
        },
        optionB: {
            label: '🎲 Riesgo: Tira dado. 7+ = +8, sino = -4',
            effect: 'gamble',
            winThreshold: 7,
            winValue: 8,
            loseValue: -4,
        },
    },
    {
        id: 'share_vs_steal',
        name: 'Compartir o robar',
        emoji: '🤝',
        description: '¿Eres generoso o egoísta?',
        optionA: {
            label: '💛 Compartir: Todos avanzan 1',
            effect: 'all_advance',
            value: 1,
        },
        optionB: {
            label: '😈 Robar: Tú +4, el más cercano -3',
            effect: 'steal_advance',
            selfValue: 4,
            victimValue: -3,
        },
    },
    {
        id: 'bet_item',
        name: 'Apostar item',
        emoji: '💎',
        description: '¿Arriesgas un item por ventaja?',
        optionA: {
            label: '📦 Apostar: Pierde 1 item, avanza 6',
            effect: 'bet_item',
            value: 6,
        },
        optionB: {
            label: '🙅 No apostar: Quédate donde estás',
            effect: 'nothing',
            value: 0,
        },
    },
    {
        id: 'double_or_nothing',
        name: 'Doble o nada',
        emoji: '🪙',
        description: '¡La moneda decide tu destino!',
        optionA: {
            label: '🪙 Doble o nada: Par = avanza, impar = retrocede',
            effect: 'double_nothing',
        },
        optionB: {
            label: '🚶 Declinar: Avanza 1 casilla',
            effect: 'self_advance',
            value: 1,
        },
    },
]

// ── Trap effects ──
const TRAPS = [
    {
        id: 'pit',
        name: '¡Caíste en un pozo!',
        emoji: '🕳️',
        description: 'Retrocedes 5 casillas.',
        effect: 'self_back',
        value: 5,
    },
    {
        id: 'curse',
        name: '¡Maldición!',
        emoji: '🧙',
        description: 'Pierdes tu próximo turno.',
        effect: 'skip_turn',
        value: 1,
    },
    {
        id: 'thief',
        name: '¡Ladrón!',
        emoji: '🦹',
        description: 'Pierdes todos tus items.',
        effect: 'lose_all_items',
        value: 0,
    },
]

// ── Player colors (pixel art palette) ──
const PLAYER_COLORS = [
    { name: 'Rojo', color: '#e74c3c', light: '#ff6b6b' },
    { name: 'Azul', color: '#3498db', light: '#74b9ff' },
    { name: 'Verde', color: '#2ecc71', light: '#55efc4' },
    { name: 'Amarillo', color: '#f1c40f', light: '#ffeaa7' },
    { name: 'Morado', color: '#9b59b6', light: '#a29bfe' },
    { name: 'Naranja', color: '#e67e22', light: '#fab1a0' },
    { name: 'Rosa', color: '#e84393', light: '#fd79a8' },
    { name: 'Cyan', color: '#00cec9', light: '#81ecec' },
]

// ── Player pixel sprites (simple 5x5 representations for CSS) ──
const PLAYER_SPRITES = ['👾', '🤖', '👹', '🎃', '🐸', '🦊', '🐱', '🐼']

// ── Helpers ──
function getRandomEvent() {
    return EVENTS[Math.floor(Math.random() * EVENTS.length)]
}

function getRandomItem() {
    // Weighted by rarity: common=50%, rare=35%, epic=15%
    const roll = Math.random()
    let pool
    if (roll < 0.5) pool = ITEMS.filter(i => i.rarity === 'common')
    else if (roll < 0.85) pool = ITEMS.filter(i => i.rarity === 'rare')
    else pool = ITEMS.filter(i => i.rarity === 'epic')
    if (pool.length === 0) pool = ITEMS
    return pool[Math.floor(Math.random() * pool.length)]
}

function getRandomDecision() {
    return DECISIONS[Math.floor(Math.random() * DECISIONS.length)]
}

function getRandomTrap() {
    return TRAPS[Math.floor(Math.random() * TRAPS.length)]
}

module.exports = {
    TILE_TYPES,
    BOARD,
    EVENTS,
    ITEMS,
    DECISIONS,
    TRAPS,
    PLAYER_COLORS,
    PLAYER_SPRITES,
    getRandomEvent,
    getRandomItem,
    getRandomDecision,
    getRandomTrap,
}