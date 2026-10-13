import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import type { LoadProgress } from '@rivus/agent-trace-rpc'
import { VIEW_BUDGET_BYTES } from '@rivus/agent-trace-kernel'
import { describe, expect, it } from 'vite-plus/test'
import { createTraceStore } from './trace-store.ts'
import { writeLargeCodexSession } from './testsupport/large-session.ts'

// S12 size budget (plan 1.3, 5.2). Opt-in: it writes about 350 MB to a temp directory.
//   AGENT_TRACE_SIZE_TEST=1 vp test src/size-budget.test.ts
// AGENT_TRACE_SIZE_REAL=<session file> measures a local session instead; only numbers are printed.
const enabled = process.env.AGENT_TRACE_SIZE_TEST === '1'
const realPath = process.env.AGENT_TRACE_SIZE_REAL
const MB = 1024 * 1024
const SIZE_REF = 'size-test'

/** An independent read of the source line (plain `node:fs`), not the store's source-pointer read. */
async function lineAt(path: string, offset: number, length: number): Promise<unknown> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, offset)
    return JSON.parse(buffer.toString('utf8')) as unknown
  } finally {
    await handle.close()
  }
}

async function measure(path: string) {
  const { store } = createTraceStore({
    redacts: true,
    resolve: ref => (ref === SIZE_REF ? { key: path, target: { path } } : undefined),
  })
  let peakRss = process.memoryUsage().rss
  const sampler = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss)
  }, 20)
  const started = performance.now()
  const progress: LoadProgress[] = []
  try {
    const handle = await store.open(SIZE_REF, {})
    handle.onProgress(item => progress.push(item))
    await handle.done
    const loadMs = performance.now() - started
    const view = await store.view(SIZE_REF)
    const viewMs = performance.now() - started - loadMs
    const payloadBytes = Buffer.byteLength(JSON.stringify(view))
    peakRss = Math.max(peakRss, process.memoryUsage().rss)
    return { store, view, loadMs, viewMs, payloadBytes, progress, peakRss, settledRss: process.memoryUsage().rss }
  } finally {
    clearInterval(sampler)
  }
}

function report(label: string, fileBytes: number, m: Awaited<ReturnType<typeof measure>>, shortened: number): void {
  console.log(
    `${label}: ${JSON.stringify({
      fileMB: +(fileBytes / 1e6).toFixed(1),
      events: m.view.trace.events.length,
      shortenedEvents: shortened,
      viewPayloadBytes: m.payloadBytes,
      viewPayloadMB: +(m.payloadBytes / 1e6).toFixed(2),
      maxString: m.view.trace.view?.maxString,
      withinBudget: m.view.trace.view?.withinBudget,
      loadMs: Math.round(m.loadMs),
      viewMs: Math.round(m.viewMs),
      peakRssMB: Math.round(m.peakRss / MB),
      settledRssMB: Math.round(m.settledRss / MB),
      progressUpdates: m.progress.length,
    })}`,
  )
}

describe.skipIf(!enabled)('S12 size budget', () => {
  it('opens a 350 MB Codex session with a view of at most 12 MB and loads full events on demand', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'at-s12-'))
    try {
      const session = writeLargeCodexSession(dir, { targetBytes: 350 * 1000 * 1000 })
      expect(session.bytes).toBeGreaterThanOrEqual(350 * 1000 * 1000)
      const m = await measure(session.path)
      const shortened = m.view.trace.events.filter(event => Array.isArray(event.payload.$truncated))
      report('synthetic', session.bytes, m, shortened.length)

      expect(m.payloadBytes).toBeLessThanOrEqual(VIEW_BUDGET_BYTES)
      expect(m.progress.length).toBeGreaterThan(1)
      expect(m.progress.at(-1)).toEqual({ bytesRead: session.bytes, totalBytes: session.bytes })
      expect(shortened.length).toBeGreaterThanOrEqual(session.longOutputs)

      const longest = m.view.trace.events.find(
        event => event.kind === 'tool_result' && event.payload.callId === session.longest.callId,
      )!
      expect(longest.payload.$truncated).toEqual([['output']])
      expect((longest.payload.output as string).length).toBe(m.view.trace.view!.maxString)
      expect(m.view.bytes).toBeLessThan(m.payloadBytes)
      const full = await m.store.event(SIZE_REF, longest.id)
      expect((full.payload.output as string).length).toBe(session.longest.length)
      expect(full.original).toEqual(await lineAt(session.path, full.source.offset, full.source.length))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 600_000)
})

describe.skipIf(!realPath)('S12 on a local session (numbers only)', () => {
  it('measures the view of a real session', async () => {
    const m = await measure(realPath!)
    const shortened = m.view.trace.events.filter(event => Array.isArray(event.payload.$truncated))
    report('real', statSync(realPath!).size, m, shortened.length)
    const sample = shortened.find(event => event.kind === 'tool_result') ?? shortened[0]
    if (sample) {
      const started = performance.now()
      const full = await m.store.event(SIZE_REF, sample.id)
      console.log(
        `real get-event: ${JSON.stringify({ ms: Math.round(performance.now() - started), fullEventMB: +(Buffer.byteLength(JSON.stringify(full)) / MB).toFixed(2), hasOriginal: full.original !== undefined })}`,
      )
    }
    expect(m.payloadBytes).toBeLessThanOrEqual(VIEW_BUDGET_BYTES)
  }, 600_000)
})
