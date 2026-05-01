// Single helper used by every report's "Export to Sheets" button.
//
// What it does beyond a plain api.post:
//   1. Opens an about:blank popup BEFORE the request so Safari doesn't
//      flag the navigation as user-gesture-less when the response
//      arrives ~3s later.
//   2. Catches the 412 NOT_CONNECTED / GRANT_INVALID responses we send
//      from the export endpoint and pops the singleton ConnectDriveModal
//      instead of a generic toast — the user sees an action ("Connect")
//      instead of an error.
//   3. Closes the popup on failure so the user isn't left staring at a
//      blank tab.
//
// Returns the URL on success so callers can do their own follow-up if
// they want, but most callers just await it for the side effects.

import { reportsApi } from '@/lib/queries'
import { showToast } from '@/components/Toast'
import { showConnectDriveModal } from '@/components/ConnectDriveModal'

export type ExportSheetInput = {
  title:  string
  sheets: Array<{ name: string; headers: string[]; rows: any[][] }>
  // Optional human-readable name shown in the connect modal so the
  // user knows what they were trying to export ("Partner Report").
  exportName?: string
}

export type ExportSheetResult = {
  ok:    boolean
  url?:  string
  // If the export was halted because Drive isn't connected, the modal
  // is showing and the caller usually wants to do nothing further.
  halted?: 'not_connected' | 'grant_invalid'
}

export async function exportToSheet(input: ExportSheetInput): Promise<ExportSheetResult> {
  // Open popup synchronously inside the click handler — Safari requires
  // it. We point at about:blank and update the URL once the API returns.
  const popup = typeof window !== 'undefined' ? window.open('about:blank', '_blank') : null

  try {
    const res: any = await reportsApi.exportGoogleSheet({
      title:  input.title,
      sheets: input.sheets,
    })
    if (res?.url) {
      // Validate the URL protocol + host before navigating the popup.
      // The server builds this from `https://docs.google.com/spreadsheets/d/${id}/edit`
      // where `id` is Google-assigned, so realistically nothing else
      // can reach this branch — but a stray `javascript:` URL would
      // execute in the popup with our origin if we ever stop trusting
      // the server response. Cheap defense in depth.
      let safeUrl: string | null = null
      try {
        const u = new URL(res.url)
        if (u.protocol === 'https:' && u.hostname === 'docs.google.com') {
          safeUrl = u.toString()
        }
      } catch { /* fall through to error path */ }

      if (!safeUrl) {
        if (popup) popup.close()
        showToast.error('Export returned an unexpected URL. Check Drive manually.')
        return { ok: false }
      }

      if (popup) popup.location.href = safeUrl
      else showToast.success(`Sheet ready — popup blocked, link copied to clipboard.`)
      return { ok: true, url: safeUrl }
    }
    if (popup) popup.close()
    showToast.error('Sheet was created but no URL was returned. Check Drive manually.')
    return { ok: false }
  } catch (e: any) {
    if (popup) popup.close()

    // Pull the structured error our API returns. axios shape:
    //   e.response.data.errors[0].{code, message}
    const errs   = e?.response?.data?.errors || []
    const code   = errs?.[0]?.code    as string | undefined
    const apiMsg = errs?.[0]?.message as string | undefined

    if (code === 'NOT_CONNECTED') {
      showConnectDriveModal({ reason: 'not_connected', exportName: input.exportName })
      return { ok: false, halted: 'not_connected' }
    }
    if (code === 'GRANT_INVALID') {
      showConnectDriveModal({ reason: 'grant_invalid', exportName: input.exportName })
      return { ok: false, halted: 'grant_invalid' }
    }

    showToast.error('Export failed: ' + (apiMsg || e?.message || 'unknown error'))
    return { ok: false }
  }
}
