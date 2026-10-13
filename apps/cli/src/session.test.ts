import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createNodePlatform } from '@rivus/agent-kit/node'
import { afterEach, describe, expect, it } from 'vitest'
import { loadSession } from './session.ts'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'load-session-'))
  dirs.push(dir)
  return dir
}

/** A Claude Code session whose first record names a format generation no adapter reads. */
async function unknownGeneration(): Promise<string> {
  const dir = await tempDir()
  const path = join(dir, 'session.jsonl')
  await writeFile(path, `${JSON.stringify({ type: 'user', formatVersion: 2, uuid: 'u1', sessionId: 's-ug' })}\n`)
  return path
}

/** A Grok session directory whose summary names a chat format the adapter does not read. */
async function grokUnknownGeneration(): Promise<string> {
  const dir = await tempDir()
  await writeFile(join(dir, 'summary.json'), `${JSON.stringify({ chat_format_version: 2 })}\n`)
  await writeFile(join(dir, 'updates.jsonl'), '')
  return dir
}

describe('loadSession', () => {
  it('throws the unknown-generation wording, which the web parses into agent, file, and line', async () => {
    const path = await unknownGeneration()
    await expect(loadSession(path, { platform: createNodePlatform({ home: '/u/me', env: {} }) })).rejects.toThrow(
      `claude-code: ${path}:1: unknown format generation`,
    )
  })

  it('the ref’s agent routes the read even when detection would pick another adapter', async () => {
    const dir = await grokUnknownGeneration()
    // Named Claude Code, the Grok directory is read as a Claude file: the failure is Claude
    // Code's directory read failure (EISDIR), not Grok's summary handling — routing beat
    // detection, which would have picked Grok for this directory.
    await expect(
      loadSession({ agent: 'claude-code', path: dir }, { platform: createNodePlatform({ home: '/u/me', env: {} }) }),
    ).rejects.toThrow(/EISDIR/)
  })

  it('a ref naming an agent without an adapter fails with capability-unsupported wording', async () => {
    const path = await unknownGeneration()
    await expect(
      loadSession({ agent: 'nosuch', path }, { platform: createNodePlatform({ home: '/u/me', env: {} }) }),
    ).rejects.toThrow('no session adapter for nosuch')
  })

  it('a file no adapter recognizes fails detection with the ref label', async () => {
    const dir = await tempDir()
    const path = join(dir, 'notes.txt')
    await writeFile(path, 'not a session at all\n')
    await expect(loadSession(path, { platform: createNodePlatform({ home: '/u/me', env: {} }) })).rejects.toThrow(
      `No adapter accepted ${path}`,
    )
  })

  it('falls through a canonical head whose body is not JSON to the kit adapters', async () => {
    const dir = await tempDir()
    const path = join(dir, 'session.jsonl')
    // The head says "canonical agent-trace", the body is a Claude record. The schema parse
    // fails with SyntaxError, the file falls through to the kit adapters, and the canonical
    // first record is one no adapter reads — not a raw JSON parse error.
    await writeFile(
      path,
      `${JSON.stringify({ schema: 'agent-trace', truncated: true })}\n${JSON.stringify({
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-01-01T00:00:00.000Z',
        sessionId: 's-fall',
        cwd: '/work/app',
        message: { role: 'user', content: 'Run the fall-through checks' },
      })}\n`,
    )
    await expect(loadSession(path, { platform: createNodePlatform({ home: '/u/me', env: {} }) })).rejects.toThrow(
      `claude-code: ${path}:1: unknown format generation`,
    )
  })

  it('an aborted load rejects with the signal’s reason', async () => {
    const path = await unknownGeneration()
    const controller = new AbortController()
    const reason = new Error('stop reading')
    controller.abort(reason)
    await expect(
      loadSession(path, { platform: createNodePlatform({ home: '/u/me', env: {} }), signal: controller.signal }),
    ).rejects.toThrow(reason)
  })

  it('a missing file is named with its path#id label', async () => {
    const dir = await tempDir()
    const path = join(dir, 'missing.jsonl')
    await expect(
      loadSession(`${path}#s1`, { platform: createNodePlatform({ home: '/u/me', env: {} }) }),
    ).rejects.toThrow(`${path}#s1 does not exist`)
  })

  it('a canonical agent-trace file loads as the parsed file, originals included', async () => {
    const path = join(repo, 'fixtures/demo.trace.json')
    // No kit adapter accepts this file, so only the canonical fast path can return it.
    const expected: unknown = JSON.parse(await readFile(path, 'utf8'))
    const trace = await loadSession(path, { platform: createNodePlatform({ home: '/u/me', env: {} }) })
    expect(trace).toEqual(expected)
  })

  it('a real Claude Code fixture loads with its events and originals', async () => {
    const dir = await tempDir()
    const projects = join(dir, 'projects/app')
    await mkdir(projects, { recursive: true })
    await cp(
      join(repo, 'fixtures/sessions/claude-code/conformance/plain/session.jsonl'),
      join(projects, 'session.jsonl'),
    )
    const platform = createNodePlatform({ home: dir, env: {} })
    const trace = await loadSession(
      { agent: 'claude-code', path: join(projects, 'session.jsonl'), sessionId: 's' },
      { platform },
    )
    expect(trace.schema).toBe('agent-trace')
    expect(trace.agent.id).toBe('claude-code')
    expect(trace.events.length).toBeGreaterThan(0)
    expect(trace.events[0]!.original).toBeDefined()
  })
})
