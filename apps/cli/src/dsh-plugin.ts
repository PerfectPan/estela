/**
 * Managed Cordis capture and registration. Each live session owns an append-only NDJSON file;
 * event callbacks enqueue writes, and dsh's session/flush checkpoint drains them. Marker pairs
 * limit installer edits to our registration block so other plugins retain their configuration.
 */

import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import * as z from 'zod/mini'
import { isSeq, parseDocument } from 'yaml'

export const DSH_TRACE_PLUGIN_FILE_NAME = 'agent-trace-dsh.mjs'
export const DSH_TRACE_PLUGIN_MARKER = '@rivus/agent-trace dsh plugin'

const DSH_TRACE_PATCH_START = '# agent-trace-dsh-plugin:start'
const DSH_TRACE_PATCH_END = '# agent-trace-dsh-plugin:end'
const missingFile = z.object({ code: z.literal('ENOENT') })

export interface DshTracePluginPaths {
  /** Where the single-file plugin is written, e.g. `~/.dsh/plugins/agent-trace-dsh.mjs`. */
  pluginPath: string
  /** The home-level cordis patch that registers it, e.g. `~/.dsh/cordis.patch.yml`. */
  patchPath: string
  /** Where the plugin records session traces, e.g. `~/.dsh/agent-trace`. */
  tracesDir: string
}

/** Resolve the plugin, patch and trace paths, honouring `DSH_HOME` and the test overrides. */
export function resolveDshTracePluginPaths(env: NodeJS.ProcessEnv = process.env): DshTracePluginPaths {
  const dshHome = env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return {
    pluginPath: env.DSH_AGENT_TRACE_PLUGIN_FILE ?? join(dshHome, 'plugins', DSH_TRACE_PLUGIN_FILE_NAME),
    patchPath: env.DSH_AGENT_TRACE_PATCH_FILE ?? join(dshHome, 'cordis.patch.yml'),
    tracesDir: env.DSH_AGENT_TRACE_DIR ?? join(dshHome, 'agent-trace'),
  }
}

type ManagedState = 'managed' | 'unmanaged' | 'absent'

/** Whether `path` holds the managed plugin: its body names the marker. */
async function readManagedFile(path: string, marker: string): Promise<ManagedState> {
  let body: string
  try {
    body = await readFile(path, 'utf8')
  } catch (error) {
    if (z.safeParse(missingFile, error).success) {
      return 'absent'
    }
    throw error
  }
  return body.includes(marker) ? 'managed' : 'unmanaged'
}

/** The patch entry: one `insert` of this plugin, between the marker comments. */
function pluginBlock(pluginPath: string, indent: string): string {
  const entry = `- insert:
    - id: agent-trace-dsh
      name: ${JSON.stringify(pluginPath)}`
  return `${DSH_TRACE_PATCH_START}\n${entry
    .split('\n')
    .map(line => indent + line)
    .join('\n')}\n${DSH_TRACE_PATCH_END}`
}

/** Validate the actual YAML sequence before mixing styles, while retaining foreign text and comments. */
function patchBody(input: string): { text: string; indent: string } {
  const doc = parseDocument(input)
  if (doc.errors.length > 0) {
    throw new Error('invalid Cordis patch YAML: ' + doc.errors[0]!.message)
  }
  if (doc.contents === null) {
    return { text: input, indent: '' }
  }
  if (!isSeq(doc.contents)) {
    throw new Error('the Cordis patch must be a YAML sequence')
  }
  const range = doc.contents.range
  if (doc.contents.flow) {
    if (doc.contents.items.length > 0) {
      throw new Error('refusing to rewrite a nonempty flow-style Cordis patch; use a block sequence before installing')
    }
    return { text: input.slice(0, range[0]) + input.slice(range[1]), indent: '' }
  }
  const start = input.lastIndexOf('\n', range[0] - 1) + 1
  return { text: input, indent: input.slice(start, range[0]) }
}

/** Refuse ambiguous boundaries rather than deleting adjacent plugins while repairing a patch. */
function patchRange(input: string): { start: number; end: number } | undefined {
  const starts = [...input.matchAll(/^# agent-trace-dsh-plugin:start\r?$/gm)]
  const ends = [...input.matchAll(/^# agent-trace-dsh-plugin:end\r?$/gm)]
  if (starts.length === 0 && ends.length === 0) {
    return undefined
  }
  const start = starts[0]?.index
  const end = ends[0]?.index
  if (starts.length !== 1 || ends.length !== 1 || start === undefined || end === undefined || end <= start) {
    throw new Error('invalid agent-trace plugin markers in the Cordis patch; repair the marker pair before retrying')
  }
  return { start, end: end + ends[0]![0].length }
}

/** The body with this plugin's entry merged in, replacing any earlier entry the markers hold. */
export function withDshTracePatch(input: string, pluginPath: string): string {
  const range = patchRange(input)
  const body = patchBody(input)
  const block = pluginBlock(pluginPath, body.indent)
  const next = range
    ? `${input.slice(0, range.start)}${block}${input.slice(range.end)}`
    : `${body.text}${body.text && !body.text.endsWith('\n') ? '\n' : ''}${block}\n`
  patchBody(next)
  return next
}

/** The body without this plugin's entry, or `''` when nothing of it is left. */
export function withoutDshTracePatch(input: string): string {
  const range = patchRange(input)
  if (!range) {
    return input
  }
  patchBody(input)
  const before = input.slice(0, range.start)
  const after = input.slice(range.end).replace(/^\r?\n/, '')
  const result = before + after
  if (!result.trim()) {
    return ''
  }
  const doc = parseDocument(result)
  if (doc.contents === null) {
    return `${result}${result.endsWith('\n') ? '' : '\n'}[]\n`
  }
  patchBody(result)
  return result
}

async function readTextFile(path: string, fallback: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (z.safeParse(missingFile, error).success) {
      return fallback
    }
    throw error
  }
}

/**
 * Standalone Cordis capture for the dsh agent/session/tools event interfaces. Event callbacks
 * enqueue immutable records; session/flush is the awaited durability checkpoint. Capture errors
 * stay local to the plugin so an unavailable trace directory cannot fail an agent turn.
 */
export function buildDshTracePluginSource(tracesDir: string): string {
  return `// ${DSH_TRACE_PLUGIN_MARKER}
// Generated by agent-trace dsh-plugin install; reinstall to update.
import { appendFile, mkdir } from "node:fs/promises"
import { join } from "node:path"

const TRACES_DIR = ${JSON.stringify(tracesDir)}
const started = new WeakSet()
const ended = new WeakSet()
let write = Promise.resolve()

/** Capture the destination before enqueuing: agents can run concurrently or be disposed. */
function append(session, type, fields) {
  const path = join(TRACES_DIR, encodeURIComponent(session.id) + ".ndjson")
  const body = JSON.stringify({ v: 1, ts: new Date().toISOString(), type, ...fields })
  write = write.then(() => appendFile(path, body + "\\n", { mode: 0o600 })).catch(() => { started.delete(session) })
}

/** A resumed session keeps its id; metadata is logged once per live Session object. */
function start(session) {
  if (!session || ended.has(session) || started.has(session)) { return }
  started.add(session)
  append(session, "session_start", { sessionId: session.id, cwd: session.header?.cwd })
}

function record(session, type, fields) {
  if (!session || ended.has(session)) { return }
  start(session)
  append(session, type, fields)
}

function stop(session) {
  if (!session || ended.has(session)) { return }
  record(session, "session_end", {})
  ended.add(session)
}

export const name = "agent-trace-dsh"

export async function apply(ctx) {
  await mkdir(TRACES_DIR, { recursive: true, mode: 0o700 }).catch(() => {})
  ctx.on("session/created", start)
  ctx.on("agent/created", ({ agent }) => start(agent.session))
  ctx.on("agent/status", ({ agent, status }) => {
    record(agent.session, "agent_status", { status })
  })
  ctx.on("session/event", (session, event) => {
    if (event.type === "turn/start") {
      record(session, "turn_started", { turn: event.data.turn })
    } else if (event.type === "turn/end") {
      record(session, "turn_ended", { turn: event.data.turn })
    } else if (event.type === "assistant/message") {
      record(session, "assistant_message", {
        model: event.data.message.source.model,
        usage: event.data.usage,
      })
    } else {
      record(session, "session_event", { eventType: event.type })
    }
  })
  ctx.on("tools/result", (exec, result) => {
    record(exec.agent?.session, "tool_result", { callId: exec.callId, name: exec.name, isError: result.isError })
  })
  ctx.on("agent/turn-stopping", ({ agent, turn }) => record(agent.session, "turn_stopping", { turn }))
  ctx.on("agent/disposed", ({ agent }) => record(agent.session, "agent_disposed", {}))
  ctx.on("session/disposed", session => stop(session))
  ctx.on("session/flush", () => write)
}
`
}

/** Atomic replacement would replace the link itself; leave linked dotfiles under their owner's control. */
async function refuseSymlink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw new Error('refusing to replace a symbolic link: ' + path)
    }
  } catch (error) {
    if (!z.safeParse(missingFile, error).success) {
      throw error
    }
  }
}

/** Replace a complete managed file in one rename, keeping existing configuration intact on write failure. */
async function replaceFile(path: string, body: string): Promise<void> {
  const temporary = path + '.' + randomUUID() + '.tmp'
  try {
    await writeFile(temporary, body, { mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

export interface DshTraceInstallResult {
  status: 'installed'
  pluginPath: string
  patchPath: string
  patchUpdated: boolean
}

export interface DshTraceUninstallResult {
  status: 'removed' | 'skipped'
  pluginPath: string
  patchPath: string
  patchUpdated: boolean
}

/** Writes the plugin file and merges the patch entry. Refuses to touch an unmanaged plugin file. */
export async function installDshTracePlugin(paths: DshTracePluginPaths): Promise<DshTraceInstallResult> {
  await refuseSymlink(paths.pluginPath)
  await refuseSymlink(paths.patchPath)
  const existing = await readManagedFile(paths.pluginPath, DSH_TRACE_PLUGIN_MARKER)
  if (existing === 'unmanaged') {
    throw new Error(
      `refusing to overwrite ${paths.pluginPath}: it is not managed by @rivus/agent-trace. `
        + 'Delete or rename that file, then rerun the install.',
    )
  }
  const patch = await readTextFile(paths.patchPath, '')
  const next = withDshTracePatch(patch, paths.pluginPath)
  await mkdir(paths.tracesDir, { recursive: true, mode: 0o700 })
  await mkdir(dirname(paths.pluginPath), { recursive: true, mode: 0o700 })
  await mkdir(dirname(paths.patchPath), { recursive: true, mode: 0o700 })
  await replaceFile(paths.pluginPath, buildDshTracePluginSource(paths.tracesDir))
  await replaceFile(paths.patchPath, next)
  return { status: 'installed', pluginPath: paths.pluginPath, patchPath: paths.patchPath, patchUpdated: patch !== next }
}

/** Removes the plugin file and its patch entry. A missing plugin is a no-op, not an error. */
export async function uninstallDshTracePlugin(paths: DshTracePluginPaths): Promise<DshTraceUninstallResult> {
  await refuseSymlink(paths.pluginPath)
  await refuseSymlink(paths.patchPath)
  const existing = await readManagedFile(paths.pluginPath, DSH_TRACE_PLUGIN_MARKER)
  const patch = await readTextFile(paths.patchPath, '')
  const next = withoutDshTracePatch(patch)
  if (patch !== next) {
    if (next) {
      await replaceFile(paths.patchPath, next)
    } else {
      await rm(paths.patchPath, { force: true })
    }
  }
  if (existing === 'managed') {
    await rm(paths.pluginPath, { force: true })
  }
  return {
    status: existing === 'managed' ? 'removed' : 'skipped',
    pluginPath: paths.pluginPath,
    patchPath: paths.patchPath,
    patchUpdated: patch !== next,
  }
}
