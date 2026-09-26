/** Node 20 can import this file. The CLI module is loaded only after the check. */
export function unsupportedNodeMessage(version) {
  const parts = String(version).split('.')
  const major = Number(parts[0])
  const minor = Number(parts[1])
  if (major < 22 || (major === 22 && minor < 18) || (major === 23 && minor < 6))
    return 'agent-trace requires Node.js 22.18 or later.'
  return null
}
