import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { beforeAll, describe, expect, it } from 'vite-plus/test'
import * as z from 'zod/mini'

const clientModule = z.object({
  inject: z.unknown(),
  apply: z.unknown(),
})

const pluginDir = dirname(dirname(fileURLToPath(import.meta.url)))
const clientBundle = join(pluginDir, 'dist/client.js')

interface RegisteredModule {
  id: string
  factory: (require: (id: string) => unknown) => unknown
}

describe('dist/client.js', () => {
  beforeAll(() => {
    if (!existsSync(clientBundle)) {
      execFileSync('pnpm', ['run', 'build'], { cwd: pluginDir, stdio: 'pipe' })
    }
  })

  it('registers a dsh module with inject and apply and defines no globals', async () => {
    const code = await readFile(clientBundle, 'utf8')
    const loaded: RegisteredModule[] = []
    const windowObj: Record<string, unknown> = {
      __ModuleLoader__: {
        load(entry: RegisteredModule) {
          loaded.push(entry)
        },
      },
    }
    const sandbox: Record<string, unknown> = {
      window: windowObj,
      self: windowObj,
    }
    sandbox.globalThis = sandbox
    const context = vm.createContext(sandbox)

    const globalsBefore = Object.getOwnPropertyNames(sandbox).toSorted()
    const windowBefore = Object.getOwnPropertyNames(windowObj).toSorted()

    vm.runInContext(code, context, { filename: 'client.js' })

    expect(loaded).toHaveLength(1)
    expect(loaded[0]!.id).toBe('@rivus/dsh-estela')
    expect(typeof loaded[0]!.factory).toBe('function')

    const required: string[] = []
    const exported = z.parse(
      clientModule,
      loaded[0]!.factory(id => {
        required.push(id)
        return {}
      }),
    )
    // `Array.isArray` and `typeof` work across `vm` realms where `instanceof Array` does not.
    expect(Array.isArray(exported.inject)).toBe(true)
    expect(typeof exported.apply).toBe('function')

    // Evaluating the bundle and invoking its factory must define no globals on the host page.
    expect(Object.getOwnPropertyNames(sandbox).toSorted()).toEqual(globalsBefore)
    expect(Object.getOwnPropertyNames(windowObj).toSorted()).toEqual(windowBefore)
  })
})
