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

describe('TypstSyncManager', () => {
  beforeEach(async ctx => {
    ctx.TypstSyncManager = (await import(MODULE_PATH)).default
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

  describe('pairBlocks', () => {
    const src = (line, text) => ({
      file: 'main.typ',
      line,
      endLine: line,
      kind: 'paragraph',
      text,
    })
    const rendered = (y, text) => ({ page: 1, x: 72, y, text })

    it('pairs blocks by content, not by position', async ctx => {
      // The renderer emits an extra block ("intro") that the source scan never
      // produced. Index pairing would shift every later block onto the wrong
      // coordinates; content alignment must keep alpha/beta/gamma correct.
      const entries = ctx.TypstSyncManager.pairBlocks(
        [src(10, 'alpha'), src(20, 'beta'), src(30, 'gamma')],
        {
          paragraphs: [
            rendered(50, 'intro'),
            rendered(100, 'alpha'),
            rendered(200, 'beta'),
            rendered(300, 'gamma'),
          ],
        }
      )
      expect(entries.map(e => [e.line, e.y])).to.deep.equal([
        [10, 100],
        [20, 200],
        [30, 300],
      ])
    })

    it('drops source blocks that were never rendered', async ctx => {
      // "beta" has no rendered counterpart. It must get no anchor at all
      // rather than borrowing gamma's position.
      const entries = ctx.TypstSyncManager.pairBlocks(
        [src(10, 'alpha'), src(20, 'beta'), src(30, 'gamma')],
        { paragraphs: [rendered(100, 'alpha'), rendered(300, 'gamma')] }
      )
      expect(entries.map(e => [e.line, e.y])).to.deep.equal([
        [10, 100],
        [30, 300],
      ])
    })

    it('preserves document order when matching', async ctx => {
      // Repeated text must not let a later source block match an earlier
      // rendered block.
      const entries = ctx.TypstSyncManager.pairBlocks(
        [src(10, 'same'), src(20, 'same')],
        { paragraphs: [rendered(100, 'same'), rendered(200, 'same')] }
      )
      expect(entries.map(e => [e.line, e.y])).to.deep.equal([
        [10, 100],
        [20, 200],
      ])
    })
  })
})
