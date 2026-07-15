import { readFile } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'
import { existsSync } from 'node:fs'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
}

export function createStaticHandler(distDir: string, publicDir?: string) {
  const root = normalize(distDir)
  const pub = publicDir ? normalize(publicDir) : null

  const tryFile = async (base: string, rel: string): Promise<Response | null> => {
    const filePath = normalize(join(base, rel.replace(/^\//, '')))
    if (!filePath.startsWith(base)) return new Response('Forbidden', { status: 403 })
    try {
      const data = await readFile(filePath)
      const type = MIME[extname(filePath)] ?? 'application/octet-stream'
      const isHtml = rel.endsWith('.html')
      const isWellKnown = rel.includes('.well-known') || rel.endsWith('.txt') || rel.endsWith('.webmanifest')
      return new Response(data, {
        headers: {
          'content-type': type,
          'cache-control': isHtml || isWellKnown ? 'no-cache' : 'public, max-age=31536000, immutable',
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
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' },
      })
    } catch {
      return null
    }
  }
}
