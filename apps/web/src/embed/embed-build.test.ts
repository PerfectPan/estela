// @vitest-environment happy-dom
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, beforeAll, describe, expect, it } from 'vite-plus/test'
import * as z from 'zod/mini'
import { splitStylesheet, splitTopLevelRules } from './stylesheet.ts'

const embedModuleSchema = z.object({
  defineEstelaWorkspace: z.custom<() => void>(value => typeof value === 'function'),
  ESTELA_WORKSPACE_TAG: z.string(),
})

const webDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const bundlePath = join(webDir, 'dist-embed', 'index.js')

let bundleCode = ''

beforeAll(() => {
  if (!existsSync(bundlePath)) {
    const vp = process.platform === 'win32' ? 'vp.cmd' : 'vp'
    execFileSync(vp, ['build', '--mode', 'embed'], { cwd: webDir, stdio: 'pipe' })
  }
  bundleCode = readFileSync(bundlePath, 'utf8')
}, 60_000)

afterEach(() => {
  document.body.innerHTML = ''
  for (const style of document.querySelectorAll('style[data-estela-shared]')) {
    style.remove()
  }
})

describe('embed build artifact (dist-embed/index.js)', () => {
  it('omits devframe, @font-face, and process.env from the bundle', () => {
    expect(bundleCode).not.toMatch(/devframe/i)
    expect(bundleCode).not.toMatch(/@font-face/i)
    expect(bundleCode).not.toContain('process.env')
  })

  it('splits the built stylesheet into 60 uncut @property rules and the remaining shadow rules', async () => {
    const match = /"(\/\*! tailwindcss(?:[^"\\]|\\.)*)"/.exec(bundleCode)
    expect(match).not.toBeNull()
    const builtCss = z.parse(z.string(), JSON.parse(`"${match![1]}"`))
    expect(builtCss).not.toMatch(/@font-face/i)

    const allRules = splitTopLevelRules(builtCss)
    expect(allRules.join('')).toBe(builtCss)

    const split = splitStylesheet(builtCss)
    expect(split.propertyCount).toBe(60)
    expect(split.shadowCss).not.toContain('@property')
    expect(split.documentCss.length + split.shadowCss.length).toBe(builtCss.length)

    const propRules = splitTopLevelRules(split.documentCss)
    expect(propRules.length).toBe(60)
    for (const rule of propRules) {
      expect(rule.trimStart().startsWith('@property ')).toBe(true)
      expect(rule.trimEnd().endsWith('}')).toBe(true)
    }

    const rejoinedRules = [...propRules, ...splitTopLevelRules(split.shadowCss)].toSorted()
    expect(rejoinedRules).toEqual(allRules.toSorted())

    // Mount the built module directly to verify its runtime <style data-estela-shared> lifecycle.
    const mod = z.parse(embedModuleSchema, await import(pathToFileURL(bundlePath).href))
    mod.defineEstelaWorkspace()
    const first = document.createElement(mod.ESTELA_WORKSPACE_TAG)
    const second = document.createElement(mod.ESTELA_WORKSPACE_TAG)
    document.body.append(first, second)

    const shared = document.querySelectorAll('style[data-estela-shared]')
    expect(shared.length).toBe(1)
    expect(shared[0]!.textContent).toBe(split.documentCss)
    expect(first.shadowRoot?.querySelector('style')?.textContent).toBe(split.shadowCss)

    first.remove()
    expect(document.querySelectorAll('style[data-estela-shared]').length).toBe(1)

    second.remove()
    expect(document.querySelectorAll('style[data-estela-shared]').length).toBe(0)
  })
})
