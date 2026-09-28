/**
 * Tic-tac-toe rules, dependency-free. Each side keeps its own board and
 * applies the opponent's moves when they arrive; moves are only legal on an
 * empty cell while the game is live, so both boards converge without a
 * server-side referee. Resets are only honored on a finished board, which
 * keeps a stale "play again" from wiping a live game.
 */

export type Mark = 'X' | 'O'
export type Cell = Mark | null
export type Board = Cell[]
export type Winner = Mark | 'draw' | null

/** A move or reset broadcast through `activity:state`. */
export type GameUpdate = { move: number; by: number } | { reset: true; by: number }

const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
]

export function emptyBoard(): Board {
  return Array(9).fill(null)
}

export function winnerOf(board: Board): Winner {
  for (const [a, b, c] of LINES) {
    const mark = board[a]
    if (mark && mark === board[b] && mark === board[c]) return mark
  }
  return board.every((cell) => cell) ? 'draw' : null
}

export function isGameUpdate(v: unknown): v is GameUpdate {
  if (typeof v !== 'object' || v === null) return false
  const u = v as Record<string, unknown>
  if (typeof u.by !== 'number') return false
  if (u.reset === true) return true
  return typeof u.move === 'number' && Number.isInteger(u.move) && u.move >= 0 && u.move < 9
}

/**
 * Apply a move for `mark`. Returns the next board, or null when the move is
 * illegal (occupied cell, finished game, or out of range) so callers can
 * drop it — local clicks and remote moves share this check.
 */
export function applyMove(board: Board, index: number, mark: Mark): Board | null {
  if (index < 0 || index > 8 || board[index] || winnerOf(board)) return null
  const next = [...board]
  next[index] = mark
  return next
}

/** Whose turn it is on a board: X opens and the marks strictly alternate. */
export function turnOf(board: Board): Mark {
  const xs = board.filter((c) => c === 'X').length
  const os = board.filter((c) => c === 'O').length
  return xs <= os ? 'X' : 'O'
}
