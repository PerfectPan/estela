/**
 * Invented file contents and command output for the demo session (`demo-session.ts`): a small
 * book catalog API called tinyshelf. Nothing here comes from a real project or session.
 */

/** `cat -n` style, as Claude Code's Read tool returns a file. */
export function numbered(text: string, from = 1): string {
  return text
    .split('\n')
    .map((line, index) => `${String(from + index).padStart(6)}\t${line}`)
    .join('\n')
}

export const ROUTE_BEFORE = `import { Hono } from 'hono'
import { z } from 'zod'
import { listBooks, getBook, createBook } from '../store/books.ts'
import { requireApiKey } from '../middleware/api-key.ts'

export const books = new Hono()

books.get('/', async c => {
  const author = c.req.query('author')
  const rows = await listBooks({ author })
  return c.json({ items: rows })
})

books.get('/:id', async c => {
  const book = await getBook(c.req.param('id'))
  if (!book) {
    return c.json({ error: 'not_found' }, 404)
  }
  return c.json(book)
})

const NewBook = z.object({
  title: z.string().min(1),
  author: z.string().min(1),
  isbn: z.string().regex(/^97[89]\\d{10}$/).optional(),
  year: z.number().int().min(1450).max(2100),
})

books.post('/', requireApiKey, async c => {
  const parsed = NewBook.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: 'invalid', issues: parsed.error.issues }, 400)
  }
  const book = await createBook(parsed.data)
  return c.json(book, 201)
})`

export const STORE_BEFORE = `import { db } from '../db.ts'

export interface Book {
  id: number
  title: string
  author: string
  isbn: string | null
  year: number
}

export interface ListOptions {
  author?: string
}

export async function listBooks(options: ListOptions = {}): Promise<Book[]> {
  if (options.author) {
    return db.all<Book>('SELECT * FROM books WHERE author = ? ORDER BY id', options.author)
  }
  return db.all<Book>('SELECT * FROM books ORDER BY id')
}

export async function getBook(id: string): Promise<Book | undefined> {
  return db.get<Book>('SELECT * FROM books WHERE id = ?', Number(id))
}

export async function createBook(input: Omit<Book, 'id' | 'isbn'> & { isbn?: string }): Promise<Book> {
  const result = await db.run(
    'INSERT INTO books (title, author, isbn, year) VALUES (?, ?, ?, ?)',
    input.title,
    input.author,
    input.isbn ?? null,
    input.year,
  )
  return { id: Number(result.lastID), isbn: null, ...input }
}`

export const STORE_PAGE = `export interface PageOptions {
  author?: string
  limit: number
  cursor?: number
}

export interface Page {
  items: Book[]
  nextCursor: number | null
}

/** Rows after \`cursor\` in id order; one extra row tells whether another page exists. */
export async function listBooksPage(options: PageOptions): Promise<Page> {
  const where = options.author ? 'WHERE author = ? AND id > ?' : 'WHERE id > ?'
  const params = options.author ? [options.author, options.cursor ?? 0] : [options.cursor ?? 0]
  const rows = await db.all<Book>(\`SELECT * FROM books \${where} ORDER BY id LIMIT ?\`, ...params, options.limit + 1)
  const items = rows.slice(0, options.limit)
  return { items, nextCursor: rows.length > options.limit ? items.at(-1)!.id : null }
}`

export const TEST_BEFORE = `import { describe, expect, it, beforeAll } from 'vitest'
import { app } from '../src/app.ts'
import { seed } from './seed.ts'

beforeAll(async () => {
  await seed(120)
})

describe('GET /books', () => {
  it('lists books in id order', async () => {
    const res = await app.request('/books')
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.items[0].id).toBe(1)
  })

  it('pages with limit and cursor', async () => {
    const first = await (await app.request('/books?limit=50')).json()
    expect(first.items).toHaveLength(50)
    const second = await (await app.request(\`/books?limit=50&cursor=\${first.nextCursor}\`)).json()
    expect(second.items[0].id).toBe(51)
  })

  it('uses the default page size', async () => {
    const body = await (await app.request('/books')).json()
    expect(body.items).toHaveLength(50)
  })

  it('filters by author', async () => {
    const body = await (await app.request('/books?author=Ines%20Varga')).json()
    expect(body.items.every((book: { author: string }) => book.author === 'Ines Varga')).toBe(true)
  })
})`

export const README_API = `## API

| Method | Path         | Notes                                   |
|--------|--------------|-----------------------------------------|
| GET    | /books       | All books, oldest first. \`?author=\` filters. |
| GET    | /books/:id   | One book, or 404.                       |
| POST   | /books       | Needs \`x-api-key\`. Body: title, author, year, isbn? |

Responses are JSON. Errors look like \`{ "error": "not_found" }\`.`

export const MIGRATION_ISBN = `-- 0003: optional ISBN-13 per book
ALTER TABLE books ADD COLUMN isbn TEXT;
CREATE UNIQUE INDEX books_isbn_idx ON books (isbn) WHERE isbn IS NOT NULL;`

export const MIGRATION_INDEX = `-- 0004: keyset pagination by author walks (author, id) instead of scanning books
CREATE INDEX IF NOT EXISTS books_author_id_idx ON books (author, id);`

const AUTHORS = ['Ines Varga', 'Tomas Reyes', 'Mara Ocampo', 'Jun Takeda', 'Lena Ostrova', 'Pavel Brandt']
const WORDS = ['Salt', 'Lanterns', 'Orchard', 'Winter', 'Harbor', 'Glass', 'Atlas', 'Copper', 'Tides', 'Quiet']

/** The verbose Vitest report of the whole suite: `failing` names the test that fails. */
export function vitestRun(
  cwd: string,
  file: string,
  tests: string[],
  failing?: { name: string; message: string[] },
): string {
  const lines = [` RUN  v3.2.4 ${cwd}`, '']
  for (const name of tests) {
    const ms = 3 + ((name.length * 7) % 40)
    lines.push(`   ${name === failing?.name ? '×' : '✓'} ${file} > ${name} ${ms}ms`)
  }
  if (failing) {
    lines.push('', '⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯', '', ` FAIL  ${file} > ${failing.name}`, ...failing.message)
  }
  const passed = tests.length - (failing ? 1 : 0)
  lines.push(
    '',
    ` Test Files  ${failing ? '1 failed' : '1 passed'} (1)`,
    `      Tests  ${failing ? `1 failed | ${passed} passed` : `${passed} passed`} (${tests.length})`,
    `   Duration  ${(0.6 + tests.length * 0.04).toFixed(2)}s`,
  )
  return lines.join('\n')
}

/** The whole suite across files, as `pnpm test` prints it. */
export function fullSuite(cwd: string): string {
  const files = [
    ['test/books.test.ts', 7],
    ['test/book-by-id.test.ts', 4],
    ['test/create-book.test.ts', 9],
    ['test/api-key.test.ts', 5],
    ['test/migrations.test.ts', 6],
    ['test/health.test.ts', 2],
  ] as const
  const lines = [`> tinyshelf@0.4.0 test ${cwd}`, '> vitest run', '', ` RUN  v3.2.4 ${cwd}`, '']
  let total = 0
  for (const [file, count] of files) {
    total += count
    lines.push(` ✓ ${file} (${count} tests) ${40 + count * 11}ms`)
  }
  lines.push('', ' Test Files  6 passed (6)', `      Tests  ${total} passed (${total})`, '   Duration  2.31s')
  return lines.join('\n')
}

/** `grep -rn` style hits. */
export function grepHits(hits: [string, number, string][]): string {
  return hits.map(([file, line, text]) => `${file}:${line}:${text}`).join('\n')
}

/** Seed rows as `seed.ts` prints them with `--dry-run`. */
export function seedPreview(count: number): string {
  const rows = ['id | title | author | year']
  for (let id = 1; id <= count; id++) {
    const title = `${WORDS[id % WORDS.length]} ${WORDS[(id * 3) % WORDS.length]!.toLowerCase()}`
    rows.push(`${id} | ${title} | ${AUTHORS[id % AUTHORS.length]} | ${1950 + ((id * 7) % 70)}`)
  }
  return rows.join('\n')
}
