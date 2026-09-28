#!/usr/bin/env node
// Dependency direction for @rivus/* packages. See docs/plans/0001-external-release.md section 2.2.
// host-opencode stays in the allow-list; plan section 7, "OpenCode needs SqliteIO".
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
const KERNEL = '@rivus/agent-trace-kernel'
const SCHEMA = '@rivus/agent-trace-schema'
const RPC = '@rivus/agent-trace-rpc'
const CORE = [RPC, KERNEL, SCHEMA]
const HOSTS = [
  '@rivus/agent-trace-host-claude-code',
  '@rivus/agent-trace-host-codex',
  '@rivus/agent-trace-host-grok',
  '@rivus/agent-trace-host-opencode',
  '@rivus/agent-trace-host-dsh',
]
const HOST_DEPS = [KERNEL, SCHEMA]
const RUNTIME = '@rivus/agent-trace-runtime-node'

const ALLOW = {
  '@rivus/agent-trace': ['@rivus/agent-trace-web', '@rivus/agent-trace-runtime-node', ...CORE, ...HOSTS],
  '@rivus/agent-trace-web': CORE,
  [RPC]: [KERNEL, SCHEMA],
  '@rivus/agent-trace-runtime-node': HOST_DEPS,
  [KERNEL]: [SCHEMA],
  [SCHEMA]: [],
}
for (const host of HOSTS)
  ALLOW[host] = HOST_DEPS

const HELP = `Usage:
  node scripts/check-layers.mjs [--help]

Reads every project from rush.json and checks each package.json @rivus/*
dependency (dependencies, devDependencies, peerDependencies, optionalDependencies)
against the "May depend on" column in docs/plans/0001-external-release.md section 2.2.
Exits 1 and prints one line per violation.
`

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(HELP)
  process.exit(0)
}

const rush = JSON.parse(readFileSync('rush.json', 'utf8'))
const violations = []
for (const project of rush.projects) {
  const manifest = JSON.parse(readFileSync(join(project.projectFolder, 'package.json'), 'utf8'))
  if (manifest.name !== project.packageName) {
    violations.push(`check-layers: ${project.projectFolder} package.json name ${manifest.name} does not match rush.json ${project.packageName}`)
  }
  if (!Object.hasOwn(ALLOW, manifest.name))
    violations.push(`check-layers: ${manifest.name} has no allow-list entry`)
  for (const field of FIELDS) {
    const deps = manifest[field]
    if (!deps)
      continue
    const allowed = new Set(ALLOW[manifest.name] ?? [])
    if (field === 'devDependencies' && HOSTS.includes(manifest.name))
      allowed.add(RUNTIME)
    for (const name of Object.keys(deps)) {
      if (!name.startsWith('@rivus/'))
        continue
      if (!allowed.has(name))
        violations.push(`check-layers: ${manifest.name} depends on ${name} (${field}), which 2.2 does not allow`)
    }
  }
}

if (violations.length > 0) {
  for (const line of violations)
    console.error(line)
  process.exit(1)
}

console.log(`check-layers: ok (${rush.projects.length} projects)`)
