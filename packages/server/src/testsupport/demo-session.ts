import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { paginationTurns } from './demo-story-build.ts'
import { shipTurns } from './demo-story-ship.ts'
import { SessionWriter } from './demo-writer.ts'

/**
 * The demo session: a Claude Code session on an invented book catalog API (tinyshelf). Five user
 * turns and 34 main requests whose context grows until the user runs `/compact`, two subagent lanes
 * (Explore and a migration review), three failed tool calls, hooks, and prompt snapshots (the
 * system prompt before the first request, the tool list after it; the subagents record none, so
 * their "Model saw" shows those slots as unavailable). Shared by `demo-trace.ts`, which writes
 * the bundled `fixtures/demo.trace.json`, and the e2e demo home, which runs this file by path.
 * Everything is invented; the same `cwd` always gives the same bytes.
 */
const DEMO_MODEL = 'claude-sonnet-5'
const DEMO_SUBAGENT_MODEL = 'claude-haiku-4-5-20251001'
const DEMO_SESSION_ID = '7c3e9a52-4f1d-4b8e-9d26-0a5be1c4f873'
/** 2026-11-10 09:12 UTC. */
const START = Date.UTC(2026, 10, 10, 9, 12, 0)

const SYSTEM_PROMPT = [
  'You are Claude Code, an interactive command line tool that helps users with software engineering tasks.',
  'Prefer small, reviewable changes. Run the tests that cover a change before you report it as done.',
]

const TOOLS = ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob', 'Task'].map(name => ({
  name,
  description: `${name} tool`,
  schema: {
    name,
    description: `${name} tool`,
    input_schema: { type: 'object', properties: name === 'Bash' ? { command: { type: 'string' } } : {} },
  },
}))

function story(writer: SessionWriter, cwd: string): void {
  const main = writer.main
  main.title('Add cursor pagination to /books')
  main.snapshot(SYSTEM_PROMPT)
  main.hook('SessionStart', 'startup', undefined, 'branch: main (clean)')

  paginationTurns(writer, cwd, { subagent: DEMO_SUBAGENT_MODEL, systemPrompt: SYSTEM_PROMPT, tools: TOOLS })
  shipTurns(writer, cwd, { main: DEMO_MODEL })
}

export interface DemoSession {
  /** The main session file. */
  path: string
  requests: number
}

/**
 * Writes the demo session under `projectDir` (a `~/.claude/projects/<folder>` directory) as
 * `<session id>.jsonl` plus its companion `subagents/` directory; `cwd` is the project directory
 * the log names.
 */
export function writeDemoSession(projectDir: string, cwd: string): DemoSession {
  const writer = new SessionWriter({ sessionId: DEMO_SESSION_ID, cwd, start: START, model: DEMO_MODEL })
  story(writer, cwd)
  const files = writer.files()
  mkdirSync(projectDir, { recursive: true })
  const path = join(projectDir, files.main.name)
  writeFileSync(path, `${files.main.lines.join('\n')}\n`)
  for (const extra of files.extra) {
    const target = join(projectDir, DEMO_SESSION_ID, extra.name)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, extra.text)
  }
  return { path, requests: writer.requests() }
}

// Run by path (the e2e demo home does): `node demo-session.ts <projectDir> <cwd>` prints the result as JSON.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [projectDir, cwd] = process.argv.slice(2)
  if (!projectDir || !cwd) {
    process.stderr.write('Usage: node demo-session.ts <projectDir> <cwd>\n')
    process.exit(1)
  }
  process.stdout.write(`${JSON.stringify(writeDemoSession(projectDir, cwd))}\n`)
}
