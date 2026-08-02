export type OutlineItemData = {
  line: number
  title: string
  level?: number
  children?: OutlineItemData[]
  from?: number
  to?: number
  /**
   * The doc the heading lives in. Only set for a document-wide outline, where
   * entries can come from a file other than the one on screen.
   */
  docId?: string
  path?: string
}
