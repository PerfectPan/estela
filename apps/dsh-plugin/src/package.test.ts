import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'
import * as z from 'zod/mini'
import { DSH_VERSION } from './contract/channel.ts'

const pluginDir = dirname(dirname(fileURLToPath(import.meta.url)))

const manifestSchema = z.object({
  name: z.string(),
  description: z.string(),
  license: z.string(),
  type: z.string(),
  private: z.optional(z.boolean()),
  repository: z.object({
    type: z.string(),
    url: z.string(),
    directory: z.string(),
  }),
  publishConfig: z.object({
    access: z.string(),
  }),
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

/** Manifest fields from Plan 0010 §3.5.1. */
const EXPECTED_MANIFEST = {
  name: '@rivus/dsh-estela',
  description: 'Estela view of the current DeepSeek Harness session: ledger, Model saw, Compare, and cost.',
  license: 'GPL-3.0-only',
  type: 'module',
  repository: {
    type: 'git',
    url: 'git+https://github.com/PerfectPan/estela.git',
    directory: 'apps/dsh-plugin',
  },
  publishConfig: {
    access: 'public',
  },
  engines: {
    dsh: `>=${DSH_VERSION} <0.3.0-0`,
    node: '>=24.9.0',
  },
  exports: {
    '.': './dist/host.mjs',
    './client': './dist/client.js',
    './icon': './assets/icon.png',
    './package.json': './package.json',
  },
  files: [
    'dist/host.mjs',
    'dist/client.js',
    'cordis.patch.yml',
    'dist/THIRD-PARTY-NOTICES.txt',
    'assets',
    'README.md',
    'LICENSE',
    'CHANGELOG.md',
  ],
  dsh: {
    manifestVersion: 1,
    bundle: { patch: './cordis.patch.yml' },
    client: {
      platform: 'web',
      inject: ['@deepseek-ai/dsh-client-ui-theme', '@deepseek-ai/dsh-client-locale'],
    },
  },
} as const

describe('@rivus/dsh-estela manifest', () => {
  it('matches the Plan 3.5.1 manifest key-by-key, pins engines.dsh to DSH_VERSION, and has no bin or runtime dependencies', async () => {
    const raw: unknown = JSON.parse(await readFile(join(pluginDir, 'package.json'), 'utf8'))
    const manifest = z.parse(manifestSchema, raw)

    expect(manifest.name).toBe(EXPECTED_MANIFEST.name)
    expect(manifest.description).toBe(EXPECTED_MANIFEST.description)
    expect(manifest.license).toBe(EXPECTED_MANIFEST.license)
    expect(manifest.type).toBe(EXPECTED_MANIFEST.type)
    expect(manifest.private).toBeUndefined()
    expect(manifest.repository).toEqual(EXPECTED_MANIFEST.repository)
    expect(manifest.publishConfig).toEqual(EXPECTED_MANIFEST.publishConfig)
    expect(manifest.engines).toEqual(EXPECTED_MANIFEST.engines)
    expect(manifest.engines.dsh.startsWith(`>=${DSH_VERSION}`)).toBe(true)
    expect(manifest.exports).toEqual(EXPECTED_MANIFEST.exports)
    expect(manifest.files).toEqual(EXPECTED_MANIFEST.files)
    expect(manifest.dsh).toEqual(EXPECTED_MANIFEST.dsh)

    expect(manifest.dependencies).toBeUndefined()
    expect(manifest.peerDependencies).toBeUndefined()
    expect(manifest.bin).toBeUndefined()
  })

  it('ships a square raster PNG icon', async () => {
    const icon = await readFile(join(pluginDir, 'assets/icon.png'))
    // PNG signature + IHDR width/height: must be a square raster image.
    expect(icon.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    const width = icon.readUInt32BE(16)
    const height = icon.readUInt32BE(20)
    expect(width).toBeGreaterThan(0)
    expect(width).toBe(height)
  })

  it('declares 1-8 existing local WebP screenshots (<= 400 KB) in screenshots.json', async () => {
    const raw: unknown = JSON.parse(await readFile(join(pluginDir, 'screenshots.json'), 'utf8'))
    const paths = z.parse(z.array(z.string()), raw)
    expect(paths.length).toBeGreaterThanOrEqual(1)
    expect(paths.length).toBeLessThanOrEqual(8)
    for (const rel of paths) {
      expect(rel.startsWith('/')).toBe(false)
      expect(rel.split('/').includes('..')).toBe(false)
      const full = join(pluginDir, rel)
      expect(existsSync(full), `missing screenshot ${rel}`).toBe(true)
      const info = await stat(full)
      expect(info.isFile(), `screenshot ${rel} must be a regular file`).toBe(true)
      expect(info.size).toBeLessThanOrEqual(400 * 1024)
      const bytes = await readFile(full)
      // RIFF....WEBP container header signature.
      expect(bytes.subarray(0, 4).toString('ascii'), `screenshot ${rel} must start with RIFF`).toBe('RIFF')
      expect(bytes.subarray(8, 12).toString('ascii'), `screenshot ${rel} must carry WEBP signature`).toBe('WEBP')
    }
  })
})
