/**
 * Tiny XSS-safe markdown subset: no dependencies, no sanitizer needed.
 *
 * Everything is HTML-escaped FIRST, so the only markup that can ever reach
 * the DOM is the tags this module emits itself. Supported syntax:
 * inline `` `code` ``, **bold**, *italic*, [label](https://…) links, bare
 * URL autolinks, and newlines. Block mode adds fenced code blocks,
 * `#`/`##` headings, and `-`/`*` lists for descriptions.
 */

function escapeHtml(src: string): string {
  return src
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const HTTP_URL = /^https?:\/\/\S+$/i

function linkOrText(label: string, url: string): string {
  if (!HTTP_URL.test(url)) return `${label} (${url})`
  // The url is already escaped (no raw quotes), so the href can't break out.
  return `<a href="${url}" target="_blank" rel="noreferrer">${label}</a>`
}

// Markers must hug non-space text, so `2 * 3` math stays literal while
// `*two words*` still emphasizes.
const emphasis = (text: string): string =>
  text
    .replace(/\*\*(\S[^*\n]*\S|\S)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(\S[^*\n]*\S|\S)\*/g, '<em>$1</em>')

/** Code spans, markdown links, and bare URLs — one pass, no placeholders. */
const TOKEN = /(`[^`\n]+`)|\[([^\][\n]+)\]\((\S+?)\)|(https?:\/\/\S+)/g

/** Inline markup for chat messages: code, links, emphasis, line breaks. */
export function renderInlineMd(src: string): string {
  const esc = escapeHtml(src)
  const out: string[] = []
  let last = 0
  let m: RegExpExecArray | null
  TOKEN.lastIndex = 0
  while ((m = TOKEN.exec(esc)) !== null) {
    out.push(emphasis(esc.slice(last, m.index)))
    if (m[1] !== undefined) out.push(`<code>${m[1].slice(1, -1)}</code>`)
    else if (m[2] !== undefined) out.push(linkOrText(m[2], m[3] ?? ''))
    else out.push(linkOrText(m[4]!, m[4]!))
    last = m.index + m[0].length
  }
  out.push(emphasis(esc.slice(last)))
  return out.join('').replace(/\n/g, '<br>')
}

const FENCE = /```(\w*)\n([\s\S]*?)(?:```|$)/g

function renderProse(prose: string): string {
  return prose
    .split(/\n{2,}/)
    .filter((block) => block.trim() !== '')
    .map((block) => {
      const lines = block.split('\n')
      const first = lines[0]?.trim() ?? ''
      const heading = /^(#{1,2})\s+(.+)$/.exec(first)
      if (heading && lines.length === 1) {
        const level = heading[1]!.length === 1 ? 'h3' : 'h4'
        return `<${level}>${renderInlineMd(heading[2]!)}</${level}>`
      }
      if (lines.length > 0 && lines.every((line) => /^\s*[-*]\s+\S/.test(line))) {
        const items = lines
          .map((line) => line.replace(/^\s*[-*]\s+/, ''))
          .map((item) => `<li>${renderInlineMd(item)}</li>`)
          .join('')
        return `<ul>${items}</ul>`
      }
      return `<p>${renderInlineMd(block)}</p>`
    })
    .join('')
}

/** Block markdown for descriptions: fences, headings, lists, paragraphs. */
export function renderMarkdown(src: string): string {
  // Split keeps captures: [prose, lang, code, prose, …]. Fences stay opaque.
  const parts = src.split(FENCE)
  const out: string[] = []
  for (let i = 0; i < parts.length; i += 3) {
    if (parts[i]) out.push(renderProse(parts[i]!))
    const code = parts[i + 2]
    if (code !== undefined) out.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`)
  }
  return out.join('')
}

/**
 * Renders the safe markdown subset. `block` is for descriptions (headings,
 * lists, code fences, paragraphs); inline is for chat bubbles (emphasis,
 * code, links, line breaks). The HTML is escaped-first by construction,
 * so no sanitizer pass is needed.
 */
export function Markdown({
  text,
  block,
  className,
}: {
  text: string
  block?: boolean
  className?: string
}) {
  const html = block ? renderMarkdown(text) : renderInlineMd(text)
  if (block) {
    return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />
  }
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />
}
