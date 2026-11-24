import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { describe, expect, it } from 'vite-plus/test'
import * as z from 'zod/mini'

const clientModule = z.object({
  inject: z.array(z.string()),
  apply: z.unknown(),
})

const ALLOWED_EXTERNALS = new Set(['react', 'react/jsx-runtime'])

const pluginDir = dirname(dirname(fileURLToPath(import.meta.url)))
const clientBundle = join(pluginDir, 'dist/client.js')

interface RegisteredModule {
  id: string
  factory: (require: (id: string) => unknown) => unknown
}

describe('dist/client.js', () => {
  it('registers a dsh module with inject and apply, requires only React externals, and defines no plugin globals', async () => {
    const code = await readFile(clientBundle, 'utf8')
    const loaded: RegisteredModule[] = []
    const doc = { addEventListener() {} }
    const windowObj: Record<string, unknown> = {
      document: doc,
      __ModuleLoader__: {
        load(entry: RegisteredModule) {
          loaded.push(entry)
        },
      },
    }
    class FakeHTMLElement {}
    const sandbox: Record<string, unknown> = {
      window: windowObj,
      self: windowObj,
      document: doc,
      HTMLElement: FakeHTMLElement,
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
    const fakeRequire = (id: string): unknown => {
      if (!ALLOWED_EXTERNALS.has(id)) {
        throw new Error(`unexpected require(${JSON.stringify(id)}) in dist/client.js`)
      }
      required.push(id)
      return {}
    }

    expect(() => fakeRequire('unavailable-module')).toThrow('unexpected require("unavailable-module")')

    const exported = z.parse(clientModule, loaded[0]!.factory(fakeRequire))
    expect(required).toEqual(['react'])

    // `Array.isArray` and `typeof` work across `vm` realms where `instanceof Array` does not.
    expect(Array.isArray(exported.inject)).toBe(true)
    expect(Array.from(exported.inject)).toEqual(['slots', 'connection', 'theme', 'locale'])
    expect(typeof exported.apply).toBe('function')

    // Evaluating the bundle and invoking its factory must define no plugin globals on the host page
    // (`zod/mini` initializes its own `__zod_globalConfig` slot on `globalThis`).
    const addedGlobals = Object.getOwnPropertyNames(sandbox).filter(
      name => !globalsBefore.includes(name) && name !== '__zod_globalConfig',
    )
    expect(addedGlobals).toEqual([])
    expect(Object.getOwnPropertyNames(windowObj).toSorted()).toEqual(windowBefore)
  })
})
