import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { nodeIO } from './node-io.ts'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function fixture(name: string, bytes: Buffer): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'node-io-'))
  dirs.push(dir)
  const path = join(dir, name)
  await writeFile(path, bytes)
  return path
}

async function collect(path: string) {
  const rows = []
  for await (const row of nodeIO.lines(path))
    rows.push(row)
  return rows
}

describe('NodeIO.lines', () => {
  it('records byte offsets for ASCII lines', async () => {
    const path = await fixture('ascii.txt', Buffer.from('alpha\nbeta\n'))
    const rows = await collect(path)
    expect(rows).toEqual([
      { text: 'alpha', offset: 0, length: 5, line: 1 },
      { text: 'beta', offset: 6, length: 4, line: 2 },
    ])
    for (const row of rows) {
      const bytes = await nodeIO.readBytes(path, { start: row.offset, end: row.offset + row.length })
      expect(new TextDecoder().decode(bytes)).toBe(row.text)
    }
  })

  it('counts multi-byte UTF-8 in the offset', async () => {
    const path = await fixture('utf8.txt', Buffer.from('héllo\n世界\n'))
    const rows = await collect(path)
    expect(rows.map(row => row.text)).toEqual(['héllo', '世界'])
    expect(rows[0]?.offset).toBe(0)
    expect(rows[0]?.length).toBe(Buffer.byteLength('héllo'))
    expect(rows[1]?.offset).toBe(Buffer.byteLength('héllo\n'))
    for (const row of rows) {
      const bytes = await nodeIO.readBytes(path, { start: row.offset, end: row.offset + row.length })
      expect(new TextDecoder().decode(bytes)).toBe(row.text)
    }
  })

  it('treats CRLF as a line ending and not part of the text', async () => {
    const path = await fixture('crlf.txt', Buffer.from('one\r\ntwo\r\n'))
    const rows = await collect(path)
    expect(rows).toEqual([
      { text: 'one', offset: 0, length: 3, line: 1 },
      { text: 'two', offset: 5, length: 3, line: 2 },
    ])
    for (const row of rows) {
      const bytes = await nodeIO.readBytes(path, { start: row.offset, end: row.offset + row.length })
      expect(new TextDecoder().decode(bytes)).toBe(row.text)
    }
  })

  it('yields the last line when the file has no trailing newline', async () => {
    const path = await fixture('tail.txt', Buffer.from('a\nb'))
    const rows = await collect(path)
    expect(rows).toEqual([
      { text: 'a', offset: 0, length: 1, line: 1 },
      { text: 'b', offset: 2, length: 1, line: 2 },
    ])
    const last = rows[1]!
    const bytes = await nodeIO.readBytes(path, { start: last.offset, end: last.offset + last.length })
    expect(new TextDecoder().decode(bytes)).toBe('b')
  })
})

describe('NodeIO.lines chunks', () => {
  it('reads a line longer than the 64 KB chunk', async () => {
    const body = 'a'.repeat(70_000)
    const path = await fixture('long.txt', Buffer.from(`${body}\n`))
    const rows = await collect(path)
    expect(rows).toEqual([{ text: body, offset: 0, length: body.length, line: 1 }])
    const bytes = await nodeIO.readBytes(path, { start: 0, end: body.length })
    expect(new TextDecoder().decode(bytes)).toBe(body)
  })

  it('joins a multi-byte character and CRLF that cross a chunk boundary', async () => {
    const chunk = 64 * 1024
    const prefix = Buffer.alloc(chunk - 1, 0x61)
    const file = Buffer.concat([prefix, Buffer.from([0xc3, 0xa9]), Buffer.from('\r\nz')])
    const path = await fixture('span.txt', file)
    const rows = await collect(path)
    expect(rows.map(row => row.text)).toEqual([`${'a'.repeat(chunk - 1)}é`, 'z'])
    expect(rows[0]?.length).toBe(chunk - 1 + 2)
    expect(rows[1]?.offset).toBe(chunk - 1 + 2 + 2)
    for (const row of rows) {
      const bytes = await nodeIO.readBytes(path, { start: row.offset, end: row.offset + row.length })
      expect(new TextDecoder().decode(bytes)).toBe(row.text)
    }
  })
})

describe('NodeIO.stat', () => {
  it('returns null when the path does not exist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'node-io-'))
    dirs.push(dir)
    expect(await nodeIO.stat(join(dir, 'missing.txt'))).toBeNull()
  })

  it('rethrows errors other than ENOENT', async () => {
    const path = await fixture('file.txt', Buffer.from('x'))
    await expect(nodeIO.stat(join(path, 'child'))).rejects.toMatchObject({ code: 'ENOTDIR' })
  })
})
