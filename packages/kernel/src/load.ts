import { readFile } from 'node:fs/promises'
import { isTrace, type Trace } from '@agent-trace/schema'

export interface Adapter {
  id: string
  detect: (path: string) => Promise<boolean>
  load: (path: string) => Promise<Trace>
}

export class UnsupportedTraceError extends Error {
  constructor(path: string) {
    super(`No adapter accepted ${path}. Use a canonical ${'`'}agent-trace/v0${'`'} JSON file, or an implemented host adapter.`)
    this.name = 'UnsupportedTraceError'
  }
}

/** Load a canonical JSON trace. Host adapters wrap this after they normalize. */
export async function loadCanonicalJson(path: string): Promise<Trace> {
  const text = await readFile(path, 'utf8')
  const value: unknown = JSON.parse(text)
  if (!isTrace(value))
    throw new Error(`${path} is not an agent-trace/v0 document`)
  return value
}

export async function loadTrace(path: string, adapters: readonly Adapter[] = []): Promise<Trace> {
  try {
    return await loadCanonicalJson(path)
  }
  catch (error) {
    if (adapters.length === 0)
      throw error
  }

  for (const adapter of adapters) {
    if (await adapter.detect(path))
      return adapter.load(path)
  }
  throw new UnsupportedTraceError(path)
}
