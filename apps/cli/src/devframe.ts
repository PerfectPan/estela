import { defineDevframe } from 'devframe'
import { NAMESPACE, serverFunctions } from '@rivus/agent-trace-rpc'
import pkg from '../package.json' with { type: 'json' }
import { BASE_PATH } from './base-path.ts'
import { webDistDir } from './paths.ts'

export { BASE_PATH }

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
  clientAssets: webDistDir(),
  cli: {
    command: 'agent-trace',
    port: 7392,
    configure(cli) {
      cli.option('--pick', 'Pick a session in the terminal')
    },
  },
  setup(ctx) {
    const scoped = ctx.scope(NAMESPACE)
    for (const fn of serverFunctions)
      scoped.rpc.register(fn)
  },
})
