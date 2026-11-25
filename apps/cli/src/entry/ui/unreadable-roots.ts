import type { SessionCatalog, UnreadableRoot } from '@rivus/estela-server'
import { sanitizeInline } from '../failure.ts'

const PERMISSION_CODES: ReadonlySet<string> = new Set(['EACCES', 'EPERM'])

/** `<agent> <root> (<reason>); its sessions are not listed.` followed by the fix for that reason. */
export function unreadableRootLine(root: UnreadableRoot): string {
  const denied = root.code !== undefined && PERMISSION_CODES.has(root.code)
  const fix = denied
    ? 'Check that your user can read this folder and the ones above it.'
    : 'Check that this folder can be reached.'
  return `${sanitizeInline(root.displayName)} ${sanitizeInline(root.path)} (${sanitizeInline(root.reason)}); its sessions are not listed. ${fix}`
}

/**
 * Says each agent root the `discover` pass could not reach. The paths come from the catalog with `~`.
 * When the rows came from the index, the pass runs on behind the ready line, so they are said once it
 * is done; a pass that fails there says the roots it had reached, as the list keeps the index's rows.
 */
export function sayUnreadableRoots(
  catalog: Pick<SessionCatalog, 'startedFromIndex' | 'unreadableRoots' | 'discovered'>,
  say: (root: UnreadableRoot) => void,
): void {
  const warn = () => {
    for (const root of catalog.unreadableRoots) {
      say(root)
    }
  }
  if (catalog.startedFromIndex) {
    void catalog.discovered().then(warn, warn)
    return
  }
  warn()
}
