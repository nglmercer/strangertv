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
  '.woff2': 'font/woff2',
  '.map': 'application/json',
}

export function createStaticHandler(distDir: string) {
  const root = normalize(distDir)

  return async (path: string): Promise<Response | null> => {
    if (!existsSync(root)) return null
    let rel = path === '/' || path === '' ? '/index.html' : path
    // SPA fallback for /admin
    if (rel === '/admin' || rel.startsWith('/admin/')) rel = '/index.html'
    // prevent path traversal
    const filePath = normalize(join(root, rel.replace(/^\//, '')))
    if (!filePath.startsWith(root)) return new Response('Forbidden', { status: 403 })

    try {
      const data = await readFile(filePath)
      const type = MIME[extname(filePath)] ?? 'application/octet-stream'
      return new Response(data, {
        headers: {
          'content-type': type,
          'cache-control': rel.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
        },
      })
    } catch {
      // SPA fallback
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
}
