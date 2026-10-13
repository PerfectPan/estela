export function splitSessionRef(path: string): { file: string; sessionId?: string } {
  const hash = path.lastIndexOf('#')
  if (hash <= 0) {
    return { file: path }
  }
  return { file: path.slice(0, hash), sessionId: path.slice(hash + 1) }
}
