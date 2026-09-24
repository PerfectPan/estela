/** Posix `/` join. Host paths in this release use `/`. */
export function joinPath(...parts: string[]): string {
  let out = ''
  for (const part of parts) {
    if (!part)
      continue
    if (!out) {
      out = part
      continue
    }
    const left = out.endsWith('/') ? out.slice(0, -1) : out
    const right = part.startsWith('/') ? part.slice(1) : part
    out = `${left}/${right}`
  }
  return out
}

export function basenamePath(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? path : path.slice(slash + 1)
}

export function dirnamePath(path: string): string {
  const slash = path.lastIndexOf('/')
  if (slash < 0)
    return '.'
  if (slash === 0)
    return '/'
  return path.slice(0, slash)
}
