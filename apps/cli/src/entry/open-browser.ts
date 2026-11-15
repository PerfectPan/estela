import { buildOtpAuthUrl } from 'devframe/node/auth'
import { open } from 'devframe/utils/open'

/**
 * Open the session browser (`traceId === undefined`) or one session's workspace (`?s=<traceId>`).
 * DevFrame's auth gate uses the URL fragment for its one-time code, so the trace id rides the
 * query string and the SPA moves it to `#/s/<traceId>` after it connects. The trace id is opaque;
 * no path is in the URL.
 */
export async function openBrowser(base: string, traceId: string | undefined, auth: boolean): Promise<void> {
  const target = traceId === undefined ? base : `${base}?s=${encodeURIComponent(traceId)}`
  try {
    await open(auth ? buildOtpAuthUrl(target) : target)
  } catch {
    // The terminal already printed the URL.
  }
}
