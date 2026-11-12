/** Node 20 can import this file. The CLI module is loaded only after the check. */
export function unsupportedNodeMessage(version) {
  const major = Number(String(version).split('.')[0])
  if (major < 24) {
    return 'estela requires Node.js 24 or later.'
  }
  return null
}
