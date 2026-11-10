import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NAMESPACE } from '@rivus/agent-trace-rpc'
import { describe, expect, it } from 'vite-plus/test'
import * as z from 'zod/mini'
import { packForFile } from './report-site.ts'

const cliDir = join(dirname(fileURLToPath(import.meta.url)), '../..')
const compaction = join(cliDir, '../../fixtures/sessions/claude-code/conformance/compaction/session.jsonl')

function build(path: string, outDir: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['bin.mjs', 'build', path, '--out-dir', outDir], {
      cwd: cliDir,
      stdio: 'ignore',
      env: { ...process.env, AGENT_TRACE_REDACT: '0' },
    })
    child.on('error', reject)
    child.on('close', code => resolve(code ?? 1))
  })
}

describe('report site', () => {
  it('is one index.html holding the redacted report-trace, the script, and the styles', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'at-m5-report-'))
    try {
      // AGENT_TRACE_REDACT=0 affects only the local server; the report is redacted anyway.
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

async function pack(record: unknown): Promise<void> {
  const outDir = await mkdtemp(join(tmpdir(), 'at-report-record-'))
  try {
    await mkdir(join(outDir, '__rpc-dump'))
    const manifest = { [`${NAMESPACE}:report-trace`]: { fallback: '__rpc-dump/record.json' } }
    await writeFile(join(outDir, '__rpc-dump/index.json'), JSON.stringify(manifest))
    await writeFile(join(outDir, '__rpc-dump/record.json'), JSON.stringify(record))
    // No web build: a record that reads as an output gets as far as the missing entry script.
    await writeFile(join(outDir, 'index.html'), '<!doctype html>')
    await packForFile(outDir)
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
}

describe('baked report-trace record', () => {
  it('refuses a record with neither an output nor an error', async () => {
    await expect(pack({})).rejects.toThrow('record is not an output or an error')
    await expect(pack({ inputs: [] })).rejects.toThrow('record is not an output or an error')
  })

  it('reports the error a record carries', async () => {
    await expect(pack({ error: { message: 'boom' } })).rejects.toThrow('report-trace failed while baking: boom')
    await expect(pack({ error: {} })).rejects.toThrow('report-trace failed while baking: unknown error')
  })

  it('takes a null output as an output', async () => {
    await expect(pack({ output: null })).rejects.toThrow('the web build has no module script or stylesheet')
  })
})
