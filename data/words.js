/**
 * ═══════════════════════════════════════════
 *  WORD SEARCH — Word bank by category
 * ═══════════════════════════════════════════
 *
 * Each category has a pool of words.
 * The game picks a random category and selects
 * a subset of words for each round.
 */

const categories = [
    {
        id: 'animales',
        name: 'Animales',
        emoji: '🐾',
        words: [
            'GATO', 'PERRO', 'LEON', 'TIGRE', 'OSO', 'LOBO', 'ZORRO',
            'AGUILA', 'BUHO', 'PATO', 'RANA', 'DELFIN', 'MONO', 'RATA',
            'VACA', 'TORO', 'CERDO', 'CABRA', 'BURRO', 'PUMA', 'COBRA',
            'FOCA', 'PAVO', 'CIERVO', 'OVEJA', 'HALCON', 'CEBRA'
        ]
    },
    {
        id: 'comida',
        name: 'Comida',
        emoji: '🍕',
        words: [
            'PIZZA', 'TACO', 'SOPA', 'ARROZ', 'PAN', 'QUESO', 'POLLO',
            'CARNE', 'PASTA', 'FRESA', 'MANGO', 'LIMON', 'PERA', 'TORTA',
            'MAIZ', 'ATUN', 'JAMON', 'FLAN', 'CREMA', 'SALSA', 'HUEVO',
            'CHILE', 'CAFE', 'JUGO', 'LECHE', 'MIEL', 'NUEZ'
        ]
    },
    {
        id: 'paises',
        name: 'Países',
        emoji: '🌍',
        words: [
            'PERU', 'CHILE', 'BRASIL', 'CUBA', 'MEXICO', 'CHINA', 'JAPON',
            'INDIA', 'RUSIA', 'FRANCIA', 'ITALIA', 'EGIPTO', 'IRAN', 'IRAK',
            'CANADA', 'NEPAL', 'COREA', 'SUIZA', 'GRECIA', 'SUECIA', 'TURQUIA',
            'COLOMBIA', 'PANAMA', 'BOLIVIA', 'ECUADOR'
        ]
    },
    {
        id: 'deportes',
        name: 'Deportes',
        emoji: '⚽',
        words: [
            'FUTBOL', 'TENIS', 'GOLF', 'BOXEO', 'SURF', 'RUGBY', 'JUDO',
            'POLO', 'REMO', 'VELA', 'SALTO', 'NADO', 'LUCHA', 'KARATE',
            'BEISBOL', 'VOLEY', 'HOCKEY', 'ESQUI', 'BUCEO', 'CICLISMO',
            'ARCO', 'PESCA', 'DANZA', 'AJEDREZ'
        ]
    },
    {
        id: 'naturaleza',
        name: 'Naturaleza',
        emoji: '🌿',
        words: [
            'ARBOL', 'FLOR', 'ROCA', 'RIO', 'MAR', 'LAGO', 'MONTE',
            'SELVA', 'PLAYA', 'ISLA', 'BOSQUE', 'NIEVE', 'LLUVIA', 'SOL',
            'LUNA', 'ARENA', 'TIERRA', 'FUEGO', 'VIENTO', 'NUBE', 'HIERBA',
            'CORAL', 'HOJA', 'SEMILLA', 'RAIZ', 'VOLCAN'
        ]
    },
    {
        id: 'colores',
        name: 'Colores y Formas',
        emoji: '🎨',
        words: [
            'ROJO', 'AZUL', 'VERDE', 'ROSA', 'NEGRO', 'BLANCO', 'GRIS',
            'DORADO', 'PLATA', 'VIOLETA', 'NARANJA', 'CELESTE', 'CIRCULO',
            'CUBO', 'LINEA', 'CURVA', 'ARCO', 'ESFERA', 'PRISMA', 'CONO',
            'ROMBO', 'OVALO', 'PUNTO', 'BORDE'
        ]
    },
    {
        id: 'musica',
        name: 'Música',
        emoji: '🎵',
        words: [
            'PIANO', 'FLAUTA', 'TAMBOR', 'GUITARRA', 'VIOLIN', 'ARPA',
            'BOMBO', 'RITMO', 'NOTA', 'TONO', 'CORO', 'BAJO', 'ROCK',
            'JAZZ', 'SALSA', 'RUMBA', 'VALS', 'OPERA', 'HIMNO', 'BANDA',
            'DISCO', 'CANTO', 'ACORDE', 'MELODIA'
        ]
    },
    {
        id: 'espacio',
        name: 'Espacio',
        emoji: '🚀',
        words: [
            'SOL', 'LUNA', 'MARTE', 'VENUS', 'TIERRA', 'PLUTON', 'COMETA',
            'ORBITA', 'NAVE', 'ASTRO', 'CRATER', 'GALAXIA', 'NEBULA', 'NOVA',
            'PULSAR', 'PLASMA', 'VACIO', 'COSMOS', 'POLAR', 'ECLIPSE',
            'METEORO', 'SATELITE', 'ESTRELLA'
        ]
    }
]

module.exports = categories