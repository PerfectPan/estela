#!/usr/bin/env node
// Writes a started dsh v4 zstd session into a temporary DSH_HOME so `dsh web` shows the
// conversation View tabs without calling a model. Built solely from the repository's
// `fixtures/sessions/dsh/conformance/plain/session.v4.jsonl` fixture.
import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { zstdCompressSync } from 'node:zlib'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '../../..')
const plainFixturePath = join(repoRoot, 'fixtures/sessions/dsh/conformance/plain/session.v4.jsonl')

function compressFrame(lines) {
  return zstdCompressSync(Buffer.from(`${lines.map(entry => JSON.stringify(entry)).join('\n')}\n`))
}

function encodeWorkspaceDir(cwd) {
  return `--${cwd.slice(1).replaceAll('/', '-')}--`
}

function loadPlainFixtureEvents() {
  return readFileSync(plainFixturePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .slice(1)
    .map(line => JSON.parse(line))
}

/**
 * Seeds one started dsh session into `home` and registers it in `storages/workspace.json`
 * under `cwd`.
 *
 * @param {object} options
 * @param {string} options.home - temporary `DSH_HOME` directory
 * @param {string} options.cwd - workspace path already present in `storages/workspace.json`
 * @param {string} [options.title] - session title recorded in `session/title`
 * @param {string} [options.userText] - replaces the first user prompt text (e.g. with fake HOME for DSH-10)
 * @param {number} [options.repeats] - number of fixture cycles to emit with contiguous seqs (for DSH-7)
 */
export function seedSession(options) {
  const { home, cwd, title = 'Estela smoke session', userText, repeats = 1 } = options
  const fixtureEvents = loadPlainFixtureEvents()
  const now = Date.now()
  const id = `session-${randomUUID()}`

  let seq = -1
  const push = (list, type, data) => {
    seq += 1
    list.push({ type, seq, time: now + seq, data })
  }

  const events = []
  push(events, 'permission/preset', { preset: 'workspace-write' })
  push(events, 'sandbox/mode', { mode: 'workspace-write' })
  push(events, 'approval/policy', { policy: 'ask' })

  let turn = 0
  let replacedUser = false
  for (let cycle = 0; cycle < repeats; cycle += 1) {
    for (const rawEvent of fixtureEvents) {
      if (rawEvent.type === 'session/title') {
        continue
      }
      if (rawEvent.type === 'system/message') {
        if (turn > 0) {
          push(events, 'turn/end', { turn, reason: { kind: 'completed' } })
        }
        turn += 1
        push(events, 'turn/start', { turn })
      }

      const data = structuredClone(rawEvent.data)
      if (rawEvent.type === 'user/message' && typeof data.id === 'string') {
        data.id = `${data.id}-c${cycle}`
        if (
          userText !== undefined
          && (!replacedUser || cycle === repeats - 1)
          && Array.isArray(data.content)
          && data.content[0]
        ) {
          data.content[0].text = userText
          replacedUser = true
        }
      }
      if (rawEvent.type === 'assistant/message') {
        if (typeof data.turn === 'number') {
          data.turn = turn
        }
        if (data.message && typeof data.message.id === 'string') {
          data.message.id = `${data.message.id}-c${cycle}`
        }
        if (data.message && Array.isArray(data.message.content)) {
          for (const block of data.message.content) {
            if (block.type === 'tool-call' && typeof block.id === 'string') {
              block.id = `${block.id}-c${cycle}`
            }
          }
        }
      }
      if (rawEvent.type === 'tool/result') {
        if (typeof data.turn === 'number') {
          data.turn = turn
        }
        if (typeof data.toolCallId === 'string') {
          data.toolCallId = `${data.toolCallId}-c${cycle}`
        }
        if (data.message && data.message.source && typeof data.message.source.callId === 'string') {
          data.message.source.callId = `${data.message.source.callId}-c${cycle}`
        }
      }
      if (rawEvent.type === 'system/message' && typeof data.turn === 'number') {
        data.turn = turn
      }

      push(events, rawEvent.type, data)
    }
  }

  push(events, 'turn/end', { turn, reason: { kind: 'completed' } })
  push(events, 'session/title', { title })

  const header = {
    type: 'session',
    version: 4,
    id,
    createdAt: now,
    cwd,
    isSeeded: false,
    delegationDepth: 0,
    agentPreset: 'standard',
  }

  const sessionDir = join(home, 'sessions', encodeWorkspaceDir(cwd), id)
  mkdirSync(sessionDir, { recursive: true })
  const logPath = join(sessionDir, 'session.v4.jsonl.zstd')
  writeFileSync(logPath, Buffer.concat([compressFrame([header]), compressFrame(events)]))

  const storagePath = join(home, 'storages', 'workspace.json')
  const workspaces = JSON.parse(readFileSync(storagePath, 'utf8'))
  const workspace = Object.values(workspaces.tables.workspaces).find(entry => entry.path === cwd)
  if (workspace === undefined) {
    throw new Error(`no workspace with path ${cwd} in ${storagePath}; start dsh web once first`)
  }
  if (!workspace.sessionIds.includes(id)) {
    workspace.sessionIds.push(id)
  }
  writeFileSync(storagePath, `${JSON.stringify(workspaces, null, 2)}\n`)

  return {
    id,
    logPath,
    sessionDir,
    eventCount: events.length,
    lastSeq: seq,
    lastTurn: turn,
  }
}

/**
 * Appends one valid zstd frame containing a new user/assistant turn to an existing seeded log
 * (used by DSH-9 to simulate a running session writing new events after the View loaded).
 */
export function appendTurnFrame(logPath, options) {
  const { startSeq, turn, userText, assistantText = 'appended reply' } = options
  const now = Date.now()
  let seq = startSeq - 1
  const next = (type, data) => {
    seq += 1
    return { type, seq, time: now + seq, data }
  }

  const frameEvents = [
    next('turn/start', { turn }),
    next('user/message', {
      role: 'user',
      content: [{ type: 'text', text: userText }],
      source: { kind: 'user' },
      id: `u-appended-${turn}`,
    }),
    next('assistant/message', {
      turn,
      step: 1,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: assistantText }],
        source: { kind: 'model', provider: 'test', model: 'test-model' },
        id: `m-appended-${turn}`,
      },
      usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
    }),
    next('turn/end', { turn, reason: { kind: 'completed' } }),
  ]

  appendFileSync(logPath, compressFrame(frameEvents))
  return { lastSeq: seq, lastTurn: turn, addedEvents: frameEvents.length }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { values } = parseArgs({
    options: {
      home: { type: 'string' },
      cwd: { type: 'string' },
      title: { type: 'string' },
      'user-text': { type: 'string' },
      repeats: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  if (values.help || !values.home || !values.cwd) {
    process.stdout.write(
      'Usage: node test/seed-session.mjs --home <DSH_HOME> --cwd <workspace path> [--title <t>] [--user-text <text>] [--repeats <n>]\n',
    )
    process.exit(values.help ? 0 : 1)
  }
  const seeded = seedSession({
    home: values.home,
    cwd: values.cwd,
    title: values.title,
    userText: values['user-text'],
    repeats: values.repeats ? Number(values.repeats) : 1,
  })
  process.stdout.write(`${JSON.stringify(seeded)}\n`)
}
