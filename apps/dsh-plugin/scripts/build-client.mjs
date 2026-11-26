import { realpathSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import solid from 'vite-plugin-solid'
import { build } from 'vite-plus'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const pluginDir = dirname(scriptDir)
const webSrc = fileURLToPath(new URL('../../web/src', import.meta.url))
const clientEntry = join(pluginDir, 'src/client/index.ts')
const outFile = join(pluginDir, 'dist/client.js')

const FONTSOURCE_IMPORT = /^\s*@import\s+["']@fontsource\/[^"']+["']\s*;\s*$/gm

/**
 * Strips `@fontsource/*` imports from `apps/web/src/styles.css` so the client bundle injects no
 * `@font-face` rules and ships no webfont files.
 */
function stripEmbedFonts() {
  return {
    name: 'estela-dsh-embed-no-fonts',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?', 1)[0]?.replaceAll('\\', '/')
      if (file?.endsWith('/styles.css')) {
        return code.replace(FONTSOURCE_IMPORT, '')
      }
      return undefined
    },
  }
}

function wrapFactory(code) {
  return [
    'window.__ModuleLoader__.load({',
    "  id: '@rivus/dsh-estela',",
    '  factory(require) {',
    '    var module = { exports: {} };',
    '    var exports = module.exports;',
    code,
    '    return module.exports;',
    '  },',
    '});',
    '',
  ].join('\n')
}

async function buildClient() {
  const result = await build({
    configFile: false,
    root: webSrc,
    logLevel: 'warn',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [stripEmbedFonts(), solid(), tailwindcss()],
    resolve: {
      alias: {
        '@': webSrc,
      },
    },
    build: {
      write: false,
      emptyOutDir: false,
      minify: true,
      lib: {
        entry: clientEntry,
        formats: ['cjs'],
        fileName: () => 'client.js',
      },
      rolldownOptions: {
        // Slow CI runners emit Rolldown's informational PLUGIN_TIMINGS hint, which is not a build defect.
        checks: { bundlerTimings: false },
        external: ['react', 'react/jsx-runtime'],
        output: {
          codeSplitting: false,
        },
        onwarn(warning) {
          throw new Error(`build-client: ${warning.message}`)
        },
      },
    },
  })

  const outputs = Array.isArray(result) ? result : [result]
  const chunks = outputs.flatMap(entry => ('output' in entry ? entry.output : [])).filter(item => item.type === 'chunk')
  if (chunks.length !== 1) {
    throw new Error(`build-client: expected 1 chunk, got ${chunks.length}`)
  }

  const wrapped = wrapFactory(chunks[0].code)
  await mkdir(dirname(outFile), { recursive: true })
  await writeFile(outFile, wrapped, 'utf8')
  return outFile
}

function isDirectEntry() {
  const invoked = process.argv[1]
  if (!invoked) {
    return false
  }
  return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(invoked))
}

if (!isDirectEntry()) {
  throw new Error('build-client.mjs must be run directly as a Node script')
}

await buildClient()
