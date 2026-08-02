import {
  createContext,
  Dispatch,
  FC,
  SetStateAction,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'
import useScopeEventEmitter from '@/shared/hooks/use-scope-event-emitter'
import useEventListener from '@/shared/hooks/use-event-listener'
import { isValidTeXFile } from '@/main/is-valid-tex-file'
import localStorage from '@/infrastructure/local-storage'
import { useProjectContext } from '@/shared/context/project-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useFileTreeOpenContext } from './file-tree-open-context'
import { useEditorAnalytics } from '@/shared/hooks/use-editor-analytics'
import { useEditorManagerContext } from '@/features/ide-react/context/editor-manager-context'

export type PartialFlatOutline = {
  level: number
  title: string
  line: number
  /**
   * Set only for a document-wide outline, where a heading may belong to a file
   * other than the one on screen. Absent means "the open file".
   */
  docId?: string
  path?: string
}[]

export type FlatOutlineState =
  | {
      items: PartialFlatOutline
      partial: boolean
    }
  | undefined

const OutlineContext = createContext<
  | {
      flatOutline: FlatOutlineState
      setFlatOutline: Dispatch<SetStateAction<FlatOutlineState>>
      highlightedLine: number
      /** The file the highlighted line belongs to; see outlineItemKey. */
      highlightedDocId: string | null
      jumpToLine: (
        lineNumber: number,
        syncToPdf: boolean,
        docId?: string
      ) => void
      canShowOutline: boolean
      outlineExpanded: boolean
      toggleOutlineExpanded: () => void
      expandOutline: () => void
      collapseOutline: () => void
    }
  | undefined
>(undefined)

export const OutlineProvider: FC<React.PropsWithChildren> = ({ children }) => {
  const [flatOutline, setFlatOutline] = useState<FlatOutlineState>(undefined)
  const [currentlyHighlightedLine, setCurrentlyHighlightedLine] =
    useState<number>(-1)
  const [binaryFileOpened, setBinaryFileOpened] = useState<boolean>(false)
  const [ignoreNextCursorUpdate, setIgnoreNextCursorUpdate] =
    useState<boolean>(false)
  const [ignoreNextScroll, setIgnoreNextScroll] = useState<boolean>(false)
  const { sendEvent } = useEditorAnalytics()
  const { currentDocumentId: openDocId } = useEditorOpenDocContext()
  const { openDocWithId } = useEditorManagerContext()

  const goToLineEmitter = useScopeEventEmitter('editor:gotoLine', true)

  useEventListener(
    'file-view:file-opened',
    useCallback(() => {
      setBinaryFileOpened(true)
    }, [])
  )

  useEventListener(
    'scroll:editor:update',
    useCallback(
      (evt: CustomEvent) => {
        if (ignoreNextScroll) {
          setIgnoreNextScroll(false)
          return
        }
        setCurrentlyHighlightedLine(evt.detail + 1)
      },
      [ignoreNextScroll]
    )
  )

  useEventListener(
    'cursor:editor:update',
    useCallback(
      (evt: CustomEvent) => {
        if (ignoreNextCursorUpdate) {
          setIgnoreNextCursorUpdate(false)
          return
        }
        setCurrentlyHighlightedLine(evt.detail.row + 1)
      },
      [ignoreNextCursorUpdate]
    )
  )

  useEventListener(
    'doc:after-opened',
    useCallback((evt: CustomEvent) => {
      if (evt.detail.isNewDoc) {
        setIgnoreNextCursorUpdate(true)
      }
      setBinaryFileOpened(false)
      setIgnoreNextScroll(true)
    }, [])
  )

  const jumpToLine = useCallback(
    (lineNumber: number, syncToPdf: boolean, docId?: string) => {
      setIgnoreNextScroll(true)
      // A document-wide outline can point at a heading in a file that is not
      // open. Switch to it first; openDocWithId scrolls to the line itself, so
      // emitting a goto for the old document would jump the wrong editor.
      if (docId && docId !== openDocId) {
        openDocWithId(docId, { gotoLine: lineNumber, gotoColumn: 0 })
      } else {
        goToLineEmitter({
          gotoLine: lineNumber,
          gotoColumn: 0,
          syncToPdf,
        })
      }
      sendEvent('outline-jump-to-line')
    },
    [goToLineEmitter, sendEvent, openDocId, openDocWithId]
  )

  // In a document-wide outline the items span several files, so line numbers
  // from another file would otherwise compete for the highlight. Only the
  // headings in the file on screen can match the cursor.
  const highlightedLine = useMemo(
    () =>
      closestSectionLineNumber(
        flatOutline?.items.filter(
          item => item.docId === undefined || item.docId === openDocId
        ),
        currentlyHighlightedLine
      ),
    [flatOutline, currentlyHighlightedLine, openDocId]
  )

  const { openDocName } = useEditorOpenDocContext()
  const isTexFile = useMemo(
    () => (openDocName ? isValidTeXFile(openDocName) : false),
    [openDocName]
  )

  const { selectedEntityCount } = useFileTreeOpenContext()
  const hasSingleEntityOpen = selectedEntityCount === 1

  const { projectId } = useProjectContext()
  const storageKey = `file_outline.expanded.${projectId}`

  const [outlineExpanded, setOutlineExpanded] = useState(
    () => localStorage.getItem(storageKey) !== false
  )

  const canShowOutline = hasSingleEntityOpen && isTexFile && !binaryFileOpened

  const expandOutline = useCallback(() => {
    if (canShowOutline) {
      localStorage.setItem(storageKey, true)
      sendEvent('outline-expand')
      setOutlineExpanded(true)
    }
  }, [canShowOutline, storageKey, sendEvent])

  const collapseOutline = useCallback(() => {
    if (canShowOutline) {
      localStorage.setItem(storageKey, false)
      sendEvent('outline-collapse')
      setOutlineExpanded(false)
    }
  }, [canShowOutline, storageKey, sendEvent])

  const toggleOutlineExpanded = useCallback(() => {
    if (outlineExpanded) {
      collapseOutline()
    } else {
      expandOutline()
    }
  }, [collapseOutline, expandOutline, outlineExpanded])

  const value = useMemo(
    () => ({
      flatOutline,
      setFlatOutline,
      highlightedLine,
      highlightedDocId: openDocId,
      jumpToLine,
      canShowOutline,
      outlineExpanded,
      toggleOutlineExpanded,
      expandOutline,
      collapseOutline,
    }),
    [
      flatOutline,
      highlightedLine,
      openDocId,
      jumpToLine,
      canShowOutline,
      outlineExpanded,
      toggleOutlineExpanded,
      expandOutline,
      collapseOutline,
    ]
  )

  return (
    <OutlineContext.Provider value={value}>{children}</OutlineContext.Provider>
  )
}

export const useOutlineContext = () => {
  const context = useContext(OutlineContext)

  if (!context) {
    throw new Error(
      'useOutlineProvider is only available inside OutlineProvider'
    )
  }

  return context
}

const closestSectionLineNumber = (
  outline: { line: number }[] | undefined,
  lineNumber: number
): number => {
  if (!outline) {
    return -1
  }
  let highestLine = -1
  for (const section of outline) {
    if (section.line > lineNumber) {
      return highestLine
    }
    highestLine = section.line
  }
  return highestLine
}
