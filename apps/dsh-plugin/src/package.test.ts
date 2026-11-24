import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vite-plus/test'
import * as z from 'zod/mini'
import { DSH_VERSION } from './contract/channel.ts'

const pluginDir = dirname(dirname(fileURLToPath(import.meta.url)))

const manifestSchema = z.object({
  name: z.string(),
  private: z.optional(z.boolean()),
  license: z.string(),
  engines: z.object({
    dsh: z.string(),
    node: z.string(),
  }),
  exports: z.record(z.string(), z.string()),
  files: z.array(z.string()),
  dsh: z.object({
    manifestVersion: z.number(),
    bundle: z.object({ patch: z.string() }),
    client: z.object({
      platform: z.string(),
      inject: z.array(z.string()),
    }),
  }),
  bin: z.optional(z.unknown()),
  dependencies: z.optional(z.unknown()),
  peerDependencies: z.optional(z.unknown()),
})

/** Static and dynamic ESM import specifiers in a bundled JS file. */
function importSpecifiers(code: string): string[] {
  const found = new Set<string>()
  const pattern =
    /(?:^|[\n;])\s*import\s+(?:[^'"]*\s+from\s+)?['"]([^'"]+)['"]|(?:\bimport|\brequire)\(\s*['"]([^'"]+)['"]\s*\)/g
  for (const match of code.matchAll(pattern)) {
    const specifier = match[1] ?? match[2]
    if (specifier) {
      found.add(specifier)
    }
  }
  return [...found]
}

describe('@rivus/dsh-estela package', () => {
  beforeAll(() => {
    if (!existsSync(join(pluginDir, 'dist/host.mjs')) || !existsSync(join(pluginDir, 'dist/client.js'))) {
      execFileSync('pnpm', ['run', 'build'], { cwd: pluginDir, stdio: 'pipe' })
    }
  })

  it('declares the dsh manifest, pins engines.dsh to DSH_VERSION, and has no bin or runtime dependencies', async () => {
    const raw: unknown = JSON.parse(await readFile(join(pluginDir, 'package.json'), 'utf8'))
    const manifest = z.parse(manifestSchema, raw)

    expect(manifest.name).toBe('@rivus/dsh-estela')
    expect(manifest.private).toBe(true)
    expect(manifest.license).toBe('GPL-3.0-only')
    expect(manifest.engines.dsh.startsWith(`>=${DSH_VERSION}`)).toBe(true)
    expect(manifest.dependencies).toBeUndefined()
    expect(manifest.peerDependencies).toBeUndefined()
    expect(manifest.bin).toBeUndefined()

    for (const target of Object.values(manifest.exports)) {
      expect(existsSync(join(pluginDir, target)), `missing export target ${target}`).toBe(true)
    }

    const icon = await readFile(join(pluginDir, 'assets/icon.png'))
    // PNG signature + IHDR width/height: must be a square raster image.
    expect(icon.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    const width = icon.readUInt32BE(16)
    const height = icon.readUInt32BE(20)
    expect(width).toBeGreaterThan(0)
    expect(width).toBe(height)
  })

  it('packs only the declared files, including the cordis patch, and omits src, tests, and scripts', async () => {
    const raw: unknown = JSON.parse(await readFile(join(pluginDir, 'package.json'), 'utf8'))
    const manifest = z.parse(manifestSchema, raw)
    const patchFile = manifest.dsh.bundle.patch.replace(/^\.\//, '')

    const packDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-pack-'))
    try {
      execFileSync('pnpm', ['pack', '--pack-destination', packDir], { cwd: pluginDir, stdio: 'pipe' })
      const archives = (await readdir(packDir)).filter(name => name.endsWith('.tgz'))
      expect(archives).toHaveLength(1)
      const listing = execFileSync('tar', ['-tzf', join(packDir, archives[0]!)], { encoding: 'utf8' })
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(entry => entry.replace(/^package\//, ''))

      expect(listing).toContain(patchFile)
      expect(listing).toContain('dist/host.mjs')
      expect(listing).toContain('dist/client.js')
      expect(listing).toContain('dist/THIRD-PARTY-NOTICES.txt')
      expect(listing).toContain('assets/icon.png')
      expect(listing).toContain('README.md')
      expect(listing).toContain('LICENSE')
      expect(listing).toContain('package.json')

      const allowedExact = new Set(['package.json', ...manifest.files.filter(entry => !entry.endsWith('/'))])
      for (const file of listing) {
        const underAssets = file.startsWith('assets/')
        expect(allowedExact.has(file) || underAssets, `unexpected file in tarball: ${file}`).toBe(true)
        expect(file.startsWith('src/')).toBe(false)
        expect(file.startsWith('scripts/')).toBe(false)
        expect(file.includes('.test.')).toBe(false)
      }
    } finally {
      await rm(packDir, { recursive: true, force: true })
    }
  })

  it('bundles dist/host.mjs with neither devframe nor node:sqlite import specifiers', async () => {
    const code = await readFile(join(pluginDir, 'dist/host.mjs'), 'utf8')
    const specifiers = importSpecifiers(code)
    expect(specifiers.some(spec => spec === 'devframe' || spec.startsWith('devframe/'))).toBe(false)
    expect(specifiers).not.toContain('node:sqlite')
    expect(specifiers.some(spec => spec.startsWith('@rivus/'))).toBe(false)
  })
})
