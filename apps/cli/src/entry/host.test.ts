import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { describe, expect, it, vi } from 'vite-plus/test'
import {
  canonicalizeHost,
  createServerOriginGate,
  dialableOrigin,
  isLoopbackHost,
  isWildcardHost,
  secureDevframeDir,
  unbracketHost,
} from './host.ts'

describe('host predicates', () => {
  it('unbrackets and canonicalizes IPv6 literals and normalizes case', () => {
    expect(unbracketHost(' [::1] ')).toBe('::1')
    expect(unbracketHost('LOCALHOST')).toBe('localhost')
    expect(unbracketHost('127.0.0.1')).toBe('127.0.0.1')

    expect(canonicalizeHost('[::1]')).toBe('::1')
    expect(canonicalizeHost('0:0:0:0:0:0:0:1')).toBe('::1')
    expect(canonicalizeHost('0000:0000:0000:0000:0000:0000:0000:0000')).toBe('::')
    expect(canonicalizeHost('LOCALHOST')).toBe('localhost')
  })

  it('distinguishes loopback hosts from wildcards and LAN hosts', () => {
    expect(isLoopbackHost('localhost')).toBe(true)
    expect(isLoopbackHost('127.0.0.1')).toBe(true)
    expect(isLoopbackHost('127.0.1.1')).toBe(true)
    expect(isLoopbackHost('::1')).toBe(true)
    expect(isLoopbackHost('[::1]')).toBe(true)
    expect(isLoopbackHost('0:0:0:0:0:0:0:1')).toBe(true)

    expect(isLoopbackHost('0.0.0.0')).toBe(false)
    expect(isLoopbackHost('::')).toBe(false)
    expect(isLoopbackHost('[::]')).toBe(false)
    expect(isLoopbackHost('192.168.1.10')).toBe(false)
    expect(isLoopbackHost('example.com')).toBe(false)
    expect(isLoopbackHost('')).toBe(false)

    expect(isWildcardHost('0.0.0.0')).toBe(true)
    expect(isWildcardHost('::')).toBe(true)
    expect(isWildcardHost('[::]')).toBe(true)
    expect(isWildcardHost('0:0:0:0:0:0:0:0')).toBe(true)
    expect(isWildcardHost('127.0.0.1')).toBe(false)
  })
})

describe('dialableOrigin', () => {
  it('keeps explicit loopback literals intact instead of falling back to localhost', () => {
    expect(dialableOrigin('127.0.0.1', 7392, 'http://localhost:7392')).toBe('http://127.0.0.1:7392')
    expect(dialableOrigin('::1', 7392, 'http://localhost:7392')).toBe('http://[::1]:7392')
    expect(dialableOrigin('[::1]', 7392, 'http://localhost:7392')).toBe('http://[::1]:7392')
    expect(dialableOrigin('0:0:0:0:0:0:0:1', 7392, 'http://localhost:7392')).toBe('http://[::1]:7392')
  })

  it('uses the fallback origin for wildcard or empty bind hosts', () => {
    expect(dialableOrigin('localhost', 7392, 'http://localhost:7392')).toBe('http://localhost:7392')
    expect(dialableOrigin('0.0.0.0', 7392, 'http://localhost:7392')).toBe('http://localhost:7392')
    expect(dialableOrigin('::', 7392, 'http://localhost:7392')).toBe('http://localhost:7392')
  })
})

describe('createServerOriginGate', () => {
  it('locks explicit loopback bindings to that address and port while allowing no-Origin clients', () => {
    const gate = createServerOriginGate('127.0.0.1')
    expect(gate.registry.isAllowed('http://127.0.0.1:7392')).toBe(false)

    gate.setPort(7392)
    expect(gate.registry.isAllowed(undefined)).toBe(true)
    expect(gate.registry.isAllowed('http://127.0.0.1:7392')).toBe(true)
    expect(gate.registry.isAllowed('http://127.0.0.1:3000')).toBe(false)
    expect(gate.registry.isAllowed('http://localhost:7392')).toBe(false)
    expect(gate.registry.isAllowed('http://[::1]:7392')).toBe(false)
    expect(gate.registry.isAllowed('http://localhost:3000')).toBe(false)
    expect(gate.registry.isAllowed('null')).toBe(false)
    expect(gate.registry.isAllowed('')).toBe(false)
    expect(gate.registry.isAllowed('https://127.0.0.1:7392')).toBe(false)
    expect(
      gate.registry.registerFromUrl('http://localhost:7392/?devframe_viewer_origin=http://evil.example'),
    ).toBeUndefined()
  })

  it('allows loopback origins for localhost and canonicalizes expanded IPv6', () => {
    const localGate = createServerOriginGate('localhost')
    localGate.setPort(7392)
    expect(localGate.registry.isAllowed('http://localhost:7392')).toBe(true)
    expect(localGate.registry.isAllowed('http://127.0.0.1:7392')).toBe(true)
    expect(localGate.registry.isAllowed('http://[::1]:7392')).toBe(true)
    expect(localGate.registry.isAllowed('http://localhost:3000')).toBe(false)
    expect(localGate.registry.isAllowed('http://evil.example:7392')).toBe(false)

    const v6Gate = createServerOriginGate('::1')
    v6Gate.setPort(7392)
    expect(v6Gate.registry.isAllowed('http://[::1]:7392')).toBe(true)
    expect(v6Gate.registry.isAllowed('http://[0:0:0:0:0:0:0:1]:7392')).toBe(true)
    expect(v6Gate.registry.isAllowed('http://[::1]:3000')).toBe(false)

    const expandedGate = createServerOriginGate('0:0:0:0:0:0:0:1')
    expandedGate.setPort(7392)
    expect(expandedGate.registry.isAllowed('http://[::1]:7392')).toBe(true)
  })

  it('restricts wildcard bindings to loopback and local interface IPs and rejects DNS names', () => {
    const wildcardGate = createServerOriginGate('0.0.0.0', () => ['192.168.1.50', 'fd00::1234%en0'])
    wildcardGate.setPort(7392)
    expect(wildcardGate.registry.isAllowed('http://localhost:7392')).toBe(true)
    expect(wildcardGate.registry.isAllowed('http://127.0.0.1:7392')).toBe(true)
    expect(wildcardGate.registry.isAllowed('http://[::1]:7392')).toBe(true)
    expect(wildcardGate.registry.isAllowed('http://192.168.1.50:7392')).toBe(true)
    expect(wildcardGate.registry.isAllowed('http://[fd00::1234]:7392')).toBe(true)
    expect(wildcardGate.registry.isAllowed('http://attacker.example:7392')).toBe(false)
    expect(wildcardGate.registry.isAllowed('http://203.0.113.99:7392')).toBe(false)
    expect(wildcardGate.registry.isAllowed('http://localhost:3000')).toBe(false)

    const v6Wildcard = createServerOriginGate('::', () => ['10.0.0.12'])
    v6Wildcard.setPort(7392)
    expect(v6Wildcard.registry.isAllowed('http://10.0.0.12:7392')).toBe(true)
    expect(v6Wildcard.registry.isAllowed('http://rebind.attacker.test:7392')).toBe(false)
  })
})

describe('secureDevframeDir', () => {
  it('sets 0700 on ~/.estela/devframe and 0600 on pre-existing auth.json without following symlinks', async () => {
    if (process.platform === 'win32') {
      return
    }
    const home = mkdtempSync(join(tmpdir(), 'at-devframe-perm-'))
    try {
      await secureDevframeDir(home)
      const dir = join(home, '.estela', 'devframe')
      expect(statSync(dir).mode & 0o777).toBe(0o700)

      const authFile = join(dir, 'auth.json')
      writeFileSync(authFile, '{"secret":"test"}\n', { mode: 0o644 })
      await secureDevframeDir(home)
      expect(statSync(authFile).mode & 0o777).toBe(0o600)

      const victim = join(home, 'victim.txt')
      writeFileSync(victim, 'ok', { mode: 0o644 })
      const symAuthDir = mkdtempSync(join(tmpdir(), 'at-devframe-sym-'))
      try {
        await secureDevframeDir(symAuthDir)
        symlinkSync(victim, join(symAuthDir, '.estela', 'devframe', 'auth.json'))
        await secureDevframeDir(symAuthDir)
        expect(statSync(victim).mode & 0o777).toBe(0o644)
      } finally {
        rmSync(symAuthDir, { recursive: true, force: true })
      }
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('warns instead of throwing when HOME is unwritable or ~/.estela is not a directory', async () => {
    if (process.platform === 'win32') {
      return
    }
    const base = mkdtempSync(join(tmpdir(), 'at-devframe-err-'))
    try {
      const fileHome = join(base, 'file-home')
      mkdirSync(fileHome)
      writeFileSync(join(fileHome, '.estela'), 'not a directory')
      const warnFile = vi.fn<(message: string) => void>()
      await expect(secureDevframeDir(fileHome, warnFile)).resolves.toBeUndefined()
      expect(warnFile).toHaveBeenCalledTimes(1)

      const symHome = join(base, 'sym-home')
      const symTarget = join(base, 'sym-target')
      mkdirSync(symTarget, { mode: 0o755 })
      mkdirSync(join(symHome, '.estela'), { recursive: true })
      symlinkSync(symTarget, join(symHome, '.estela', 'devframe'))
      const warnSym = vi.fn<(message: string) => void>()
      await expect(secureDevframeDir(symHome, warnSym)).resolves.toBeUndefined()
      expect(warnSym).toHaveBeenCalledTimes(1)
      expect(statSync(symTarget).mode & 0o777).toBe(0o755)

      if (process.getuid?.() !== 0) {
        const roHome = join(base, 'ro-home')
        mkdirSync(roHome, { mode: 0o500 })
        try {
          const warnRo = vi.fn<(message: string) => void>()
          await expect(secureDevframeDir(roHome, warnRo)).resolves.toBeUndefined()
          expect(warnRo).toHaveBeenCalledTimes(1)
        } finally {
          chmodSync(roHome, 0o700)
        }
      }
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})
