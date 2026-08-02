import { useCodeMirrorStateContext } from './codemirror-context'
import React, { useEffect } from 'react'
import { documentOutline } from '../languages/latex/document-outline'
import { ProjectionStatus } from '../utils/tree-operations/projection'
import useDebounce from '../../../shared/hooks/use-debounce'
import { useOutlineContext } from '@/features/ide-react/context/outline-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useTypstDocumentOutline } from '@/features/ide-react/hooks/use-typst-document-outline'

export const CodemirrorOutline = React.memo(function CodemirrorOutline() {
  const { setFlatOutline } = useOutlineContext()
  const { openDocName, currentDocumentId } = useEditorOpenDocContext()

  const state = useCodeMirrorStateContext()
  const debouncedState = useDebounce(state, 100)
  const outlineResult = debouncedState.field(documentOutline, false)

  const isTypst = Boolean(openDocName?.endsWith('.typ'))

  // Typst gets an outline of the whole document, walked from the root doc
  // through #include, rather than of whichever file happens to be open. The
  // open file's text is passed in so that edits show up without a round trip.
  const typstOutline = useTypstDocumentOutline({
    enabled: isTypst,
    openDocId: currentDocumentId,
    openDocText: isTypst ? debouncedState.doc.toString() : null,
  })

  // when the outline projection changes, calculate the flat outline
  useEffect(() => {
    if (isTypst) {
      setFlatOutline(typstOutline)
      return
    }

    if (outlineResult && outlineResult.status !== ProjectionStatus.Pending) {
      // We have a (potentially partial) outline.
      setFlatOutline({
        items: outlineResult.items.map(element => ({
          level: element.level,
          title: element.title,
          line: element.line,
          // A LaTeX outline only ever covers the open file, but tagging the
          // items keeps highlighting keyed on (file, line) everywhere.
          docId: currentDocumentId ?? undefined,
        })),
        partial: outlineResult?.status === ProjectionStatus.Partial,
      })
    } else {
      setFlatOutline(undefined)
    }
  }, [isTypst, typstOutline, outlineResult, currentDocumentId, setFlatOutline])

  return null
})
