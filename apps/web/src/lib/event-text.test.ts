import type { TraceEvent } from '@rivus/estela-schema'
import { describe, expect, it } from 'vite-plus/test'
import { exitCode, isShortened, rowText, toolTarget } from './event-text.ts'

const source = { file: '0', offset: 0, length: 1, line: 1 }
const base = { id: 'e', seq: 0, ts: 1, source }

describe('toolTarget', () => {
  it('shows a string argument, the first target key, or an argv array', () => {
    expect(toolTarget('ls -la')).toBe('ls -la')
    expect(toolTarget({ description: 'later', command: 'git status' })).toBe('git status')
    expect(toolTarget({ command: '  ', file_path: 'src/a.ts' })).toBe('src/a.ts')
    expect(toolTarget({ cmd: ['git', 'log', '-1'] })).toBe('git log -1')
  })

  it('falls back to a JSON preview for anything else', () => {
    expect(toolTarget({ command: ['git', 1], other: true })).toBe('{"command":["git",1],"other":true}')
    expect(toolTarget(['a', 'b'])).toBe('["a","b"]')
    expect(toolTarget(42)).toBe('42')
    expect(toolTarget(undefined)).toBe('')
  })
})

describe('rowText', () => {
  it('reads each kind from its own payload fields', () => {
    const events: TraceEvent[] = [
      { ...base, kind: 'tool_result', payload: { callId: 'c', output: 'done' } },
      { ...base, kind: 'request', payload: { model: 'm', finishReason: 'end_turn' } },
      { ...base, kind: 'hook', payload: { type: 'hook_success', event: 'PreToolUse' } },
      { ...base, kind: 'unknown', payload: { type: 'mystery' } },
      { ...base, kind: 'system', payload: { durationMs: 5 } },
      { ...base, kind: 'compaction', payload: { trigger: 'auto' } },
    ]
    expect(events.map(rowText)).toEqual([
      { text: 'done' },
      { text: 'm · finish end_turn' },
      { text: 'PreToolUse' },
      { text: 'mystery' },
      { text: '{"durationMs":5}' },
      {},
    ])
  })
})

describe('isShortened and exitCode', () => {
  it('read the view marker and a tool result exit code', () => {
    const result: TraceEvent = {
      ...base,
      kind: 'tool_result',
      payload: { callId: 'c', exitCode: 2, $truncated: [['output']] },
    }
    expect(isShortened(result)).toBe(true)
    expect(isShortened({ ...result, payload: { callId: 'c', $truncated: [] } })).toBe(false)
    expect(isShortened(undefined)).toBe(false)
    expect(exitCode(result)).toBe(2)
    expect(exitCode({ ...base, kind: 'hook', payload: { type: 'h', exitCode: 1 } })).toBeUndefined()
  })
})
