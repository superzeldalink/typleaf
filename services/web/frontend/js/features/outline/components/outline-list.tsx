import classNames from 'classnames'
import OutlineItem from './outline-item'
import { memo } from 'react'
import { OutlineItemData } from '@/features/ide-react/types/outline'
import getChildrenKeys, {
  highlightedItemKey,
  outlineItemKey,
} from '../util/get-children-keys'

const OutlineList = memo(function OutlineList({
  outline,
  jumpToLine,
  isRoot,
  highlightedLine,
  highlightedDocId,
  containsHighlightedLine,
}: {
  outline: OutlineItemData[]
  jumpToLine: (line: number, syncToPdf: boolean, docId?: string) => void
  isRoot?: boolean
  highlightedLine?: number | null
  highlightedDocId?: string | null
  containsHighlightedLine?: boolean
}) {
  // Keyed on (file, line): with a document-wide outline, matching on the line
  // alone lights up every file that happens to have a heading on that line.
  const highlightedKey = highlightedItemKey(highlightedDocId, highlightedLine)
  const listClasses = classNames('outline-item-list', {
    'outline-item-list-root': isRoot,
  })
  return (
    <ul className={listClasses} role={isRoot ? 'tree' : 'group'}>
      {outline.map((outlineItem, idx) => {
        const matchesHighlightedLine =
          containsHighlightedLine &&
          highlightedKey !== null &&
          outlineItemKey(outlineItem) === highlightedKey
        const itemContainsHighlightedLine =
          highlightedKey !== null &&
          containsHighlightedLine &&
          getChildrenKeys(outlineItem.children).includes(highlightedKey)

        // highlightedLine is only provided to the item if the item matches or
        // contains the highlighted line. This means that whenever the item does
        // not contain the highlighted line, the props provided to it are the
        // same and the component can be memoized.
        return (
          <OutlineItem
            key={`${outlineItem.level}-${idx}`}
            outlineItem={outlineItem}
            jumpToLine={jumpToLine}
            highlightedDocId={highlightedDocId}
            highlightedLine={
              matchesHighlightedLine || itemContainsHighlightedLine
                ? highlightedLine
                : null
            }
            matchesHighlightedLine={matchesHighlightedLine}
            containsHighlightedLine={itemContainsHighlightedLine}
          />
        )
      })}
    </ul>
  )
})

export default OutlineList
