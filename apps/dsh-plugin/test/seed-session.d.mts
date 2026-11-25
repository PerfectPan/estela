export interface SeedSessionOptions {
  home: string
  cwd: string
  title?: string
  userText?: string
  repeats?: number
  fixturePath?: string
}

export interface SeededSession {
  id: string
  logPath: string
  sessionDir: string
  eventCount: number
  lastSeq: number
  lastTurn: number
}

export interface AppendTurnOptions {
  startSeq: number
  turn: number
  userText: string
  assistantText?: string
}

export interface AppendedTurn {
  lastSeq: number
  lastTurn: number
  addedEvents: number
}

export function seedSession(options: SeedSessionOptions): SeededSession
export function appendTurnFrame(logPath: string, options: AppendTurnOptions): AppendedTurn
