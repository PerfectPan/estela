import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Trace } from '@rivus/estela-schema'
import { assertTrace } from '@rivus/estela-schema'
import { describe, expect, it } from 'vite-plus/test'
import { writeDemoTrace } from './demo-trace.ts'

const committed = join(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/demo.trace.json')

describe('demo trace', () => {
  it('the committed fixtures/demo.trace.json is what the generator writes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'estela-demo-test-'))
    try {
      await writeDemoTrace(join(dir, 'demo.trace.json'))
      const fresh = await readFile(join(dir, 'demo.trace.json'), 'utf8')
      // On a mismatch, regenerate: node apps/cli/src/testsupport/demo-trace.ts fixtures/demo.trace.json
      expect(fresh === (await readFile(committed, 'utf8'))).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('has what the product shows: turns, a compaction, two subagent lanes, failures, hooks, snapshots', async () => {
    const value: unknown = JSON.parse(await readFile(committed, 'utf8'))
    assertTrace(value, committed)
    const trace: Trace = value
    const main = trace.events.filter(event => event.agentId === undefined)
    const count = (kind: string, events = trace.events) => events.filter(event => event.kind === kind).length
    expect(count('request', main)).toBeGreaterThanOrEqual(25)
    expect(count('request', main)).toBeLessThanOrEqual(40)
    expect(count('compaction')).toBe(1)
    expect(trace.agents.filter(agent => agent.parentId === 'main')).toHaveLength(2)
    expect(trace.events.filter(event => event.kind === 'tool_result' && event.payload.isError)).toHaveLength(3)
    expect(count('hook')).toBeGreaterThan(0)
    expect(trace.capabilities).toEqual(expect.arrayContaining(['systemPrompt', 'toolSchemas', 'subagents', 'hooks']))
    for (const event of trace.events) {
      if (event.kind === 'request') {
        expect(event.payload.model).toMatch(/^claude-/)
        expect(event.payload.usage?.cacheReadTokens).toBeTypeOf('number')
      }
    }
  })
})
