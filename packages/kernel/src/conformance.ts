import type { Capability, Trace } from '@rivus/agent-trace-schema'
import type { TraceIO } from './io.ts'
import type { HostAdapter, SessionHead, SessionRef } from './host.ts'
import { describe, expect, it } from 'vitest'
import { countingIO } from './counting-io.ts'
import { fold, summaryOf } from './fold.ts'
import { asNumber, asRecord } from './jsonl.ts'
import { latestSnapshot, snapshotHasSystemPrompt, snapshotHasTools } from './prompt-snapshot.ts'
import { summarize } from './summarize.ts'

const ALL_CAPABILITIES: readonly Capability[] = [
  'requests',
  'usage',
  'durations',
  'thinking',
  'compaction',
  'compactionTokens',
  'subagents',
  'systemPrompt',
  'toolSchemas',
  'hooks',
]

/** Capabilities a trace lists by the presence of content in its own files, not by host. */
const PRESENCE_CAPABILITIES: readonly Capability[] = ['systemPrompt', 'toolSchemas']

const DISCOVER_BUDGET = 128 * 1024
const EDGE_BUDGET = 64 * 1024

export interface ConformanceSession {
  /** Session file `discover` must return. */
  path: string
  /** JSONL files that make up the session. Defaults to `[path]`. */
  files?: readonly string[]
  /** Non-empty JSONL records across `files`. */
  records: number
  /** Capabilities this session demonstrates. */
  capabilities: readonly Capability[]
}

export interface OversizedSession {
  /** Directory whose discover listing includes `file`. */
  root: string
  /** A session file larger than 128 KB. */
  file: string
}

export interface ConformanceFixtures {
  root: string
  io: TraceIO
  sessions: readonly ConformanceSession[]
  /** Generated in the test. Discover must read 64 KB from each end and not the whole file. */
  oversized?: OversizedSession
}

export interface ConformanceEvidence {
  /** Source of `scripts/check-browser-bundle.mjs`. */
  browserBundleSource: string
  /** Source of `.oxlintrc.json`. */
  oxlintSource: string
}

function isHead(value: SessionHead | { ref: SessionRef; error: string }): value is SessionHead {
  return 'lastActiveAt' in value
}

function filesOf(session: ConformanceSession): readonly string[] {
  return session.files ?? [session.path]
}

async function nonEmptyLines(io: TraceIO, file: string): Promise<number[]> {
  const lines: number[] = []
  for await (const line of io.lines(file)) {
    if (line.text.trim()) {
      lines.push(line.line)
    }
  }
  return lines
}

function capabilitySeen(trace: Trace, capability: Capability): boolean {
  switch (capability) {
    case 'requests':
      return trace.events.some(event => event.kind === 'request')
    case 'usage':
      return trace.events.some(event => event.kind === 'request' && asRecord(event.payload.usage) != null)
    case 'durations':
      return trace.events.some(
        event =>
          (event.kind === 'request' && asNumber(event.payload.durationMs) !== undefined)
          || (event.kind === 'system'
            && event.payload.type === 'turn_duration'
            && asNumber(event.payload.durationMs) !== undefined),
      )
    case 'thinking':
      return trace.events.some(event => event.kind === 'thinking')
    case 'compaction':
      return trace.events.some(event => event.kind === 'compaction')
    case 'compactionTokens':
      return trace.events.some(
        event =>
          event.kind === 'compaction'
          && (asNumber(event.payload.preTokens) !== undefined || asNumber(event.payload.postTokens) !== undefined),
      )
    case 'subagents':
      return trace.agents.some(agent => agent.parentId != null)
    case 'systemPrompt':
      return (
        (typeof trace.session.systemPrompt === 'string' && trace.session.systemPrompt.length > 0)
        || trace.agents.some(agent => typeof agent.systemPrompt === 'string' && agent.systemPrompt.length > 0)
        || latestSnapshot(trace.events, snapshotHasSystemPrompt) !== undefined
      )
    case 'toolSchemas':
      return trace.session.tools != null || latestSnapshot(trace.events, snapshotHasTools) !== undefined
    case 'hooks':
      return trace.events.some(event => event.kind === 'hook')
    default:
      return false
  }
}

/**
 * Host checks from plan section 3.2.
 *
 * Check 3 counts input records, not emitted events: one record may become
 * several events that share its source line (content blocks, the request
 * event). A record is accounted when that line is an event source or a
 * `skipped` entry.
 *
 * Check 5 requires `shadowedBy` to name a later compaction of the same agent.
 *
 * Check 9 does not import `node:*`. It reads the browser-bundle entry list and
 * the oxlint override that the caller passes in, which is how M1 keeps
 * `node:*` out of kernel, rpc, and the registered hosts.
 */
export function describeHostConformance(
  adapter: HostAdapter,
  fixtures: ConformanceFixtures,
  evidence: ConformanceEvidence,
): void {
  describe(`${adapter.id} conformance`, () => {
    it('discovers every fixture session within 128 KB per file', async () => {
      const counted = countingIO(fixtures.io)
      const found: string[] = []
      for await (const item of adapter.discover(fixtures.root, counted, {})) {
        expect(isHead(item), 'error' in item ? item.error : '').toBe(true)
        if (isHead(item)) {
          found.push(item.ref.path)
        }
      }
      expect(found.toSorted()).toEqual(fixtures.sessions.map(session => session.path).toSorted())
      for (const [path, bytes] of counted.snapshot()) {
        expect(bytes, path).toBeLessThanOrEqual(DISCOVER_BUDGET)
      }
    })

    it('loads the same event ids in the same order', async () => {
      for (const session of fixtures.sessions) {
        const ref: SessionRef = { host: adapter.id, path: session.path }
        const first = await adapter.load(ref, fixtures.io, {})
        const second = await adapter.load(ref, fixtures.io, {})
        expect(second.events.map(event => event.id)).toEqual(first.events.map(event => event.id))
      }
    })

    it('accounts for every input record', async () => {
      for (const session of fixtures.sessions) {
        const trace = await adapter.load({ host: adapter.id, path: session.path }, fixtures.io, {})
        const covered = new Map<string, Set<number>>()
        const mark = (file: string, line: number): void => {
          const lines = covered.get(file) ?? new Set<number>()
          lines.add(line)
          covered.set(file, lines)
        }
        for (const event of trace.events) {
          mark(event.source.file, event.source.line)
        }
        for (const skip of trace.skipped) {
          expect(skip.reason.length).toBeGreaterThan(0)
          mark(skip.file, skip.line)
        }
        let records = 0
        for (const file of filesOf(session)) {
          for (const line of await nonEmptyLines(fixtures.io, file)) {
            records += 1
            expect(covered.get(file)?.has(line), `${file}:${line}`).toBe(true)
          }
        }
        expect(records).toBe(session.records)
      }
    })

    it('pairs tool results or flags them orphan', async () => {
      for (const session of fixtures.sessions) {
        const trace = await adapter.load({ host: adapter.id, path: session.path }, fixtures.io, {})
        const seen = new Set<string>()
        for (const event of trace.events) {
          const callId = typeof event.payload.callId === 'string' ? event.payload.callId : undefined
          const agent = event.agentId ?? ''
          if (event.kind === 'tool_call' && callId) {
            seen.add(`${agent}\0${callId}`)
            continue
          }
          if (event.kind !== 'tool_result') {
            continue
          }
          const matched = callId != null && seen.has(`${agent}\0${callId}`)
          if (!matched) {
            expect(event.payload.orphan).toBe(true)
          } else {
            expect(event.payload.orphan).not.toBe(true)
          }
        }
      }
    })

    it('points shadowedBy at a later compaction', async () => {
      for (const session of fixtures.sessions) {
        const trace = await adapter.load({ host: adapter.id, path: session.path }, fixtures.io, {})
        const byId = new Map(trace.events.map(event => [event.id, event]))
        for (const event of trace.events) {
          if (!event.shadowedBy) {
            continue
          }
          const compaction = byId.get(event.shadowedBy)
          expect(compaction?.kind, event.id).toBe('compaction')
          expect(compaction!.seq).toBeGreaterThan(event.seq)
          expect(compaction?.agentId ?? '', event.id).toBe(event.agentId ?? '')
        }
      }
    })

    it('event ids are unique', async () => {
      for (const session of fixtures.sessions) {
        const trace = await adapter.load({ host: adapter.id, path: session.path }, fixtures.io, {})
        const ids = trace.events.map(event => event.id)
        expect(new Set(ids).size, session.path).toBe(ids.length)
      }
    })

    it('seq matches the event index', async () => {
      for (const session of fixtures.sessions) {
        const trace = await adapter.load({ host: adapter.id, path: session.path }, fixtures.io, {})
        trace.events.forEach((event, index) => {
          expect(event.seq, event.id).toBe(index)
        })
        for (let index = 1; index < trace.events.length; index++) {
          expect(trace.events[index]!.seq).toBeGreaterThan(trace.events[index - 1]!.seq)
        }
      }
    })

    it('keeps file order for the events of each source file', async () => {
      // A request event is exempt: hosts that log usage after the call place it
      // before the call's first output (plan 3.3), ahead of its own record.
      for (const session of fixtures.sessions) {
        const trace = await adapter.load({ host: adapter.id, path: session.path }, fixtures.io, {})
        const last = new Map<string, number>()
        for (const event of trace.events) {
          if (event.kind === 'request') {
            continue
          }
          const previous = last.get(event.source.file) ?? -1
          expect(event.source.offset, `${event.id} after offset ${previous}`).toBeGreaterThanOrEqual(previous)
          last.set(event.source.file, event.source.offset)
        }
      }
    })

    it('shadowedBy stays on the same agent', async () => {
      for (const session of fixtures.sessions) {
        const trace = await adapter.load({ host: adapter.id, path: session.path }, fixtures.io, {})
        const byId = new Map(trace.events.map(event => [event.id, event]))
        for (const event of trace.events) {
          if (!event.shadowedBy) {
            continue
          }
          const compaction = byId.get(event.shadowedBy)
          expect(compaction?.agentId ?? '', event.id).toBe(event.agentId ?? '')
        }
      }
    })

    it('reads at most 64 KB from each end of a large session', async () => {
      const oversized = fixtures.oversized
      expect(oversized, 'generated oversized session').toBeTruthy()
      if (!oversized) {
        return
      }
      const counted = countingIO(fixtures.io)
      const found: string[] = []
      for await (const item of adapter.discover(oversized.root, counted, {})) {
        expect(isHead(item), 'error' in item ? item.error : '').toBe(true)
        if (isHead(item)) {
          found.push(item.ref.path)
        }
      }
      expect(found).toContain(oversized.file)
      const bytes = counted.snapshot().get(oversized.file) ?? 0
      expect(bytes).toBeGreaterThan(64 * 1024)
      expect(bytes).toBeLessThanOrEqual(DISCOVER_BUDGET)
      const size = (await fixtures.io.stat(oversized.file))?.size ?? 0
      const ranges = counted.ranges().get(oversized.file) ?? []
      for (const range of ranges) {
        expect(range.end - range.start, `range ${range.start}-${range.end}`).toBeLessThanOrEqual(EDGE_BUDGET)
      }
      expect(
        ranges.some(range => range.end === size),
        'one read ends at end of file',
      ).toBe(true)
    })

    it('reads each source pointer back to original', async () => {
      for (const session of fixtures.sessions) {
        const trace = await adapter.load({ host: adapter.id, path: session.path }, fixtures.io, {})
        for (const event of trace.events) {
          const { file, offset, length } = event.source
          const bytes = await fixtures.io.readBytes(file, { start: offset, end: offset + length })
          const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
          expect(parsed).toEqual(event.original)
        }
      }
    })

    it('shows each claimed capability and no undeclared one', async () => {
      // A host declares what it can record; each trace lists what its own files
      // record (a subset), and never shows a capability it does not list.
      // `systemPrompt` and `toolSchemas` are listed exactly when present.
      const declared = new Set(adapter.capabilities)
      const claimed = new Set<Capability>()
      for (const session of fixtures.sessions) {
        const trace = await adapter.load({ host: adapter.id, path: session.path }, fixtures.io, {})
        const listed = new Set(trace.capabilities)
        for (const capability of listed) {
          expect(declared.has(capability), `${session.path} lists ${capability}`).toBe(true)
        }
        for (const capability of session.capabilities) {
          claimed.add(capability)
          expect(declared.has(capability), capability).toBe(true)
          expect(listed.has(capability), `${session.path} lists ${capability}`).toBe(true)
          expect(capabilitySeen(trace, capability), `${session.path} ${capability}`).toBe(true)
        }
        for (const capability of ALL_CAPABILITIES) {
          if (!declared.has(capability) || !listed.has(capability)) {
            expect(capabilitySeen(trace, capability), `${session.path} ${capability}`).toBe(false)
          }
        }
        // Content capabilities: a trace lists one exactly when its files contain that content.
        for (const capability of PRESENCE_CAPABILITIES) {
          expect(listed.has(capability), `${session.path} lists ${capability} iff it has one`).toBe(
            capabilitySeen(trace, capability),
          )
        }
      }
      for (const capability of adapter.capabilities) {
        expect(claimed.has(capability), capability).toBe(true)
      }
    })

    it('summarizes like fold(load())', async () => {
      for (const session of fixtures.sessions) {
        const ref: SessionRef = { host: adapter.id, path: session.path }
        const trace = await adapter.load(ref, fixtures.io, {})
        const summary = await summarize(adapter, ref, fixtures.io, {})
        expect(summary).toEqual(summaryOf(fold(trace)))
      }
    })

    it('is covered by the browser bundle and the oxlint node rule', () => {
      const entry = `packages/host-${adapter.id}/src/index.ts`
      const source = `packages/host-${adapter.id}/src/`
      expect(evidence.browserBundleSource).toContain(entry)
      expect(evidence.oxlintSource).toContain(source)
    })
  })
}
