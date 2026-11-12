import type { ReportTrace } from '@rivus/estela-rpc'
import type * as z from 'zod/mini'
import { describe, expect, expectTypeOf, it } from 'vite-plus/test'
import { parseReportTrace, type reportTraceSchema } from './report.ts'

const source = { file: '0', offset: 0, length: 1, line: 1 }

const report: ReportTrace = {
  trace: {
    schema: 'estela',
    agent: 'claude-code',
    session: { id: 's' },
    capabilities: ['requests'],
    agents: [{ id: 'main' }],
    events: [
      {
        id: 'c',
        seq: 0,
        ts: 1,
        kind: 'tool_call',
        payload: { callId: 'x', name: 'Bash', $truncated: [['args']] },
        source,
      },
    ],
    skipped: [],
    sourceFiles: ['/logs/s.jsonl'],
    view: { maxString: 4096, budgetBytes: 12_000_000, withinBudget: true },
  },
  summary: { turns: 1, contextShape: [1, 2] },
  events: [
    {
      id: 'c',
      seq: 0,
      ts: 1,
      kind: 'tool_call',
      payload: { callId: 'x', name: 'Bash', args: { command: 'ls' } },
      source,
      originalUnavailable: 'the file changed',
    },
  ],
  total: 1,
  truncated: false,
  locale: 'zh-CN',
}

const withField = (path: (copy: Record<string, unknown>) => void): string => {
  const copy: Record<string, unknown> = structuredClone({ ...report })
  path(copy)
  return JSON.stringify(copy)
}

describe('parseReportTrace', () => {
  it('accepts every ReportTrace, with the kit summary and any report locale', () => {
    type Accepted = z.input<typeof reportTraceSchema>
    expectTypeOf<ReportTrace['summary']>().toExtend<Accepted['summary']>()
    expectTypeOf<ReportTrace['locale']>().toExtend<Accepted['locale']>()
    expectTypeOf<ReportTrace>().toExtend<Accepted>()
  })

  it('reads a report as buildReport writes it, unchanged', () => {
    expect(parseReportTrace(JSON.stringify(report))).toEqual(report)
  })

  it('names the first field that does not match', () => {
    const view = { ...report.trace, events: [{ ...report.trace.events[0]!, payload: { name: 'Bash' } }] }
    expect(() => parseReportTrace(withField(copy => (copy.trace = view)))).toThrow(
      new TypeError('report-trace: trace.events.0.payload.callId: Invalid input'),
    )
    expect(() => parseReportTrace(withField(copy => (copy.summary = { turns: '1' })))).toThrow(
      new TypeError('report-trace: summary.turns: Invalid input'),
    )
    expect(() => parseReportTrace(withField(copy => (copy.locale = 'fr')))).toThrow(
      new TypeError('report-trace: locale: Invalid input'),
    )
    expect(() => parseReportTrace(withField(copy => delete copy.total))).toThrow(
      new TypeError('report-trace: total: Invalid input'),
    )
    expect(() =>
      parseReportTrace(withField(copy => (copy.events = [{ ...report.events[0]!, originalUnavailable: 1 }]))),
    ).toThrow(new TypeError('report-trace: events.0.originalUnavailable: Invalid input'))
  })

  it('leaves text that is not JSON to JSON.parse', () => {
    expect(() => parseReportTrace('{')).toThrow(SyntaxError)
  })
})
