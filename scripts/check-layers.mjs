#!/usr/bin/env node
// Dependency direction for @rivus/* packages: the "May depend on" column of the Layers table in AGENTS.md.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
const KERNEL = '@rivus/estela-kernel'
const SCHEMA = '@rivus/estela-schema'
const RPC = '@rivus/estela-rpc'
const KIT = '@rivus/agent-kit'
const CORE = [RPC, KERNEL, SCHEMA]

const SERVER = '@rivus/estela-server'
const RUNTIME_NODE = '@rivus/estela-runtime-node'

const ALLOW = {
  // The server reads sessions through the kit; the CLI imports only its redact and node entries at runtime, and the
  // kernel only the import-free /cost and /cost/prices. oxlint (root vite.config.ts) enforces type-only imports
  // everywhere else.
  '@rivus/estela': [KIT, SERVER, '@rivus/estela-web', RUNTIME_NODE, ...CORE],
  [SERVER]: [KIT, RUNTIME_NODE, ...CORE],
  '@rivus/estela-web': [KIT, ...CORE],
  // Tests the packed tarball from outside; it depends on no workspace package.
  '@rivus/estela-e2e': [],
  [RPC]: [KIT, KERNEL, SCHEMA],
  [RUNTIME_NODE]: [KIT, KERNEL, SCHEMA],
  [KERNEL]: [KIT, SCHEMA],
  [SCHEMA]: [KIT],
}

const HELP = `Usage:
  node scripts/check-layers.mjs [--help]

Reads every workspace package from "pnpm ls -r" and checks each package.json
@rivus/* dependency (dependencies, devDependencies, peerDependencies,
optionalDependencies) against the "May depend on" column of the Layers table
in AGENTS.md. @rivus/estela-e2e may have no runtime dependencies at all.
A new workspace package needs an ALLOW entry in this script.
Exits 1 and prints one line per violation.
`

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(HELP)
  process.exit(0)
}

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const listed = JSON.parse(
  execFileSync('pnpm', ['ls', '-r', '--depth', '-1', '--json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  }),
)
// "pnpm ls -r" also lists the root project; the layers table only covers the packages.
const projects = listed
  .map(pkg => relative(root, pkg.path))
  .filter(path => path !== '')
  .toSorted()

const violations = []
for (const project of projects) {
  const manifest = JSON.parse(readFileSync(join(root, project, 'package.json'), 'utf8'))
  if (manifest.name === '@rivus/estela-e2e' && Object.keys(manifest.dependencies ?? {}).length > 0) {
    violations.push(
      `check-layers: ${manifest.name} has runtime dependencies; it may only use devDependencies (test tooling)`,
    )
  }
  if (!Object.hasOwn(ALLOW, manifest.name)) {
    violations.push(`check-layers: ${manifest.name} has no allow-list entry`)
  }
  for (const field of FIELDS) {
    const deps = manifest[field]
    if (!deps) {
      continue
    }
    const allowed = new Set(ALLOW[manifest.name] ?? [])
    for (const name of Object.keys(deps)) {
      if (!name.startsWith('@rivus/')) {
        continue
      }
      if (!allowed.has(name)) {
        violations.push(
          `check-layers: ${manifest.name} depends on ${name} (${field}), which the AGENTS.md Layers table does not allow`,
        )
      }
    }
  }
}

if (violations.length > 0) {
  for (const line of violations) {
    console.error(line)
  }
  process.exit(1)
}

console.log(`check-layers: ok (${projects.length} projects)`)
