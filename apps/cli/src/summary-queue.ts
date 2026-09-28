export interface SummaryQueueOptions<T> {
  /** At most this many jobs run at once (D7: 4). */
  concurrency: number
  key: (job: T) => string
  /** Default order: larger first (newest activity). */
  rank: (job: T) => number
  /** A heavy job runs alone, so at most one very large file is held in memory. */
  heavy: (job: T) => boolean
  run: (job: T) => Promise<void>
}

/** The summary work list: newest first, visible rows moved to the front, bounded concurrency. */
export class SummaryQueue<T> {
  private readonly waiting: T[] = []
  private active = 0
  private heavyActive = false
  private paused: boolean
  private readonly idleWaiters: (() => void)[] = []
  private readonly options: SummaryQueueOptions<T>

  constructor(options: SummaryQueueOptions<T>, paused = false) {
    this.options = options
    this.paused = paused
  }

  /** Start running jobs (a queue created paused only collects them). */
  resume(): void {
    this.paused = false
    this.pump()
  }

  get size(): number {
    return this.waiting.length + this.active
  }

  add(jobs: readonly T[]): void {
    const sorted = [...this.waiting, ...jobs].toSorted((a, b) => this.options.rank(b) - this.options.rank(a))
    this.waiting.splice(0, this.waiting.length, ...sorted)
    this.pump()
  }

  /** Move these keys to the front, in the given order. */
  prioritize(keys: readonly string[]): void {
    if (keys.length === 0 || this.waiting.length === 0)
      return
    const order = new Map(keys.map((key, index) => [key, index]))
    const front = this.waiting
      .filter(job => order.has(this.options.key(job)))
      .toSorted((a, b) => order.get(this.options.key(a))! - order.get(this.options.key(b))!)
    if (front.length === 0)
      return
    const rest = this.waiting.filter(job => !order.has(this.options.key(job)))
    this.waiting.splice(0, this.waiting.length, ...front, ...rest)
    this.pump()
  }

  whenIdle(): Promise<void> {
    this.resume()
    if (this.size === 0)
      return Promise.resolve()
    return new Promise(resolve => this.idleWaiters.push(resolve))
  }

  private pump(): void {
    while (!this.paused && this.waiting.length > 0 && this.active < this.options.concurrency && !this.heavyActive) {
      const next = this.waiting[0]!
      const heavy = this.options.heavy(next)
      if (heavy && this.active > 0)
        break
      this.waiting.shift()
      this.active += 1
      this.heavyActive = heavy
      void this.options.run(next)
        .catch(() => {})
        .finally(() => {
          this.active -= 1
          if (heavy)
            this.heavyActive = false
          this.pump()
          this.settle()
        })
    }
    this.settle()
  }

  private settle(): void {
    if (this.size > 0 || this.paused)
      return
    for (const resolve of this.idleWaiters.splice(0))
      resolve()
  }
}
