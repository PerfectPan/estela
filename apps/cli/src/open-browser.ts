import { buildOtpAuthUrl } from 'devframe/node/auth'
import { open } from 'devframe/utils/open'

/**
 * Open the workspace for one session. DevFrame's auth gate uses the URL fragment for its
 * one-time code, so the session ref rides `?s=<ref>` and the SPA moves it to `#/s/<ref>`
 * after it connects. The ref is opaque; no path is in the URL.
 */
export async function openBrowser(base: string, ref: string, auth: boolean): Promise<void> {
  const target = `${base}?s=${encodeURIComponent(ref)}`
  try {
    await open(auth ? buildOtpAuthUrl(target) : target)
  } catch {
    // The terminal already printed the URL.
  }
}
