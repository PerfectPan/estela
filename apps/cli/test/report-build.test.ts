import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
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

describe('report site', () => {
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
