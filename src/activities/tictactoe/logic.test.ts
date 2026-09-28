import { describe, expect, it } from 'vitest'
import { applyMove, emptyBoard, isGameUpdate, turnOf, winnerOf } from './logic'

describe('winnerOf', () => {
  it('spots rows, columns, diagonals, draws, and live games', () => {
    expect(winnerOf(['X', 'X', 'X', null, null, null, null, null, null])).toBe('X')
    expect(winnerOf(['O', null, null, 'O', null, null, 'O', null, null])).toBe('O')
    expect(winnerOf(['X', null, null, null, 'X', null, null, null, 'X'])).toBe('X')
    expect(winnerOf(['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'])).toBe('draw')
    expect(winnerOf(emptyBoard())).toBeNull()
  })
})

describe('applyMove', () => {
  it('fills empty cells and refuses the rest', () => {
    const board = applyMove(emptyBoard(), 4, 'X')
    expect(board?.[4]).toBe('X')
    expect(applyMove(board!, 4, 'O')).toBeNull()
    expect(applyMove(board!, 9, 'O')).toBeNull()
    expect(applyMove(['X', 'X', 'X', null, null, null, null, null, null], 5, 'O')).toBeNull()
  })
})

describe('turnOf', () => {
  it('alternates from X', () => {
    expect(turnOf(emptyBoard())).toBe('X')
    expect(turnOf(['X', null, null, null, null, null, null, null, null])).toBe('O')
    expect(turnOf(['X', 'O', null, null, null, null, null, null, null])).toBe('X')
  })
})

describe('isGameUpdate', () => {
  it('accepts moves and resets, rejects junk', () => {
    expect(isGameUpdate({ move: 3, by: 7 })).toBe(true)
    expect(isGameUpdate({ reset: true, by: 7 })).toBe(true)
    expect(isGameUpdate({ move: 9, by: 7 })).toBe(false)
    expect(isGameUpdate({ move: 1.5, by: 7 })).toBe(false)
    expect(isGameUpdate({ move: 3 })).toBe(false)
    expect(isGameUpdate(null)).toBe(false)
    expect(isGameUpdate('x')).toBe(false)
  })
})
