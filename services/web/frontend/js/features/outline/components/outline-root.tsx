import { useTranslation } from 'react-i18next'
import OutlineList from './outline-list'
import { OutlineItemData } from '@/features/ide-react/types/outline'

function OutlineRoot({
  outline,
  jumpToLine,
  highlightedLine,
  highlightedDocId,
}: {
  outline: OutlineItemData[]
  jumpToLine: (line: number, syncToPdf: boolean, docId?: string) => void
  highlightedLine?: number
  highlightedDocId?: string | null
}) {
  const { t } = useTranslation()

  return (
    <div>
      {outline.length ? (
        <OutlineList
          outline={outline}
          jumpToLine={jumpToLine}
          isRoot
          highlightedLine={highlightedLine}
          highlightedDocId={highlightedDocId}
          containsHighlightedLine
        />
      ) : (
        <div className="outline-body-no-elements">
          {t('we_cant_find_any_sections_or_subsections_in_this_file')}.{' '}
          <a
            href="https://docs.overleaf.com/navigating-in-the-editor/selecting-and-managing-files"
            className="outline-body-link"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('find_out_more_about_the_file_outline')}
          </a>
        </div>
      )}
    </div>
  )
}

export default OutlineRoot
