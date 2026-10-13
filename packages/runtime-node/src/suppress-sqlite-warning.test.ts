import { describe, expect, it } from 'vite-plus/test'
import { isSqliteExperimentalWarning } from './suppress-sqlite-warning.ts'

describe('isSqliteExperimentalWarning', () => {
  it('matches only the node:sqlite experimental warning', () => {
    expect(
      isSqliteExperimentalWarning(
        'SQLite is an experimental feature and might change at any time',
        'ExperimentalWarning',
      ),
    ).toBe(true)
    expect(isSqliteExperimentalWarning('SQLite is an experimental feature', { type: 'ExperimentalWarning' })).toBe(true)
    const error = Object.assign(new Error('SQLite is an experimental feature'), { name: 'ExperimentalWarning' })
    expect(isSqliteExperimentalWarning(error, undefined)).toBe(true)
    expect(isSqliteExperimentalWarning('WASI is an experimental feature', 'ExperimentalWarning')).toBe(false)
    expect(isSqliteExperimentalWarning('SQLite is slow', 'DeprecationWarning')).toBe(false)
    expect(isSqliteExperimentalWarning('something else', undefined)).toBe(false)
  })
})
