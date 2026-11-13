import type { SessionWriter } from './demo-writer.ts'
import { grepHits, numbered, ROUTE_BEFORE, STORE_BEFORE, STORE_PAGE, TEST_BEFORE, vitestRun } from './demo-files.ts'

const BOOK_TESTS = [
  'lists books in id order',
  'pages with limit and cursor',
  'uses the default page size',
  'filters by author',
]

/** Turns 1 and 2 of the demo session (`demo-session.ts`): cursor pagination with an Explore subagent, then the empty cursor. */
export function paginationTurns(
  writer: SessionWriter,
  cwd: string,
  options: { subagent: string; systemPrompt: string[]; tools: unknown[] },
): void {
  const main = writer.main
  const file = (name: string) => `${cwd}/${name}`
  // Turn 1: pagination.
  main.tick(20)
  let turn = writer.clock
  main.user(
    'GET /books returns every row, which is getting slow. Add cursor pagination (limit + cursor query params, default 50, max 200) and keep the response shape backwards compatible.',
  )
  let tool = main.request({
    thinking:
      'Start from the route and the store. Keyset pagination on id is enough: the ids are monotonic and the list is already ordered by id.',
    text: "I'll read the route and the store first.",
    tool: { name: 'Read', input: { file_path: file('src/routes/books.ts') } },
    output: 312,
    seconds: 6,
  })
  main.result(tool, { output: numbered(ROUTE_BEFORE), seconds: 0.2, tokens: 2_140 })
  main.snapshot(options.systemPrompt, options.tools)
  tool = main.request({
    tool: { name: 'Read', input: { file_path: file('src/store/books.ts') } },
    output: 84,
    seconds: 2.5,
  })
  main.result(tool, { output: numbered(STORE_BEFORE), seconds: 0.2, tokens: 1_870 })
  tool = main.request({
    text: 'Before I change the store, let me find every caller of listBooks so nothing else breaks.',
    tool: {
      name: 'Task',
      input: {
        description: 'Find callers of listBooks',
        prompt:
          'Find every caller of listBooks() in the repo, including tests and scripts. Report file, line, and how the result is used.',
        subagent_type: 'Explore',
      },
    },
    output: 196,
    seconds: 4,
  })
  const explore = writer.subagent(
    'a41f07c2',
    options.subagent,
    { agentType: 'Explore', description: 'Find callers of listBooks', spawnDepth: 1 },
    9_400,
  )
  explore.user(
    'Find every caller of listBooks() in the repo, including tests and scripts. Report file, line, and how the result is used.',
  )
  let sub = explore.request({
    tool: { name: 'Grep', input: { pattern: 'listBooks\\(', output_mode: 'content', '-n': true } },
    output: 61,
    seconds: 1.8,
  })
  explore.result(sub, {
    output: grepHits([
      ['src/routes/books.ts', 10, '  const rows = await listBooks({ author })'],
      ['src/routes/export.ts', 14, '  const all = await listBooks()'],
      ['scripts/backfill-isbn.ts', 22, 'for (const book of await listBooks()) {'],
      ['src/store/books.ts', 15, 'export async function listBooks(options: ListOptions = {}): Promise<Book[]> {'],
    ]),
    seconds: 0.3,
  })
  sub = explore.request({
    tool: { name: 'Read', input: { file_path: file('src/routes/export.ts') } },
    output: 48,
    seconds: 1.5,
  })
  explore.result(sub, {
    output: numbered(
      "import { Hono } from 'hono'\nimport { listBooks } from '../store/books.ts'\nimport { toCsv } from '../csv.ts'\n\nexport const exportRoute = new Hono()\n\n// The CSV export is the full catalog by design; it is streamed by the reverse proxy.\nexportRoute.get('/books.csv', async c => {\n  c.header('content-type', 'text/csv')\n\n  // listBooks() with no options: every row\n  // (see docs/export.md)\n\n  const all = await listBooks()\n  return c.body(toCsv(all))\n})",
    ),
    seconds: 0.2,
  })
  sub = explore.request({
    tool: { name: 'Read', input: { file_path: file('scripts/backfill-isbn.ts'), limit: 40 } },
    output: 52,
    seconds: 1.4,
  })
  explore.result(sub, {
    output: numbered(
      "import { listBooks } from '../src/store/books.ts'\nimport { lookupIsbn } from './isbn-lookup.ts'\n\n// One-off: fills isbn for rows created before migration 0003.\n// Run with: pnpm tsx scripts/backfill-isbn.ts --dry-run\n\nconst dryRun = process.argv.includes('--dry-run')\nlet filled = 0\n\n// Walks the whole table; fine for a one-off script.\n\n\n\n\n\n\n\n\n\n\n\nfor (const book of await listBooks()) {\n  if (book.isbn) continue\n  const isbn = await lookupIsbn(book.title, book.author)\n  if (isbn && !dryRun) await setIsbn(book.id, isbn)\n  filled += isbn ? 1 : 0\n}",
    ),
    seconds: 0.2,
  })
  sub = explore.request({
    text: 'Three callers:\n\n1. `src/routes/books.ts:10` — the GET /books handler, passes `{ author }`.\n2. `src/routes/export.ts:14` — CSV export, needs **every** row (documented in docs/export.md).\n3. `scripts/backfill-isbn.ts:22` — one-off script, walks the whole table.\n\nOnly the route should page; the other two rely on listBooks() returning everything.',
    output: 214,
    seconds: 3.2,
  })
  main.result(tool, {
    output:
      'Three callers: the GET /books route (pages), the CSV export and the ISBN backfill script (both need every row). Only the route should page.',
    seconds: 0.5,
    detail: { status: 'completed', agentId: 'a41f07c2', totalDurationMs: 9_800, totalTokens: 13_120 },
  })
  tool = main.request({
    thinking:
      'Keep listBooks() as is for the export and the script; add listBooksPage() next to it and switch only the route.',
    text: "listBooks() stays for the export and the backfill script. I'll add listBooksPage() beside it.",
    tool: {
      name: 'Edit',
      input: {
        file_path: file('src/store/books.ts'),
        old_string: 'export async function getBook',
        new_string: `${STORE_PAGE}\n\nexport async function getBook`,
      },
    },
    output: 688,
    seconds: 11,
  })
  main.result(tool, { output: `The file ${file('src/store/books.ts')} has been updated.`, seconds: 0.1 })
  main.hook('PostToolUse', 'Edit', tool, 'src/store/books.ts 41ms')
  tool = main.request({
    tool: {
      name: 'Edit',
      input: {
        file_path: file('src/routes/books.ts'),
        old_string: '  const rows = await listBooks({ author })\n  return c.json({ items: rows })',
        new_string:
          "  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200)\n  const cursor = c.req.query('cursor')\n  const page = await listBooksPage({ author, limit, cursor: cursor ? Number(cursor) : undefined })\n  return c.json({ items: page.items, nextCursor: page.nextCursor ?? '' })",
      },
    },
    output: 402,
    seconds: 7,
  })
  main.result(tool, { output: `The file ${file('src/routes/books.ts')} has been updated.`, seconds: 0.1 })
  main.hook('PostToolUse', 'Edit', tool, 'src/routes/books.ts 38ms')
  tool = main.request({
    tool: {
      name: 'Bash',
      input: { command: 'pnpm vitest run test/books.test.ts', description: 'Run the books tests' },
    },
    output: 71,
    seconds: 2,
  })
  const failed = vitestRun(cwd, 'test/books.test.ts', BOOK_TESTS, {
    name: 'uses the default page size',
    message: [
      'AssertionError: expected [ …(120) ] to have a length of 50 but got 120',
      '',
      '- Expected',
      '+ Received',
      '',
      '- 50',
      '+ 120',
      '',
      ' ❯ test/books.test.ts:27:24',
    ],
  })
  main.result(tool, { output: `Exit code 1\n${failed}`, isError: true, seconds: 3.4, tokens: 1_260 })
  tool = main.request({
    thinking:
      'Number(undefined) is NaN, and Math.min(NaN, 200) is NaN, so LIMIT NaN + 1 returns every row. The default never applies when limit is missing.',
    text: '`Number(undefined)` is `NaN`, so the default never applies. Let me parse the param properly.',
    tool: {
      name: 'Edit',
      input: {
        file_path: file('src/routes/books.ts'),
        old_string: "  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200)",
        new_string:
          "  const limit = z.coerce.number().int().min(1).max(200).catch(50).parse(c.req.query('limit') ?? 50)",
      },
    },
    output: 524,
    seconds: 9,
  })
  main.result(tool, { output: `The file ${file('src/routes/books.ts')} has been updated.`, seconds: 0.1 })
  main.hook('PostToolUse', 'Edit', tool, 'src/routes/books.ts 35ms')
  tool = main.request({
    tool: {
      name: 'Bash',
      input: { command: 'pnpm vitest run test/books.test.ts', description: 'Run the books tests' },
    },
    output: 66,
    seconds: 1.8,
  })
  main.result(tool, { output: vitestRun(cwd, 'test/books.test.ts', BOOK_TESTS), seconds: 3.1, tokens: 980 })
  main.request({
    text: 'Pagination is in:\n\n- `listBooksPage()` in `src/store/books.ts` (keyset on `id`, one extra row to detect the next page)\n- `GET /books?limit=&cursor=` — default 50, max 200; `items` is unchanged, `nextCursor` is new\n- the CSV export and the ISBN backfill still use `listBooks()` and get every row\n\nAll 4 tests in `test/books.test.ts` pass.',
    output: 342,
    seconds: 5,
  })
  main.hook('Stop', '', undefined, 'notified')
  main.turnDuration(writer.clock - turn)

  // Turn 2: the empty cursor.
  main.tick(50)
  turn = writer.clock
  main.user(
    'The last page returns `nextCursor: ""` and the web client treats any string as a cursor, so it loops. Make it null on the last page and add a test for it.',
  )
  tool = main.request({
    tool: { name: 'Grep', input: { pattern: 'nextCursor', path: cwd, output_mode: 'content', '-n': true } },
    output: 58,
    seconds: 2,
  })
  main.result(tool, {
    output: grepHits([
      ['src/routes/books.ts', 12, "  return c.json({ items: page.items, nextCursor: page.nextCursor ?? '' })"],
      ['src/store/books.ts', 52, '  nextCursor: number | null'],
      [
        'src/store/books.ts',
        61,
        '  return { items, nextCursor: rows.length > options.limit ? items.at(-1)!.id : null }',
      ],
      ['web/src/api/books.ts', 31, '    if (page.nextCursor !== undefined) {'],
      [
        'test/books.test.ts',
        21,
        '    const second = await (await app.request(`/books?limit=50&cursor=${first.nextCursor}`)).json()',
      ],
    ]),
    seconds: 0.3,
  })
  tool = main.request({
    tool: {
      name: 'Edit',
      input: {
        file_path: file('src/routes/books.ts'),
        old_string: "nextCursor: page.nextCursor ?? ''})",
        new_string: 'nextCursor: page.nextCursor })',
      },
    },
    output: 118,
    seconds: 3,
  })
  main.result(tool, {
    output: `<tool_use_error>String to replace not found in file.\nString: nextCursor: page.nextCursor ?? ''})</tool_use_error>`,
    isError: true,
    seconds: 0.1,
  })
  tool = main.request({
    text: 'The formatter added a space. Re-reading the handler.',
    tool: { name: 'Read', input: { file_path: file('src/routes/books.ts'), offset: 8, limit: 8 } },
    output: 77,
    seconds: 2.2,
  })
  main.result(tool, {
    output: numbered(
      "books.get('/', async c => {\n  const author = c.req.query('author')\n  const limit = z.coerce.number().int().min(1).max(200).catch(50).parse(c.req.query('limit') ?? 50)\n  const cursor = c.req.query('cursor')\n  const page = await listBooksPage({ author, limit, cursor: cursor ? Number(cursor) : undefined })\n  return c.json({ items: page.items, nextCursor: page.nextCursor ?? '' })\n})",
      8,
    ),
    seconds: 0.2,
  })
  tool = main.request({
    tool: {
      name: 'Edit',
      input: {
        file_path: file('src/routes/books.ts'),
        old_string: "nextCursor: page.nextCursor ?? '' })",
        new_string: 'nextCursor: page.nextCursor })',
      },
    },
    output: 96,
    seconds: 2.4,
  })
  main.result(tool, { output: `The file ${file('src/routes/books.ts')} has been updated.`, seconds: 0.1 })
  main.hook('PostToolUse', 'Edit', tool, 'src/routes/books.ts 33ms')
  tool = main.request({
    tool: { name: 'Read', input: { file_path: file('test/books.test.ts') } },
    output: 52,
    seconds: 1.6,
  })
  main.result(tool, { output: numbered(TEST_BEFORE), seconds: 0.2, tokens: 1_480 })
  tool = main.request({
    tool: {
      name: 'Edit',
      input: {
        file_path: file('test/books.test.ts'),
        old_string: "  it('filters by author'",
        new_string:
          "  it('ends with a null cursor on the last page', async () => {\n    const last = await (await app.request('/books?limit=50&cursor=100')).json()\n    expect(last.items).toHaveLength(20)\n    expect(last.nextCursor).toBeNull()\n  })\n\n  it('filters by author'",
      },
    },
    output: 296,
    seconds: 4.5,
  })
  main.result(tool, { output: `The file ${file('test/books.test.ts')} has been updated.`, seconds: 0.1 })
  main.hook('PostToolUse', 'Edit', tool, 'test/books.test.ts 36ms')
  tool = main.request({
    tool: {
      name: 'Bash',
      input: {
        command: 'pnpm vitest run test/books.test.ts && pnpm tsc --noEmit',
        description: 'Run tests and type check',
      },
    },
    output: 74,
    seconds: 1.9,
  })
  main.result(tool, {
    output: vitestRun(cwd, 'test/books.test.ts', [
      ...BOOK_TESTS.slice(0, 3),
      'ends with a null cursor on the last page',
      BOOK_TESTS[3]!,
    ]),
    seconds: 6.2,
    tokens: 1_020,
  })
  tool = main.request({
    tool: { name: 'Read', input: { file_path: file('web/src/api/books.ts'), offset: 24, limit: 20 } },
    output: 61,
    seconds: 2,
  })
  main.result(tool, {
    output: numbered(
      'export async function* allBooks(author?: string) {\n  let cursor: number | undefined\n  for (;;) {\n    const page = await getJson<Page>(booksUrl({ author, cursor }))\n    yield* page.items\n    if (page.nextCursor !== undefined) {\n      cursor = page.nextCursor\n    } else {\n      return\n    }\n  }\n}',
      24,
    ),
    seconds: 0.2,
  })
  tool = main.request({
    text: 'The client checks `!== undefined`, so `null` would still loop. Fixing the check too.',
    tool: {
      name: 'Edit',
      input: {
        file_path: file('web/src/api/books.ts'),
        old_string: 'if (page.nextCursor !== undefined) {',
        new_string: 'if (page.nextCursor != null) {',
      },
    },
    output: 142,
    seconds: 3,
  })
  main.result(tool, { output: `The file ${file('web/src/api/books.ts')} has been updated.`, seconds: 0.1 })
  main.hook('PostToolUse', 'Edit', tool, 'web/src/api/books.ts 30ms')
  main.request({
    text: 'Fixed both ends:\n\n- the API returns `nextCursor: null` on the last page\n- `web/src/api/books.ts` stops on `null` as well as a missing cursor\n- new test: `ends with a null cursor on the last page`\n\nTests and the type check pass.',
    output: 238,
    seconds: 4,
  })
  main.hook('Stop', '', undefined, 'notified')
  main.turnDuration(writer.clock - turn)
}
