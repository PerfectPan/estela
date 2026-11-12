import { createRoot } from 'solid-js'
import { describe, expect, it } from 'vite-plus/test'
import { sample } from '@/testsupport/ledger-trace.ts'
import { createWorkspaceState, type WorkspaceState } from './workspace-state.ts'

function withState(run: (state: WorkspaceState) => void): void {
  createRoot(dispose => {
    const state = createWorkspaceState({
      traceId: 't',
      trace: sample(),
      summary: {},
      event: async () => {
        throw new Error('unexpected get-event')
      },
    })
    try {
      run(state)
    } finally {
      dispose()
    }
  })
}

describe('setLayout', () => {
  it('moves a subagent selection to its lane header under Requests and back to the subagent row', () => {
    withState(state => {
      state.setFilter('requests')
      state.setSelectedKey('s:t0:sub')
      state.setLayout('lanes')
      // Requests hides the spawn call, the subagent row's place in Agents, so its lane header holds it.
      expect(state.selectedKey()).toBe('l:sub')
      state.setLayout('turns')
      expect(state.selectedKey()).toBe('s:t0:sub')
    })
  })

  it('selects the spawn call for a subagent lane header and nothing for the main one', () => {
    withState(state => {
      state.setLayout('lanes')
      state.setSelectedKey('l:sub')
      state.setLayout('turns')
      expect(state.selectedKey()).toBe('s:t0:sub')
      state.setLayout('lanes')
      expect(state.selectedKey()).toBe('e:spawn')
      state.setSelectedKey('l:main')
      state.setLayout('turns')
      expect(state.selectedKey()).toBeUndefined()
    })
  })
})
