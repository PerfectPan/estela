#!/usr/bin/env node
// Dependency direction for @rivus/* packages: the "May depend on" column of the Layers table in AGENTS.md.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
const KERNEL = '@rivus/agent-trace-kernel'
const SCHEMA = '@rivus/agent-trace-schema'
const RPC = '@rivus/agent-trace-rpc'
const KIT = '@rivus/agent-kit'
const CORE = [RPC, KERNEL, SCHEMA]

const ALLOW = {
  // Only the CLI imports the kit at runtime; oxlint enforces type-only imports elsewhere.
  '@rivus/agent-trace': [KIT, '@rivus/agent-trace-web', '@rivus/agent-trace-runtime-node', ...CORE],
  '@rivus/agent-trace-web': [KIT, ...CORE],
  // Tests the packed tarball from outside; it depends on no workspace package.
  '@rivus/agent-trace-e2e': [],
  [RPC]: [KIT, KERNEL, SCHEMA],
  '@rivus/agent-trace-runtime-node': [KIT, KERNEL, SCHEMA],
  [KERNEL]: [KIT, SCHEMA],
  [SCHEMA]: [KIT],
}

const HELP = `Usage:
  node scripts/check-layers.mjs [--help]

Reads every project from rush.json and checks each package.json @rivus/*
dependency (dependencies, devDependencies, peerDependencies, optionalDependencies)
against the "May depend on" column of the Layers table in AGENTS.md.
@rivus/agent-trace-e2e may have no runtime dependencies at all.
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
    violations.push(
      `check-layers: ${project.projectFolder} package.json name ${manifest.name} does not match rush.json ${project.packageName}`,
    )
  }
  if (manifest.name === '@rivus/agent-trace-e2e' && Object.keys(manifest.dependencies ?? {}).length > 0) {
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

console.log(`check-layers: ok (${rush.projects.length} projects)`)
