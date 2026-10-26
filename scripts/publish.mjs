#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import process from 'node:process'

const require = createRequire(new URL('../apps/cli/package.json', import.meta.url))
const z = require('zod/mini')
const registry = 'https://registry.npmjs.org/'
const manifestSchema = z.object({
  name: z.literal('@rivus/agent-trace'),
  version: z.string().check(z.regex(/^\d+\.\d+\.\d+(?:-[\da-z.-]+)?(?:\+[\da-z.-]+)?$/i)),
})
const publishedSchema = z.object({
  name: z.string(),
  version: z.string(),
  dist: z.object({ integrity: z.string(), tarball: z.url() }),
})
const registryErrorSchema = z.object({ error: z.object({ code: z.string() }) })

function command(file, args) {
  const result = spawnSync(file, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (result.error) {
    throw result.error
  }
  return result
}

function checked(file, args) {
  const result = command(file, args)
  if (result.status !== 0) {
    throw new Error(`${file} ${args.join(' ')} failed:\n${result.stdout}${result.stderr}`)
  }
  return result.stdout
}

function integrity(bytes) {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`
}

function releaseNotes(changelog, version) {
  const lines = changelog.split(/\r?\n/)
  const headings = lines.flatMap((line, index) => (line === `## ${version}` ? [index] : []))
  if (headings.length !== 1) {
    throw new Error(`CHANGELOG.md must contain exactly one section for ${version}`)
  }
  const start = headings[0] + 1
  const next = lines.findIndex((line, index) => index >= start && line.startsWith('## '))
  const notes = lines
    .slice(start, next === -1 ? undefined : next)
    .join('\n')
    .trim()
  if (!notes) {
    throw new Error(`CHANGELOG.md has no release notes for ${version}`)
  }
  return `${notes}\n`
}

function remoteTag(tag, sha) {
  const refs = checked('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`]).trim()
  if (!refs) {
    return false
  }
  const targets = new Map(
    refs.split('\n').map(line => {
      const [target, ref] = line.split('\t')
      if (!/^[\da-f]{40,64}$/.test(target) || ![`refs/tags/${tag}`, `refs/tags/${tag}^{}`].includes(ref)) {
        throw new Error(`Unexpected git tag response: ${line}`)
      }
      return [ref, target]
    }),
  )
  const target = targets.get(`refs/tags/${tag}^{}`) ?? targets.get(`refs/tags/${tag}`)
  if (target !== sha) {
    throw new Error(`${tag} already points to ${target}, expected ${sha}`)
  }
  return true
}

function published(spec) {
  const result = command('npm', ['view', spec, 'name', 'version', 'dist', '--json', '--registry', registry])
  if (result.status === 0) {
    return publishedSchema.parse(JSON.parse(result.stdout))
  }
  if (result.stdout.trim()) {
    const error = registryErrorSchema.parse(JSON.parse(result.stdout))
    if (error.error.code === 'E404') {
      return undefined
    }
  }
  throw new Error(`Cannot query ${spec}:\n${result.stdout}${result.stderr}`)
}

async function verifyPublished(value, manifest, expectedIntegrity) {
  if (
    value.name !== manifest.name
    || value.version !== manifest.version
    || value.dist.integrity !== expectedIntegrity
  ) {
    throw new Error('The published package does not match the tested tarball')
  }
  const response = await fetch(value.dist.tarball)
  if (!response.ok) {
    throw new Error(`Published tarball is unavailable: HTTP ${response.status}`)
  }
  if (integrity(Buffer.from(await response.arrayBuffer())) !== expectedIntegrity) {
    throw new Error('The downloaded registry tarball does not match the tested tarball')
  }
}

const args = process.argv.slice(2)
if (args.length > 1 || (args.length === 1 && !['--check-version', '--dry-run', '--publish'].includes(args[0]))) {
  throw new Error('Usage: node scripts/publish.mjs [--check-version|--dry-run|--publish]')
}
const manifest = manifestSchema.parse(JSON.parse(await readFile('apps/cli/package.json', 'utf8')))
if (manifest.version === '0.0.0') {
  throw new Error(
    'Set the first release version and consume its changesets before publishing; 0.0.0 cannot be released',
  )
}
process.stdout.write(`Release ${manifest.name}@${manifest.version}\n`)
if (args[0] === '--check-version') {
  process.exit(0)
}

const tarball = z.string().check(z.minLength(1)).parse(process.env.AGENT_TRACE_SMOKE_TARBALL)
const sha = z
  .string()
  .check(z.regex(/^[\da-f]{40}$/))
  .parse(process.env.GITHUB_SHA)
const tag = `v${manifest.version}`
const packed = manifestSchema.parse(JSON.parse(checked('tar', ['-xOf', tarball, 'package/package.json'])))
if (packed.name !== manifest.name || packed.version !== manifest.version) {
  throw new Error('The tested tarball version differs from apps/cli/package.json')
}
const expectedIntegrity = integrity(await readFile(tarball))
const notes = releaseNotes(await readFile('apps/cli/CHANGELOG.md', 'utf8'), manifest.version)
remoteTag(tag, sha)

// Dry runs inspect the smoke-tested artifact without requesting npm credentials or running publish.
if (args[0] !== '--publish') {
  process.stdout.write(`Dry run: ${tag}, ${expectedIntegrity}\n${notes}`)
  process.exit(0)
}

const spec = `${manifest.name}@${manifest.version}`
let existing = published(spec)
if (existing) {
  await verifyPublished(existing, manifest, expectedIntegrity)
  process.stdout.write(`${spec} already contains the tested tarball; recovering its GitHub Release\n`)
} else {
  process.stdout.write(
    checked('pnpm', [
      'publish',
      tarball,
      '--access',
      'public',
      '--no-git-checks',
      '--registry',
      registry,
      '--publish-wait-timeout',
      '600000',
    ]),
  )
  existing = published(spec)
  if (!existing) {
    throw new Error(`${spec} is still unavailable after publish`)
  }
  await verifyPublished(existing, manifest, expectedIntegrity)
}

// A concurrent tag creation must not make the release silently point at another commit.
if (!remoteTag(tag, sha)) {
  process.stdout.write(checked('git', ['push', 'origin', `${sha}:refs/tags/${tag}`]))
}
if (!remoteTag(tag, sha)) {
  throw new Error(`${tag} is missing after tag creation`)
}
const release = command('gh', ['release', 'view', tag, '--json', 'tagName'])
if (release.status === 0) {
  process.stdout.write(`${tag} already has a GitHub Release\n`)
} else if (/release not found|\(HTTP 404\)/i.test(release.stderr)) {
  const notesFile = join(z.string().parse(process.env.RUNNER_TEMP), 'agent-trace-release-notes.md')
  await writeFile(notesFile, notes)
  process.stdout.write(
    checked('gh', ['release', 'create', tag, '--verify-tag', '--title', tag, '--notes-file', notesFile]),
  )
} else {
  throw new Error(`Cannot query the GitHub Release:\n${release.stdout}${release.stderr}`)
}
