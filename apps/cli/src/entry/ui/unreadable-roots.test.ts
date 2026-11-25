import { describe, expect, it } from 'vite-plus/test'
import type { UnreadableRoot } from '@rivus/estela-server'
import { sayUnreadableRoots, unreadableRootLine } from './unreadable-roots.ts'

const claude: UnreadableRoot = {
  agent: 'claude-code',
  displayName: 'Claude Code',
  path: '~/.claude/projects',
  reason: "EACCES: permission denied, stat '~/.claude/projects'",
  code: 'EACCES',
}

describe('unreadableRootLine', () => {
  it('names the agent and the root with `~`, the reason, and the permission fix for reading and entering: never --no-index', () => {
    const line = unreadableRootLine(claude)
    expect(line).toBe(
      "Claude Code ~/.claude/projects (EACCES: permission denied, stat '~/.claude/projects'); "
        + 'its sessions could not be read. Check that your user has read permission (r) on this folder and enter permission (x) on it and on the folders above it.',
    )
  })

  it('asks for the path to be checked, not its permissions, for any other reason or none', () => {
    const loop = unreadableRootLine({ ...claude, code: 'ELOOP' })
    const unknown = unreadableRootLine({ ...claude, code: undefined })
    for (const line of [loop, unknown]) {
      expect(line).toContain('~/.claude/projects')
      expect(line).toMatch(/; its sessions could not be read\. Check that this folder can be reached\.$/)
      expect(line).not.toContain('read permission')
    }
  })
})

describe('sayUnreadableRoots', () => {
  it('says each root at once when the rows came from the discover pass', () => {
    const said: UnreadableRoot[] = []
    const catalog = {
      startedFromIndex: false,
      unreadableRoots: [claude],
      discovered: async () => {},
    }
    sayUnreadableRoots(catalog, root => said.push(root))
    expect(said).toEqual([claude])
  })

  it('waits for the discover pass when the rows came from the index, also when that pass fails', async () => {
    const said: UnreadableRoot[] = []
    let finish!: () => void
    let fail!: (error: Error) => void
    const catalog = {
      startedFromIndex: true,
      unreadableRoots: [claude],
      discovered: () =>
        new Promise<void>((resolve, reject) => {
          finish = resolve
          fail = reject
        }),
    }
    sayUnreadableRoots(catalog, root => said.push(root))
    expect(said).toEqual([])
    finish()
    await Promise.resolve()
    expect(said).toEqual([claude])

    said.length = 0
    sayUnreadableRoots(catalog, root => said.push(root))
    fail(new Error('stat EIO'))
    await Promise.resolve()
    expect(said).toEqual([claude])
  })

  it('says nothing when every root could be read', () => {
    const said: UnreadableRoot[] = []
    sayUnreadableRoots({ startedFromIndex: false, unreadableRoots: [], discovered: async () => {} }, root =>
      said.push(root),
    )
    expect(said).toEqual([])
  })
})
