import { describe, expect, it } from 'vitest'
import { domainHost, faviconUrl, mediaIdForIcon, resolveLinkIcon } from './linkIcons'

describe('domainHost', () => {
  it('strips scheme, path, and whitespace', () => {
    expect(domainHost('github.com')).toBe('github.com')
    expect(domainHost('https://github.com/org/repo')).toBe('github.com')
    expect(domainHost('  clips.meme.dev/watch  ')).toBe('clips.meme.dev')
  })
})

describe('faviconUrl', () => {
  it('builds a sized favicon lookup for the host', () => {
    expect(faviconUrl('https://github.com/ometv')).toBe(
      'https://www.google.com/s2/favicons?domain=github.com&sz=64',
    )
  })
})

describe('mediaIdForIcon', () => {
  it('parses media references and rejects the rest', () => {
    expect(mediaIdForIcon('media:12')).toBe(12)
    expect(mediaIdForIcon('media:0')).toBeNull()
    expect(mediaIdForIcon('media:abc')).toBeNull()
    expect(mediaIdForIcon('M0 0h24v24H0z')).toBeNull()
    expect(mediaIdForIcon('')).toBeNull()
  })
})

describe('resolveLinkIcon', () => {
  it('resolves empty to the domain favicon', () => {
    expect(resolveLinkIcon('', 'youtube.com')).toEqual({
      kind: 'favicon',
      src: faviconUrl('youtube.com'),
    })
  })

  it('resolves uploads to the media API', () => {
    expect(resolveLinkIcon('media:7', 'example.com')).toEqual({
      kind: 'media',
      src: '/api/v1/media/7',
    })
  })

  it('passes built-in paths through', () => {
    expect(resolveLinkIcon('M0 0h24v24H0z', 'example.com')).toEqual({
      kind: 'path',
      path: 'M0 0h24v24H0z',
    })
  })
})
