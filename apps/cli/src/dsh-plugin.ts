/**
 * The managed dsh plugin: a single-file Cordis plugin that records a dsh run's lifecycle events
 * into `<dsh home>/agent-trace/<session id>.ndjson`, and the install/uninstall that registers it
 * in the home-level `~/.dsh/cordis.patch.yml` (which applies to every profile). The layout follows
 * the managed plugins agent-presence installs: a marker comments the managed file, and the patch
 * entry lives between two marker comments so a merge is idempotent and an uninstall is a clean
 * text removal. The two plugins coexist: each owns its own markers, and Cordis fans every event
 * out to every plugin.
 *
 * The plugin appends a record per event and never blocks dsh: writes run in the background and
 * swallow their own errors. The session adapter in `./dsh-plugin-adapter.ts` reads the files back.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'

export const DSH_TRACE_PLUGIN_FILE_NAME = 'agent-trace-dsh.mjs'
export const DSH_TRACE_PLUGIN_MARKER = '@rivus/agent-trace dsh plugin'

const DSH_TRACE_PATCH_START = '# agent-trace-dsh-plugin:start'
const DSH_TRACE_PATCH_END = '# agent-trace-dsh-plugin:end'

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
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return 'absent'
    }
    throw error
  }
  return body.includes(marker) ? 'managed' : 'unmanaged'
}

/** The patch entry: one `insert` of this plugin, between the marker comments. */
function pluginBlock(pluginPath: string): string {
  return `${DSH_TRACE_PATCH_START}
- insert:
    - id: agent-trace-dsh
      name: ${pluginPath}
${DSH_TRACE_PATCH_END}`
}

/** The body with this plugin's entry merged in, replacing any earlier entry the markers hold. */
export function withDshTracePatch(input: string, pluginPath: string): string {
  const block = pluginBlock(pluginPath)
  const start = input.indexOf(DSH_TRACE_PATCH_START)
  if (start === -1) {
    const trimmed = input.trimEnd()
    return trimmed ? `${trimmed}\n${block}\n` : `${block}\n`
  }
  const end = input.indexOf(DSH_TRACE_PATCH_END, start)
  const endAt = end === -1 ? input.length : end + DSH_TRACE_PATCH_END.length
  return `${input.slice(0, start)}${block}${input.slice(endAt)}`
}

/** The body without this plugin's entry, or `''` when nothing of it is left. */
export function withoutDshTracePatch(input: string): string {
  const start = input.indexOf(DSH_TRACE_PATCH_START)
  if (start === -1) {
    return input
  }
  const end = input.indexOf(DSH_TRACE_PATCH_END, start)
  if (end === -1) {
    return input
  }
  const before = input.slice(0, start).replace(/\n+$/, '')
  const after = input.slice(end + DSH_TRACE_PATCH_END.length).replace(/^\n+/, '')
  const result = `${before}\n\n${after}`.trim()
  return result ? `${result}\n` : ''
}

async function readTextFile(path: string, fallback: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return fallback
    }
    throw error
  }
}

/**
 * The plugin source. It subscribes to the Cordis lifecycle events agent-presence's bridge uses —
 * `agent/session-start`, `agent/status`, `session/event`, `tools/result`, `agent/turn-stopping`,
 * `agent/disposed` and `session/disposed` — and appends one record per event to the session's
 * `.ndjson` file. Records keep their original shapes: the adapter reads them back, so a format
 * the adapter does not know yet is still on disk.
 */
export function buildDshTracePluginSource(tracesDir: string): string {
  return `// ${DSH_TRACE_PLUGIN_MARKER}
//
// Records a dsh (DeepSeek harness) run into <dsh home>/agent-trace/<session id>.ndjson so
// @rivus/agent-trace can read the session: lifecycle events, model messages with their usage,
// and tool results. The file format is the events as dsh emits them, one JSON record per line.
//
// Generated by \`agent-trace dsh-plugin install\`. Do not edit by hand. Re-running the install
// overwrites this file; \`agent-trace dsh-plugin uninstall\` removes it.
import { appendFile, mkdir } from "node:fs/promises"
import { join } from "node:path"

const TRACES_DIR = ${JSON.stringify(tracesDir)}

let sessionId
let write = Promise.resolve()

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value
  }
  return undefined
}

/** One record: appended after every earlier one, and a write error never breaks dsh. */
function record(type, fields) {
  if (!sessionId) return
  const body = JSON.stringify({ v: 1, ts: new Date().toISOString(), type, ...fields })
  write = write.then(() => appendFile(join(TRACES_DIR, \`\${sessionId}.ndjson\`), \`\\n\${body}\`), () => {})
}

function sessionOf(agent) {
  const session = agent?.session
  const id = firstString(session?.header?.id, session?.id)
  return id === undefined ? undefined : { id, cwd: firstString(session?.header?.cwd) ?? process.cwd() }
}

export const name = "agent-trace-dsh"

export async function apply(ctx) {
  await mkdir(TRACES_DIR, { recursive: true, mode: 0o700 })

  ctx.on("agent/session-start", (payload) => {
    const session = sessionOf(payload?.agent)
    if (!session) return
    sessionId = session.id
    record("session_start", { cwd: session.cwd })
  })

  // 'running' opens the work a prompt started; 'idle' closes it. A one-shot (headless) run may
  // skip idle, so agent/disposed and session/disposed close the trace too.
  ctx.on("agent/status", (payload) => {
    if (payload?.status === "running") record("turn_started", {})
    else if (payload?.status === "idle") record("turn_ended", {})
  })

  ctx.on("session/event", (session, event) => {
    const type = event?.type
    if (type === undefined) return
    if (type === "assistant/message") {
      const usage = event.data?.usage
      record("assistant_message", {
        model: firstString(event.data?.message?.source?.model),
        ...(usage === undefined ? {} : { usage }),
      })
      return
    }
    record("session_event", { eventType: type })
  })

  ctx.on("tools/result", () => {
    record("tool_result", {})
  })

  ctx.on("agent/turn-stopping", () => {
    record("turn_ended", {})
  })

  const stop = () => {
    if (sessionId !== undefined) {
      record("session_end", {})
      sessionId = undefined
    }
  }
  ctx.on("agent/disposed", stop)
  ctx.on("session/disposed", stop)
}
`
}

export interface DshTraceInstallResult {
  status: 'installed'
  pluginPath: string
  patchPath: string
  patchUpdated: boolean
  patchError?: string
}

export interface DshTraceUninstallResult {
  status: 'removed' | 'skipped'
  pluginPath: string
  patchPath: string
  patchUpdated: boolean
  patchError?: string
}

/** Writes the plugin file and merges the patch entry. Refuses to touch an unmanaged plugin file. */
export async function installDshTracePlugin(paths: DshTracePluginPaths): Promise<DshTraceInstallResult> {
  const existing = await readManagedFile(paths.pluginPath, DSH_TRACE_PLUGIN_MARKER)
  if (existing === 'unmanaged') {
    throw new Error(
      `refusing to overwrite ${paths.pluginPath}: it is not managed by @rivus/agent-trace. `
        + 'Delete or rename that file, then rerun the install.',
    )
  }
  await mkdir(paths.tracesDir, { recursive: true, mode: 0o700 })
  await mkdir(join(paths.pluginPath, '..'), { recursive: true, mode: 0o700 })
  await writeFile(paths.pluginPath, buildDshTracePluginSource(paths.tracesDir), { mode: 0o600 })

  let patchUpdated = false
  let patchError: string | undefined
  try {
    const patch = await readTextFile(paths.patchPath, '')
    await writeFile(paths.patchPath, withDshTracePatch(patch, paths.pluginPath), { mode: 0o600 })
    patchUpdated = true
  } catch (error) {
    patchError = (error as NodeJS.ErrnoException).message
  }

  return { status: 'installed', pluginPath: paths.pluginPath, patchPath: paths.patchPath, patchUpdated, patchError }
}

/** Removes the plugin file and its patch entry. A missing plugin is a no-op, not an error. */
export async function uninstallDshTracePlugin(paths: DshTracePluginPaths): Promise<DshTraceUninstallResult> {
  const existing = await readManagedFile(paths.pluginPath, DSH_TRACE_PLUGIN_MARKER)
  let status: DshTraceUninstallResult['status'] = 'skipped'
  if (existing === 'managed') {
    await rm(paths.pluginPath, { force: true })
    status = 'removed'
  }

  let patchUpdated = false
  let patchError: string | undefined
  try {
    const patch = await readTextFile(paths.patchPath, '')
    const next = withoutDshTracePatch(patch)
    if (next) {
      await writeFile(paths.patchPath, next, { mode: 0o600 })
    } else {
      await rm(paths.patchPath, { force: true })
    }
    patchUpdated = true
  } catch (error) {
    patchError = (error as NodeJS.ErrnoException).message
  }

  return { status, pluginPath: paths.pluginPath, patchPath: paths.patchPath, patchUpdated, patchError }
}
