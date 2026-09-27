import { describe, expect, it } from 'vitest'
import { renderInlineMd, renderMarkdown } from './Markdown'

describe('renderInlineMd', () => {
  it('renders emphasis, code, and links', () => {
    expect(renderInlineMd('**bold** and *italic* and `code`')).toBe(
      '<strong>bold</strong> and <em>italic</em> and <code>code</code>',
    )
    expect(renderInlineMd('[label](https://example.com/x)')).toBe(
      '<a href="https://example.com/x" target="_blank" rel="noreferrer">label</a>',
    )
    expect(renderInlineMd('see https://example.com/a_b')).toBe(
      'see <a href="https://example.com/a_b" target="_blank" rel="noreferrer">https://example.com/a_b</a>',
    )
  })

  it('keeps newlines and leaves lone markers alone', () => {
    expect(renderInlineMd('one\ntwo')).toBe('one<br>two')
    expect(renderInlineMd('2 * 3 is *six')).toBe('2 * 3 is *six')
  })

  it('neutralizes markup attacks', () => {
    expect(renderInlineMd('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    )
    // javascript: links degrade to text, never anchors.
    expect(renderInlineMd('[x](javascript:alert(1))')).toBe('x (javascript:alert(1))')
    // Quotes arrive pre-escaped, so they can't break out of the href.
    const quoted = renderInlineMd('[x](https://e.com/"onmouseover="alert(1))')
    expect(quoted).toContain('&quot;')
    expect(quoted).not.toContain('"onmouseover')
    // Emphasis markers inside code spans and URLs stay literal.
    expect(renderInlineMd('`**not bold**`')).toBe('<code>**not bold**</code>')
    expect(renderInlineMd('https://e.com/**')).toBe(
      '<a href="https://e.com/**" target="_blank" rel="noreferrer">https://e.com/**</a>',
    )
  })
})

describe('renderMarkdown', () => {
  it('renders headings, lists, fences, and paragraphs', () => {
    expect(renderMarkdown('# Title')).toBe('<h3>Title</h3>')
    expect(renderMarkdown('## Sub **bold**')).toBe('<h4>Sub <strong>bold</strong></h4>')
    expect(renderMarkdown('- one\n- two *x*')).toBe(
      '<ul><li>one</li><li>two <em>x</em></li></ul>',
    )
    expect(renderMarkdown('```js\nconst <a> = 1\n```')).toBe(
      '<pre><code>const &lt;a&gt; = 1</code></pre>',
    )
    expect(renderMarkdown('first\n\nsecond')).toBe('<p>first</p><p>second</p>')
    expect(renderMarkdown('')).toBe('')
  })

  it('keeps fences opaque and escapes the rest', () => {
    expect(renderMarkdown('```\n**nope** [x](https://e.com)\n```')).toBe(
      '<pre><code>**nope** [x](https://e.com)</code></pre>',
    )
    expect(renderMarkdown('<img src=x onerror=alert(1)>')).toBe(
      '<p>&lt;img src=x onerror=alert(1)&gt;</p>',
    )
  })
})
