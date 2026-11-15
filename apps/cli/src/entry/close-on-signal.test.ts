import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { closeOnSignal } from './close-on-signal.ts'

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const

afterEach(() => {
  vi.restoreAllMocks()
})

function listeners(): number[] {
  return SIGNALS.map(signal => process.listenerCount(signal))
}

describe('closeOnSignal', () => {
  it.each(SIGNALS)('closes once on %s, then sends it again with no handler left', signal => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const before = listeners()
    const close = vi.fn<() => void>()
    closeOnSignal(close)
    expect(listeners()).toEqual(before.map(count => count + 1))

    process.emit(signal)

    expect(close).toHaveBeenCalledTimes(1)
    expect(kill).toHaveBeenCalledWith(process.pid, signal)
    expect(listeners()).toEqual(before)
  })

  it('still sends the signal when close throws', () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    closeOnSignal(() => {
      throw new Error('database is locked')
    })
    process.emit('SIGTERM')
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM')
  })

  it('removes its handlers when the caller closes the server itself', () => {
    const before = listeners()
    const close = vi.fn<() => void>()
    const remove = closeOnSignal(close)
    remove()
    expect(listeners()).toEqual(before)
    expect(close).not.toHaveBeenCalled()
  })
})
