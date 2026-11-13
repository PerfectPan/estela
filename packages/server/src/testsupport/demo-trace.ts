import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { createNodePlatform } from '@rivus/agent-kit/node'
import { loadSession } from '../sessions/load-session.ts'
import { writeDemoSession } from './demo-session.ts'

/**
 * Writes the bundled demo trace (`fixtures/demo.trace.json`, the session `build`, `mcp`, and the
 * exports read when no path is given): the demo session from `demo-session.ts`, read through the
 * kit exactly as a Claude Code log is, as canonical Estela JSON with originals. Source pointers
 * name the files relative to the session's project folder, so the output names no temp path.
 *
 *   node packages/server/src/testsupport/demo-trace.ts fixtures/demo.trace.json
 */
const DEMO_CWD = '/work/tinyshelf'

export async function writeDemoTrace(out: string): Promise<{ events: number; requests: number }> {
  const home = mkdtempSync(join(tmpdir(), 'estela-demo-'))
  try {
    const projectDir = join(home, '.claude/projects/-work-tinyshelf')
    const session = writeDemoSession(projectDir, DEMO_CWD)
    const platform = createNodePlatform({ home, env: {} })
    const trace = await loadSession({ agent: 'claude-code', path: session.path }, { platform })
    for (const event of trace.events) {
      event.source = { ...event.source, file: `tinyshelf/${relative(projectDir, event.source.file)}` }
    }
    const skipped = trace.skipped.map(entry => ({
      ...entry,
      file: `tinyshelf/${relative(projectDir, entry.file)}`,
    }))
    const text = JSON.stringify({ ...trace, skipped }, null, 1)
    if (text.includes(home)) {
      throw new Error('the demo trace still names the temp home')
    }
    writeFileSync(out, `${text}\n`)
    return { events: trace.events.length, requests: session.requests }
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const out = process.argv[2]
  if (!out) {
    process.stderr.write('Usage: node demo-trace.ts <out.trace.json>\n')
    process.exit(1)
  }
  const result = await writeDemoTrace(resolve(out))
  process.stdout.write(`${resolve(out)}\n${result.events} events, ${result.requests} requests\n`)
}
