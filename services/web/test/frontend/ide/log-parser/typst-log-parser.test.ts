import { expect } from 'chai'
import parseTypstLog, {
  looksLikeTypstLog,
} from '../../../../frontend/js/ide/log-parser/typst-log-parser'

// Real `typst compile` output, kept verbatim: the box-drawing characters and
// the exact indentation are what the parser keys on.
const TYPST_LOG = `error: expected comma
   ┌─ sections/05-parameters.typ:13:74
   │
13 │ #[#metadata(l:13)]/**/(default 2 ppc) and the AXI4-Stream width scales
   │                                                                      ^

warning: unknown font family: calibri
   ┌─ lib/template.typ:28:13
   │
28 │   text(font: head-font, size: 16pt, weight: "bold", body),
   │              ^^^^^^^^^
`

describe('typst log parser', function () {
  it('recognises a typst log', function () {
    expect(looksLikeTypstLog(TYPST_LOG)).to.equal(true)
  })

  it('does not claim a LaTeX log', function () {
    expect(
      looksLikeTypstLog('! Undefined control sequence.\nl.5 \\foo')
    ).to.equal(false)
  })

  it('extracts the message, file, line and column of an error', function () {
    const { errors } = parseTypstLog(TYPST_LOG)
    expect(errors).to.have.length(1)
    expect(errors[0].level).to.equal('error')
    expect(errors[0].message).to.equal('expected comma')
    expect(errors[0].file).to.equal('sections/05-parameters.typ')
    expect(errors[0].line).to.equal(13)
    expect(errors[0].column).to.equal(74)
  })

  it('separates warnings from errors', function () {
    const { warnings } = parseTypstLog(TYPST_LOG)
    expect(warnings).to.have.length(1)
    expect(warnings[0].message).to.equal('unknown font family: calibri')
    expect(warnings[0].file).to.equal('lib/template.typ')
    expect(warnings[0].line).to.equal(28)
  })

  it('keeps the source excerpt as the entry detail', function () {
    const { errors } = parseTypstLog(TYPST_LOG)
    // Without this the reader gets a message with no sight of the offending
    // line, which is most of what makes a typst diagnostic readable.
    expect(errors[0].content).to.contain('AXI4-Stream width scales')
    expect(errors[0].content).to.contain('^')
  })

  it('handles a diagnostic with no location block', function () {
    const { errors } = parseTypstLog(
      'error: file not found (searched at a.typ)'
    )
    expect(errors).to.have.length(1)
    expect(errors[0].message).to.equal('file not found (searched at a.typ)')
    expect(errors[0].file).to.equal(undefined)
  })

  it('returns nothing for empty input', function () {
    expect(parseTypstLog('')).to.deep.equal({ errors: [], warnings: [] })
  })
})
