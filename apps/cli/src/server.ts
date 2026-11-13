import { createEstelaServer as createServer, type EstelaServer, type EstelaServerOptions } from '@rivus/estela-server'
import pkg from '../package.json' with { type: 'json' }
import { webDistDir } from './paths.ts'

/**
 * The Estela server of this package: its name, version, and built SPA (`dist/web/` in the tarball).
 * `dev`, `build`, and `mcp` start here; a programmatic export of the published package would too.
 */
export function createEstelaServer(options: Omit<EstelaServerOptions, 'app'>): EstelaServer {
  return createServer({
    ...options,
    app: {
      packageName: pkg.name,
      version: pkg.version,
      homepage: pkg.homepage,
      description: pkg.description,
      clientAssets: webDistDir(),
    },
  })
}
