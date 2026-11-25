#!/usr/bin/env node
// Writes a started dsh v4 zstd session into a temporary DSH_HOME so `dsh web` shows the
// conversation View tabs without calling a model. Built solely from the repository's
// `fixtures/sessions/dsh/conformance/plain/session.v4.jsonl` fixture.
import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
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

function registerSessionInWorkspace(home, cwd, id, now) {
  const storagePath = join(home, 'storages', 'workspace.json')
  mkdirSync(dirname(storagePath), { recursive: true })
  const nowIso = new Date(now).toISOString()
  const workspaces = existsSync(storagePath)
    ? JSON.parse(readFileSync(storagePath, 'utf8'))
    : {
        unit: { name: 'workspace', version: 2 },
        global: {
          initialized: true,
          workspaceIds: [],
          archivedSessionIds: [],
          pinnedSessionIds: [],
        },
        tables: { workspaces: {} },
      }
  let workspace = Object.values(workspaces.tables.workspaces).find(entry => entry.path === cwd)
  if (workspace === undefined) {
    const workspaceId = randomUUID()
    workspace = {
      path: cwd,
      title: basename(cwd) || 'workspace',
      sessionIds: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    }
    workspaces.tables.workspaces[workspaceId] = workspace
    workspaces.global.workspaceIds.push(workspaceId)
    if (workspaces.global.defaultWorkspaceId === undefined) {
      workspaces.global.defaultWorkspaceId = workspaceId
    }
    workspaces.global.initialized = true
  }
  if (!workspace.sessionIds.includes(id)) {
    workspace.sessionIds.push(id)
    workspace.updatedAt = nowIso
  }
  writeFileSync(storagePath, `${JSON.stringify(workspaces, null, 2)}\n`)
}

function jsonEscapeInner(text) {
  return JSON.stringify(text).slice(1, -1)
}

function seedFromFixture({ home, cwd, fixturePath, title }) {
  const rawTextLines = readFileSync(fixturePath, 'utf8').split('\n').filter(Boolean)
  const rawHeader = rawTextLines[0] ? JSON.parse(rawTextLines[0]) : undefined
  if (!rawHeader || rawHeader.type !== 'session') {
    throw new Error(`fixture ${fixturePath} must start with a dsh session header`)
  }
  const sourceCwd = typeof rawHeader.cwd === 'string' && rawHeader.cwd.length > 0 ? rawHeader.cwd : undefined
  const id = `session-${randomUUID()}`
  const header = {
    ...rawHeader,
    id,
    cwd,
  }
  const escapedFrom = sourceCwd ? jsonEscapeInner(sourceCwd) : undefined
  const escapedTo = jsonEscapeInner(cwd)
  const events = rawTextLines.slice(1).map(line => {
    const rewritten = escapedFrom ? line.replaceAll(escapedFrom, escapedTo) : line
    const event = JSON.parse(rewritten)
    if (title !== undefined && event.type === 'session/title' && event.data) {
      event.data.title = title
    }
    return event
  })

  const lastSeq = events.reduce((max, event) => (typeof event.seq === 'number' ? Math.max(max, event.seq) : max), -1)
  const lastTurn = events.reduce(
    (max, event) => (event.data && typeof event.data.turn === 'number' ? Math.max(max, event.data.turn) : max),
    0,
  )
  const createdAt = typeof header.createdAt === 'number' ? header.createdAt : Date.now()
  const sessionDir = join(home, 'sessions', encodeWorkspaceDir(cwd), id)
  mkdirSync(sessionDir, { recursive: true })
  const logPath = join(sessionDir, 'session.v4.jsonl.zstd')
  writeFileSync(logPath, Buffer.concat([compressFrame([header]), compressFrame(events)]))
  registerSessionInWorkspace(home, cwd, id, createdAt)

  return {
    id,
    logPath,
    sessionDir,
    eventCount: events.length,
    lastSeq,
    lastTurn,
  }
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
 * @param {string} [options.fixturePath] - complete dsh v4 JSONL fixture to seed verbatim (with `cwd` rewritten)
 */
export function seedSession(options) {
  const { home, cwd: rawCwd, title, userText, repeats = 1, fixturePath } = options
  mkdirSync(rawCwd, { recursive: true })
  const cwd = realpathSync(rawCwd)
  if (fixturePath !== undefined) {
    return seedFromFixture({ home, cwd, fixturePath, title })
  }
  const effectiveTitle = title ?? 'Estela smoke session'
  const fixtureEvents = loadPlainFixtureEvents()
  const now = Date.now()
  const id = `session-${randomUUID()}`

  const SURFACE_TYPES = new Set([
    'system/message',
    'developer/message',
    'user/message',
    'assistant/message',
    'tool/result',
  ])
  let seq = -1
  let systemSeq = null
  const push = (list, type, data) => {
    seq += 1
    const entry = { type, seq, time: now + seq, data }
    if (SURFACE_TYPES.has(type)) {
      if (type === 'system/message' && systemSeq !== null) {
        entry.surfaceOp = { op: 'replace', startSeq: systemSeq, endSeq: systemSeq }
      } else {
        entry.surfaceOp = 'append'
      }
      if (type === 'system/message') {
        systemSeq = seq
      }
    }
    list.push(entry)
  }

  const events = []
  push(events, 'permission/preset', { preset: 'workspace-write' })
  push(events, 'sandbox/mode', { mode: 'workspace-write' })
  push(events, 'approval/policy', { policy: 'ask' })

  let turn = 0
  let step = 0
  let turnOpen = false
  let stepOpen = false
  let replacedUser = false

  const closeStep = () => {
    if (stepOpen) {
      push(events, 'step/end', { turn, step })
      stepOpen = false
    }
  }
  const closeTurn = () => {
    closeStep()
    if (turnOpen) {
      push(events, 'turn/end', { turn, reason: { kind: 'completed' } })
      turnOpen = false
    }
  }
  const openTurnAndStep = () => {
    closeTurn()
    turn += 1
    step = 1
    push(events, 'turn/start', { turn })
    turnOpen = true
    push(events, 'step/start', { turn, step })
    stepOpen = true
  }

  for (let cycle = 0; cycle < repeats; cycle += 1) {
    let sawUserInCycle = false
    for (const rawEvent of fixtureEvents) {
      if (rawEvent.type === 'session/title') {
        continue
      }
      if (rawEvent.type === 'system/message') {
        openTurnAndStep()
      } else if (rawEvent.type === 'user/message' && sawUserInCycle) {
        openTurnAndStep()
      }

      const data = structuredClone(rawEvent.data)
      if (rawEvent.type === 'request/header') {
        data.reason = cycle === 0 ? 'initial' : 'series'
      }
      if (rawEvent.type === 'user/message' && typeof data.id === 'string') {
        sawUserInCycle = true
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
        data.turn = turn
        data.step = step
        if (!Array.isArray(data.stream)) {
          data.stream = []
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
        data.turn = turn
        data.step = step
        if (data.message) {
          data.message.id = `tr-${cycle}-${seq + 1}`
          if (typeof data.message.toolCallId === 'string') {
            const nextCallId = `${data.message.toolCallId}-c${cycle}`
            data.message.toolCallId = nextCallId
            if (data.message.source) {
              data.message.source.callId = nextCallId
            }
            push(events, 'tool/call', {
              turn,
              step,
              callId: nextCallId,
              name: 'read',
              arguments: '{"path":"/u/me/a"}',
            })
          }
        }
      }
      if (rawEvent.type === 'system/message') {
        data.turn = turn
        data.step = step
        if (data.message) {
          data.message.id = `sys-c${cycle}`
          data.message.source = { kind: 'system-prompt' }
        }
      }

      push(events, rawEvent.type, data)
    }
  }

  closeTurn()
  push(events, 'session/title', { title: effectiveTitle, messageSeqs: [], source: { kind: 'user' } })

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
  registerSessionInWorkspace(home, cwd, id, now)

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
  const SURFACE_TYPES = new Set([
    'system/message',
    'developer/message',
    'user/message',
    'assistant/message',
    'tool/result',
  ])
  const next = (type, data) => {
    seq += 1
    const entry = { type, seq, time: now + seq, data }
    if (SURFACE_TYPES.has(type)) {
      entry.surfaceOp = 'append'
    }
    return entry
  }

  const frameEvents = [
    next('turn/start', { turn }),
    next('user/message', {
      role: 'user',
      content: [{ type: 'text', text: userText }],
      source: { kind: 'user' },
      id: `u-appended-${turn}`,
    }),
    next('step/start', { turn, step: 1 }),
    next('assistant/message', {
      turn,
      step: 1,
      stream: [],
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: assistantText }],
        source: { kind: 'model', provider: 'test', model: 'test-model' },
        id: `m-appended-${turn}`,
      },
      usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
    }),
    next('step/end', { turn, step: 1 }),
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
      fixture: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  if (values.help || !values.home || !values.cwd) {
    process.stdout.write(
      'Usage: node test/seed-session.mjs --home <DSH_HOME> --cwd <workspace path> [--title <t>] [--user-text <text>] [--repeats <n>] [--fixture <jsonl>]\n',
    )
    process.exit(values.help ? 0 : 1)
  }
  const seeded = seedSession({
    home: values.home,
    cwd: values.cwd,
    title: values.title,
    userText: values['user-text'],
    repeats: values.repeats ? Number(values.repeats) : 1,
    fixturePath: values.fixture,
  })
  process.stdout.write(`${JSON.stringify(seeded)}\n`)
}
