export interface TraceIO {
  readText: (path: string) => Promise<string>
  /** `end` is exclusive. */
  readBytes: (path: string, range?: { start: number; end: number }) => Promise<Uint8Array>
  list: (dir: string) => Promise<{ name: string; kind: 'file' | 'dir' }[]>
  /** `null` when the path does not exist. */
  stat: (path: string) => Promise<{ kind: 'file' | 'dir'; size: number; mtimeMs: number } | null>
  /** Iterate lines with their byte offsets; used to build source pointers. */
  lines: (
    path: string,
    opts?: { signal?: AbortSignal },
  ) => AsyncIterable<{ text: string; offset: number; length: number; line: number }>
}

export interface HostEnv {
  homeDir: string
  env: Readonly<Record<string, string | undefined>>
}
