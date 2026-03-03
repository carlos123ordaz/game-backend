/**
 * ═══════════════════════════════════════════
 *  WORD SEARCH — Grid Generator
 * ═══════════════════════════════════════════
 */

const DIRECTIONS = [
    { dr: 0, dc: 1, name: 'right' },
    { dr: 0, dc: -1, name: 'left' },
    { dr: 1, dc: 0, name: 'down' },
    { dr: -1, dc: 0, name: 'up' },
    { dr: 1, dc: 1, name: 'down-right' },
    { dr: -1, dc: -1, name: 'up-left' },
    { dr: 1, dc: -1, name: 'down-left' },
    { dr: -1, dc: 1, name: 'up-right' },
]

const FILLER_POOL = 'AAABCDDEEEFGHIIIJLLLMNNNOOOOPPQRRRSSSTTTUUVXYZ'

function createEmptyGrid(size) {
    return Array.from({ length: size }, () => Array(size).fill(null))
}

function shuffle(arr) {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
            ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
}

function tryPlace(grid, word, row, col, dir, size) {
    const cells = []
    for (let i = 0; i < word.length; i++) {
        const r = row + dir.dr * i
        const c = col + dir.dc * i
        if (r < 0 || r >= size || c < 0 || c >= size) return null
        const existing = grid[r][c]
        if (existing !== null && existing !== word[i]) return null
        cells.push({ r, c, letter: word[i], wasEmpty: existing === null })
    }
    return cells
}

function placeWord(grid, word, size) {
    const dirs = shuffle(DIRECTIONS)
    const positions = []
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            positions.push({ r, c })
        }
    }
    const shuffledPositions = shuffle(positions)

    for (const dir of dirs) {
        for (const { r, c } of shuffledPositions) {
            const cells = tryPlace(grid, word, r, c, dir, size)
            if (cells) {
                for (const cell of cells) {
                    grid[cell.r][cell.c] = cell.letter
                }
                return {
                    word,
                    startRow: r,
                    startCol: c,
                    endRow: r + dir.dr * (word.length - 1),
                    endCol: c + dir.dc * (word.length - 1),
                    direction: dir.name,
                    cells: cells.map(cell => ({ row: cell.r, col: cell.c })),
                }
            }
        }
    }
    return null
}

function fillGrid(grid, size) {
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (grid[r][c] === null) {
                grid[r][c] = FILLER_POOL[Math.floor(Math.random() * FILLER_POOL.length)]
            }
        }
    }
}

function generateGrid(words, size = 14) {
    const sortedWords = [...words].sort((a, b) => b.length - a.length)

    for (let attempt = 0; attempt < 5; attempt++) {
        const grid = createEmptyGrid(size)
        const placements = []
        const failedWords = []

        for (const word of sortedWords) {
            const placement = placeWord(grid, word, size)
            if (placement) placements.push(placement)
            else failedWords.push(word)
        }

        if (failedWords.length <= Math.floor(words.length * 0.2)) {
            fillGrid(grid, size)
            return { grid, placements, placedWords: placements.map(p => p.word), failedWords, size }
        }
    }

    const biggerSize = size + 2
    const grid = createEmptyGrid(biggerSize)
    const placements = []
    const failedWords = []

    for (const word of sortedWords) {
        const placement = placeWord(grid, word, biggerSize)
        if (placement) placements.push(placement)
        else failedWords.push(word)
    }

    fillGrid(grid, biggerSize)
    return { grid, placements, placedWords: placements.map(p => p.word), failedWords, size: biggerSize }
}

module.exports = { generateGrid }