import { describe, expect, it } from 'vitest'
import { followLabel, statusFromState } from './ProfileActions'
import { formatCount, formatJoined } from './profileMock'
import { DEFAULT_SECTION, docKey, docToSave, dtoToHeader } from '../components/profile/linksStore'

describe('statusFromState', () => {
  it('derives the four relationships', () => {
    expect(statusFromState(false, false)).toBe('stranger')
    expect(statusFromState(true, false)).toBe('following')
    expect(statusFromState(false, true)).toBe('follower')
    expect(statusFromState(true, true)).toBe('mutual')
  })
})

describe('followLabel', () => {
  it('labels every status', () => {
    expect(followLabel('stranger')).toBe('Follow')
    expect(followLabel('following')).toBe('Following')
    expect(followLabel('follower')).toBe('Follow back')
    expect(followLabel('mutual')).toBe('Friends')
  })
})

describe('formatJoined', () => {
  it('renders SQLite timestamps as Mon YYYY', () => {
    expect(formatJoined('2023-03-14 21:05:00')).toBe('Mar 2023')
    expect(formatJoined('2026-01-02T03:04:05Z')).toBe('Jan 2026')
  })

  it('passes garbage through untouched', () => {
    expect(formatJoined('not a date')).toBe('not a date')
  })

  it('matches the compact counts used beside it', () => {
    expect(formatCount(1204)).toBe('1.2K')
    expect(formatCount(86)).toBe('86')
  })
})

describe('dtoToHeader', () => {
  it('defaults missing fields to empty strings', () => {
    expect(dtoToHeader({ followerCount: 0, followingCount: 0 })).toEqual({
      displayName: '',
      bio: '',
      website: '',
      avatar: null,
    })
    expect(
      dtoToHeader({
        displayName: 'Ada',
        bio: 'Hi',
        website: 'a.dev',
        avatarUrl: '/api/v1/media/7',
        avatarId: 7,
        followerCount: 1,
        followingCount: 2,
      }),
    ).toEqual({ displayName: 'Ada', bio: 'Hi', website: 'a.dev', avatar: 7 })
  })
})

describe('docToSave header', () => {
  const section = { ...DEFAULT_SECTION }

  it('omits profile for link-only callers', () => {
    expect(docToSave([], section)).not.toHaveProperty('profile')
  })

  it('rides along and keys saves when given', () => {
    const header = { displayName: 'Ada', bio: '', website: '', avatar: null as number | null }
    expect(docToSave([], section, header).profile).toEqual(header)
    expect(docKey([], section, header)).not.toBe(
      docKey([], section, { ...header, bio: 'Hi' }),
    )
  })
})
