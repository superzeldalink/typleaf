import { expect } from 'chai'
import {
  parseTypstFile,
  resolveTypstPath,
} from '../../../../../../frontend/js/features/source-editor/languages/typst/outline'

describe('typst outline', function () {
  describe('parseTypstFile', function () {
    it('collects headings with their level and line number', function () {
      const { headings } = parseTypstFile(
        ['= Top', '', 'Body text.', '', '== Nested', '=== Deeper'].join('\n')
      )

      expect(headings).to.deep.equal([
        { level: 1, title: 'Top', line: 1 },
        { level: 2, title: 'Nested', line: 5 },
        { level: 3, title: 'Deeper', line: 6 },
      ])
    })

    it('ignores headings inside a raw block', function () {
      // A shell prompt or a diff inside a code sample must not become a
      // section of the document.
      const { headings } = parseTypstFile(
        [
          '= Real',
          '',
          '```',
          '= Not a heading',
          '```',
          '',
          '== Also real',
        ].join('\n')
      )

      expect(headings.map(h => h.title)).to.deep.equal(['Real', 'Also real'])
    })

    it('collects includes in source order', function () {
      const { includes } = parseTypstFile(
        [
          '#include "sections/01-intro.typ"',
          '',
          '```',
          '#include "not-really.typ"',
          '```',
          '',
          '#include "sections/02-body.typ"',
        ].join('\n')
      )

      expect(includes).to.deep.equal([
        'sections/01-intro.typ',
        'sections/02-body.typ',
      ])
    })

    it('does not treat an equals sign mid-line as a heading', function () {
      const { headings } = parseTypstFile('#let x = 1\nsome = text\n')
      expect(headings).to.deep.equal([])
    })

    it('requires a space after the equals signs', function () {
      const { headings } = parseTypstFile('=NotAHeading\n= A heading')
      expect(headings.map(h => h.title)).to.deep.equal(['A heading'])
    })
  })

  describe('resolveTypstPath', function () {
    it('resolves relative to the including file', function () {
      expect(resolveTypstPath('main.typ', 'sections/one.typ')).to.equal(
        'sections/one.typ'
      )
      expect(resolveTypstPath('sections/one.typ', 'two.typ')).to.equal(
        'sections/two.typ'
      )
    })

    it('walks up out of the including directory', function () {
      expect(
        resolveTypstPath('sections/deep/one.typ', '../shared/intro.typ')
      ).to.equal('sections/shared/intro.typ')
    })

    it('ignores redundant current-directory segments', function () {
      expect(resolveTypstPath('main.typ', './sections/one.typ')).to.equal(
        'sections/one.typ'
      )
    })
  })
})
