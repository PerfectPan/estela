// @vitest-environment happy-dom
import type { EventDetail, TraceViewResult } from '@rivus/estela-rpc'
import type { Trace } from '@rivus/estela-schema'
import type { WorkspaceSource } from './index.ts'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test'
import { applyLocale } from '@/i18n/locale.ts'
import { REPORT_ISSUE_URL } from '@/lib/read-error.ts'
import { sample } from '@/testsupport/ledger-trace.ts'
import { defineEstelaWorkspace, ESTELA_WORKSPACE_TAG, EstelaWorkspaceElement, NoLogError, StaleError } from './index.ts'

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

function viewResult(trace: Trace = sample(), traceId = 'trace-1'): TraceViewResult {
  return {
    traceId,
    trace,
    summary: { turns: 2, requests: 2 },
    bytes: 512,
  }
}

function createElement(): EstelaWorkspaceElement {
  const el = document.createElement(ESTELA_WORKSPACE_TAG)
  if (!(el instanceof EstelaWorkspaceElement)) {
    throw new TypeError(`expected ${ESTELA_WORKSPACE_TAG} to be an EstelaWorkspaceElement`)
  }
  return el
}

function mountElement(source?: WorkspaceSource, attrs: Record<string, string> = {}): EstelaWorkspaceElement {
  const el = createElement()
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value)
  }
  if (source) {
    el.source = source
  }
  document.body.append(el)
  return el
}

beforeAll(() => {
  defineEstelaWorkspace()
})

afterEach(() => {
  document.body.innerHTML = ''
  for (const style of document.querySelectorAll('style[data-estela-shared]')) {
    style.remove()
  }
  delete document.documentElement.dataset.theme
  document.documentElement.lang = ''
  applyLocale('en', document.createElement('div'))
})

describe('<estela-workspace>', () => {
  it('registers once idempotently and renders the embedded workspace without page chrome', async () => {
    defineEstelaWorkspace()
    expect(customElements.get(ESTELA_WORKSPACE_TAG)).toBeDefined()

    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    try {
      const el = mountElement({
        open: async () => viewResult(),
        event: async () => {
          throw new Error('unexpected event')
        },
      })
      await tick()

      const shadow = el.shadowRoot
      expect(shadow).not.toBeNull()
      expect(shadow!.querySelector('[data-testid="ledger"]')).not.toBeNull()
      expect(shadow!.querySelector('[data-testid="inspector"]')).not.toBeNull()
      expect(shadow!.querySelectorAll('a[href^="#"]').length).toBe(0)
      expect(shadow!.querySelector('[data-testid="theme-switch"]')).toBeNull()
      expect(shadow!.querySelector('[data-testid="language-switch"]')).toBeNull()
      expect(shadow!.querySelector('[data-testid="export-report"]')).toBeNull()
      expect(shadow!.querySelector('[data-testid="connection-lost"]')).toBeNull()
      expect(shadow!.querySelector('nav')).toBeNull()
      expect(shadow!.querySelector('h1')).toBeNull()
      expect(shadow!.querySelector('[data-testid="embedded-header"]')).not.toBeNull()
      expect(shadow!.querySelector('[data-testid="jump-to"]')?.textContent).toContain('Jump to')
      expect(reload).not.toHaveBeenCalled()
    } finally {
      reload.mockRestore()
    }
  })

  it('labels each count of exactly one in the singular and any other count in the plural', async () => {
    const metrics = async (summary: TraceViewResult['summary']) => {
      const el = mountElement({
        open: async () => ({ ...viewResult(), summary }),
        event: async () => {
          throw new Error('unexpected event')
        },
      })
      await tick()
      const pairs = [...el.shadowRoot!.querySelectorAll('[data-testid="embedded-header"] dt')].map(
        dt => `${dt.parentElement?.querySelector('dd')?.textContent} ${dt.textContent}`,
      )
      el.remove()
      return pairs
    }

    // Mixed counts: each label follows its own number, not a neighbour's.
    expect(await metrics({ turns: 1, requests: 3, compactions: 2, subagents: 1, failedTools: 1 })).toEqual(
      expect.arrayContaining(['1 turn', '3 requests', '2 compactions', '1 subagent', '1 failed tool call']),
    )
    expect(await metrics({ turns: 3, requests: 1, compactions: 1, subagents: 2, failedTools: 2 })).toEqual(
      expect.arrayContaining(['3 turns', '1 request', '1 compaction', '2 subagents', '2 failed tool calls']),
    )
  })

  it('tracks theme and lang attributes without modifying document.documentElement', async () => {
    document.documentElement.dataset.theme = 'host-theme'
    document.documentElement.lang = 'fr'

    const el = mountElement(
      {
        open: async () => viewResult(),
        event: async () => {
          throw new Error('unexpected event')
        },
      },
      { 'data-theme': 'light', lang: 'en' },
    )
    await tick()

    expect(el.getAttribute('data-theme')).toBe('light')
    expect(el.shadowRoot!.querySelector('[data-testid="embedded-header"]')?.textContent).toContain('turns')
    expect(document.documentElement.dataset.theme).toBe('host-theme')
    expect(document.documentElement.lang).toBe('fr')

    el.setAttribute('data-theme', 'dark')
    el.setAttribute('lang', 'zh-CN')
    await tick()

    expect(el.getAttribute('data-theme')).toBe('dark')
    expect(el.lang).toBe('zh-CN')
    expect(el.shadowRoot!.querySelector('[data-testid="embedded-header"]')?.textContent).toContain('轮次')
    expect(document.documentElement.dataset.theme).toBe('host-theme')
    expect(document.documentElement.lang).toBe('fr')

    // Non-zh locales normalize back to English without touching <html>.
    el.setAttribute('lang', 'de')
    await tick()
    expect(el.lang).toBe('en')
    expect(el.shadowRoot!.querySelector('[data-testid="embedded-header"]')?.textContent).toContain('turns')
    expect(document.documentElement.lang).toBe('fr')
  })

  it('shows an indeterminate loading state while open() is pending (DSH-7)', async () => {
    let resolveOpen!: (value: TraceViewResult) => void
    const el = mountElement({
      open: () =>
        new Promise<TraceViewResult>(resolve => {
          resolveOpen = resolve
        }),
      event: async () => {
        throw new Error('unexpected event')
      },
    })
    await tick()

    const loading = el.shadowRoot!.querySelector('[data-testid="loading"]')
    expect(loading).not.toBeNull()
    expect(loading!.textContent).toContain('Opening session')
    expect(loading!.textContent).toContain('Loading…')

    resolveOpen(viewResult())
    await tick()

    expect(el.shadowRoot!.querySelector('[data-testid="loading"]')).toBeNull()
    expect(el.shadowRoot!.querySelector('[data-testid="ledger"]')).not.toBeNull()
  })

  it('shows only the no-log notice when open() rejects with NoLogError (DSH-4)', async () => {
    const el = mountElement({
      open: async () => {
        throw new NoLogError()
      },
      event: async () => {
        throw new Error('unexpected event')
      },
    })
    await tick()

    const shadow = el.shadowRoot!
    const notice = shadow.querySelector('[data-testid="no-log"]')
    expect(notice).not.toBeNull()
    expect(notice!.textContent).toContain('This session has no log on disk yet.')
    expect(shadow.querySelector('[data-testid="load-error"]')).toBeNull()
    expect(shadow.querySelector('dl')).toBeNull()
    expect(shadow.querySelector('a')).toBeNull()
    expect(notice!.querySelector('button')).toBeNull()
  })

  it('shows the unknown-format hint and GitHub link with no back link (DSH-5)', async () => {
    const el = mountElement({
      open: async () => {
        throw new Error('dsh: ~/.dsh/sessions/s.jsonl:1: unknown format generation: v99')
      },
      event: async () => {
        throw new Error('unexpected event')
      },
    })
    await tick()

    const shadow = el.shadowRoot!
    const panel = shadow.querySelector('[data-testid="load-error"]')
    expect(panel).not.toBeNull()
    expect(panel!.textContent).toContain('Could not open this session')
    expect(panel!.textContent).toContain('~/.dsh/sessions/s.jsonl')
    expect(panel!.textContent).toContain('unknown format generation: v99')

    const hint = shadow.querySelector('[data-testid="unknown-format-hint"]')
    expect(hint).not.toBeNull()
    const issueLink = hint!.querySelector<HTMLAnchorElement>('a')
    expect(issueLink?.href).toBe(REPORT_ISSUE_URL)
    expect(shadow.querySelector('a[href^="#"]')).toBeNull()
  })

  it('catches a source that throws synchronously and recovers on Try again without replacing the element', async () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    try {
      let calls = 0
      const source: WorkspaceSource = {
        open() {
          calls += 1
          if (calls === 1) {
            throw new Error('channel unavailable')
          }
          return Promise.resolve(viewResult())
        },
        event: async () => {
          throw new Error('unexpected event')
        },
      }
      const el = mountElement(source)
      await tick()

      const shadow = el.shadowRoot!
      const panel = shadow.querySelector('[data-testid="load-error"]')
      expect(panel).not.toBeNull()
      expect(panel!.textContent).toContain('Could not open this session')
      expect(panel!.textContent).toContain('channel unavailable')

      const retry = panel!.querySelector<HTMLButtonElement>('button')
      expect(retry?.textContent).toBe('Try again')
      retry!.click()
      await tick()

      expect(calls).toBe(2)
      expect(reload).not.toHaveBeenCalled()
      expect(shadow.querySelector('[data-testid="ledger"]')).not.toBeNull()
      expect(document.querySelector(ESTELA_WORKSPACE_TAG)).toBe(el)
      expect(el.source).toBe(source)
    } finally {
      reload.mockRestore()
    }
  })

  it('contains rendering errors inside the element boundary and recovers on Try again (DSH-6)', async () => {
    let calls = 0
    const brokenTrace = sample()
    Object.defineProperty(brokenTrace, 'events', {
      get() {
        throw new Error('render boom')
      },
    })
    const el = mountElement({
      open: async () => {
        calls += 1
        return calls === 1 ? viewResult(brokenTrace) : viewResult(sample())
      },
      event: async () => {
        throw new Error('unexpected event')
      },
    })
    await tick()

    const shadow = el.shadowRoot!
    const panel = shadow.querySelector('[data-testid="load-error"]')
    expect(panel).not.toBeNull()
    expect(panel!.textContent).toContain('Could not open this session')
    expect(panel!.textContent).toContain('render boom')

    panel!.querySelector<HTMLButtonElement>('button')!.click()
    await tick()

    expect(calls).toBe(2)
    expect(shadow.querySelector('[data-testid="ledger"]')).not.toBeNull()
  })

  it('reopens the session when event() rejects with StaleError', async () => {
    let opens = 0
    const receivedTraceIds: string[] = []
    const firstTrace = sample()
    firstTrace.session.title = 'first snapshot'
    const secondTrace = sample()
    secondTrace.session.title = 'refreshed snapshot'

    const el = mountElement({
      open: async () => {
        opens += 1
        return opens === 1 ? viewResult(firstTrace, 'trace-v1') : viewResult(secondTrace, 'trace-v2')
      },
      event: async (traceId, id): Promise<EventDetail> => {
        receivedTraceIds.push(traceId)
        if (traceId === 'trace-v1') {
          throw new StaleError()
        }
        const found = secondTrace.events.find(item => item.id === id)
        if (!found) {
          throw new Error(`missing ${id}`)
        }
        return { ...found, original: { ok: true } }
      },
    })
    await tick()

    const shadow = el.shadowRoot!
    expect(shadow.querySelector('[data-testid="embedded-header"]')?.getAttribute('aria-label')).toBe('first snapshot')

    // Move selection via keyboard on the ledger (happy-dom has zero viewport height for virtualized rows),
    // then open the Raw tab to trigger `source.event(traceId, id)`.
    const ledger = shadow.querySelector<HTMLElement>('[data-testid="ledger"]')
    expect(ledger).not.toBeNull()
    ledger!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, composed: true }))
    ledger!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, composed: true }))
    await tick()
    const rawTab = shadow.querySelector<HTMLButtonElement>('#inspector-tab-raw')
    expect(rawTab).not.toBeNull()
    rawTab!.click()
    await tick()
    await tick()

    expect(opens).toBe(2)
    expect(receivedTraceIds).toEqual(['trace-v1'])
    expect(shadow.querySelector('[data-testid="embedded-header"]')?.getAttribute('aria-label')).toBe(
      'refreshed snapshot',
    )
  })

  it('shows Try again when event() fails after load and reopens without replacing the element (DSH-6)', async () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    try {
      let opens = 0
      const trace = sample()
      const source: WorkspaceSource = {
        open: async () => {
          opens += 1
          return viewResult(trace, `trace-${opens}`)
        },
        event: async (_traceId, id): Promise<EventDetail> => {
          if (opens === 1) {
            throw new Error('transport closed')
          }
          const found = trace.events.find(item => item.id === id)
          if (!found) {
            throw new Error(`missing ${id}`)
          }
          return { ...found, original: { recovered: true } }
        },
      }
      const el = mountElement(source)
      await tick()

      const shadow = el.shadowRoot!
      const ledger = shadow.querySelector<HTMLElement>('[data-testid="ledger"]')
      expect(ledger).not.toBeNull()
      ledger!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, composed: true }))
      ledger!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, composed: true }))
      await tick()
      shadow.querySelector<HTMLButtonElement>('#inspector-tab-raw')!.click()
      await tick()
      await tick()

      const panel = shadow.querySelector('[data-testid="load-error"]')
      expect(panel).not.toBeNull()
      expect(panel!.textContent).toContain('Could not open this session')
      expect(panel!.textContent).toContain('transport closed')
      expect(shadow.querySelector('a[href^="#"]')).toBeNull()

      const retry = panel!.querySelector<HTMLButtonElement>('button')
      expect(retry?.textContent).toBe('Try again')
      retry!.click()
      await tick()

      expect(opens).toBe(2)
      expect(reload).not.toHaveBeenCalled()
      expect(shadow.querySelector('[data-testid="ledger"]')).not.toBeNull()
      expect(document.querySelector(ESTELA_WORKSPACE_TAG)).toBe(el)
      expect(el.source).toBe(source)
    } finally {
      reload.mockRestore()
    }
  })

  it('passes the displayed view traceId to event() even when overlapping opens resolve out of order (DSH-9)', async () => {
    const v1Trace = sample()
    v1Trace.session.title = 'version-one'
    const v2Trace = sample()
    v2Trace.session.title = 'version-two'
    const resolvers: Array<(value: TraceViewResult) => void> = []
    const requestedTraceIds: string[] = []

    const source: WorkspaceSource = {
      open: () =>
        new Promise<TraceViewResult>(resolve => {
          resolvers.push(resolve)
        }),
      event: async (traceId, id): Promise<EventDetail> => {
        requestedTraceIds.push(traceId)
        const base = traceId === 'trace-v2' ? v2Trace : v1Trace
        const found = base.events.find(item => item.id === id)
        if (!found) {
          throw new Error(`missing ${id}`)
        }
        return { ...found, original: { snapshot: traceId } }
      },
    }

    const el = mountElement(source)
    await tick()
    expect(resolvers.length).toBe(1)

    // Remove and re-insert while the first open is still pending, starting a second overlapping open.
    el.remove()
    document.body.append(el)
    await tick()
    expect(resolvers.length).toBe(2)

    // Second open resolves first with v2; first open resolves later with v1.
    resolvers[1]!(viewResult(v2Trace, 'trace-v2'))
    await tick()
    resolvers[0]!(viewResult(v1Trace, 'trace-v1'))
    await tick()

    const shadow = el.shadowRoot!
    expect(shadow.querySelector('[data-testid="embedded-header"]')?.getAttribute('aria-label')).toBe('version-two')

    const ledger = shadow.querySelector<HTMLElement>('[data-testid="ledger"]')
    expect(ledger).not.toBeNull()
    ledger!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, composed: true }))
    ledger!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, composed: true }))
    await tick()
    shadow.querySelector<HTMLButtonElement>('#inspector-tab-raw')!.click()
    await tick()
    await tick()

    expect(requestedTraceIds).toEqual(['trace-v2'])
    expect(shadow.querySelector('[data-testid="inspector"]')?.textContent).toContain('"snapshot": "trace-v2"')
  })

  it('disposes rendering on disconnect and removes the shared document style after the last element disconnects', async () => {
    let resolvePending!: (value: TraceViewResult) => void
    const first = mountElement({
      open: () =>
        new Promise<TraceViewResult>(resolve => {
          resolvePending = resolve
        }),
      event: async () => {
        throw new Error('unexpected event')
      },
    })
    const second = mountElement({
      open: async () => viewResult(),
      event: async () => {
        throw new Error('unexpected event')
      },
    })
    await tick()

    // In Vitest without embed build mode, styles.css still splits into shadow + document rules.
    const sharedBefore = document.querySelectorAll('style[data-estela-shared]').length
    expect(sharedBefore).toBeLessThanOrEqual(1)

    first.remove()
    // Resolving an in-flight load after disconnect must not render into the detached element.
    resolvePending(viewResult())
    await tick()
    expect(first.shadowRoot!.querySelector('#app')?.childNodes.length).toBe(0)
    expect(document.querySelectorAll('style[data-estela-shared]').length).toBe(sharedBefore)

    second.remove()
    expect(second.shadowRoot!.querySelector('#app')?.childNodes.length).toBe(0)
    expect(document.querySelectorAll('style[data-estela-shared]').length).toBe(0)
  })
})
