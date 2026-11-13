import type { SessionWriter } from './demo-writer.ts'
import {
  fullSuite,
  MIGRATION_INDEX,
  MIGRATION_ISBN,
  numbered,
  README_API,
  seedPreview,
  vitestRun,
} from './demo-files.ts'

/** Turns 3 to 5 of the demo session (`demo-session.ts`): an index migration with a review subagent, the `/compact`, docs, and the commit. */
export function shipTurns(writer: SessionWriter, cwd: string, options: { main: string }): void {
  const main = writer.main
  const file = (name: string) => `${cwd}/${name}`
  // Turn 3: the index, with a review subagent.
  main.tick(65)
  let turn = writer.clock
  main.user(
    'Add a migration with an index on (author, id) so the author filter stays fast with the cursor, and check the query plan against data/sample.db.',
  )
  let tool = main.request({
    tool: {
      name: 'Bash',
      input: {
        command: 'ls migrations && pnpm tsx scripts/seed.ts --dry-run --count 400',
        description: 'List migrations and preview seed rows',
      },
    },
    output: 63,
    seconds: 2,
  })
  main.result(tool, {
    output: `0001_init.sql\n0002_api_keys.sql\n0003_add_isbn.sql\n\n${seedPreview(400)}`,
    seconds: 1.4,
    tokens: 9_600,
  })
  tool = main.request({
    tool: { name: 'Read', input: { file_path: file('migrations/0003_add_isbn.sql') } },
    output: 41,
    seconds: 1.5,
  })
  main.result(tool, { output: numbered(MIGRATION_ISBN), seconds: 0.2 })
  tool = main.request({
    tool: {
      name: 'Write',
      input: { file_path: file('migrations/0004_books_author_id_idx.sql'), content: MIGRATION_INDEX },
    },
    output: 133,
    seconds: 3,
  })
  main.result(tool, {
    output: `File created successfully at: ${file('migrations/0004_books_author_id_idx.sql')}`,
    seconds: 0.1,
  })
  main.hook('PostToolUse', 'Write', tool, 'migrations/0004_books_author_id_idx.sql (unchanged)')
  tool = main.request({
    text: "I'll have a reviewer check the migration and the query plan while I run it.",
    tool: {
      name: 'Task',
      input: {
        description: 'Review migration 0004',
        prompt:
          'Review migrations/0004_books_author_id_idx.sql: is it safe to run on a live SQLite database, and does the paged author query use it? Check with EXPLAIN QUERY PLAN on data/sample.db.',
        subagent_type: 'general-purpose',
      },
    },
    output: 188,
    seconds: 3.6,
  })
  const review = writer.subagent(
    'c9be3d10',
    options.main,
    { agentType: 'general-purpose', description: 'Review migration 0004', spawnDepth: 1 },
    11_200,
  )
  review.user(
    'Review migrations/0004_books_author_id_idx.sql: is it safe to run on a live SQLite database, and does the paged author query use it? Check with EXPLAIN QUERY PLAN on data/sample.db.',
  )
  let sub = review.request({
    tool: { name: 'Read', input: { file_path: file('migrations/0004_books_author_id_idx.sql') } },
    output: 44,
    seconds: 1.6,
  })
  review.result(sub, { output: numbered(MIGRATION_INDEX), seconds: 0.2 })
  const plan = "EXPLAIN QUERY PLAN SELECT * FROM books WHERE author = 'Ines Varga' AND id > 50 ORDER BY id LIMIT 51"
  sub = review.request({
    tool: { name: 'Bash', input: { command: `sqlite3 data/sample.db "${plan}"` } },
    output: 70,
    seconds: 2,
  })
  review.result(sub, { output: 'Exit code 127\nbash: sqlite3: command not found', isError: true, seconds: 0.1 })
  sub = review.request({
    text: 'No sqlite3 binary here; the repo has a node helper for this.',
    tool: { name: 'Bash', input: { command: `pnpm tsx scripts/sql.ts data/sample.db "${plan}"` } },
    output: 96,
    seconds: 2.4,
  })
  review.result(sub, {
    output: 'QUERY PLAN\n`--SEARCH books USING INDEX books_author_id_idx (author=? AND id>?)',
    seconds: 1.2,
  })
  review.request({
    text: 'Safe to merge. `CREATE INDEX IF NOT EXISTS` takes a short write lock on SQLite and the table is small (400 rows in the sample). With the index, the paged author query is a SEARCH on `books_author_id_idx (author=? AND id>?)` with no temp B-tree for ORDER BY.',
    output: 176,
    seconds: 3,
  })
  main.result(tool, {
    output:
      'Safe to merge: short write lock only. The paged author query uses SEARCH books USING INDEX books_author_id_idx (author=? AND id>?), no temp B-tree.',
    seconds: 0.4,
    detail: { status: 'completed', agentId: 'c9be3d10', totalDurationMs: 11_900, totalTokens: 12_480 },
  })
  tool = main.request({
    tool: {
      name: 'Bash',
      input: { command: 'pnpm db:migrate --db data/sample.db', description: 'Apply migrations to the sample DB' },
    },
    output: 52,
    seconds: 1.7,
  })
  main.result(tool, {
    output:
      '> tinyshelf@0.4.0 db:migrate\n> tsx scripts/migrate.ts --db data/sample.db\n\napplied 0004_books_author_id_idx.sql (12 ms)\n1 migration applied, schema version 4',
    seconds: 1.3,
  })
  tool = main.request({
    tool: {
      name: 'Bash',
      input: { command: 'pnpm vitest run test/migrations.test.ts', description: 'Run migration tests' },
    },
    output: 49,
    seconds: 1.5,
  })
  main.result(tool, {
    output: vitestRun(cwd, 'test/migrations.test.ts', [
      'applies every migration in order',
      'is idempotent',
      'records the schema version',
      'creates books_isbn_idx',
      'creates books_author_id_idx',
      'keeps existing rows',
    ]),
    seconds: 2.6,
    tokens: 6_800,
  })
  main.request({
    text: 'Added `migrations/0004_books_author_id_idx.sql` (index on `(author, id)`). It is applied to `data/sample.db`, the migration tests pass, and the reviewer confirmed the paged author query now searches the index instead of scanning.',
    output: 204,
    seconds: 3.4,
  })
  main.hook('Stop', '', undefined, 'notified')
  main.turnDuration(writer.clock - turn)
  // The user compacts between tasks, so the docs turn starts from the summary.
  main.tick(35)
  main.compact(
    'This session is being continued from a previous conversation. Summary:\n\n1. GET /books now pages with `limit` (default 50, max 200, parsed with zod) and `cursor` (keyset on id) through `listBooksPage()` in src/store/books.ts. `listBooks()` is unchanged because the CSV export (src/routes/export.ts) and scripts/backfill-isbn.ts need every row.\n2. The last page returns `nextCursor: null`; web/src/api/books.ts stops on null. Test: "ends with a null cursor on the last page".\n3. migrations/0004_books_author_id_idx.sql adds an index on (author, id); applied to data/sample.db; the query plan uses it.\n\nAll tests pass. Pending: none.',
    31_000,
  )

  // Turn 4: docs.
  main.tick(40)
  turn = writer.clock
  main.user("Update the README's API section for the new params and add a CHANGELOG entry under Unreleased.")
  tool = main.request({
    tool: { name: 'Read', input: { file_path: file('README.md'), offset: 40, limit: 12 } },
    output: 47,
    seconds: 2.4,
  })
  main.result(tool, { output: numbered(README_API, 40), seconds: 0.2 })
  tool = main.request({
    tool: {
      name: 'Edit',
      input: {
        file_path: file('README.md'),
        old_string: '| GET    | /books       | All books, oldest first. `?author=` filters. |',
        new_string:
          '| GET    | /books       | Books, oldest first, 50 per page. `?author=` filters; `?limit=` (1–200) and `?cursor=` page. The response has `nextCursor`, `null` on the last page. |',
      },
    },
    output: 233,
    seconds: 4,
  })
  main.result(tool, { output: `The file ${file('README.md')} has been updated.`, seconds: 0.1 })
  tool = main.request({
    tool: {
      name: 'Edit',
      input: {
        file_path: file('CHANGELOG.md'),
        old_string: '## Unreleased\n',
        new_string:
          '## Unreleased\n\n- GET /books pages: `limit` (default 50, max 200) and `cursor`; responses carry `nextCursor` (`null` on the last page).\n- New index on books (author, id) (migration 0004).\n',
      },
    },
    output: 171,
    seconds: 3,
  })
  main.result(tool, { output: `The file ${file('CHANGELOG.md')} has been updated.`, seconds: 0.1 })
  tool = main.request({
    tool: { name: 'Bash', input: { command: 'pnpm test', description: 'Run the full suite' } },
    output: 38,
    seconds: 1.4,
  })
  main.result(tool, { output: fullSuite(cwd), seconds: 4.8 })
  tool = main.request({
    tool: { name: 'Bash', input: { command: 'git status --short', description: 'Show changed files' } },
    output: 36,
    seconds: 1.2,
  })
  main.result(tool, {
    output:
      ' M CHANGELOG.md\n M README.md\n M src/routes/books.ts\n M src/store/books.ts\n M test/books.test.ts\n M web/src/api/books.ts\n?? migrations/0004_books_author_id_idx.sql',
    seconds: 0.1,
  })
  main.request({
    text: 'README and CHANGELOG are updated. The full suite passes (33 tests in 6 files). Seven files changed, one of them new (the migration).',
    output: 129,
    seconds: 2.6,
  })
  main.hook('Stop', '', undefined, 'notified')
  main.turnDuration(writer.clock - turn)

  // Turn 5: commit.
  main.tick(30)
  turn = writer.clock
  main.user('Commit it on a branch.')
  tool = main.request({
    tool: {
      name: 'Bash',
      input: {
        command:
          "git switch -c feat/books-pagination && git add -A && git commit -m 'feat(api): cursor pagination for GET /books'",
        description: 'Create a branch and commit',
      },
    },
    output: 92,
    seconds: 2.2,
  })
  writer.branch('feat/books-pagination')
  main.result(tool, {
    output:
      "Switched to a new branch 'feat/books-pagination'\n[feat/books-pagination 4e1c9b7] feat(api): cursor pagination for GET /books\n 7 files changed, 74 insertions(+), 9 deletions(-)\n create mode 100644 migrations/0004_books_author_id_idx.sql",
    seconds: 0.6,
  })
  main.request({ text: 'Committed on `feat/books-pagination` (4e1c9b7). Nothing is pushed.', output: 58, seconds: 1.6 })
  main.hook('Stop', '', undefined, 'notified')
  main.turnDuration(writer.clock - turn)
}
