import { describe, expect, it } from 'vite-plus/test'
import { failureReport, isListenFailure } from './failure.ts'

describe('failureReport sanitization', () => {
  it('strips VT escapes, control bytes, and bidi overrides from session and index errors', () => {
    const report = failureReport({
      kind: 'session',
      action: 'load',
      label: '/tmp/\u001b]8;;https://evil.example\u0007click\u001b]8;;\u0007/\u202Egpj.exe',
      cause: new Error('\u001b[31mbad\u001b[0m\nline\u202E\u0000detail'),
    })
    expect(report.exitCode).toBe(1)
    expect(report.message?.cause).toBe('Could not load /tmp/click/gpj.exe: bad line detail')
    expect(report.message?.cause).not.toContain('\u001b')
    expect(report.message?.cause).not.toContain('\u0007')
    expect(report.message?.cause).not.toContain('\u202E')

    const usageReport = failureReport({
      kind: 'usage',
      detail: 'line1\n\u001b[31mline2\u001b[0m\u202E',
    })
    expect(usageReport.message?.cause).toBe('line1\nline2')
  })

  it('formats output errors with exit code 1', () => {
    const buildOut = failureReport({
      kind: 'output',
      action: 'build',
      cause: new Error('Output directory is not empty: /tmp/\u001b[31mdir\u001b[0m'),
    })
    expect(buildOut.exitCode).toBe(1)
    expect(buildOut.message?.cause).toBe('Could not write build output: Output directory is not empty: /tmp/dir')

    const exportOut = failureReport({
      kind: 'output',
      action: 'export',
      cause: new Error('Refusing symlink'),
    })
    expect(exportOut.exitCode).toBe(1)
    expect(exportOut.message?.fix).toContain('--out')
  })

  it('points unknown format generation failures to the issue tracker', () => {
    const report = failureReport({
      kind: 'session',
      action: 'load',
      label: '/tmp/session.jsonl',
      cause: new Error('claude-code: /tmp/session.jsonl:1: unknown format generation'),
    })
    expect(report.exitCode).toBe(1)
    expect(report.message?.cause).toBe(
      'Could not load /tmp/session.jsonl: claude-code: /tmp/session.jsonl:1: unknown format generation',
    )
    expect(report.message?.fix).toContain('https://github.com/PerfectPan/estela/issues/new/choose')
    expect(report.message?.fix).toContain('npx @rivus/estela@latest')
  })
})

describe('isListenFailure and listen reports', () => {
  it('recognizes DF0052 and listen syscalls and reports EADDRINUSE cleanly', () => {
    const err = Object.assign(new Error('DF0052'), {
      code: 'DF0052',
      cause: Object.assign(new Error('listen EADDRINUSE: address already in use 127.0.0.1:7392'), {
        code: 'EADDRINUSE',
        syscall: 'listen',
      }),
    })
    expect(isListenFailure(err)).toBe(true)
    const report = failureReport({ kind: 'listen', host: '127.0.0.1', port: 7392, cause: err })
    expect(report).toEqual({
      exitCode: 1,
      message: {
        cause: 'Port 7392 is already in use.',
        fix: 'Stop the process using port 7392, or pass --port with a free port (or omit --port).',
      },
    })
  })

  it('recognizes non-EADDRINUSE listen errors and ignores ordinary errors', () => {
    const addrNotAvail = Object.assign(new Error('listen EADDRNOTAVAIL'), {
      code: 'EADDRNOTAVAIL',
      syscall: 'listen',
    })
    expect(isListenFailure(addrNotAvail)).toBe(true)
    const report = failureReport({ kind: 'listen', host: '203.0.113.1', port: 7392, cause: addrNotAvail })
    expect(report.exitCode).toBe(1)
    expect(report.message?.cause).toContain('Cannot listen on host 203.0.113.1')

    expect(isListenFailure(new Error('boom'))).toBe(false)
    expect(isListenFailure(null)).toBe(false)
  })
})
