import { afterEach, describe, expect, it } from 'vitest'
import { sayReady } from './terminal.ts'

const stdout = process.stdout as NodeJS.WriteStream & { columns: number | undefined }
const original = {
  isTTY: stdout.isTTY,
  columns: stdout.columns,
  write: stdout.write.bind(stdout),
}

afterEach(() => {
  stdout.isTTY = original.isTTY
  stdout.columns = original.columns
  stdout.write = original.write
  delete process.env.NO_COLOR
})

function capture(columns: number): string[] {
  const chunks: string[] = []
  stdout.isTTY = true
  stdout.columns = columns
  delete process.env.NO_COLOR
  stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk))
    return true
  }) as typeof stdout.write
  return chunks
}

describe('sayReady', () => {
  const url = 'http://localhost:7392/__agent-trace/'

  it('does not throw when stdout has 0 columns', () => {
    const chunks = capture(0)
    expect(() => sayReady(url)).not.toThrow()
    expect(chunks.join('')).toContain(`Ready: ${url}`)
  })

  it('does not throw when stdout has 8 columns', () => {
    const chunks = capture(8)
    expect(() => sayReady(url)).not.toThrow()
    expect(chunks.join('')).toContain(`Ready: ${url}`)
  })
})
