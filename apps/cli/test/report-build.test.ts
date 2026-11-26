import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'
import * as z from 'zod/mini'

const cliDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const compaction = join(cliDir, '../../fixtures/sessions/claude-code/conformance/compaction/session.jsonl')

function build(path: string, outDir: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['bin.mjs', 'build', path, '--out-dir', outDir], {
      cwd: cliDir,
      stdio: 'ignore',
      env: { ...process.env, ESTELA_REDACT: '0' },
    })
    child.on('error', reject)
    child.on('close', code => resolve(code ?? 1))
  })
}

/** `build` with its stderr kept: the warnings the store and the report give end up there. */
function buildCapturing(path: string, outDir: string): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['bin.mjs', 'build', path, '--out-dir', outDir], {
      cwd: cliDir,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, ESTELA_REDACT: '0' },
    })
    let stderr = ''
    child.stderr.on('data', chunk => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', code => resolve({ code: code ?? 1, stderr }))
  })
}

describe('report site', () => {
  it('warns on stderr when its view is over the budget, as the dev server does', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'at-m5-report-budget-'))
    const sessionDir = await mkdtemp(join(tmpdir(), 'at-m5-session-budget-'))
    try {
      // A canonical trace of 40,000 events: over the view's budget even at the 256-character floor.
      const text = 'x'.repeat(300)
      const event = (index: number): string =>
        `{"id":"e${index}","seq":${index},"ts":${index + 1},"kind":"user","payload":{"text":"${text}"},"source":{"file":"log.jsonl","offset":0,"length":1,"line":1},"original":{"id":"e${index}","text":"${text}"}}`
      const file = join(sessionDir, 'big.trace.json')
      await writeFile(
        file,
        `{"schema":"estela","agent":"test","session":{"id":"s"},"capabilities":[],"agents":[{"id":"main"}],"events":[${Array.from({ length: 40_000 }, (_, index) => event(index)).join(',')}],"skipped":[]}`,
      )
      const { code, stderr } = await buildCapturing(file, outDir)
      expect(code).toBe(0)
      expect(stderr).toContain('bytes at the 256-character floor, over the 11934464-byte budget')
    } finally {
      await Promise.all([outDir, sessionDir].map(dir => rm(dir, { recursive: true, force: true })))
    }
  })

  it('builds a session whose event ids name the home directory, and shows each event under the id the view shows', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'at-m5-report-ids-'))
    const sessionDir = await mkdtemp(join(tmpdir(), 'at-m5-session-ids-'))
    try {
      // Written at run time: the id names the home of whoever runs the test, which no fixture may hold.
      const file = join(sessionDir, 'session.jsonl')
      const base = { sessionId: 's-ids', version: '2.0.0', cwd: join(homedir(), 'work', 'anywhere') }
      await writeFile(
        file,
        [
          {
            ...base,
            type: 'user',
            uuid: join(homedir(), 'ids', 'prompt'),
            timestamp: '2026-02-01T00:00:00.000Z',
            message: { role: 'user', content: 'list the files' },
          },
          {
            ...base,
            type: 'assistant',
            uuid: join(homedir(), 'ids', 'reply'),
            requestId: 'req-ids',
            timestamp: '2026-02-01T00:00:01.000Z',
            message: {
              role: 'assistant',
              model: 'claude-sonnet-4-5-20250929',
              id: 'msg-ids',
              stop_reason: 'end_turn',
              usage: { input_tokens: 7, output_tokens: 3 },
              content: [{ type: 'text', text: 'two files' }],
            },
          },
        ]
          .map(record => `${JSON.stringify(record)}\n`)
          .join(''),
      )
      expect(await build(file, outDir)).toBe(0)
      const html = await readFile(join(outDir, 'index.html'), 'utf8')
      expect(html).not.toContain(homedir())
      const json = /<script type="application\/json" id="report-trace">(.*?)<\/script>/s.exec(html)?.[1]
      const report = z.parse(
        z.object({
          trace: z.object({ events: z.array(z.object({ id: z.string() })) }),
          events: z.array(z.object({ id: z.string(), original: z.unknown() })),
          total: z.number(),
        }),
        JSON.parse(json!),
      )
      // Every event is there in full, under the id the view shows it by.
      expect(report.events.map(event => event.id)).toEqual(report.trace.events.map(event => event.id))
      expect(report.events).toHaveLength(report.total)
      for (const event of report.events) {
        expect(event.original).toBeDefined()
      }
      // Both events whose id names the home are shown under an alias.
      expect(report.trace.events.filter(event => event.id.startsWith('@e')).map(event => event.id)).toEqual([
        '@e0',
        '@e2',
      ])
    } finally {
      await Promise.all([outDir, sessionDir].map(dir => rm(dir, { recursive: true, force: true })))
    }
  })

  it('is one index.html holding the redacted report-trace, the script, and the styles', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'at-m5-report-'))
    try {
      // ESTELA_REDACT=0 affects only the local server; the report is redacted anyway.
      expect(await build(compaction, outDir)).toBe(0)
      expect(await readdir(outDir)).toEqual(['index.html'])
      const html = await readFile(join(outDir, 'index.html'), 'utf8')
      expect(html).not.toContain(homedir())
      expect(html).not.toMatch(/<script[^>]+src=|<link rel="stylesheet"|url\(\.\//)
      const json = /<script type="application\/json" id="report-trace">(.*?)<\/script>/s.exec(html)?.[1]
      const report = z.parse(
        z.object({
          trace: z.object({ events: z.array(z.unknown()), sourceFiles: z.optional(z.array(z.string())) }),
          events: z.array(z.object({ original: z.optional(z.unknown()) })),
          total: z.number(),
          truncated: z.boolean(),
        }),
        JSON.parse(json!),
      )
      expect(report.total).toBe(report.trace.events.length)
      expect(report.truncated).toBe(false)
      expect(report.events.every(event => event.original !== undefined)).toBe(true)
      // The checkout usually sits under the home directory (locally and on CI runners).
      if (compaction.startsWith(homedir())) {
        expect(report.trace.sourceFiles?.[0]).toMatch(/^~\//)
      }
      expect(html).toContain('<script type="module">')
    } finally {
      await rm(outDir, { recursive: true, force: true })
    }
  })
})
