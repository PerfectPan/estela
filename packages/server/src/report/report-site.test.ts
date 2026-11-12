import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NAMESPACE } from '@rivus/estela-rpc'
import { describe, expect, it } from 'vite-plus/test'
import { packForFile } from './report-site.ts'

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
