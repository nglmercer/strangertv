import { readFile } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'
import { existsSync } from 'node:fs'
import { CACHE_CONTROL, HTTP_HEADERS, MIME_TYPE } from '../shared/constants'

const MIME: Record<string, string> = {
  '.html': MIME_TYPE.html,
  '.js': MIME_TYPE.javascript,
  '.css': MIME_TYPE.css,
  '.svg': MIME_TYPE.svg,
  '.png': MIME_TYPE.png,
  '.jpg': MIME_TYPE.jpg,
  '.ico': MIME_TYPE.ico,
  '.json': MIME_TYPE.json,
  '.webmanifest': MIME_TYPE.webmanifest,
  '.txt': MIME_TYPE.plain,
  '.woff2': MIME_TYPE.woff2,
  '.map': MIME_TYPE.json,
}

export function createStaticHandler(distDir: string, publicDir?: string) {
  const root = normalize(distDir)
  const pub = publicDir ? normalize(publicDir) : null

  const tryFile = async (base: string, rel: string): Promise<Response | null> => {
    const filePath = normalize(join(base, rel.replace(/^\//, '')))
    if (!filePath.startsWith(base)) return new Response('Forbidden', { status: 403 })
    try {
      const data = await readFile(filePath)
      const type = MIME[extname(filePath)] ?? MIME_TYPE.octetStream
      const isHtml = rel.endsWith('.html')
      const isWellKnown = rel.includes('.well-known') || rel.endsWith('.txt') || rel.endsWith('.webmanifest')
      return new Response(data, {
        headers: {
          [HTTP_HEADERS.contentType]: type,
          'cache-control': isHtml || isWellKnown ? CACHE_CONTROL.noCache : CACHE_CONTROL.immutable,
        },
      })
    } catch {
      return null
    }
  }

  return async (path: string): Promise<Response | null> => {
    if (!existsSync(root) && !(pub && existsSync(pub))) return null
    let rel = path === '/' || path === '' ? '/index.html' : path
    if (rel === '/admin' || rel.startsWith('/admin/')) rel = '/index.html'

    if (pub && existsSync(pub)) {
      const fromPub = await tryFile(pub, rel)
      if (fromPub) return fromPub
    }
    if (existsSync(root)) {
      const fromDist = await tryFile(root, rel)
      if (fromDist) return fromDist
    }

    try {
      const index = await readFile(join(root, 'index.html'))
      return new Response(index, {
        headers: { [HTTP_HEADERS.contentType]: MIME_TYPE.html, 'cache-control': CACHE_CONTROL.noCache },
      })
    } catch {
      return null
    }
  }
}
