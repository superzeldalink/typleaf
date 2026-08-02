import { useCallback, useEffect, useRef, useState } from 'react'
import {
  parseTypstFile,
  resolveTypstPath,
} from '@/features/source-editor/languages/typst/outline'
import { useFileTreePathContext } from '@/features/file-tree/contexts/file-tree-path'
import { useProjectContext } from '@/shared/context/project-context'
import { debugConsole } from '@/utils/debugging'
import type { PartialFlatOutline } from '@/features/ide-react/context/outline-context'

const FETCH_TIMEOUT_MS = 10000

// Guards against a cycle of includes, and against a pathological project
// walking the whole file tree.
const MAX_FILES = 200

type DocumentOutline = {
  items: PartialFlatOutline
  /** True when some included file could not be read, so the outline has gaps. */
  partial: boolean
}

/**
 * Builds an outline for the whole document rather than for the file on screen:
 * start at the project's root doc and follow `#include` depth first, so the
 * headings appear in the order a reader meets them.
 *
 * The open file's text comes from the editor rather than the server so that
 * typing a heading updates the outline immediately. Every other file is
 * fetched once and cached; a file's cache entry is dropped when it is opened,
 * since the copy on the server goes stale as soon as it is edited.
 */
export function useTypstDocumentOutline({
  enabled,
  openDocId,
  openDocText,
}: {
  enabled: boolean
  openDocId: string | null
  openDocText: string | null
}): DocumentOutline | undefined {
  const { projectId, project } = useProjectContext()
  const rootDocId = project?.rootDocId
  const { pathInFolder, findEntityByPath } = useFileTreePathContext()
  const [outline, setOutline] = useState<DocumentOutline | undefined>(undefined)

  // docId -> file contents. Persists across renders so that typing in one file
  // does not refetch every other file in the document.
  const cacheRef = useRef(new Map<string, string>())

  // The server's copy of the open doc is stale the moment it is edited, so
  // drop it and let the live editor text stand in.
  useEffect(() => {
    if (openDocId) {
      cacheRef.current.delete(openDocId)
    }
  }, [openDocId])

  const fetchDoc = useCallback(
    async (docId: string) => {
      const cached = cacheRef.current.get(docId)
      if (cached !== undefined) {
        return cached
      }
      const response = await fetch(
        `/Project/${projectId}/doc/${docId}/download`,
        { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
      )
      if (!response.ok) {
        throw new Error(`failed to fetch doc ${docId}: ${response.status}`)
      }
      const text = await response.text()
      cacheRef.current.set(docId, text)
      return text
    },
    [projectId]
  )

  useEffect(() => {
    if (!enabled || !rootDocId) {
      setOutline(undefined)
      return
    }

    const rootPath = pathInFolder(rootDocId)
    if (!rootPath) {
      setOutline(undefined)
      return
    }

    let cancelled = false

    const build = async () => {
      const items: PartialFlatOutline = []
      const visited = new Set<string>()
      let incomplete = false

      const walk = async (docId: string, path: string) => {
        if (cancelled || visited.has(docId) || visited.size >= MAX_FILES) {
          return
        }
        visited.add(docId)

        let text: string
        if (docId === openDocId && openDocText !== null) {
          text = openDocText
        } else {
          try {
            text = await fetchDoc(docId)
          } catch (error) {
            // A file we cannot read just contributes nothing; the rest of the
            // outline is still worth showing.
            debugConsole.debug(`[outline] could not read ${path}`, error)
            incomplete = true
            return
          }
        }

        const { headings, includes } = parseTypstFile(text)

        for (const heading of headings) {
          items.push({ ...heading, docId, path })
        }

        for (const include of includes) {
          const includePath = resolveTypstPath(path, include)
          const found = findEntityByPath(includePath)
          if (found?.type === 'doc' && found.entity?._id) {
            await walk(found.entity._id, includePath)
          } else {
            debugConsole.debug(`[outline] unresolved include ${includePath}`)
            incomplete = true
          }
        }
      }

      await walk(rootDocId, rootPath)

      if (cancelled) {
        return
      }

      // A file the root doc never includes -- a scratch file, or one only
      // reachable through #import -- would otherwise show an outline with no
      // relation to what is on screen. Fall back to its own headings.
      if (openDocId && openDocText !== null && !visited.has(openDocId)) {
        setOutline({
          items: parseTypstFile(openDocText).headings,
          partial: false,
        })
        return
      }

      setOutline({ items, partial: incomplete })
    }

    build().catch(error => {
      debugConsole.error('[outline] failed to build document outline', error)
      if (!cancelled) {
        setOutline(undefined)
      }
    })

    return () => {
      cancelled = true
    }
  }, [
    enabled,
    rootDocId,
    openDocId,
    openDocText,
    pathInFolder,
    findEntityByPath,
    fetchDoc,
  ])

  return outline
}
