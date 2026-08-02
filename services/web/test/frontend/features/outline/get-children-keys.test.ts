import { expect } from 'chai'
import getChildrenKeys, {
  highlightedItemKey,
  outlineItemKey,
} from '../../../../frontend/js/features/outline/util/get-children-keys'

describe('outline item keys', function () {
  it('distinguishes the same line in different files', function () {
    // Regression: a document-wide outline highlighted every file that had a
    // heading on the cursor's line number, lighting up four sections at once.
    const a = { line: 12, docId: 'doc-a' }
    const b = { line: 12, docId: 'doc-b' }

    expect(outlineItemKey(a)).to.not.equal(outlineItemKey(b))
    expect(outlineItemKey(a)).to.equal(highlightedItemKey('doc-a', 12))
    expect(outlineItemKey(b)).to.not.equal(highlightedItemKey('doc-a', 12))
  })

  it('matches an item in the open file', function () {
    expect(outlineItemKey({ line: 5, docId: 'doc-a' })).to.equal(
      highlightedItemKey('doc-a', 5)
    )
  })

  it('has no key when nothing is highlighted', function () {
    expect(highlightedItemKey('doc-a', null)).to.equal(null)
    expect(highlightedItemKey('doc-a', undefined)).to.equal(null)
  })

  it('collects descendant keys, not bare line numbers', function () {
    const keys = getChildrenKeys([
      {
        line: 1,
        title: 'parent',
        docId: 'doc-a',
        children: [{ line: 2, title: 'child', docId: 'doc-b' }],
      },
    ])

    expect(keys).to.have.members(['doc-a:1', 'doc-b:2'])
  })
})
