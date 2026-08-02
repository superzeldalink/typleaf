import { expect, describe, beforeEach, it } from 'vitest'
import Path from 'node:path'

const MODULE_PATH = Path.join(
  import.meta.dirname,
  '../../../app/js/TypstSyncManager'
)

// Anchors mark the start of a source block; y grows downward. A long paragraph
// starting at y=150 runs until the next anchor at y=320.
const ENTRIES = [
  { file: 'main.typ', line: 10, page: 1, x: 72, y: 100, kind: 'heading' },
  { file: 'main.typ', line: 14, page: 1, x: 72, y: 150, kind: 'paragraph' },
  { file: 'main.typ', line: 40, page: 1, x: 72, y: 320, kind: 'paragraph' },
  { file: 'main.typ', line: 60, page: 3, x: 72, y: 90, kind: 'heading' },
]

const MARKER = /#\[#metadata\(\(f:"[^"]*",l:(\d+)\)\)<ol-typst-sync>\]\/\*\*\//g

// The line each marker on `line` claims to come from, so a test can assert
// that injection never lies about a source position.
function markersOn(content, line) {
  const text = content.split('\n')[line - 1]
  return [...text.matchAll(MARKER)].map(match => Number(match[1]))
}

describe('TypstSyncManager', () => {
  beforeEach(async ctx => {
    ctx.TypstSyncManager = (await import(MODULE_PATH)).default
    ctx.inject = (source, file = 'main.typ') =>
      ctx.TypstSyncManager.injectMarkers(source, file)
  })

  describe('injectMarkers', () => {
    it('never changes line numbering', async ctx => {
      const source = ['= Title', '', 'Body text.', '', 'More text.'].join('\n')
      const { content } = ctx.inject(source)
      expect(content.split('\n')).to.have.length(5)
      expect(markersOn(content, 3)).to.deep.equal([3])
      expect(markersOn(content, 5)).to.deep.equal([5])
    })

    it('ends the marker so the text after it cannot be swallowed', async ctx => {
      // Regression, hit on a real project: a content block is a callable
      // expression, so prose starting with "(" became `#[...](default 2 ppc)`
      // -- a call taking the paragraph as its arguments, which failed the whole
      // query with "expected comma". "[" and "." bind the same way. The
      // trailing comment ends the expression and renders nothing.
      for (const text of ['(default 2 ppc) and', '[bracket] start', '.dot']) {
        const { content } = ctx.inject(text)
        expect(content, text).to.match(/<ol-typst-sync>\]\/\*\*\//)
      }
    })

    it('never steals a label from the content it belongs to', async ctx => {
      // Regression, hit on a real project (108 occurrences): a label attaches
      // to whatever precedes it, so a marker in front of `<overview>` took the
      // label off the heading and every `@overview` with it.
      const source = ['= Overview', '<overview>', '', 'Body text.'].join('\n')
      const { content } = ctx.inject(source)
      expect(markersOn(content, 2)).to.deep.equal([])
      expect(content.split('\n')[1]).to.equal('<overview>')
      expect(markersOn(content, 4)).to.deep.equal([4])
    })

    it('keeps a heading a heading', async ctx => {
      // Injecting at column 0 would push "=" off the start of the line and
      // turn the heading into plain text.
      const { content } = ctx.inject('== Section title')
      expect(content).to.match(/^== #\[#metadata/)
    })

    it('keeps list and enum markers at the start of the line', async ctx => {
      const source = ['- bullet', '+ enumerated', '/ Term: meaning'].join('\n')
      const { content } = ctx.inject(source)
      for (const line of content.split('\n')) {
        expect(line).to.match(/^[-+/] #\[#metadata/)
      }
    })

    it('anchors every line of a paragraph, not just the first', async ctx => {
      // The whole point of the rewrite: a click in the middle of a long
      // paragraph should resolve to the line it landed on.
      const source = ['first line', 'second line', 'third line'].join('\n')
      const { content, markerCount } = ctx.inject(source)
      expect(markerCount).to.equal(3)
      expect(markersOn(content, 2)).to.deep.equal([2])
    })

    it('leaves code mode alone', async ctx => {
      // A marker is markup syntax. Emitting one inside a dictionary literal is
      // a parse error that takes the entire query compile down with it.
      const source = [
        '#let config = (',
        '  title: "Doc",',
        '  tags: ("a", "b"),',
        ')',
      ].join('\n')
      const { content, markerCount } = ctx.inject(source)
      expect(markerCount).to.equal(0)
      expect(content).to.equal(source)
    })

    it('leaves raw blocks and comments alone', async ctx => {
      const source = [
        '```rust',
        'let x = (a: 1);',
        '```',
        '',
        '/* a comment',
        '   over two lines */',
      ].join('\n')
      expect(ctx.inject(source).markerCount).to.equal(0)
    })

    it('leaves display math alone but anchors the line it starts on', async ctx => {
      const source = ['$ a^2 + b^2 = c^2', '  = d $'].join('\n')
      const { content } = ctx.inject(source)
      expect(markersOn(content, 1)).to.deep.equal([1])
      expect(markersOn(content, 2)).to.deep.equal([])
    })

    it('anchors table cells individually', async ctx => {
      // Table body text has no other way to be anchored, so an in-table click
      // could never resolve before this.
      const source = [
        '#table(',
        '  columns: 2,',
        '  [Name], [Qty],',
        '  [Widget], [12],',
        ')',
      ].join('\n')
      const { content } = ctx.inject(source)
      expect(markersOn(content, 3)).to.deep.equal([3, 3])
      expect(markersOn(content, 4)).to.deep.equal([4, 4])
      // The marker goes inside the cell, so the cell still starts with "[".
      expect(content.split('\n')[2].trim()).to.match(/^\[#\[#metadata/)
    })

    it('does not anchor a figure caption as if it were a cell', async ctx => {
      const source = [
        '#figure(',
        '  rect(),',
        '  caption: [A caption],',
        ')',
      ].join('\n')
      const { content, kinds } = ctx.inject(source)
      expect(markersOn(content, 3)).to.deep.equal([])
      expect(kinds.get(1)).to.deep.equal({ kind: 'figure', injected: 1 })
    })

    it('skips template bodies', async ctx => {
      // Content inside #let/#set/#show is rendered wherever the template is
      // used, so anchoring it points clicks at the definition instead of at
      // the text the reader clicked on.
      const source = [
        '#set page(header: [',
        '  Running header',
        '])',
        '',
        '#show heading: it => [',
        '  #it.body',
        '])',
        '',
        '#let note = [',
        '  Reusable note.',
        ']',
        '',
        'Real body text.',
      ].join('\n')
      const { content, markerCount } = ctx.inject(source)
      expect(markerCount).to.equal(1)
      expect(markersOn(content, 13)).to.deep.equal([13])
    })

    it('does not anchor statements that render nothing', async ctx => {
      const source = [
        '#set text(size: 11pt)',
        '#import "lib.typ": *',
        '#include "chapter.typ"',
      ].join('\n')
      expect(ctx.inject(source).markerCount).to.equal(0)
    })

    it('reports includes so every file gets markers of its own', async ctx => {
      const source = [
        '#include "sections/one.typ"',
        '',
        '```',
        '#include "not-really.typ"',
        '```',
        '',
        '#include "sections/two.typ"',
      ].join('\n')
      expect(ctx.inject(source).includes).to.deep.equal([
        'sections/one.typ',
        'sections/two.typ',
      ])
    })

    it('is idempotent', async ctx => {
      // The compile dir survives between compiles. If a crash ever leaves
      // markers behind, the next injection must not stack a second set on top.
      const source = ['= Title', '', 'Body text.'].join('\n')
      const once = ctx.inject(source).content
      const twice = ctx.inject(once).content
      expect(twice).to.equal(once)
      expect(ctx.TypstSyncManager.stripMarkers(once)).to.equal(source)
    })
  })

  describe('findPdfAnchor', () => {
    it('resolves a click to the block that contains it', async ctx => {
      const entry = ctx.TypstSyncManager.findPdfAnchor(ENTRIES, 1, 160)
      expect(entry.line).to.equal(14)
    })

    it('keeps resolving to the same block deep inside it', async ctx => {
      // Regression: picking the nearest anchor by absolute distance snapped to
      // the following block (line 40) once the click passed the midpoint.
      for (const y of [250, 290, 319]) {
        const entry = ctx.TypstSyncManager.findPdfAnchor(ENTRIES, 1, y)
        expect(entry.line, `click at y=${y}`).to.equal(14)
      }
    })

    it('treats an anchor as the exact start of its block', async ctx => {
      // Boundaries are half-open: y=150 is the paragraph, y=149 is still the
      // heading above it. No tolerance, so the boundary is exactly the anchor.
      expect(ctx.TypstSyncManager.findPdfAnchor(ENTRIES, 1, 150).line).to.equal(
        14
      )
      expect(ctx.TypstSyncManager.findPdfAnchor(ENTRIES, 1, 149).line).to.equal(
        10
      )
    })

    it('resolves a click above the first anchor to the first block', async ctx => {
      const entry = ctx.TypstSyncManager.findPdfAnchor(ENTRIES, 1, 20)
      expect(entry.line).to.equal(10)
    })

    it('does not jump forward when a page has no anchors', async ctx => {
      // Page 2 is unmapped: prefer the last anchor before it, never one after.
      const entry = ctx.TypstSyncManager.findPdfAnchor(ENTRIES, 2, 200)
      expect(entry.line).to.equal(40)
    })

    it('resolves anchors on later pages', async ctx => {
      const entry = ctx.TypstSyncManager.findPdfAnchor(ENTRIES, 3, 95)
      expect(entry.line).to.equal(60)
    })

    it('returns null when there are no entries', async ctx => {
      expect(ctx.TypstSyncManager.findPdfAnchor([], 1, 100)).to.equal(null)
    })
  })

  describe('findCodeAnchor', () => {
    it('resolves an anchored line exactly', async ctx => {
      const entry = ctx.TypstSyncManager.findCodeAnchor(ENTRIES, 'main.typ', 14)
      expect(entry.y).to.equal(150)
    })

    it('falls back to the last anchor above an unanchored line', async ctx => {
      // Per-line markers leave gaps (code blocks, raw, templates). A line in a
      // gap belongs to the block that started before it.
      const entry = ctx.TypstSyncManager.findCodeAnchor(ENTRIES, 'main.typ', 30)
      expect(entry.line).to.equal(14)
    })

    it('returns null for a file with no anchors', async ctx => {
      expect(
        ctx.TypstSyncManager.findCodeAnchor(ENTRIES, 'other.typ', 5)
      ).to.equal(null)
    })
  })
})
