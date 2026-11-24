// The performance and size budgets that `node scripts/check-budgets.mjs` checks, each with its reason.
//
// The laptop numbers in the reasons are three runs on an Apple-silicon laptop.
// GitHub's ubuntu-latest runners are slower and noisier, so a time budget is an absolute ceiling that
// catches an order-of-magnitude regression, not a target; a size is deterministic, so its budget sits
// 10 to 25 % above today's number. A change that grows a size past its budget raises the number here in
// the same PR, with the new measurement in the reason and in the PR's Validation section.

/** "Thousands of sessions" (overview, Session index): 5,000 across two agents, about 190 MB. */
export const SESSIONS_PER_AGENT = 2500
/** "A session around 100 MB": the S12 generator at 100 MB instead of 350 MB keeps the CI step short. */
export const LARGE_SESSION_BYTES = 100 * 1000 * 1000

const KB = 1000
const MB = 1000 * 1000

/**
 * `enforced: false` is printed and written to the job summary but never fails the run.
 * `unit: 'ms'` limits are milliseconds; `unit: 'bytes'` limits are bytes.
 */
export const BUDGETS = [
  {
    id: 'first-rows-cold',
    label: 'First rows, cold (5,000 sessions, no index)',
    unit: 'ms',
    limit: 10_000,
    enforced: true,
    reason:
      'Laptop 1.0 to 1.8 s, up to 3.6 s while other jobs load the machine, inside the 2 s design goal. 10 s leaves about 5x for a slow runner; it fails on a slowdown of that order across the start path (process start, discover, the first list-sessions).',
  },
  {
    id: 'first-rows-warm',
    label: 'First rows, warm (index present)',
    unit: 'ms',
    limit: 5_000,
    enforced: true,
    reason:
      'Laptop 0.22 to 0.40 s, most of it Node start-up. 5 s fails on a 12 to 20x slowdown of the whole warm start. A warm start that waits for discover again is caught by the from-the-index check in check-budgets.mjs, not by this time.',
  },
  {
    id: 'all-summaries-cold',
    label: 'All summaries done, cold',
    unit: 'ms',
    limit: 30_000,
    enforced: false,
    reason:
      "Laptop 3.2 to 4.9 s. Reported only: it scales with the runner's cores (4 summaries at a time) and runs after the rows are on screen.",
  },
  {
    id: 'large-session-view',
    label: 'Large session (100 MB) to get-trace-view',
    unit: 'ms',
    limit: 15_000,
    enforced: true,
    reason:
      'Laptop 0.52 to 0.89 s for a 103 MB Codex rollout. 15 s catches an order-of-magnitude regression in loading or toView.',
  },
  {
    id: 'large-session-rss',
    label: 'Large session (100 MB), peak RSS',
    unit: 'bytes',
    limit: 1000 * MB,
    enforced: true,
    reason:
      'Laptop 400 to 500 MB, the whole CLI process (it moves with GC timing). Memory does not depend on CPU speed; 1 GB fails when the peak of a load roughly doubles.',
  },
  {
    id: 'web-raw',
    label: 'Web bundle JS + CSS, raw',
    unit: 'bytes',
    limit: 510 * KB,
    enforced: true,
    reason: '426.1 kB with the cost and context-diff views (350.6 kB before them); about 20 % of headroom.',
  },
  {
    id: 'web-gzip',
    label: 'Web bundle JS + CSS, gzip',
    unit: 'bytes',
    limit: 150 * KB,
    enforced: true,
    reason: '124.2 kB with the cost and context-diff views (110.5 kB before them); about 20 % of headroom.',
  },
  {
    id: 'cli-mjs',
    label: 'dist/cli.mjs',
    unit: 'bytes',
    limit: 1230 * KB,
    enforced: true,
    reason: '1,023.6 kB with the MCP tools and the price snapshot (856.9 kB before them); about 20 % of headroom.',
  },
  {
    id: 'tarball',
    label: 'Packed tarball (pnpm pack)',
    unit: 'bytes',
    limit: 790 * KB,
    enforced: true,
    reason:
      '654.7 kB, mostly the gzipped cli.mjs, web bundle, fonts, notices, and the demo trace (570.2 kB before the demo session, MCP tools, and cost); same headroom as cli.mjs.',
  },
  {
    id: 'dsh-client-raw',
    label: 'dsh plugin dist/client.js, raw',
    unit: 'bytes',
    limit: 420 * KB,
    enforced: true,
    reason: '347.0 kB (346,952 B) for the embedded workspace element and React wrapper; about 20 % of headroom.',
  },
  {
    id: 'dsh-client-gzip',
    label: 'dsh plugin dist/client.js, gzip',
    unit: 'bytes',
    limit: 120 * KB,
    enforced: true,
    reason: '96.7 kB (96,722 B) gzipped with Node zlib defaults; about 20 % of headroom.',
  },
  {
    id: 'dsh-host',
    label: 'dsh plugin dist/host.mjs',
    unit: 'bytes',
    limit: 970 * KB,
    enforced: true,
    reason:
      '803.6 kB (803,574 B) with the DevFrame-free server core, TraceStore, and agent-kit; about 20 % of headroom.',
  },
  {
    id: 'dsh-tarball',
    label: 'dsh plugin tarball (pnpm pack)',
    unit: 'bytes',
    limit: 430 * KB,
    enforced: true,
    reason:
      '354.4 kB (354,396 B), mostly the gzipped host.mjs, client.js, third-party notices, icon, and cordis.patch.yml; about 20 % of headroom.',
  },
]
