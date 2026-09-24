import type { FixtureHome } from './fixture-home.ts'
import type { Installed } from './tarball.ts'

export interface SmokeContext extends Installed, FixtureHome {
  /** Temp directory for this run; removed after the run unless `AGENT_TRACE_SMOKE_KEEP=1`. */
  root: string
  /** Holds the fake `open` and `xdg-open`. */
  fakeBin: string
}

declare module 'vitest' {
  export interface ProvidedContext {
    smoke: SmokeContext
  }
}
