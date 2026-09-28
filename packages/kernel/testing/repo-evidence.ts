import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Browser-bundle and oxlint sources for conformance check 9. */
export function repoEvidence(): { browserBundleSource: string, oxlintSource: string } {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
  return {
    browserBundleSource: readFileSync(join(root, 'scripts/check-browser-bundle.mjs'), 'utf8'),
    oxlintSource: readFileSync(join(root, '.oxlintrc.json'), 'utf8'),
  }
}

/** Write a session larger than 128 KB from a one-line template. The caller picks a temp directory. */
export function writeOversized(directory: string, name: string, line: string): string {
  mkdirSync(directory, { recursive: true })
  const path = join(directory, name)
  const once = line.endsWith('\n') ? line : `${line}\n`
  let body = ''
  while (Buffer.byteLength(body) <= 128 * 1024)
    body += once
  writeFileSync(path, body)
  return path
}
