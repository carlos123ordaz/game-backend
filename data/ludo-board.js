/**
 * ===================================================================
 *  LUDO — Board Configuration & Movement Logic
 *  File: server/games/ludo-board.js
 * ===================================================================
 *  Board is a 15x15 grid. The cross-shaped path has 52 squares.
 *  Each player has 4 tokens in base, a start position, a home
 *  column of 6 squares, and a final HOME center.
 *  Colors: red (bottom), green (left), yellow (top), blue (right)
 * ===================================================================
 */

const COLORS = ['red', 'green', 'yellow', 'blue'];

const COLOR_DATA = {
    red: { label: 'Rojo', hex: '#EF4444', emoji: '\u{1F534}' },
    green: { label: 'Verde', hex: '#22C55E', emoji: '\u{1F7E2}' },
    yellow: { label: 'Amarillo', hex: '#EAB308', emoji: '\u{1F7E1}' },
    blue: { label: 'Azul', hex: '#3B82F6', emoji: '\u{1F535}' },
};

// Main track: 52 positions (clockwise from Red's entry)
const MAIN_PATH = [
    { r: 13, c: 6 }, { r: 12, c: 6 }, { r: 11, c: 6 }, { r: 10, c: 6 }, { r: 9, c: 6 },       // 0-4   Red arm UP
    { r: 8, c: 5 }, { r: 8, c: 4 }, { r: 8, c: 3 }, { r: 8, c: 2 }, { r: 8, c: 1 }, { r: 8, c: 0 }, // 5-10  Left across
    { r: 7, c: 0 }, { r: 6, c: 0 },                                           // 11-12 Turn up
    { r: 6, c: 1 }, { r: 6, c: 2 }, { r: 6, c: 3 }, { r: 6, c: 4 }, { r: 6, c: 5 },            // 13-17 Green arm RIGHT
    { r: 5, c: 6 }, { r: 4, c: 6 }, { r: 3, c: 6 }, { r: 2, c: 6 }, { r: 1, c: 6 }, { r: 0, c: 6 }, // 18-23 Up along left
    { r: 0, c: 7 }, { r: 0, c: 8 },                                           // 24-25 Turn right
    { r: 1, c: 8 }, { r: 2, c: 8 }, { r: 3, c: 8 }, { r: 4, c: 8 }, { r: 5, c: 8 },            // 26-30 Yellow arm DOWN
    { r: 6, c: 9 }, { r: 6, c: 10 }, { r: 6, c: 11 }, { r: 6, c: 12 }, { r: 6, c: 13 }, { r: 6, c: 14 }, // 31-36 Right across
    { r: 7, c: 14 }, { r: 8, c: 14 },                                         // 37-38 Turn down
    { r: 8, c: 13 }, { r: 8, c: 12 }, { r: 8, c: 11 }, { r: 8, c: 10 }, { r: 8, c: 9 },        // 39-43 Blue arm LEFT
    { r: 9, c: 8 }, { r: 10, c: 8 }, { r: 11, c: 8 }, { r: 12, c: 8 }, { r: 13, c: 8 }, { r: 14, c: 8 }, // 44-49 Down along right
    { r: 14, c: 7 }, { r: 14, c: 6 },                                         // 50-51 Turn left
];

const START_POSITIONS = { red: 0, green: 13, yellow: 26, blue: 39 };

const HOME_COLUMNS = {
    red: [{ r: 13, c: 7 }, { r: 12, c: 7 }, { r: 11, c: 7 }, { r: 10, c: 7 }, { r: 9, c: 7 }, { r: 8, c: 7 }],
    green: [{ r: 7, c: 1 }, { r: 7, c: 2 }, { r: 7, c: 3 }, { r: 7, c: 4 }, { r: 7, c: 5 }, { r: 7, c: 6 }],
    yellow: [{ r: 1, c: 7 }, { r: 2, c: 7 }, { r: 3, c: 7 }, { r: 4, c: 7 }, { r: 5, c: 7 }, { r: 6, c: 7 }],
    blue: [{ r: 7, c: 13 }, { r: 7, c: 12 }, { r: 7, c: 11 }, { r: 7, c: 10 }, { r: 7, c: 9 }, { r: 7, c: 8 }],
};

const BASE_POSITIONS = {
    red: [{ r: 11, c: 2 }, { r: 11, c: 3 }, { r: 12, c: 2 }, { r: 12, c: 3 }],
    green: [{ r: 2, c: 2 }, { r: 2, c: 3 }, { r: 3, c: 2 }, { r: 3, c: 3 }],
    yellow: [{ r: 2, c: 11 }, { r: 2, c: 12 }, { r: 3, c: 11 }, { r: 3, c: 12 }],
    blue: [{ r: 11, c: 11 }, { r: 11, c: 12 }, { r: 12, c: 11 }, { r: 12, c: 12 }],
};

// Safe squares: start positions + star squares
const SAFE_POSITIONS = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

const TOKEN_STATE = {
    IN_BASE: -1,
    FINISHED: 57,
    HOME_START: 51,
    HOME_END: 56,
    MAIN_TRACK_END: 50,
};

function relativeToAbsolute(color, relativePos) {
    if (relativePos < 0 || relativePos > TOKEN_STATE.MAIN_TRACK_END) return null;
    return (START_POSITIONS[color] + relativePos) % 52;
}

function getTokenCoords(color, relativePos, tokenIndex) {
    if (relativePos === TOKEN_STATE.IN_BASE) return BASE_POSITIONS[color][tokenIndex];
    if (relativePos >= TOKEN_STATE.HOME_START && relativePos <= TOKEN_STATE.HOME_END) {
        return HOME_COLUMNS[color][relativePos - TOKEN_STATE.HOME_START];
    }
    if (relativePos === TOKEN_STATE.FINISHED) return { r: 7, c: 7 };
    const absPos = relativeToAbsolute(color, relativePos);
    if (absPos !== null) return MAIN_PATH[absPos];
    return BASE_POSITIONS[color][tokenIndex];
}

function isSafeSquare(color, relativePos) {
    if (relativePos >= TOKEN_STATE.HOME_START) return true;
    const absPos = relativeToAbsolute(color, relativePos);
    if (absPos === null) return false;
    return SAFE_POSITIONS.has(absPos);
}

function calculateNewPosition(relativePos, steps) {
    if (relativePos === TOKEN_STATE.IN_BASE) return steps === 6 ? 0 : null;
    if (relativePos === TOKEN_STATE.FINISHED) return null;
    const newPos = relativePos + steps;
    if (newPos > TOKEN_STATE.FINISHED) return null;
    return newPos;
}

function findTokensAtAbsolutePos(players, absPos, excludeColor) {
    const results = [];
    for (const [color, tokens] of Object.entries(players)) {
        if (color === excludeColor) continue;
        tokens.forEach((relPos, tokenIdx) => {
            if (relPos >= 0 && relPos <= TOKEN_STATE.MAIN_TRACK_END) {
                if (relativeToAbsolute(color, relPos) === absPos) {
                    results.push({ color, tokenIdx, relPos });
                }
            }
        });
    }
    return results;
}

function getValidMoves(color, tokens, allPlayers, diceValue) {
    const moves = [];
    tokens.forEach((relPos, tokenIdx) => {
        const newPos = calculateNewPosition(relPos, diceValue);
        if (newPos === null) return;

        const move = {
            tokenIndex: tokenIdx, from: relPos, to: newPos,
            isExit: relPos === TOKEN_STATE.IN_BASE && diceValue === 6,
            isCapture: false, capturedColor: null, capturedTokenIdx: null,
            isFinish: newPos === TOKEN_STATE.FINISHED, isSafe: false,
        };

        if (newPos >= 0 && newPos <= TOKEN_STATE.MAIN_TRACK_END) {
            const absNewPos = relativeToAbsolute(color, newPos);
            const ownBlocking = tokens.some((tp, ti) =>
                ti !== tokenIdx && tp >= 0 && tp <= TOKEN_STATE.MAIN_TRACK_END &&
                relativeToAbsolute(color, tp) === absNewPos
            );
            if (ownBlocking) return;

            if (!SAFE_POSITIONS.has(absNewPos)) {
                const enemies = findTokensAtAbsolutePos(allPlayers, absNewPos, color);
                if (enemies.length > 0) {
                    move.isCapture = true;
                    move.capturedColor = enemies[0].color;
                    move.capturedTokenIdx = enemies[0].tokenIdx;
                }
            }
            move.isSafe = SAFE_POSITIONS.has(absNewPos);
        }

        if (newPos >= TOKEN_STATE.HOME_START && newPos <= TOKEN_STATE.HOME_END) {
            if (tokens.some((tp, ti) => ti !== tokenIdx && tp === newPos)) return;
        }

        moves.push(move);
    });
    return moves;
}

function hasPlayerWon(tokens) { return tokens.every(p => p === TOKEN_STATE.FINISHED); }
function countFinished(tokens) { return tokens.filter(p => p === TOKEN_STATE.FINISHED).length; }
function rollDice() { return Math.floor(Math.random() * 6) + 1; }

module.exports = {
    COLORS, COLOR_DATA, MAIN_PATH, START_POSITIONS, HOME_COLUMNS, BASE_POSITIONS,
    SAFE_POSITIONS, TOKEN_STATE, relativeToAbsolute, getTokenCoords, isSafeSquare,
    calculateNewPosition, getValidMoves, findTokensAtAbsolutePos, hasPlayerWon,
    countFinished, rollDice,
};