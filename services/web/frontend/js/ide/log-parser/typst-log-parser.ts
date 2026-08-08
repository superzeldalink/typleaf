import { LatexLogEntry } from './latex-log-parser'

// Shaped as a LatexLogEntry so these drop straight into the same log pane and
// error list as LaTeX diagnostics, with no special-casing downstream.
type ParsedTypstEntry = LatexLogEntry & { column?: number }

// `error: expected comma` / `warning: unknown font family: calibri`
const DIAGNOSTIC_RE = /^(error|warning): (.*)$/
// The location line that follows, e.g. `   ┌─ sections/05-parameters.typ:13:74`
// The box-drawing prefix is what typst emits; accept a plain arrow too in case
// a future version drops the unicode.
const LOCATION_RE = /^\s*(?:┌─|-->)\s*(.+?):(\d+):(\d+)\s*$/

/**
 * Turns `typst compile` diagnostics into log entries.
 *
 * Typst writes nothing to a log file and reports everything on stderr in its
 * own format, so the LaTeX parser finds nothing in it. Without this a failed
 * Typst compile shows only a generic "there is an error" with no file, no line
 * and no message.
 */
export default function parseTypstLog(text: string): {
  errors: ParsedTypstEntry[]
  warnings: ParsedTypstEntry[]
} {
  const errors: ParsedTypstEntry[] = []
  const warnings: ParsedTypstEntry[] = []

  if (!text) {
    return { errors, warnings }
  }

  const lines = text.split('\n')

  for (let index = 0; index < lines.length; index++) {
    const diagnostic = lines[index].match(DIAGNOSTIC_RE)
    if (!diagnostic) {
      continue
    }

    const [, level, message] = diagnostic
    const entry: ParsedTypstEntry = {
      level: level as 'error' | 'warning',
      message,
      file: undefined,
      line: null,
      raw: lines[index],
    }

    // Collect the indented block that follows: the location line plus the
    // source excerpt and carets typst prints underneath it. Shown as the
    // entry's detail, so the reader sees the offending line, not just a
    // message.
    const detail: string[] = []
    for (let next = index + 1; next < lines.length; next++) {
      const line = lines[next]
      if (line.trim() === '' || DIAGNOSTIC_RE.test(line)) {
        break
      }
      detail.push(line)

      const location = line.match(LOCATION_RE)
      if (location && !entry.file) {
        entry.file = location[1]
        entry.line = Number(location[2])
        entry.column = Number(location[3])
      }
    }

    if (detail.length > 0) {
      entry.content = detail.join('\n')
      entry.raw = [entry.raw, ...detail].join('\n')
    }

    if (entry.level === 'error') {
      errors.push(entry)
    } else {
      warnings.push(entry)
    }
  }

  return { errors, warnings }
}

/**
 * Typst's diagnostics are recognisable by the box-drawing location line, which
 * no LaTeX log contains.
 */
export function looksLikeTypstLog(text: string): boolean {
  return DIAGNOSTIC_RE.test(text?.split('\n')[0] ?? '') || /^\s*┌─ /m.test(text)
}
