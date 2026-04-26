import { useCodeMirrorStateContext } from './codemirror-context'
import React, { useEffect } from 'react'
import { documentOutline } from '../languages/latex/document-outline'
import { ProjectionStatus } from '../utils/tree-operations/projection'
import useDebounce from '../../../shared/hooks/use-debounce'
import { useOutlineContext } from '@/features/ide-react/context/outline-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { EditorState } from '@codemirror/state'

function getTypstOutline(state: EditorState) {
  const items = []
  const text = state.doc.toString()
  const lines = text.split('\n')
  let offset = 0
  let insideCodeFence = false

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const trimmed = line.trim()

    if (trimmed.startsWith('```')) {
      insideCodeFence = !insideCodeFence
    }

    if (!insideCodeFence) {
      const match = line.match(/^(=+)\s+(.*?)\s*$/)
      if (match && match[2]) {
        items.push({
          from: offset,
          to: offset + line.length,
          line: index + 1,
          level: match[1].length,
          title: match[2],
        })
      }
    }

    offset += line.length + 1
  }

  return items
}

export const CodemirrorOutline = React.memo(function CodemirrorOutline() {
  const { setFlatOutline } = useOutlineContext()
  const { openDocName } = useEditorOpenDocContext()

  const state = useCodeMirrorStateContext()
  const debouncedState = useDebounce(state, 100)
  const outlineResult = debouncedState.field(documentOutline, false)

  // when the outline projection changes, calculate the flat outline
  useEffect(() => {
    if (openDocName?.endsWith('.typ')) {
      setFlatOutline({
        items: getTypstOutline(debouncedState).map(element => ({
          level: element.level,
          title: element.title,
          line: element.line,
        })),
        partial: false,
      })
      return
    }

    if (outlineResult && outlineResult.status !== ProjectionStatus.Pending) {
      // We have a (potentially partial) outline.
      setFlatOutline({
        items: outlineResult.items.map(element => ({
          level: element.level,
          title: element.title,
          line: element.line,
        })),
        partial: outlineResult?.status === ProjectionStatus.Partial,
      })
    } else {
      setFlatOutline(undefined)
    }
  }, [debouncedState, openDocName, outlineResult, setFlatOutline])

  return null
})
