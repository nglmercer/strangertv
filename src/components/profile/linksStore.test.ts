import { describe, expect, it } from 'vitest'
import { icons } from '../icons'
import type { ProfileLink } from '../../pages/profileMock'
import {
  MAX_LINKS,
  hexA,
  isHexColor,
  moveLink,
  normalizeHex,
  selectionAfterRemove,
} from './linksStore'

const link = (id: string): ProfileLink => ({
  id,
  label: '',
  desc: '',
  domain: '',
  icon: icons.globe,
  color: 'gray',
})

describe('normalizeHex', () => {
  it('accepts #rrggbb, rrggbb, and #rgb', () => {
    expect(normalizeHex('#aabbcc')).toBe('#aabbcc')
    expect(normalizeHex('AABBCC')).toBe('#aabbcc')
    expect(normalizeHex('#abc')).toBe('#aabbcc')
    expect(normalizeHex('  #AbC  ')).toBe('#aabbcc')
  })

  it('rejects non-hex input', () => {
    expect(normalizeHex('')).toBeNull()
    expect(normalizeHex('red')).toBeNull()
    expect(normalizeHex('#zzzzzz')).toBeNull()
    expect(normalizeHex('#abcd')).toBeNull()
    expect(normalizeHex('#aabbccdd')).toBeNull()
  })
})

describe('isHexColor / hexA', () => {
  it('recognizes strict #rrggbb only', () => {
    expect(isHexColor('#aabbcc')).toBe(true)
    expect(isHexColor('#ABC')).toBe(false)
    expect(isHexColor('green')).toBe(false)
  })

  it('builds an rgba tint from a hex color', () => {
    expect(hexA('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)')
  })
})

describe('moveLink', () => {
  const links = [link('a'), link('b'), link('c')]

  it('swaps with the neighbor in the move direction', () => {
    expect(moveLink(links, 1, -1).map((l) => l.id)).toEqual(['b', 'a', 'c'])
    expect(moveLink(links, 1, 1).map((l) => l.id)).toEqual(['a', 'c', 'b'])
  })

  it('is a no-op at the list ends and out of range', () => {
    expect(moveLink(links, 0, -1)).toBe(links)
    expect(moveLink(links, 2, 1)).toBe(links)
    expect(moveLink(links, -1, 1)).toBe(links)
    expect(moveLink(links, 9, -1)).toBe(links)
  })

  it('does not mutate the input', () => {
    moveLink(links, 0, 1)
    expect(links.map((l) => l.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('selectionAfterRemove', () => {
  const links = [link('a'), link('b'), link('c')]

  it('selects the next sibling, or the previous for the last link', () => {
    expect(selectionAfterRemove(links, 'a')).toBe('b')
    expect(selectionAfterRemove(links, 'b')).toBe('c')
    expect(selectionAfterRemove(links, 'c')).toBe('b')
  })

  it('returns null when nothing remains or the id is unknown', () => {
    expect(selectionAfterRemove([link('a')], 'a')).toBeNull()
    expect(selectionAfterRemove([], 'a')).toBeNull()
    expect(selectionAfterRemove(links, 'zzz')).toBeNull()
  })
})

describe('MAX_LINKS', () => {
  it('caps the list the add button enforces', () => {
    expect(MAX_LINKS).toBe(8)
  })
})
