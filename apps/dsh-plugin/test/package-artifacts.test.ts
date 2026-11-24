import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { x } from 'tinyexec'
import { describe, expect, it } from 'vite-plus/test'
import * as z from 'zod/mini'

const pluginDir = dirname(dirname(fileURLToPath(import.meta.url)))

const manifestExportsSchema = z.object({
  exports: z.record(z.string(), z.string()),
  files: z.array(z.string()),
  dsh: z.object({
    bundle: z.object({ patch: z.string() }),
  }),
})

const packJsonSchema = z.object({
  filename: z.string(),
  files: z.array(z.object({ path: z.string() })),
})

/** Static import/re-export (`import`/`export ... from`/`export * from`) and dynamic import/require specifiers. */
function moduleSpecifiers(code: string): string[] {
  const found = new Set<string>()
  const pattern =
    /(?:^|[\n;])\s*import\s*['"]([^'"]+)['"]|(?:^|[\n;])\s*(?:import|export)(?:\s|[*{"])[^;'"]*?\bfrom\s*['"]([^'"]+)['"]|(?:\bimport|\brequire)\(\s*['"]([^'"]+)['"]\s*\)/g
  for (const match of code.matchAll(pattern)) {
    const specifier = match[1] ?? match[2] ?? match[3]
    if (specifier) {
      found.add(specifier)
    }
  }
  return [...found]
}

describe('@rivus/dsh-estela built artifacts', () => {
  it('builds every declared export target on disk', async () => {
    const raw: unknown = JSON.parse(await readFile(join(pluginDir, 'package.json'), 'utf8'))
    const manifest = z.parse(manifestExportsSchema, raw)

    for (const target of Object.values(manifest.exports)) {
      expect(existsSync(join(pluginDir, target)), `missing export target ${target}`).toBe(true)
    }
  })

  it('packs only the declared files, including the cordis patch, and omits src, tests, and scripts', async () => {
    const raw: unknown = JSON.parse(await readFile(join(pluginDir, 'package.json'), 'utf8'))
    const manifest = z.parse(manifestExportsSchema, raw)
    const patchFile = manifest.dsh.bundle.patch.replace(/^\.\//, '')

    const packDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-pack-'))
    try {
      const proc = await x('pnpm', ['pack', '--json', '--pack-destination', packDir], {
        nodeOptions: { cwd: pluginDir },
        nodePath: false,
        throwOnError: false,
      })
      if (proc.exitCode !== 0) {
        throw new Error(`pnpm pack failed (exit ${proc.exitCode}):\n${proc.stdout}${proc.stderr}`)
      }
      const packed = z.parse(packJsonSchema, JSON.parse(proc.stdout))
      const listing = packed.files.map(entry => entry.path).toSorted()

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
        expect(file.startsWith('test/')).toBe(false)
        expect(file.includes('.test.')).toBe(false)
      }
    } finally {
      await rm(packDir, { recursive: true, force: true })
    }
  })

  it('detects static import, export-from, export-star, dynamic import, and require specifiers', () => {
    const sample = [
      `import 'side-effect';`,
      `import a from 'dep-a';`,
      `export { b } from 'dep-b';`,
      `export * from 'node:sqlite';`,
      `export * as ns from 'devframe/server';`,
      `export*from"minified-star";`,
      `const c = await import('dynamic-dep');`,
      `const d = require('cjs-dep');`,
      `export const name = '@rivus/dsh-estela';`,
    ].join('\n')

    expect(moduleSpecifiers(sample).toSorted()).toEqual([
      'cjs-dep',
      'dep-a',
      'dep-b',
      'devframe/server',
      'dynamic-dep',
      'minified-star',
      'node:sqlite',
      'side-effect',
    ])
  })

  it('bundles dist/host.mjs with neither devframe nor node:sqlite import or re-export specifiers', async () => {
    const code = await readFile(join(pluginDir, 'dist/host.mjs'), 'utf8')
    const specifiers = moduleSpecifiers(code)
    expect(specifiers.some(spec => spec === 'devframe' || spec.startsWith('devframe/'))).toBe(false)
    expect(specifiers).not.toContain('node:sqlite')
    expect(specifiers.some(spec => spec.startsWith('@rivus/'))).toBe(false)
  })

  it('exports only name, inject, and apply from dist/host.mjs', async () => {
    const hostModule: Record<string, unknown> = await import(pathToFileURL(join(pluginDir, 'dist/host.mjs')).href)
    expect(Object.keys(hostModule).toSorted()).toEqual(['apply', 'inject', 'name'])
  })
})
