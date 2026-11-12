import { writeFile } from 'node:fs/promises'

/**
 * A canonical trace for the cost scenarios: a main lane with two Claude Sonnet 4.5 requests that record cache reads
 * and writes, one request of a model no price table knows, and a subagent lane with one Claude Haiku 4.5 request.
 * Usage follows the kit's convention: `inputTokens` includes cache reads and writes.
 *
 * At the LiteLLM snapshot's prices (Sonnet 4.5: $3 in, $15 out, $0.30 cache read, $3.75 cache write; Haiku 4.5:
 * $1 in, $5 out) the priced requests cost $0.04035, $0.03045 and $0.006: $0.0768 in all, with 1 of 4 unpriced.
 */
export async function writeCostTrace(file: string): Promise<void> {
  const source = { file: 'synthetic', offset: 0, length: 1, line: 1 }
  const sonnet = 'claude-sonnet-4-5-20250929'
  const events = [
    { id: 'u1', kind: 'user', payload: { text: 'Find why the export is slow' } },
    {
      id: 'r1',
      kind: 'request',
      requestId: 'q1',
      payload: {
        model: sonnet,
        usage: { inputTokens: 26_200, cacheReadTokens: 20_000, cacheWriteTokens: 5000, outputTokens: 800 },
      },
    },
    { id: 'a1', kind: 'assistant', requestId: 'q1', payload: { text: 'I will look at the export path.' } },
    { id: 'spawn', kind: 'tool_call', requestId: 'q1', payload: { callId: 'spawn', name: 'Task', args: {} } },
    {
      id: 'r-sub',
      kind: 'request',
      agentId: 'sub',
      requestId: 'qs',
      payload: { model: 'claude-haiku-4-5', usage: { inputTokens: 4000, outputTokens: 400 } },
    },
    { id: 'a-sub', kind: 'assistant', agentId: 'sub', requestId: 'qs', payload: { text: 'The loop reads twice.' } },
    { id: 'result', kind: 'tool_result', payload: { callId: 'spawn', output: 'The loop reads twice.' } },
    { id: 'u2', kind: 'user', payload: { text: 'Fix it' } },
    {
      id: 'r2',
      kind: 'request',
      requestId: 'q2',
      payload: {
        model: sonnet,
        usage: { inputTokens: 27_300, cacheReadTokens: 26_000, cacheWriteTokens: 1000, outputTokens: 1200 },
      },
    },
    { id: 'a2', kind: 'assistant', requestId: 'q2', payload: { text: 'Fixed: one read per file.' } },
    { id: 'u3', kind: 'user', payload: { text: 'Summarize' } },
    {
      id: 'r3',
      kind: 'request',
      requestId: 'q3',
      payload: { model: 'claude-test', usage: { inputTokens: 500, outputTokens: 50 } },
    },
    { id: 'a3', kind: 'assistant', requestId: 'q3', payload: { text: 'Done.' } },
  ].map((event, seq) => ({
    ...event,
    seq,
    ts: Date.UTC(2026, 0, 1) + 7000 * seq,
    source: { ...source, line: seq + 1 },
  }))
  await writeFile(
    file,
    JSON.stringify({
      schema: 'estela',
      agent: 'claude-code',
      session: { id: 'cost-demo', title: 'Export speed', cwd: '/work/app' },
      capabilities: ['requests', 'usage', 'subagents'],
      agents: [{ id: 'main' }, { id: 'sub', parentId: 'main', spawnEventId: 'spawn', title: 'Explorer' }],
      events,
      skipped: [],
    }),
  )
}
