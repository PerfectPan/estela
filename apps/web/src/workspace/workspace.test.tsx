// @vitest-environment happy-dom
import type { Trace } from '@rivus/estela-schema'
import type { LoadClient } from './load-session.ts'
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { TopBar } from '@/shell/top-bar.tsx'
import { sample } from '@/testsupport/ledger-trace.ts'
import { ErrorPanel } from './error-panel.tsx'
import { Inspector } from './inspector/inspector.tsx'
import { Workspace } from './workspace.tsx'
import { createWorkspaceState } from './workspace-state.ts'

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

function fakeConnect(trace: Trace = sample(), options: { viewError?: string; lost?: boolean } = {}) {
  const client: LoadClient = {
    status: options.lost ? 'disconnected' : 'connected',
    onStatus: () => () => {},
    loadTrace: async () => ({ loadId: 'load-1', cached: false, totalBytes: 100 }),
    traceView: async () => {
      if (options.viewError) {
        throw new Error(options.viewError)
      }
      return { traceId: 't1', trace, summary: { turns: 2, requests: 2 }, bytes: 100 }
    },
    event: async () => {
      throw new Error('unexpected get-event')
    },
    subscribe: () => ({
      cancel: () => {},
      async *[Symbol.asyncIterator]() {
        // No progress chunks needed for unit tests.
      },
    }),
  }
  return async () => client
}

let dispose: (() => void) | undefined

function mount(view: () => ReturnType<typeof Workspace>, into?: HTMLElement | ShadowRoot): HTMLElement | ShadowRoot {
  const host = into ?? document.body.appendChild(document.createElement('div'))
  dispose = render(view, host)
  return host
}

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.innerHTML = ''
})

describe('Workspace shell split', () => {
  it('renders the ready view from a fake connect without DevFrame', async () => {
    const root = mount(() => <Workspace traceId="t1" connect={fakeConnect()} />)
    await tick()
    expect(root.querySelector('[data-testid="ledger"]')).not.toBeNull()
    expect(root.querySelector('[data-testid="inspector"]')).not.toBeNull()
  })

  it('shows the connection-lost banner when lost turns true', async () => {
    const [lost, setLost] = createSignal(false)
    const root = mount(() => <Workspace traceId="t1" connect={fakeConnect()} lost={lost} />)
    await tick()
    expect(root.querySelector('[data-testid="connection-lost"]')).toBeNull()
    setLost(true)
    expect(root.querySelector('[data-testid="connection-lost"]')).not.toBeNull()
  })

  it('never shows the connection-lost banner when lost is omitted', async () => {
    const root = mount(() => <Workspace traceId="t1" connect={fakeConnect()} />)
    await tick()
    expect(root.querySelector('[data-testid="connection-lost"]')).toBeNull()
  })

  it('omits the export button when export is not passed and draws it when passed', async () => {
    const withoutExport = mount(() => <Workspace traceId="t1" connect={fakeConnect()} />)
    await tick()
    expect(withoutExport.querySelector('[data-testid="export-report"]')).toBeNull()
    dispose?.()

    const withExport = mount(() => (
      <Workspace
        traceId="t1"
        connect={fakeConnect()}
        export={
          <button type="button" data-testid="export-report">
            Export
          </button>
        }
      />
    ))
    await tick()
    expect(withExport.querySelector('[data-testid="export-report"]')).not.toBeNull()
  })

  it('focuses the ledger inside its own shadow root when Jump to is clicked or Ctrl+K is pressed', async () => {
    const host = document.body.appendChild(document.createElement('div'))
    const shadow = host.attachShadow({ mode: 'open' })
    mount(() => <Workspace traceId="t1" connect={fakeConnect()} embedded />, shadow)
    await tick()
    const jump = shadow.querySelector<HTMLButtonElement>('[data-testid="jump-to"]')
    const ledger = shadow.querySelector('[data-testid="ledger"]')
    expect(jump).not.toBeNull()
    expect(jump!.textContent).toContain('⌘K')
    expect(ledger).not.toBeNull()
    jump!.click()
    expect(shadow.activeElement).toBe(ledger)

    jump!.focus()
    expect(shadow.activeElement).toBe(jump)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
    expect(shadow.activeElement).toBe(ledger)

    // Typing inside a host input (such as a composer) must not be hijacked by ⌘K.
    const hostInput = document.body.appendChild(document.createElement('input'))
    hostInput.focus()
    hostInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))
    expect(document.activeElement).toBe(hostInput)
  })
  it('moves inspector tab focus with arrow keys inside a shadow root', () => {
    const host = document.body.appendChild(document.createElement('div'))
    const shadow = host.attachShadow({ mode: 'open' })
    const trace = sample()
    mount(() => {
      const state = createWorkspaceState({
        traceId: 't1',
        trace,
        summary: { turns: 2, requests: 2 },
        event: async () => {
          throw new Error('unexpected get-event')
        },
      })
      state.setSelectedKey('e:r1')
      return <Inspector state={state} start={0} />
    }, shadow)
    const tablist = shadow.querySelector<HTMLElement>('[role="tablist"]')
    expect(tablist).not.toBeNull()
    const tabs = [...shadow.querySelectorAll<HTMLElement>('[role="tab"]')]
    expect(tabs.length).toBeGreaterThan(1)
    tabs[0]!.focus()
    tablist!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true }))
    expect(shadow.activeElement).toBe(tabs[1])
  })
})

describe('embedded mode (B8)', () => {
  it('Workspace omits TopBar and session h1 when embedded, keeping compact stats and Jump to, while page mode keeps TopBar', async () => {
    const embedded = mount(() => <Workspace traceId="t1" connect={fakeConnect()} embedded />)
    await tick()
    expect(embedded.querySelector('nav')).toBeNull()
    expect(embedded.querySelector('h1')).toBeNull()
    expect(embedded.querySelectorAll('a').length).toBe(0)
    expect(embedded.querySelector('[data-testid="theme-switch"]')).toBeNull()
    expect(embedded.querySelector('[data-testid="language-switch"]')).toBeNull()
    expect(embedded.querySelector('[data-testid="embedded-header"]')).not.toBeNull()
    expect(embedded.querySelector('[data-testid="jump-to"]')).not.toBeNull()
    dispose?.()

    const page = mount(() => <TopBar crumbs={['proj', 'title']} />)
    const links = [...page.querySelectorAll('a')]
    expect(links.length).toBe(2)
    expect(links.map(link => link.textContent)).toEqual(['Estela', 'Sessions'])
    expect(page.querySelector('[data-testid="theme-switch"]')).not.toBeNull()
    expect(page.querySelector('[data-testid="language-switch"]')).not.toBeNull()
  })

  it('ErrorPanel omits #/ links and avoids location.reload() when embedded', () => {
    const retry = vi.fn<() => void>()
    const errorRoot = mount(() => <ErrorPanel failure={{ reason: 'boom' }} onRetry={retry} embedded />)
    expect(errorRoot.querySelectorAll('a').length).toBe(0)
    const retryBtn = errorRoot.querySelector('button')
    expect(retryBtn).not.toBeNull()
    retryBtn?.click()
    expect(retry).toHaveBeenCalledTimes(1)
    dispose?.()

    const pageError = mount(() => <ErrorPanel failure={{ reason: 'boom' }} onRetry={retry} />)
    expect(pageError.querySelectorAll('a').length).toBe(1)
    dispose?.()

    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    try {
      const lostRoot = mount(() => (
        <ErrorPanel failure={{ reason: 'connection lost', lost: true }} onRetry={retry} embedded />
      ))
      expect(lostRoot.querySelector('[data-testid="connection-lost"]')).toBeNull()
      expect(lostRoot.querySelectorAll('a').length).toBe(0)
      const lostRetry = lostRoot.querySelector('button')
      expect(lostRetry).not.toBeNull()
      lostRetry?.click()
      expect(reload).not.toHaveBeenCalled()
      expect(retry).toHaveBeenCalledTimes(2)
      dispose?.()

      const pageLost = mount(() => <ErrorPanel failure={{ reason: 'connection lost', lost: true }} onRetry={retry} />)
      expect(pageLost.querySelector('[data-testid="connection-lost"]')).not.toBeNull()
    } finally {
      reload.mockRestore()
    }
  })
})
