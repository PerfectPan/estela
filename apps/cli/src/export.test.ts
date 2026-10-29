import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createNodePlatform } from '@rivus/agent-kit/node'
import { describe, expect, it } from 'vite-plus/test'
import type { Trace } from '@rivus/agent-trace-schema'
import { exportOf, writeExport } from './export.ts'
import { loadSession } from './session.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '../../..')
const fixture = (agent: string, relative: string): string =>
  join(repo, 'fixtures/sessions', agent, 'conformance', relative)
const platform = createNodePlatform()

/** Every fixture session of a registered agent, the conformance suite's list, with whether it exports. */
const FIXTURES: readonly (readonly [agent: string, relative: string, exports: boolean])[] = [
  ['claude-code', 'plain/session.jsonl', true],
  ['claude-code', 'compaction/session.jsonl', true],
  ['claude-code', 'subagent/session.jsonl', true],
  ['claude-code', 'unknown-type/session.jsonl', true],
  ['claude-code', 'regroup/session.jsonl', true],
  ['claude-code', 'prompt-snapshot/session.jsonl', true],
  ['codex', 'rollout-plain.jsonl', true],
  ['codex', 'rollout-token-count.jsonl', true],
  ['codex', 'rollout-compaction.jsonl', true],
  ['codex', 'rollout-subagent.jsonl', true],
  ['codex', 'rollout-unknown.jsonl', true],
  ['grok', 'plain/updates.jsonl', true],
  ['grok', 'compaction/updates.jsonl', true],
  ['grok', 'subagent/updates.jsonl', true],
  // Only an unrecognized record: no step ATIF could hold, and no session prompt to fall back on.
  ['grok', 'unknown-type/updates.jsonl', false],
]

const claudeLoad = async (relative: string): Promise<Trace> =>
  loadSession({ agent: 'claude-code', path: fixture('claude-code', relative) }, { platform })

/**
 * The structural rules of ATIF v1.8 that the exporter must hold on every input, the
 * checks Harbor's Pydantic models perform (`extra: forbid`, sequential step ids,
 * in-step `source_call_id`, agent-only fields, embedded trajectory ids). The real
 * validator runs separately (`scripts/validate-exports.mjs`); this keeps the shape
 * covered where Python is not.
 */
function checkAtif(trajectory: Record<string, unknown>, embedded: boolean): void {
  expect(trajectory.schema_version).toBe('ATIF-v1.8')
  const agent = trajectory.agent
  expect(agent).toBeTypeOf('object')
  expect(typeof (agent as Record<string, unknown>).name).toBe('string')
  expect(typeof (agent as Record<string, unknown>).version).toBe('string')
  const steps = trajectory.steps as Record<string, unknown>[]
  expect(Array.isArray(steps)).toBe(true)
  expect(steps.length).toBeGreaterThan(0)
  const callIdsByStep: Set<string>[] = []
  for (const [index, step] of steps.entries()) {
    expect(step.step_id).toBe(index + 1)
    expect(['system', 'user', 'agent']).toContain(step.source)
    if (step.source !== 'agent') {
      for (const field of ['model_name', 'reasoning_content', 'tool_calls', 'metrics']) {
        expect(step[field]).toBeUndefined()
      }
    }
    const calls = (step.tool_calls ?? []) as { tool_call_id: string; arguments: unknown }[]
    expect(
      calls.every(
        call =>
          call.arguments !== null
          && typeof call.arguments === 'object'
          && !Array.isArray(call.arguments)
          && typeof call.tool_call_id === 'string',
      ),
    ).toBe(true)
    callIdsByStep.push(new Set(calls.map(call => call.tool_call_id)))
    const results = ((step.observation as { results?: unknown[] } | undefined)?.results ?? []) as {
      source_call_id?: string
    }[]
    for (const result of results) {
      expect(result.source_call_id === undefined || callIdsByStep[index]!.has(result.source_call_id)).toBe(true)
    }
    const timestamp = step.timestamp
    if (timestamp !== undefined) {
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    }
  }
  if (embedded) {
    expect(typeof trajectory.trajectory_id).toBe('string')
  }
  const subagents = (trajectory.subagent_trajectories ?? []) as Record<string, unknown>[]
  const ids = subagents.map(subagent => subagent.trajectory_id)
  for (const subagent of subagents) {
    expect(typeof subagent.trajectory_id).toBe('string')
    checkAtif(subagent, true)
  }
  expect(new Set(ids).size).toBe(ids.length)
}

describe('export', () => {
  it('writes a redacted ATIF file and keeps content with AGENT_TRACE_REDACT=0', async () => {
    const trace = await claudeLoad('plain/session.jsonl')
    const dir = mkdtempSync(join(tmpdir(), 'at-export-'))
    try {
      const redacted = await writeExport(trace, 'atif', join(dir, 'redacted.json'), true)
      expect(redacted).toBeTruthy()
      const text = readFileSync(join(dir, 'redacted.json'), 'utf8')
      expect(text).not.toMatch(/sk-[A-Za-z0-9_]{10,}/)
      const open = await writeExport(trace, 'atif', join(dir, 'open.json'), false)
      expect(open).toBeTruthy()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exports every registered agent fixture to a structurally valid ATIF document', async () => {
    for (const [agent, relative, exports] of FIXTURES) {
      const trace = await loadSession({ agent, path: fixture(agent, relative) }, { platform })
      if (!exports) {
        expect(() => exportOf(trace, 'atif')).toThrow('No events an ATIF step can come from')
        continue
      }
      const value = exportOf(trace, 'atif') as Record<string, unknown>
      checkAtif(value, false)
    }
  })

  it('exports the demo canonical file with the compaction convention', async () => {
    const bytes = await readFile(join(repo, 'fixtures/demo.trace.json'), 'utf8')
    const trace = JSON.parse(bytes) as Trace
    const value = exportOf(trace, 'atif') as {
      steps: { source: string; extra?: { context_management?: Record<string, unknown> } }[]
    }
    const boundary = value.steps.find(step => step.extra?.context_management !== undefined)
    expect(boundary?.extra?.context_management).toEqual({ type: 'compaction', boundary: 'replace' })
  })

  it('produces an OTLP request whose ids and times follow the OTLP JSON rules', async () => {
    const trace = await claudeLoad('plain/session.jsonl')
    const value = exportOf(trace, 'otlp') as {
      resourceSpans: { resource: { attributes: unknown[] }; scopeSpans: { spans: Record<string, unknown>[] }[] }[]
    }
    expect(value.resourceSpans).toHaveLength(1)
    expect(value.resourceSpans[0]!.resource.attributes).toEqual([
      { key: 'service.name', value: { stringValue: 'agent-trace' } },
    ])
    for (const span of value.resourceSpans[0]!.scopeSpans[0]!.spans) {
      expect(span.traceId).toMatch(/^[0-9a-f]{32}$/)
      expect(span.spanId).toMatch(/^[0-9a-f]{16}$/)
      expect(typeof span.startTimeUnixNano).toBe('string')
      expect(span.kind).toBeTypeOf('number')
    }
  })
})
