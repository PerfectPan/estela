import { writeFile } from 'node:fs/promises'

/** One session transcript fixture, in the envelope the loader reads. */
export interface TranscriptFixture {
  readonly file: string
  readonly sessionId: string
  readonly capabilities: readonly string[]
  readonly agents: readonly unknown[]
  readonly events: readonly unknown[]
  readonly skipped?: readonly unknown[]
}

/** Writes a session transcript fixture file for an e2e run. */
export async function writeTranscriptFixture(fixture: TranscriptFixture): Promise<void> {
  await writeFile(
    fixture.file,
    JSON.stringify({
      schema: 'estela',
      agent: 'claude-code',
      session: { id: fixture.sessionId },
      capabilities: fixture.capabilities,
      agents: fixture.agents,
      events: fixture.events,
      skipped: fixture.skipped ?? [],
    }),
  )
}
