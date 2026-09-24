#!/usr/bin/env node
// Dependency direction for @rivus/* packages. See docs/plans/0001-external-release.md section 2.2.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

const ALLOW = {
  '@rivus/agent-trace': [
    '@rivus/agent-trace-web',
    '@rivus/agent-trace-rpc',
    '@rivus/agent-trace-runtime-node',
    '@rivus/agent-trace-kernel',
    '@rivus/agent-trace-schema',
    '@rivus/agent-trace-host-claude-code',
    '@rivus/agent-trace-host-codex',
    '@rivus/agent-trace-host-grok',
    '@rivus/agent-trace-host-opencode',
    '@rivus/agent-trace-host-dsh',
  ],
  '@rivus/agent-trace-web': [
    '@rivus/agent-trace-rpc',
    '@rivus/agent-trace-kernel',
    '@rivus/agent-trace-schema',
  ],
  '@rivus/agent-trace-rpc': [
    '@rivus/agent-trace-kernel',
    '@rivus/agent-trace-schema',
  ],
  '@rivus/agent-trace-runtime-node': [
    '@rivus/agent-trace-kernel',
    '@rivus/agent-trace-schema',
  ],
  '@rivus/agent-trace-kernel': [
    '@rivus/agent-trace-schema',
  ],
  '@rivus/agent-trace-schema': [],
  '@rivus/agent-trace-host-claude-code': [
    '@rivus/agent-trace-kernel',
    '@rivus/agent-trace-schema',
  ],
  '@rivus/agent-trace-host-codex': [
    '@rivus/agent-trace-kernel',
    '@rivus/agent-trace-schema',
  ],
  '@rivus/agent-trace-host-grok': [
    '@rivus/agent-trace-kernel',
    '@rivus/agent-trace-schema',
  ],
  '@rivus/agent-trace-host-opencode': [
    '@rivus/agent-trace-kernel',
    '@rivus/agent-trace-schema',
  ],
  '@rivus/agent-trace-host-dsh': [
    '@rivus/agent-trace-kernel',
    '@rivus/agent-trace-schema',
  ],
}

const HELP = `Usage:
  node scripts/check-layers.mjs [--help]

Reads every project from rush.json and checks each package.json @rivus/*
dependency (dependencies, devDependencies, peerDependencies, optionalDependencies)
against the "May depend on" column in docs/plans/0001-external-release.md section 2.2.
Exits 1 and prints one line per violation.
`

function fail(line) {
  console.error(line)
}

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
  const allowed = new Set(ALLOW[manifest.name] ?? [])
  if (!Object.hasOwn(ALLOW, manifest.name))
    violations.push(`check-layers: ${manifest.name} has no allow-list entry`)
  for (const field of FIELDS) {
    const deps = manifest[field]
    if (!deps)
      continue
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
    fail(line)
  process.exit(1)
}

console.log(`check-layers: ok (${rush.projects.length} projects)`)
