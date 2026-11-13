import type { ChatSpec } from './agent-logs.ts'
import { execFile } from 'node:child_process'
import { mkdir, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import * as z from 'zod/mini'
import { claudeSession, codexSession, geminiSession, grokSession } from './agent-logs.ts'

/**
 * A synthetic home for demos and screenshots: the demo session (Claude Code, written by
 * `packages/server/src/testsupport/demo-session.ts`, run by path like the S12 generator) plus eight small
 * sessions from Claude Code, Codex, Gemini CLI, and Grok on three invented projects over ten days.
 * Every project lives under `<home>/work`, so the viewer's redaction shows it as `~/work/...`.
 *
 *   node apps/e2e/src/demo/demo-home.ts <home>
 */
const repo = resolve(fileURLToPath(import.meta.url), '../../../../..')
const exec = promisify(execFile)
const at = (day: number, hour: number, minute: number) => Date.UTC(2026, 10, day, hour, minute)

export interface DemoHome {
  home: string
  /** The demo session's main file. */
  demo: string
  /** Sessions per agent. */
  counts: Record<'claude-code' | 'codex' | 'gemini-cli' | 'grok', number>
}

function specs(home: string) {
  const work = (name: string) => `${home}/work/${name}`
  const claude: ChatSpec[] = [
    {
      id: '2b8f61d4-90a3-4c5e-8f17-c3d2a9e0b641',
      cwd: work('fieldnotes'),
      start: at(12, 14, 5),
      model: 'claude-sonnet-5',
      title: 'RSS feed skips posts dated today',
      turns: [
        {
          prompt: 'The RSS feed skips posts dated today. Find out why.',
          steps: [
            { command: 'pnpm build && grep -c "<item>" dist/feed.xml', output: 'built 48 pages in 1.2s\n11' },
            {
              command: 'node -e "console.log(new Date(\'2026-11-12\').toISOString())"',
              output: '2026-11-12T00:00:00.000Z',
            },
            {
              command: 'pnpm vitest run test/feed.test.ts',
              output: 'FAIL test/feed.test.ts > includes posts published today\nexpected 11 to be 12',
              exitCode: 1,
            },
          ],
          reply:
            'Front-matter dates parse as UTC midnight, and the feed filter compares them with `Date.now()` in local time, so a post dated today is "in the future" until 01:00. I added a failing test that pins this.',
        },
        {
          prompt: 'Compare dates as calendar days instead.',
          steps: [{ command: 'pnpm vitest run test/feed.test.ts', output: '✓ test/feed.test.ts (6 tests) 41ms' }],
          reply: 'The filter now compares `YYYY-MM-DD` strings. All 6 feed tests pass, including the new one.',
        },
      ],
    },
    {
      id: '5e04c7a9-1d6b-4f28-b3a0-77c1e9d2f058',
      cwd: work('tinyshelf'),
      start: at(7, 16, 40),
      model: 'claude-sonnet-5',
      title: 'ETag for GET /books/:id',
      turns: [
        {
          prompt: 'Add an ETag to GET /books/:id and answer 304 when it matches.',
          steps: [
            {
              command: 'rg -n "books.get\\(\'/:id\'" src',
              output: "src/routes/books.ts:14:books.get('/:id', async c => {",
            },
            { command: 'pnpm vitest run test/book-by-id.test.ts', output: '✓ test/book-by-id.test.ts (4 tests) 37ms' },
          ],
          reply:
            'GET /books/:id sends a weak ETag from the row version and returns 304 for a matching If-None-Match. Two new tests cover both paths.',
        },
      ],
    },
  ]
  const codex: ChatSpec[] = [
    {
      id: '019a7c2e-5b41-7d90-a3f6-2e8b1c4d5f60',
      cwd: work('fieldnotes'),
      start: at(11, 10, 20),
      model: 'gpt-5.1-codex',
      turns: [
        {
          prompt: 'slugify() drops accented letters: "Café notes" becomes "caf-notes". Keep the base letter.',
          steps: [
            {
              command: 'rg -n "export function slugify" src',
              output: 'src/lib/slug.ts:3:export function slugify(title: string): string {',
            },
            { command: 'pnpm vitest run src/lib/slug.test.ts', output: '✓ src/lib/slug.test.ts (9 tests) 12ms' },
          ],
          reply:
            'slugify() now normalizes to NFKD and strips combining marks first, so "Café notes" becomes "cafe-notes". Added three accent cases.',
        },
      ],
    },
    {
      id: '019a6f1b-08c3-7a24-9e5d-41f0b7a2c389',
      cwd: work('weatherline'),
      start: at(9, 8, 55),
      model: 'gpt-5.1-codex',
      turns: [
        {
          prompt: 'The stations export added a `elevation_m` column. Parse it and keep old files working.',
          steps: [
            {
              command: 'head -3 data/stations-2026.csv',
              output:
                'id,name,lat,lon,elevation_m\nKX01,North Ridge,47.61,-122.33,152\nKX02,Harbor Point,47.58,-122.40,4',
            },
            {
              command: 'cargo test parse_stations',
              output:
                'error[E0063]: missing field `elevation_m` in initializer of `Station`\n  --> src/stations.rs:41:9',
              exitCode: 101,
            },
            { command: 'cargo test parse_stations', output: 'running 5 tests\ntest result: ok. 5 passed; 0 failed' },
          ],
          reply:
            '`Station` has an optional `elevation_m`; the parser reads the header to find columns, so files without the column still load. 5 tests pass.',
        },
        {
          prompt: 'Show the elevation in `weatherline stations` output.',
          steps: [
            {
              command: 'cargo run -q -- stations --limit 2',
              output: 'KX01  North Ridge   152 m\nKX02  Harbor Point    4 m',
            },
          ],
          reply: 'Added an elevation column, right-aligned, blank when unknown.',
        },
      ],
    },
    {
      id: '019a5a3d-77e2-7f01-b6c4-9d03e5a8f112',
      cwd: work('tinyshelf'),
      start: at(5, 13, 30),
      model: 'gpt-5.1-codex-mini',
      turns: [
        {
          prompt: 'Write a Dockerfile for the API: multi-stage, non-root, Node 24.',
          steps: [
            {
              command: 'docker build -t tinyshelf:dev .',
              output: 'Successfully built 3f9c1d2e7a40\nSuccessfully tagged tinyshelf:dev',
            },
          ],
          reply:
            'Added a two-stage Dockerfile (pnpm deploy into a slim runtime image, user `node`). The image is 142 MB.',
        },
      ],
    },
  ]
  const gemini: [ChatSpec, string][] = [
    [
      {
        id: 'b71e3a90-4c2d-4e6f-8a15-d09c6f2e3b74',
        cwd: work('weatherline'),
        start: at(8, 15, 10),
        model: 'gemini-2.5-pro',
        turns: [
          {
            prompt: 'Plot the daily max temperature for KX01 as an SVG sparkline in the HTML report.',
            steps: [
              {
                command: 'cargo run -q -- report --station KX01 --out /tmp/kx01.html',
                output: 'wrote /tmp/kx01.html (31 days)',
              },
              {
                command: 'xmllint --noout /tmp/kx01.html',
                output: '/tmp/kx01.html:14: parser error : Opening and ending tag mismatch: polyline and svg',
                exitCode: 1,
              },
              {
                command: 'cargo run -q -- report --station KX01 --out /tmp/kx01.html && xmllint --noout /tmp/kx01.html',
                output: 'wrote /tmp/kx01.html (31 days)',
              },
            ],
            reply:
              'The report has a 120×24 sparkline of daily max temperature. The first version left `<polyline>` unclosed; it is now self-closing and the file validates.',
          },
        ],
      },
      'a3f19c0b7e254d6a',
    ],
    [
      {
        id: 'e4c80d2b-6a19-4f53-9b07-1f8e2c5d7a36',
        cwd: work('fieldnotes'),
        start: at(4, 9, 45),
        model: 'gemini-2.5-flash',
        turns: [
          {
            prompt: 'List the TODO comments in src and group them by file.',
            steps: [
              {
                command: 'rg -n "TODO" src',
                output:
                  'src/build.ts:22:// TODO: incremental builds\nsrc/feed.ts:9:// TODO: atom feed\nsrc/lib/slug.ts:5:// TODO: accents',
              },
            ],
            reply:
              'Three TODOs: incremental builds (src/build.ts), an Atom feed (src/feed.ts), and accents in slugs (src/lib/slug.ts).',
          },
        ],
      },
      '5c2e81f4a9d03b7e',
    ],
  ]
  const grok: ChatSpec[] = [
    {
      id: 'grk-6d1f0a3e',
      cwd: work('weatherline'),
      start: at(6, 11, 15),
      model: 'grok-code-fast-1',
      title: 'Add a --units flag',
      turns: [
        {
          prompt: 'Add a --units flag (metric or imperial) to every command that prints temperatures.',
          steps: [
            { command: 'cargo test units', output: 'running 4 tests\ntest result: ok. 4 passed; 0 failed' },
            {
              command: 'cargo run -q -- today --station KX02 --units imperial',
              output: 'KX02 Harbor Point  high 54°F  low 43°F',
            },
          ],
          reply:
            'Every command that prints temperatures takes `--units metric|imperial` (default metric); the conversion lives in one place, `units.rs`.',
        },
      ],
    },
  ]
  return { claude, codex, gemini, grok }
}

export async function buildDemoHome(home: string): Promise<DemoHome> {
  // Never write into (or clear) a directory that holds anything, such as a real home.
  if ((await readdir(home).catch(() => [])).length > 0) {
    throw new Error(`${home} is not empty; pass a new or empty directory`)
  }
  await mkdir(home, { recursive: true })
  const cwd = `${home}/work/tinyshelf`
  const projectDir = join(home, '.claude/projects', cwd.replaceAll(/[^A-Za-z0-9]/g, '-'))
  const { stdout } = await exec(process.execPath, [
    join(repo, 'packages/server/src/testsupport/demo-session.ts'),
    projectDir,
    cwd,
  ])
  const demo = z.parse(z.object({ path: z.string() }), JSON.parse(stdout)).path
  const all = specs(home)
  for (const spec of all.claude) {
    await claudeSession(home, spec)
  }
  for (const spec of all.codex) {
    await codexSession(home, spec)
  }
  for (const [spec, project] of all.gemini) {
    await geminiSession(home, spec, project)
  }
  for (const spec of all.grok) {
    await grokSession(home, spec)
  }
  return {
    home,
    demo,
    counts: {
      'claude-code': all.claude.length + 1,
      codex: all.codex.length,
      'gemini-cli': all.gemini.length,
      grok: all.grok.length,
    },
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const home = process.argv[2]
  if (!home) {
    process.stderr.write('Usage: node demo-home.ts <home>\n')
    process.exit(1)
  }
  process.stdout.write(`${JSON.stringify(await buildDemoHome(resolve(home)))}\n`)
}
