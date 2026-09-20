import { fileURLToPath } from 'node:url'
import { defineDevframe } from 'devframe'
import pkg from '../package.json' with { type: 'json' }
import { NAMESPACE, serverFunctions } from './rpc/index.ts'
import { BASE_PATH } from './shared/base-path.ts'

const clientAssets = fileURLToPath(new URL('../dist/client', import.meta.url))

export default defineDevframe({
  id: 'agent-trace',
  name: 'Agent Trace',
  version: pkg.version,
  packageName: pkg.name,
  importMetaUrl: import.meta.url,
  homepage: pkg.homepage,
  description: pkg.description ?? 'Inspect agent session logs; reconstruct what the model saw.',
  icon: 'ph:path-duotone',
  basePath: BASE_PATH,
  clientAssets,
  cli: {
    command: 'agent-trace',
    port: 7392,
  },
  setup(ctx) {
    const scoped = ctx.scope(NAMESPACE)
    for (const fn of serverFunctions)
      scoped.rpc.register(fn)
  },
})
