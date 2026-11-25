import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lstat, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { createNodePlatform } from '@rivus/agent-kit/node'
import { describe, expect, it } from 'vite-plus/test'
import type { Trace } from '@rivus/estela-schema'
import { ExportPathError, defaultExportPath, exportOf, writeExport } from './write-export.ts'
import { loadSession } from '@rivus/estela-server'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '../../../..')
const fixture = (agent: string, relative: string): string =>
  join(repo, 'fixtures/sessions', agent, 'conformance', relative)
const platform = createNodePlatform()

/** Every fixture session of a registered agent, the conformance suite's list, with whether it exports. */
const FIXTURES: readonly (readonly [agent: string, relative: string, exports: boolean, sessionId?: string])[] = [
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
  ['pi', 'plain/session.jsonl', true],
  ['pi', 'compaction/session.jsonl', true],
  ['pi', 'unknown-type/session.jsonl', false],
  ['dsh', 'plain/session.v4.jsonl', true],
  ['dsh', 'compaction/session.v4.jsonl', true],
  ['dsh', 'unknown-type/session.v4.jsonl', false],
  ['opencode', 'opencode.db', true, 'ses_smoke'],
  ['gemini-cli', 'plain/chats/session-1.jsonl', true],
  ['gemini-cli', 'compaction/chats/session-1.jsonl', true],
  ['gemini-cli', 'message-update/chats/session-1.jsonl', true],
  ['gemini-cli', 'unknown-type/chats/session-1.jsonl', false],
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
  it('writes a redacted ATIF file and keeps content with ESTELA_REDACT=0', async () => {
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

  it('keeps every argument of a tool call whose input keys redact to the same text', async () => {
    const source = { file: 'f.jsonl', offset: 0, length: 1, line: 1 }
    const trace: Trace = {
      schema: 'estela',
      agent: 'test',
      session: { id: 's-arguments' },
      capabilities: [],
      agents: [{ id: 'main' }],
      events: [
        { id: 'p1', seq: 0, ts: 1, kind: 'user', payload: { text: 'read both' }, source },
        // Two token-shaped keys: each redacts to `[redacted]`, and only their suffix tells them apart.
        {
          id: 'c1',
          seq: 1,
          ts: 2,
          kind: 'tool_call',
          payload: {
            callId: 'x1',
            name: 'Read',
            args: { 'sk-aaaaaaaaaaaaaaaa/x.ts': 1, 'sk-bbbbbbbbbbbbbbbb/x.ts': 2 },
          },
          source,
        },
        { id: 'o1', seq: 2, ts: 3, kind: 'tool_result', payload: { callId: 'x1', output: 'ok' }, source },
      ],
      skipped: [],
    }
    const dir = mkdtempSync(join(tmpdir(), 'at-export-keys-'))
    try {
      const out = join(dir, 'redacted.json')
      await writeExport(trace, 'atif', out, true)
      const written = JSON.parse(readFileSync(out, 'utf8')) as { steps: { tool_calls?: { arguments: unknown }[] }[] }
      const calls = written.steps.flatMap(step => step.tool_calls ?? [])
      expect(calls.map(call => call.arguments)).toEqual([{ '[redacted]/x.ts': 1, '[redacted]/x.ts#2': 2 }])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exports every registered agent fixture to a structurally valid ATIF document', async () => {
    for (const [agent, relative, exports, sessionId] of FIXTURES) {
      const trace = await loadSession(
        { agent, path: fixture(agent, relative), ...(sessionId ? { sessionId } : {}) },
        { platform },
      )
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
      { key: 'service.name', value: { stringValue: 'estela' } },
    ])
    for (const span of value.resourceSpans[0]!.scopeSpans[0]!.spans) {
      expect(span.traceId).toMatch(/^[0-9a-f]{32}$/)
      expect(span.spanId).toMatch(/^[0-9a-f]{16}$/)
      expect(typeof span.startTimeUnixNano).toBe('string')
      expect(span.kind).toBeTypeOf('number')
    }
  })

  it('picks a fresh suffix when the default export path has a valid or dangling symlink', async () => {
    const trace = await claudeLoad('plain/session.jsonl')
    const dir = mkdtempSync(join(tmpdir(), 'at-export-sym-'))
    const previousCwd = process.cwd()
    try {
      process.chdir(dir)
      const victim = join(dir, 'victim.txt')
      writeFileSync(victim, 'untouched', 'utf8')
      const base = defaultExportPath(trace.session.id, 'atif')
      const second = base.replace(/\.atif\.json$/, '-2.atif.json')
      symlinkSync(victim, base)
      symlinkSync(join(dir, 'missing-target.txt'), second)

      await writeExport(trace, 'atif', undefined, true)
      const third = base.replace(/\.atif\.json$/, '-3.atif.json')
      expect(readFileSync(victim, 'utf8')).toBe('untouched')
      expect((await lstat(base)).isSymbolicLink()).toBe(true)
      expect((await lstat(second)).isSymbolicLink()).toBe(true)
      expect(JSON.parse(readFileSync(third, 'utf8')).schema_version).toBe('ATIF-v1.8')
    } finally {
      process.chdir(previousCwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses to overwrite a symlink passed via --out while overwriting regular files', async () => {
    const trace = await claudeLoad('plain/session.jsonl')
    const dir = mkdtempSync(join(tmpdir(), 'at-export-out-'))
    try {
      const victim = join(dir, 'victim.txt')
      writeFileSync(victim, 'keep-me', 'utf8')
      const symlinkOut = join(dir, 'out-link.json')
      symlinkSync(victim, symlinkOut)

      await expect(writeExport(trace, 'atif', symlinkOut, true)).rejects.toBeInstanceOf(ExportPathError)
      expect(readFileSync(victim, 'utf8')).toBe('keep-me')

      const regularOut = join(dir, 'regular.json')
      writeFileSync(regularOut, 'old-content', 'utf8')
      await writeExport(trace, 'otlp', regularOut, true)
      expect(JSON.parse(readFileSync(regularOut, 'utf8')).resourceSpans).toBeDefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
