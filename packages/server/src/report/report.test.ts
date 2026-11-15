import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { checkReportOutDir, ReportOutDirError } from './report.ts'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'at-report-dir-'))
  dirs.push(dir)
  return dir
}

describe('checkReportOutDir', () => {
  it('allows a non-existent path, an empty directory, and an earlier Estela report directory', async () => {
    const root = await tempDir()
    const options = { cwd: join(root, 'cwd'), home: join(root, 'home') }

    const missing = join(root, 'new-report')
    expect(await checkReportOutDir(missing, options)).toBe(missing)

    const empty = join(root, 'empty')
    await mkdir(empty)
    expect(await checkReportOutDir(empty, options)).toBe(empty)

    const earlier = join(root, 'earlier')
    await mkdir(earlier)
    await writeFile(
      join(earlier, 'index.html'),
      '<!doctype html><script type="application/json" id="report-trace">{}</script>',
    )
    expect(await checkReportOutDir(earlier, options)).toBe(earlier)
  })

  it('refuses a non-empty directory that is not an earlier Estela report without deleting its files', async () => {
    const root = await tempDir()
    const options = { cwd: join(root, 'cwd'), home: join(root, 'home') }

    const victim = join(root, 'victim')
    await mkdir(join(victim, 'sub'), { recursive: true })
    await writeFile(join(victim, 'important.txt'), 'keep me')
    await writeFile(join(victim, 'sub/notes.md'), 'keep me too')

    await expect(checkReportOutDir(victim, options)).rejects.toThrow(ReportOutDirError)
    expect(await readFile(join(victim, 'important.txt'), 'utf8')).toBe('keep me')
    expect(await readFile(join(victim, 'sub/notes.md'), 'utf8')).toBe('keep me too')

    const foreignSite = join(root, 'foreign')
    await mkdir(foreignSite)
    await writeFile(join(foreignSite, 'index.html'), '<!doctype html><h1>My site</h1>')
    await expect(checkReportOutDir(foreignSite, options)).rejects.toThrow('not an earlier Estela report')
    expect(await readFile(join(foreignSite, 'index.html'), 'utf8')).toContain('My site')
  })

  it('refuses symlinks, regular files, filesystem root, cwd, and home even when empty', async () => {
    const root = await tempDir()
    const cwd = join(root, 'cwd')
    const home = join(root, 'home')
    await mkdir(cwd)
    await mkdir(home)
    const options = { cwd, home }

    await expect(checkReportOutDir(parse(root).root, options)).rejects.toThrow('filesystem root')
    await expect(checkReportOutDir(cwd, options)).rejects.toThrow('working directory')
    await expect(checkReportOutDir(home, options)).rejects.toThrow('home directory')

    const file = join(root, 'file.txt')
    await writeFile(file, 'not a dir')
    await expect(checkReportOutDir(file, options)).rejects.toThrow('not a directory')

    const target = join(root, 'target')
    await mkdir(target)
    const link = join(root, 'link')
    await symlink(target, link)
    await expect(checkReportOutDir(link, options)).rejects.toThrow('symbolic link')

    const parentReal = join(root, 'parent-real')
    const subCwd = join(parentReal, 'sub')
    await mkdir(subCwd, { recursive: true })
    const parentLink = join(root, 'parent-link')
    await symlink(parentReal, parentLink)
    await expect(checkReportOutDir(join(parentLink, 'sub'), { cwd: subCwd, home })).rejects.toThrow('working directory')
  })
})
