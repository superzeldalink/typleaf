export type TypstHeading = {
  level: number
  title: string
  line: number
}

export type TypstFileParse = {
  headings: TypstHeading[]
  includes: string[]
}

const HEADING_RE = /^(=+)\s+(.*?)\s*$/
const INCLUDE_RE = /^#include\s+"([^"]+)"\s*$/

/**
 * Pulls the headings and `#include`s out of a single Typst file.
 *
 * Only `=` markup headings are recognised, which is the same rule the editor
 * has always used. Fenced raw blocks are skipped so that a `= ` line inside a
 * code sample is not mistaken for a heading.
 */
export function parseTypstFile(text: string): TypstFileParse {
  const headings: TypstHeading[] = []
  const includes: string[] = []
  const lines = text.split('\n')
  let insideCodeFence = false

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const trimmed = line.trim()

    if (trimmed.startsWith('```')) {
      insideCodeFence = !insideCodeFence
      continue
    }

    if (insideCodeFence) {
      continue
    }

    const include = trimmed.match(INCLUDE_RE)
    if (include) {
      includes.push(include[1])
      continue
    }

    const heading = line.match(HEADING_RE)
    if (heading && heading[2]) {
      headings.push({
        level: heading[1].length,
        title: heading[2],
        line: index + 1,
      })
    }
  }

  return { headings, includes }
}

/**
 * Resolves an `#include` target against the including file's own path, so a
 * chapter that includes "../shared/intro.typ" lands in the right place.
 */
export function resolveTypstPath(fromPath: string, includePath: string) {
  const base = fromPath.split('/').slice(0, -1)
  const segments = includePath.trim().split('/')

  for (const segment of segments) {
    if (segment === '.' || segment === '') {
      continue
    }
    if (segment === '..') {
      base.pop()
    } else {
      base.push(segment)
    }
  }

  return base.join('/')
}
