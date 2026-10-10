import type { Rspack } from '@rslib/core'
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

/** Web build tools whose own code lands in `apps/web/dist` (CSS layers, the preload helper). */
const WEB_BUILD_TOOLS = ['tailwindcss', 'tw-animate-css', 'vite']
/**
 * Dependencies of those tools that also put code there, resolved from the tool. Vite 8's bundler adds its runtime
 * helpers; the lazy-init helper among them is esbuild's `__esmMin`, whose MIT notice rolldown keeps in
 * THIRD-PARTY-LICENSE next to Rollup's, so that file is listed too.
 */
const WEB_BUILD_TOOL_DEPS = [{ tool: 'vite', name: 'rolldown', extraFiles: ['THIRD-PARTY-LICENSE'] }]
const EXTRA_LICENSE_FILES = new Map(WEB_BUILD_TOOL_DEPS.map(dep => [dep.name, dep.extraFiles]))
const LICENSE_FILE = /^(?:licen[cs]e|copying|notice)(?:[.-].*)?$/i
const NODE_MODULES = `${sep}node_modules${sep}`

interface PackageNotice {
  name: string
  version: string
  license: string
  texts: string[]
}

function readManifest(dir: string): {
  name?: string
  version?: string
  license?: unknown
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
} {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
}

/** Vite's LICENSE.md appends the licenses of its own bundled build-time dependencies; none ship here. */
function ownLicense(text: string): string {
  const bundled = text.search(/^#+ Licenses of bundled dependencies/m)
  return (bundled === -1 ? text : text.slice(0, bundled)).trim()
}

function noticeOf(dir: string): PackageNotice {
  const manifest = readManifest(dir)
  const extra = EXTRA_LICENSE_FILES.get(manifest.name ?? '') ?? []
  const texts = readdirSync(dir)
    .filter(name => LICENSE_FILE.test(name) || extra.includes(name))
    .toSorted()
    .map(name => ownLicense(readFileSync(join(dir, name), 'utf8')))
  return {
    name: manifest.name ?? dir,
    version: manifest.version ?? '',
    license: typeof manifest.license === 'string' ? manifest.license : 'see package',
    texts,
  }
}

/** Package root of a file under `node_modules`, or undefined for workspace sources. */
function packageRootOf(file: string): string | undefined {
  const at = file.lastIndexOf(NODE_MODULES)
  if (at === -1) {
    return undefined
  }
  const rest = file.slice(at + NODE_MODULES.length).split(sep)
  const depth = rest[0]?.startsWith('@') ? 2 : 1
  return join(file.slice(0, at + NODE_MODULES.length), ...rest.slice(0, depth))
}

/** Node resolution of `name` from `dir`, following pnpm's symlinks. */
function findPackage(name: string, dir: string): string | undefined {
  for (let at = dir; ; at = dirname(at)) {
    const candidate = join(at, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) {
      return realpathSync(candidate)
    }
    if (dirname(at) === at) {
      return undefined
    }
  }
}

/** Every package reachable through `dependencies` from `root`, plus the listed build tools and their listed dependencies. */
function webPackages(root: string): string[] {
  const found = new Set<string>()
  const visit = (dir: string) => {
    const manifest = readManifest(dir)
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies })) {
      const pkg = findPackage(name, dir)
      if (!pkg || found.has(pkg)) {
        continue
      }
      found.add(pkg)
      visit(pkg)
    }
  }
  visit(root)
  for (const name of WEB_BUILD_TOOLS) {
    const pkg = findPackage(name, root)
    if (pkg) {
      found.add(pkg)
    }
  }
  for (const { tool, name } of WEB_BUILD_TOOL_DEPS) {
    const toolPkg = findPackage(tool, root)
    const pkg = toolPkg === undefined ? undefined : findPackage(name, toolPkg)
    if (pkg) {
      found.add(pkg)
    }
  }
  return [...found]
}

function render(title: string, notices: PackageNotice[]): string {
  const lines = [`== ${title} ==`, '']
  for (const notice of notices) {
    lines.push(`--- ${notice.name}@${notice.version} (${notice.license}) ---`, '')
    lines.push(
      notice.texts.length > 0
        ? notice.texts.join('\n\n')
        : `No license file in the package. package.json declares: ${notice.license}.`,
      '',
    )
  }
  return lines.join('\n')
}

function sorted(dirs: Iterable<string>): PackageNotice[] {
  const byId = new Map<string, PackageNotice>()
  for (const dir of dirs) {
    const notice = noticeOf(dir)
    // Workspace packages are this repository's own GPL code; @rivus/agent-kit is an external MIT package.
    if (!notice.name.startsWith('@rivus/agent-trace')) {
      byId.set(`${notice.name}@${notice.version}`, notice)
    }
  }
  return [...byId.values()].toSorted((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
}

/**
 * Writes `THIRD-PARTY-NOTICES.txt` next to `cli.mjs`: the license texts of the npm packages
 * bundled into `cli.mjs` (every file the compilation read under `node_modules`), then those of
 * the web build (the web app's `dependencies`, transitively, plus the tools in WEB_BUILD_TOOLS),
 * then `sourceNotices`, the notices for code adapted into the repository's own sources.
 * External runtime dependencies are installed with their own license files and are not listed.
 */
export class ThirdPartyNotices {
  readonly options: { webPackage: string; sourceNotices: string }

  constructor(options: { webPackage: string; sourceNotices: string }) {
    this.options = options
  }

  apply(compiler: Rspack.Compiler): void {
    const { RawSource } = compiler.webpack.sources
    compiler.hooks.thisCompilation.tap('ThirdPartyNotices', compilation => {
      compilation.hooks.processAssets.tap(
        { name: 'ThirdPartyNotices', stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT },
        () => {
          const bundled = new Set<string>()
          for (const file of compilation.fileDependencies) {
            const root = packageRootOf(file)
            if (root && !file.endsWith(`${sep}package.json`)) {
              bundled.add(root)
            }
          }
          const web = webPackages(resolve(compiler.context, this.options.webPackage))
          const adapted = readFileSync(resolve(compiler.context, this.options.sourceNotices), 'utf8').trim()
          const text = [
            'Third-party software in @rivus/agent-trace',
            '',
            'dist/cli.mjs and dist/bin.mjs bundle the packages in the first section. dist/web/ is built from',
            'the packages in the second section; it may list a package whose code was tree-shaken away.',
            'devframe, @devframes/agentic, and cac are installed as dependencies with their own licenses.',
            'The last section covers code adapted into the agent-trace sources themselves.',
            '',
            render('dist/cli.mjs', sorted(bundled)),
            render('dist/web/', sorted(web)),
            '== Adapted source code ==',
            '',
            adapted,
            '',
          ].join('\n')
          compilation.emitAsset('THIRD-PARTY-NOTICES.txt', new RawSource(text))
        },
      )
    })
  }
}
