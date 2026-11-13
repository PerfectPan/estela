import { describe, expect, it } from 'vite-plus/test'
import { SummaryQueue } from './summary-queue.ts'

interface Job {
  id: string
  rank: number
  heavy?: boolean
}

function tick(ms = 5): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('SummaryQueue', () => {
  it('runs newest first, moves prioritized keys to the front, and caps concurrency', async () => {
    const started: string[] = []
    let active = 0
    let max = 0
    const queue = new SummaryQueue<Job>({
      concurrency: 2,
      key: job => job.id,
      rank: job => job.rank,
      heavy: () => false,
      async run(job) {
        started.push(job.id)
        active += 1
        max = Math.max(max, active)
        await tick()
        active -= 1
      },
    })
    queue.add([
      { id: 'a', rank: 1 },
      { id: 'b', rank: 3 },
      { id: 'c', rank: 2 },
      { id: 'd', rank: 0 },
      { id: 'e', rank: 5 },
    ])
    queue.prioritize(['d'])
    await queue.whenIdle()
    expect(max).toBe(2)
    expect(started.slice(0, 2)).toEqual(['e', 'b'])
    expect(started[2]).toBe('d')
    expect(started).toHaveLength(5)
  })

  it('runs a heavy job alone', async () => {
    const overlap: string[] = []
    const running = new Set<string>()
    const queue = new SummaryQueue<Job>({
      concurrency: 4,
      key: job => job.id,
      rank: job => job.rank,
      heavy: job => job.heavy === true,
      async run(job) {
        running.add(job.id)
        if (running.size > 1 && [...running].some(id => id === 'big')) {
          overlap.push([...running].join(','))
        }
        await tick()
        running.delete(job.id)
      },
    })
    queue.add([
      { id: 'x', rank: 4 },
      { id: 'big', rank: 3, heavy: true },
      { id: 'y', rank: 2 },
      { id: 'z', rank: 1 },
    ])
    await queue.whenIdle()
    expect(overlap).toEqual([])
  })
})
