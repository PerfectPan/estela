import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// Root `scripts/` has no node_modules of its own; resolve `zod/mini` through `apps/cli` like the other root scripts.
const requireFromCli = createRequire(new URL('../apps/cli/package.json', import.meta.url))
const z = requireFromCli('zod/mini')

const DEFAULT_WEB_PACKAGE = fileURLToPath(new URL('../apps/web', import.meta.url))
const DEFAULT_SOURCE_NOTICES = fileURLToPath(new URL('../third-party-notices.md', import.meta.url))

/** Web build tools whose own code lands in `apps/web/dist` (CSS layers). */
const WEB_BUILD_TOOLS = ['tailwindcss', 'tw-animate-css']
const LICENSE_FILE = /^(?:licen[cs]e|copying|notice)(?:[.-].*)?$/i
const NODE_MODULES = `${sep}node_modules${sep}`

const packageMap = z.optional(z.record(z.string(), z.string()))
/** The package.json fields read here. `license` may be the older object form, so it is read on its own. */
const packageManifest = z.object({
  name: z.optional(z.string()),
  version: z.optional(z.string()),
  license: z.unknown(),
  dependencies: packageMap,
  optionalDependencies: packageMap,
  bundledVersions: packageMap,
})
const spdxLicense = z.string()

function readManifest(dir) {
  const parsed = z.safeParse(packageManifest, JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(`third-party-notices: ${join(dir, 'package.json')}: ${issue?.path.join('.')}: ${issue?.message}`)
  }
  return parsed.data
}

/** Vite's and Vite+'s licenses append those of their own bundled build-time dependencies; none ship here. */
function ownLicense(text) {
  const bundled = text.search(/^#+ Licenses of bundled dependencies/m)
  return (bundled === -1 ? text : text.slice(0, bundled)).trim()
}

function noticeOf(dir) {
  const manifest = readManifest(dir)
  const texts = readdirSync(dir)
    .filter(name => LICENSE_FILE.test(name))
    .toSorted()
    .map(name => ownLicense(readFileSync(join(dir, name), 'utf8')))
  return {
    name: manifest.name ?? dir,
    version: manifest.version ?? '',
    license: z.safeParse(spdxLicense, manifest.license).data ?? 'see package',
    texts,
  }
}

/**
 * The notice of a package that `coreDir` bundles, from the core's LICENSE. Each bundled package there is one section,
 * between dashed rules: `## <name>`, then `License:` and other header lines, then its license text quoted with `> `.
 * Throws when the section or version is missing, so a change in that format fails the build instead of dropping
 * the notice.
 */
function bundledNoticeOf(coreDir, name) {
  const core = readManifest(coreDir)
  const version = core.bundledVersions?.[name]
  const section = readFileSync(join(coreDir, 'LICENSE'), 'utf8')
    .split(/^-{10,}$/m)
    .map(part => part.trim())
    .find(part => part.startsWith(`## ${name}\n`))
  if (version === undefined || section === undefined) {
    throw new Error(`third-party-notices: ${core.name ?? coreDir} records no bundled ${name}`)
  }
  const lines = section.split('\n')
  const license = lines.find(line => line.startsWith('License: '))?.slice('License: '.length) ?? 'see package'
  const text = lines
    .filter(line => line.startsWith('>'))
    .map(line => line.replace(/^> ?/, ''))
    .join('\n')
  return { name, version, license, texts: [ownLicense(text)] }
}

/** Package root of a file under `node_modules`, or undefined for workspace sources and external imports. */
function packageRootOf(file) {
  const at = file.lastIndexOf(NODE_MODULES)
  if (at === -1) {
    return undefined
  }
  const rest = file.slice(at + NODE_MODULES.length).split(sep)
  const depth = rest[0]?.startsWith('@') ? 2 : 1
  return join(file.slice(0, at + NODE_MODULES.length), ...rest.slice(0, depth))
}

/** Node resolution of `name` from `dir`, following pnpm's symlinks. */
function findPackage(name, dir) {
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

/** vite-plus-core, which bundles Vite and Rolldown: the `vite` dependency of the vite-plus that `root` resolves. */
function vitePlusCoreOf(root) {
  const vitePlus = findPackage('vite-plus', root)
  const core = vitePlus === undefined ? undefined : findPackage('vite', vitePlus)
  if (core === undefined) {
    throw new Error(`third-party-notices: no vite-plus core resolves from ${root}`)
  }
  return core
}

/**
 * Rolldown's notice as `core`'s LICENSE records it, followed by Rolldown's THIRD-PARTY-LICENSE: the MIT notices of
 * Rollup and esbuild, from which the runtime helpers Rolldown writes into its output derive (esbuild's `__esmMin`
 * lazy-init helper among them). vite-plus-core's LICENSE records only Rolldown's own license, so the web app has
 * `rolldown` as a devDependency for that file alone. Its version must equal the Rolldown that `core` bundles; anything
 * else throws, so a vite-plus upgrade fails the build until that devDependency follows instead of shipping another
 * release's notices.
 */
function rolldownNotice(core, webRoot) {
  const notice = bundledNoticeOf(core, 'rolldown')
  const pkg = findPackage('rolldown', webRoot)
  const installed = pkg === undefined ? undefined : readManifest(pkg).version
  if (pkg === undefined || installed !== notice.version) {
    throw new Error(
      `third-party-notices: vite-plus-core bundles rolldown ${notice.version}, but ${webRoot} resolves rolldown ${installed ?? '(not installed)'}; set its rolldown devDependency to exactly ${notice.version}`,
    )
  }
  return { ...notice, texts: [...notice.texts, readFileSync(join(pkg, 'THIRD-PARTY-LICENSE'), 'utf8').trim()] }
}

/**
 * Every package reachable through `dependencies` from `root`, plus the listed build tools, plus vite-plus-core and the
 * Vite and Rolldown it bundles. The web app builds with vite-plus, whose `vite` dependency is vite-plus-core; Vite
 * adds the preload helper to `apps/web/dist` and Rolldown its runtime helpers, so both are listed with the version
 * and license text that vite-plus-core's LICENSE records for them.
 */
function webNotices(root) {
  const found = new Set()
  const visit = dir => {
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
  const core = vitePlusCoreOf(root)
  found.add(core)
  return [...[...found].map(noticeOf), bundledNoticeOf(core, 'vite'), rolldownNotice(core, root)]
}

function render(title, notices) {
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

function sorted(notices) {
  const byId = new Map()
  for (const notice of notices) {
    // Workspace packages are this repository's own GPL code; @rivus/agent-kit is an external MIT package.
    if (!notice.name.startsWith('@rivus/estela') && notice.name !== '@rivus/dsh-estela') {
      byId.set(`${notice.name}@${notice.version}`, notice)
    }
  }
  return [...byId.values()].toSorted((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
}

const DEFAULT_INTRO = [
  'dist/cli.mjs and dist/bin.mjs bundle the packages in the first section; rolldown is listed there',
  'for the runtime helpers it writes into them. dist/web/ is built from the packages in the second',
  'section; it may list a package whose code was tree-shaken away.',
  'devframe and @devframes/agentic are installed as dependencies with their own licenses.',
  'The last section covers code adapted into the Estela sources themselves.',
]

/**
 * Emits `THIRD-PARTY-NOTICES.txt` next to the packed entry: the license texts of the npm packages bundled into it
 * (every module of the bundle graph under `node_modules`, tree-shaken ones included) and of the Rolldown whose
 * runtime helpers the bundle carries, then those of the web build
 * (the web app's `dependencies`, transitively, plus the tools in WEB_BUILD_TOOLS and those vite-plus-core bundles),
 * then `sourceNotices`, the notices for code adapted into the repository's own sources. External runtime dependencies
 * are installed with their own license files and are not listed. All paths are absolute.
 */
export function thirdPartyNotices(options = {}) {
  const webPackage = options.webPackage ?? DEFAULT_WEB_PACKAGE
  const sourceNotices = options.sourceNotices ?? DEFAULT_SOURCE_NOTICES
  const packageName = options.packageName ?? '@rivus/estela'
  const bundleLabel = options.bundleLabel ?? 'dist/cli.mjs'
  const webLabel = options.webLabel ?? 'dist/web/'
  const intro = options.intro ?? DEFAULT_INTRO
  return {
    name: 'third-party-notices',
    generateBundle() {
      const bundled = new Set()
      for (const id of this.getModuleIds()) {
        const root = packageRootOf(id)
        if (root) {
          bundled.add(root)
        }
      }
      const rolldown = rolldownNotice(vitePlusCoreOf(options.packPackage ?? webPackage), webPackage)
      const adapted = readFileSync(sourceNotices, 'utf8').trim()
      const text = [
        `Third-party software in ${packageName}`,
        '',
        ...intro,
        '',
        render(bundleLabel, sorted([...[...bundled].map(noticeOf), rolldown])),
        render(webLabel, sorted(webNotices(webPackage))),
        '== Adapted source code ==',
        '',
        adapted,
        '',
      ].join('\n')
      this.emitFile({ type: 'asset', fileName: 'THIRD-PARTY-NOTICES.txt', source: text })
    },
  }
}
