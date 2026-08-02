import {
  findInTree,
  findInTreeOrThrow,
} from '@/features/file-tree/util/find-in-tree'
import { useFileTreeOpenContext } from '@/features/ide-react/context/file-tree-open-context'
import { useOutlineContext } from '@/features/ide-react/context/outline-context'
import getChildrenKeys, {
  highlightedItemKey,
  outlineItemKey,
} from '@/features/outline/util/get-children-keys'
import MaterialIcon from '@/shared/components/material-icon'
import { useFileTreeData } from '@/shared/context/file-tree-data-context'
import { Fragment, useMemo } from 'react'
import {
  nestOutline,
  Outline,
} from '@/features/source-editor/utils/tree-operations/outline'

// Matched on (file, line) rather than the line alone: a document-wide outline
// spans several files, and the same line number in two of them would otherwise
// both look like the cursor's section.
const constructOutlineHierarchy = (
  items: Outline[],
  highlightedKey: string,
  outlineHierarchy: Outline[] = []
) => {
  for (const item of items) {
    if (outlineItemKey(item) === highlightedKey) {
      outlineHierarchy.push(item)
      return outlineHierarchy
    }

    const childKeys = getChildrenKeys(item.children)
    if (childKeys.includes(highlightedKey)) {
      outlineHierarchy.push(item)
      return constructOutlineHierarchy(
        item.children as Outline[],
        highlightedKey,
        outlineHierarchy
      )
    }
  }
  return outlineHierarchy
}

export default function Breadcrumbs() {
  const { openEntity } = useFileTreeOpenContext()
  const { fileTreeData } = useFileTreeData()
  const { flatOutline, highlightedLine, highlightedDocId, canShowOutline } =
    useOutlineContext()

  // The section path is kept to the open file even though the outline panel
  // spans the whole document: the folder path to the left already says where
  // the file sits, so headings from a parent file would repeat that and, worse,
  // read as if they lived in the file on screen.
  const outline = useMemo(
    () =>
      nestOutline(
        (flatOutline?.items ?? []).filter(
          item => item.docId === undefined || item.docId === highlightedDocId
        )
      ),
    [flatOutline, highlightedDocId]
  )

  const folderHierarchy = useMemo(() => {
    if (openEntity?.type !== 'doc' || !fileTreeData) {
      return []
    }

    try {
      return openEntity.path
        .filter(id => id !== fileTreeData._id) // Filter out the root folder
        .map(id => {
          return findInTreeOrThrow(fileTreeData, id)?.entity
        })
    } catch {
      // If any of the folders in the path are not found, the entire hierarchy
      // is invalid.
      return []
    }
  }, [openEntity, fileTreeData])

  const fileName = useMemo(() => {
    // NOTE: openEntity.entity.name may not always be accurate, so we read it
    // from the file tree data instead.
    if (openEntity?.type !== 'doc' || !fileTreeData) {
      return undefined
    }
    return findInTree(fileTreeData, openEntity.entity._id)?.entity.name
  }, [fileTreeData, openEntity])

  const outlineHierarchy = useMemo(() => {
    if (openEntity?.type !== 'doc' || !canShowOutline) {
      return []
    }

    const highlightedKey = highlightedItemKey(highlightedDocId, highlightedLine)
    if (highlightedKey === null) {
      return []
    }
    return constructOutlineHierarchy(outline, highlightedKey)
  }, [outline, highlightedLine, highlightedDocId, canShowOutline, openEntity])

  if (openEntity?.type !== 'doc' || !fileTreeData) {
    return null
  }

  const numOutlineItems = outlineHierarchy.length

  return (
    <div className="ol-cm-breadcrumbs" translate="no">
      {folderHierarchy.map(folder => (
        <Fragment key={folder._id}>
          <div>{folder.name}</div>
          <Chevron />
        </Fragment>
      ))}
      <MaterialIcon unfilled type="description" />
      <div>{fileName}</div>
      {numOutlineItems > 0 && <Chevron />}
      {outlineHierarchy.map((section, idx) => (
        <Fragment key={outlineItemKey(section)}>
          <div>{section.title}</div>
          {idx < numOutlineItems - 1 && <Chevron />}
        </Fragment>
      ))}
    </div>
  )
}

const Chevron = () => (
  <MaterialIcon className="ol-cm-breadcrumb-chevron" type="chevron_right" />
)
