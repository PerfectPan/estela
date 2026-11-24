import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { exportReport, reserveReportDir } from '../src/report/report.ts'
import {
  disposeAll,
  exportBound,
  inJson,
  namesNeitherHome,
  readText,
  rowsOf,
  session,
  shown,
  start,
  tempDir,
} from './support/estela-server.ts'

afterEach(disposeAll)

/** The one report under `dir`: its directory and its `index.html`, the only file in it. */
async function reportIn(dir: string): Promise<{ dir: string; html: string }> {
  const names = await readdir(dir)
  expect(names).toHaveLength(1)
  expect(names[0]).toMatch(/^estela-report-[0-9a-f]{8}-\d{8}-\d{6}$/)
  const out = join(dir, names[0]!)
  expect(await readdir(out)).toEqual(['index.html'])
  return { dir: out, html: await readFile(join(out, 'index.html'), 'utf8') }
}

/** What `process.cwd()` returns during the test, so that a write there is seen and touches no real directory. */
async function workingDirectory(): Promise<string> {
  const cwd = await tempDir('export-cwd')
  vi.spyOn(process, 'cwd').mockReturnValue(cwd)
  return cwd
}

/** "Export report" as the workspace sends it: the trace id and the UI locale. */
function asked(traceId: string): { traceId: string; locale: 'en' } {
  return { traceId, locale: 'en' }
}

describe('"Export report"', () => {
  it('writes under the report directory the server was given, and nothing into the working directory', async () => {
    const home = await tempDir('export')
    await session(home)
    const reportDir = join(home, 'reports')
    await mkdir(reportDir)
    const cwd = await workingDirectory()
    const { server } = await start(home, { reportDir })
    const { read } = await rowsOf(server)

    const result = await exportBound(asked(read.traceId))
    const report = await reportIn(reportDir)
    // Absolute, so the browser can say exactly where; the home directory shows as `~`.
    expect(result.path).toBe(join('~', 'reports', basename(report.dir), 'index.html'))
    expect(result.total).toBeGreaterThan(0)
    expect(report.html).toContain('<script type="application/json" id="report-trace">')
    expect(report.html).toContain(inJson(readText()))
    expect(await readdir(cwd)).toEqual([])
  })

  it('writes into the working directory when the server was given no report directory', async () => {
    const home = await tempDir('export')
    await session(home)
    const cwd = await workingDirectory()
    const { server } = await start(home)
    const { read } = await rowsOf(server)

    const result = await exportBound(asked(read.traceId))
    const report = await reportIn(cwd)
    // The returned path is for the browser to show, not a path to open: compared as shown, read where written.
    expect(result.path).toBe(shown(join(report.dir, 'index.html')))
    expect((await readdir(home)).some(name => name.startsWith('estela-report'))).toBe(false)
  })

  it('hides both homes from the report, the returned path, and the error that reaches the browser', async () => {
    const home = await tempDir('export')
    await session(home)
    await workingDirectory()
    const reportDir = join(home, 'reports')
    await mkdir(reportDir)
    // The report redacts whatever `redacts` says.
    const { server } = await start(home, { reportDir, redacts: false })
    const { read } = await rowsOf(server)
    const result = await exportBound(asked(read.traceId))
    namesNeitherHome(result.path, home)
    namesNeitherHome((await reportIn(reportDir)).html, home)

    // A report directory that does not exist: the message names the path it tried, with `~`.
    const missing = join(home, 'missing')
    await start(home, { reportDir: missing })
    const failure: unknown = await exportBound(asked(read.traceId)).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    namesNeitherHome(String(failure), home)
    expect(String(failure)).toContain(join('~', 'missing', ''))
  })

  it('never writes into a directory that was there: a taken name gets the next one', async () => {
    const home = await tempDir('export')
    await session(home)
    const cwd = await workingDirectory()
    const reportDir = join(home, 'reports')
    const { server } = await start(home)
    const { read } = await rowsOf(server)
    // The name this export would take: the first 8 characters of the trace id, and the time.
    const taken = join(reportDir, `estela-report-${read.traceId.slice(0, 8)}-20260102-030405`)
    await mkdir(taken, { recursive: true })
    await writeFile(join(taken, 'keep.txt'), 'keep me')
    await writeFile(`${taken}-2`, 'a file of the next name')

    const result = await exportReport(
      server.definition,
      server.store,
      { traceId: read.traceId },
      { dir: reportDir },
      new Date(2026, 0, 2, 3, 4, 5),
    )
    const written = join(`${taken}-3`, 'index.html')
    expect(result.path).toBe(shown(written))
    expect((await readdir(reportDir)).toSorted()).toEqual([
      basename(taken),
      `${basename(taken)}-2`,
      `${basename(taken)}-3`,
    ])
    expect(await readFile(join(taken, 'keep.txt'), 'utf8')).toBe('keep me')
    expect(await readFile(`${taken}-2`, 'utf8')).toBe('a file of the next name')
    expect((await readFile(written, 'utf8')).length).toBeGreaterThan(0)
    expect(await readdir(cwd)).toEqual([])
  })
})

describe('reserveReportDir', () => {
  it('claims a new estela-report directory under the directory it is given', async () => {
    const root = await tempDir('reserve')
    const dir = await reserveReportDir(root, '0a1b2c3d-and!other@characters', new Date(2026, 0, 2, 3, 4, 5))
    expect(dir).toBe(join(root, 'estela-report-0a1b2c3d-20260102-030405'))
    expect(await readdir(dir)).toEqual([])
  })

  it('fails when the directory does not exist, creating nothing', async () => {
    const root = await tempDir('reserve')
    await expect(reserveReportDir(join(root, 'missing'), '0a1b2c3d', new Date())).rejects.toThrow('ENOENT')
    expect(await readdir(root)).toEqual([])
  })
})
