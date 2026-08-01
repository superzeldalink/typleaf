import { useTranslation } from 'react-i18next'
import OLNotification from '@/shared/components/ol/ol-notification'
import type { LinkedFile, LinkedFileData } from '@/features/file-view/types/binary-file'
import { hasProvider } from '@/features/file-view/types/binary-file'
import useInstanceFeatures from '@modules/instance-features/frontend/js/use-instance-features'

type TPRFileViewRefreshErrorProps = {
  file: LinkedFile<keyof LinkedFileData>
  refreshError: string
}

/**
 * Zotero-specific error messages when refreshing a linked file fails.
 * Registered via overleafModuleImports.tprFileViewRefreshError.
 */
export function TPRFileViewRefreshError({
  file,
  refreshError,
}: TPRFileViewRefreshErrorProps) {
  const { t } = useTranslation()
  const { zotero } = useInstanceFeatures()

  // Suppress the Zotero-specific error UI for Zotero files when Zotero is
  // disabled; other providers still surface their refresh errors.
  if (hasProvider(file, 'zotero') && !zotero) {
    return null
  }

  let message = refreshError

  if (hasProvider(file, 'zotero')) {
    if (!refreshError) {
      message = t('zotero_reference_loading_error')
    } else if (refreshError?.includes('not linked')) {
      message = t('zotero_reference_loading_error_forbidden')
    } else if (refreshError === 'forbidden' || refreshError?.includes('403')) {
      message = t('zotero_reference_loading_error_forbidden')
    } else if (refreshError === 'expired' || refreshError?.includes('token expired')) {
      message = t('zotero_reference_loading_error_expired')
    }
  }

  return (
    <div className="file-view-error">
      <OLNotification type="error" content={message} />
    </div>
  )
}
