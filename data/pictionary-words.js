/**
 * Pictionary Word Bank
 * difficulty: 1 = easy, 2 = medium, 3 = hard
 */
const words = [
    // ── Animales ──
    { word: 'Perro', category: 'animales', difficulty: 1 },
    { word: 'Gato', category: 'animales', difficulty: 1 },
    { word: 'Elefante', category: 'animales', difficulty: 1 },
    { word: 'Mariposa', category: 'animales', difficulty: 1 },
    { word: 'Serpiente', category: 'animales', difficulty: 1 },
    { word: 'Delfín', category: 'animales', difficulty: 1 },
    { word: 'Pingüino', category: 'animales', difficulty: 2 },
    { word: 'Camaleón', category: 'animales', difficulty: 2 },
    { word: 'Pulpo', category: 'animales', difficulty: 2 },
    { word: 'Murciélago', category: 'animales', difficulty: 2 },
    { word: 'Ornitorrinco', category: 'animales', difficulty: 3 },
    { word: 'Salamandra', category: 'animales', difficulty: 3 },
    { word: 'Tucán', category: 'animales', difficulty: 2 },
    { word: 'Cangrejo', category: 'animales', difficulty: 1 },
    { word: 'Tortuga', category: 'animales', difficulty: 1 },
    { word: 'Loro', category: 'animales', difficulty: 1 },
    { word: 'Caballo', category: 'animales', difficulty: 1 },
    { word: 'Tiburón', category: 'animales', difficulty: 2 },
    { word: 'Medusa', category: 'animales', difficulty: 2 },
    { word: 'Cocodrilo', category: 'animales', difficulty: 2 },

    // ── Comida ──
    { word: 'Pizza', category: 'comida', difficulty: 1 },
    { word: 'Hamburguesa', category: 'comida', difficulty: 1 },
    { word: 'Sushi', category: 'comida', difficulty: 2 },
    { word: 'Helado', category: 'comida', difficulty: 1 },
    { word: 'Tacos', category: 'comida', difficulty: 1 },
    { word: 'Pastel', category: 'comida', difficulty: 1 },
    { word: 'Espagueti', category: 'comida', difficulty: 2 },
    { word: 'Palomitas', category: 'comida', difficulty: 1 },
    { word: 'Chocolate', category: 'comida', difficulty: 1 },
    { word: 'Croissant', category: 'comida', difficulty: 2 },
    { word: 'Ceviche', category: 'comida', difficulty: 2 },
    { word: 'Empanada', category: 'comida', difficulty: 2 },
    { word: 'Donut', category: 'comida', difficulty: 1 },
    { word: 'Sandwich', category: 'comida', difficulty: 1 },
    { word: 'Galleta', category: 'comida', difficulty: 1 },

    // ── Objetos ──
    { word: 'Paraguas', category: 'objetos', difficulty: 1 },
    { word: 'Guitarra', category: 'objetos', difficulty: 1 },
    { word: 'Televisor', category: 'objetos', difficulty: 1 },
    { word: 'Telescopio', category: 'objetos', difficulty: 2 },
    { word: 'Tijeras', category: 'objetos', difficulty: 1 },
    { word: 'Reloj', category: 'objetos', difficulty: 1 },
    { word: 'Candado', category: 'objetos', difficulty: 2 },
    { word: 'Escalera', category: 'objetos', difficulty: 1 },
    { word: 'Semáforo', category: 'objetos', difficulty: 2 },
    { word: 'Brújula', category: 'objetos', difficulty: 2 },
    { word: 'Microscopio', category: 'objetos', difficulty: 3 },
    { word: 'Lupa', category: 'objetos', difficulty: 1 },
    { word: 'Corona', category: 'objetos', difficulty: 1 },
    { word: 'Cámara', category: 'objetos', difficulty: 1 },
    { word: 'Bicicleta', category: 'objetos', difficulty: 1 },
    { word: 'Vela', category: 'objetos', difficulty: 1 },
    { word: 'Ancla', category: 'objetos', difficulty: 2 },
    { word: 'Bombillo', category: 'objetos', difficulty: 1 },
    { word: 'Cohete', category: 'objetos', difficulty: 2 },
    { word: 'Balón', category: 'objetos', difficulty: 1 },

    // ── Lugares ──
    { word: 'Playa', category: 'lugares', difficulty: 1 },
    { word: 'Hospital', category: 'lugares', difficulty: 2 },
    { word: 'Castillo', category: 'lugares', difficulty: 2 },
    { word: 'Volcán', category: 'lugares', difficulty: 2 },
    { word: 'Pirámide', category: 'lugares', difficulty: 2 },
    { word: 'Iglesia', category: 'lugares', difficulty: 2 },
    { word: 'Estadio', category: 'lugares', difficulty: 2 },
    { word: 'Acuario', category: 'lugares', difficulty: 2 },
    { word: 'Faro', category: 'lugares', difficulty: 2 },
    { word: 'Isla', category: 'lugares', difficulty: 1 },
    { word: 'Cueva', category: 'lugares', difficulty: 2 },
    { word: 'Montaña rusa', category: 'lugares', difficulty: 3 },
    { word: 'Aeropuerto', category: 'lugares', difficulty: 2 },
    { word: 'Circo', category: 'lugares', difficulty: 2 },
    { word: 'Zoológico', category: 'lugares', difficulty: 2 },

    // ── Acciones / Conceptos ──
    { word: 'Dormir', category: 'acciones', difficulty: 1 },
    { word: 'Bailar', category: 'acciones', difficulty: 1 },
    { word: 'Pescar', category: 'acciones', difficulty: 1 },
    { word: 'Surfear', category: 'acciones', difficulty: 2 },
    { word: 'Cocinar', category: 'acciones', difficulty: 1 },
    { word: 'Llorar', category: 'acciones', difficulty: 1 },
    { word: 'Estornudar', category: 'acciones', difficulty: 2 },
    { word: 'Escalar', category: 'acciones', difficulty: 2 },
    { word: 'Patinar', category: 'acciones', difficulty: 2 },
    { word: 'Bucear', category: 'acciones', difficulty: 2 },
    { word: 'Meditar', category: 'acciones', difficulty: 3 },
    { word: 'Bostezar', category: 'acciones', difficulty: 2 },
    { word: 'Aplaudir', category: 'acciones', difficulty: 1 },
    { word: 'Rezar', category: 'acciones', difficulty: 2 },
    { word: 'Trotar', category: 'acciones', difficulty: 2 },

    // ── Profesiones ──
    { word: 'Pirata', category: 'profesiones', difficulty: 1 },
    { word: 'Astronauta', category: 'profesiones', difficulty: 2 },
    { word: 'Chef', category: 'profesiones', difficulty: 1 },
    { word: 'Bombero', category: 'profesiones', difficulty: 1 },
    { word: 'Detective', category: 'profesiones', difficulty: 2 },
    { word: 'Mago', category: 'profesiones', difficulty: 1 },
    { word: 'Dentista', category: 'profesiones', difficulty: 2 },
    { word: 'Payaso', category: 'profesiones', difficulty: 1 },
    { word: 'Ninja', category: 'profesiones', difficulty: 2 },
    { word: 'Fotógrafo', category: 'profesiones', difficulty: 2 },
    { word: 'Carpintero', category: 'profesiones', difficulty: 2 },
    { word: 'Piloto', category: 'profesiones', difficulty: 2 },
    { word: 'Cantante', category: 'profesiones', difficulty: 1 },
    { word: 'Policía', category: 'profesiones', difficulty: 1 },
    { word: 'Arquero', category: 'profesiones', difficulty: 2 },

    // ── Naturaleza ──
    { word: 'Arcoíris', category: 'naturaleza', difficulty: 1 },
    { word: 'Tornado', category: 'naturaleza', difficulty: 2 },
    { word: 'Cascada', category: 'naturaleza', difficulty: 2 },
    { word: 'Relámpago', category: 'naturaleza', difficulty: 2 },
    { word: 'Eclipse', category: 'naturaleza', difficulty: 3 },
    { word: 'Cactus', category: 'naturaleza', difficulty: 1 },
    { word: 'Palmera', category: 'naturaleza', difficulty: 1 },
    { word: 'Aurora boreal', category: 'naturaleza', difficulty: 3 },
    { word: 'Girasol', category: 'naturaleza', difficulty: 1 },
    { word: 'Hongo', category: 'naturaleza', difficulty: 1 },
    { word: 'Nieve', category: 'naturaleza', difficulty: 1 },
    { word: 'Terremoto', category: 'naturaleza', difficulty: 3 },
    { word: 'Luna llena', category: 'naturaleza', difficulty: 2 },
    { word: 'Estrella fugaz', category: 'naturaleza', difficulty: 3 },
    { word: 'Tsunami', category: 'naturaleza', difficulty: 3 },

    // ── Fantasía / Ficción ──
    { word: 'Dragón', category: 'fantasía', difficulty: 2 },
    { word: 'Unicornio', category: 'fantasía', difficulty: 2 },
    { word: 'Fantasma', category: 'fantasía', difficulty: 1 },
    { word: 'Robot', category: 'fantasía', difficulty: 1 },
    { word: 'Sirena', category: 'fantasía', difficulty: 2 },
    { word: 'Zombie', category: 'fantasía', difficulty: 1 },
    { word: 'Vampiro', category: 'fantasía', difficulty: 2 },
    { word: 'Alienígena', category: 'fantasía', difficulty: 2 },
    { word: 'Hombre lobo', category: 'fantasía', difficulty: 3 },
    { word: 'Duende', category: 'fantasía', difficulty: 2 },
    { word: 'Centauro', category: 'fantasía', difficulty: 3 },
    { word: 'Momia', category: 'fantasía', difficulty: 2 },
    { word: 'Bruja', category: 'fantasía', difficulty: 1 },
    { word: 'Hada', category: 'fantasía', difficulty: 2 },
    { word: 'Troll', category: 'fantasía', difficulty: 2 },
]

/**
 * Pick N random non-repeating words, mixing difficulties
 */
function pickRandomWords(count, usedWords = []) {
    const available = words.filter(w => !usedWords.includes(w.word))
    const shuffled = [...available].sort(() => Math.random() - 0.5)
    return shuffled.slice(0, count)
}

/**
 * Pick 3 word options for the drawer (1 easy, 1 medium, 1 hard when possible)
 */
function pickWordOptions(usedWords = []) {
    const available = words.filter(w => !usedWords.includes(w.word))
    const byDifficulty = {
        1: available.filter(w => w.difficulty === 1),
        2: available.filter(w => w.difficulty === 2),
        3: available.filter(w => w.difficulty === 3),
    }

    const options = []

    // Try to pick one from each difficulty
    for (const diff of [1, 2, 3]) {
        const pool = byDifficulty[diff]
        if (pool.length > 0) {
            const idx = Math.floor(Math.random() * pool.length)
            options.push(pool[idx])
            pool.splice(idx, 1)
        }
    }

    // If we don't have 3, fill from remaining
    if (options.length < 3) {
        const remaining = available.filter(w => !options.find(o => o.word === w.word))
        const shuffled = remaining.sort(() => Math.random() - 0.5)
        while (options.length < 3 && shuffled.length > 0) {
            options.push(shuffled.shift())
        }
    }

    // Shuffle so difficulty order isn't predictable
    return options.sort(() => Math.random() - 0.5)
}

module.exports = { words, pickRandomWords, pickWordOptions }