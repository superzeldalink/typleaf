import { OutlineItemData } from '@/features/ide-react/types/outline'

/**
 * Identifies a heading by its file as well as its line.
 *
 * A document-wide outline spans several files, so a bare line number is not
 * unique: line 12 of one chapter and line 12 of another would both match the
 * cursor and light up together.
 */
export function outlineItemKey(
  item: Pick<OutlineItemData, 'line' | 'docId'>
): string {
  return `${item.docId ?? ''}:${item.line}`
}

export function highlightedItemKey(
  docId: string | null | undefined,
  line: number | null | undefined
): string | null {
  return line == null ? null : `${docId ?? ''}:${line}`
}

export default function getChildrenKeys(
  children?: OutlineItemData[]
): string[] {
  return (children || [])
    .map(child => getChildrenKeys(child.children).concat(outlineItemKey(child)))
    .flat()
}
