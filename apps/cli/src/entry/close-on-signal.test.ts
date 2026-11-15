import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { closeOnSignal } from './close-on-signal.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('closeOnSignal', () => {
  it.each(['SIGINT', 'SIGTERM'] as const)('closes once on %s, then sends it again with no handler left', signal => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const before = { SIGINT: process.listenerCount('SIGINT'), SIGTERM: process.listenerCount('SIGTERM') }
    const close = vi.fn<() => void>()
    closeOnSignal(close)
    expect(process.listenerCount('SIGINT')).toBe(before.SIGINT + 1)
    expect(process.listenerCount('SIGTERM')).toBe(before.SIGTERM + 1)

    process.emit(signal)

    expect(close).toHaveBeenCalledTimes(1)
    expect(kill).toHaveBeenCalledWith(process.pid, signal)
    expect(process.listenerCount('SIGINT')).toBe(before.SIGINT)
    expect(process.listenerCount('SIGTERM')).toBe(before.SIGTERM)
  })

  it('still sends the signal when close throws', () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    closeOnSignal(() => {
      throw new Error('database is locked')
    })
    process.emit('SIGTERM')
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM')
  })
})
