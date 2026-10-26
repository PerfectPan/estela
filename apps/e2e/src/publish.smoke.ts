import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vite-plus/test'
import { repo } from './prepare-run.ts'

const exec = promisify(execFile)
const sha = 'a'.repeat(40)

interface Scenario {
  missing?: boolean
  queryError?: string
  integrityConflict?: boolean
  tagConflict?: boolean
  tagMatches?: boolean
  tagRace?: boolean
  tarballMissing?: boolean
  tarballCorrupt?: boolean
  releaseExists?: boolean
  releaseQueryError?: boolean
  version?: string
  dryRun?: boolean
}

async function scenario(options: Scenario = {}) {
  const root = await mkdtemp(join(tmpdir(), 'agent-trace-publish-'))
  const bin = join(root, 'bin')
  const cli = join(root, 'apps/cli')
  const packageDir = join(root, 'package')
  await Promise.all([mkdir(bin), mkdir(cli, { recursive: true }), mkdir(packageDir)])
  const manifest = { name: '@rivus/agent-trace', version: options.version ?? '0.1.0' }
  await Promise.all([
    writeFile(join(cli, 'package.json'), JSON.stringify(manifest)),
    writeFile(join(packageDir, 'package.json'), JSON.stringify(manifest)),
    writeFile(join(cli, 'CHANGELOG.md'), '# Changelog\n\n## 0.1.0\n\n- First release.\n\n## 0.0.1\n\n- Older.\n'),
  ])
  const tarball = join(root, 'tested.tgz')
  await exec('tar', ['-czf', tarball, '-C', root, 'package'])
  const bytes = await readFile(tarball)
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
  const server = createServer((_request, response) => {
    response.writeHead(options.tarballMissing ? 404 : 200)
    response.end(options.tarballCorrupt ? 'other tarball' : bytes)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Expected a TCP server address')
  }
  const metadata = {
    ...manifest,
    dist: {
      integrity: options.integrityConflict ? 'sha512-conflict' : integrity,
      tarball: `http://127.0.0.1:${address.port}/tested.tgz`,
    },
  }
  const log = join(root, 'commands')
  const shim = `#!${process.execPath}
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
const options = ${JSON.stringify(options)}
const metadata = ${JSON.stringify(metadata)}
const root = ${JSON.stringify(root)}
const sha = ${JSON.stringify(sha)}
const [command, ...args] = process.argv.slice(1)
const name = basename(command)
appendFileSync(${JSON.stringify(log)}, name + ' ' + args.join(' ') + '\\n')
const uploaded = join(root, 'uploaded')
const tag = join(root, 'tag')
if (name === 'git') {
  if (args[0] === 'ls-remote') {
    const target = options.tagConflict ? 'b'.repeat(40) : options.tagMatches ? sha : existsSync(tag) ? readFileSync(tag, 'utf8') : ''
    if (target) process.stdout.write(target + '\\trefs/tags/v0.1.0\\n')
  } else if (args[0] === 'push') writeFileSync(tag, sha)
  else process.exit(90)
} else if (name === 'npm') {
  if (args[0] !== 'view' || args[1] !== '@rivus/agent-trace@0.1.0') process.exit(91)
  if (options.tagRace) writeFileSync(tag, 'b'.repeat(40))
  if (options.queryError || (options.missing && !existsSync(uploaded))) {
    process.stdout.write(JSON.stringify({ error: { code: options.queryError || 'E404' } }))
    process.exit(1)
  }
  process.stdout.write(JSON.stringify(metadata))
} else if (name === 'pnpm') {
  if (args[0] !== 'publish') process.exit(92)
  writeFileSync(uploaded, '')
} else if (name === 'gh') {
  if (args[1] === 'view') {
    if (options.releaseExists) process.stdout.write('{"tagName":"v0.1.0"}')
    else {
      process.stderr.write(options.releaseQueryError ? 'HTTP 403: forbidden' : 'release not found')
      process.exit(1)
    }
  } else if (args[1] !== 'create') process.exit(93)
} else process.exit(94)
`
  for (const command of ['git', 'npm', 'pnpm', 'gh']) {
    const path = join(bin, command)
    await writeFile(path, shim)
    await chmod(path, 0o755)
  }
  try {
    const result = await new Promise<{ ok: boolean; output: string }>(resolve =>
      execFile(
        process.execPath,
        [join(repo, 'scripts/publish.mjs'), options.dryRun ? '--dry-run' : '--publish'],
        {
          cwd: root,
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            GITHUB_SHA: sha,
            RUNNER_TEMP: root,
            AGENT_TRACE_SMOKE_TARBALL: tarball,
            NPM_TOKEN: '',
            NODE_AUTH_TOKEN: '',
          },
        },
        (error, stdout, stderr) => resolve({ ok: !error, output: stdout + stderr }),
      ),
    )
    const commands = await readFile(log, 'utf8').catch(() => '')
    const notes = await readFile(join(root, 'agent-trace-release-notes.md'), 'utf8').catch(() => '')
    return { ...result, commands, notes, tarball }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
    await rm(root, { recursive: true, force: true })
  }
}

describe('release recovery and publication guards', () => {
  it('recovers a release for the exact existing tarball without uploading it again', async () => {
    const result = await scenario()
    expect(result.ok, result.output).toBe(true)
    expect(result.commands).not.toContain('pnpm publish')
    expect(result.commands).toContain('gh release create v0.1.0 --verify-tag')
    expect(result.notes).toBe('- First release.\n')
  })

  it('uploads only after E404, waits for exact availability, and uses the tested artifact', async () => {
    const result = await scenario({ missing: true })
    expect(result.ok, result.output).toBe(true)
    expect(result.commands).toContain(`pnpm publish ${result.tarball} --access public`)
    expect(result.commands).toContain('--publish-wait-timeout 600000')
    expect(result.commands.match(/npm view @rivus\/agent-trace@0.1.0/g)).toHaveLength(2)
    expect(result.commands).toContain('gh release create')
  })

  it('finishes without creating another release when the release already exists', async () => {
    const result = await scenario({ releaseExists: true, tagMatches: true })
    expect(result.ok, result.output).toBe(true)
    expect(result.commands).not.toContain('pnpm publish')
    expect(result.commands).not.toContain('git push')
    expect(result.commands).not.toContain('gh release create')
  })

  it.each(['E401', 'E403', 'E500', 'ECONNRESET'])('fails closed on registry query %s', async queryError => {
    const result = await scenario({ queryError })
    expect(result.ok).toBe(false)
    expect(result.commands).not.toContain('pnpm publish')
    expect(result.commands).not.toContain('git push')
    expect(result.commands).not.toContain('gh release create')
  })

  it.each([{ integrityConflict: true }, { tarballMissing: true }, { tarballCorrupt: true }])(
    'refuses to release an existing package that differs or cannot be downloaded: %j',
    async options => {
      const result = await scenario(options)
      expect(result.ok).toBe(false)
      expect(result.commands).not.toContain('pnpm publish')
      expect(result.commands).not.toContain('git push')
      expect(result.commands).not.toContain('gh release create')
    },
  )

  it('rejects a conflicting tag before querying npm or uploading', async () => {
    const result = await scenario({ missing: true, tagConflict: true })
    expect(result.ok).toBe(false)
    expect(result.output).toContain('already points to')
    expect(result.commands).not.toContain('npm view')
    expect(result.commands).not.toContain('pnpm publish')
  })

  it('checks the tag again before release to detect a concurrent conflict', async () => {
    const result = await scenario({ tagRace: true })
    expect(result.ok).toBe(false)
    expect(result.output).toContain('already points to')
    expect(result.commands).not.toContain('git push')
    expect(result.commands).not.toContain('gh release create')
  })

  it('does not mistake a release query error for a missing release', async () => {
    const result = await scenario({ releaseQueryError: true })
    expect(result.ok).toBe(false)
    expect(result.commands).not.toContain('gh release create')
  })

  it('dry run needs no npm authentication and performs no upload or remote write', async () => {
    const result = await scenario({ dryRun: true })
    expect(result.ok, result.output).toBe(true)
    expect(result.output).toContain('Dry run: v0.1.0')
    expect(result.commands).not.toMatch(/npm |pnpm |gh |git push/)
  })

  it('rejects 0.0.0 before reading or writing any remote state', async () => {
    const result = await scenario({ version: '0.0.0' })
    expect(result.ok).toBe(false)
    expect(result.output).toContain('0.0.0 cannot be released')
    expect(result.commands).toBe('')
  })
})
