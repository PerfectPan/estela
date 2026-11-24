import { describe, expect, it, vi } from 'vite-plus/test'
import { observeViewHeight } from './view-height.ts'

interface FakeRect {
  top: number
  bottom: number
  height: number
}

interface FakeNode {
  parentElement: FakeNode | null
  children: FakeNode[]
  clientHeight: number
  style: { height: string }
  computed: { overflowY: string; position: string }
  rect: FakeRect
  contains(node: FakeNode): boolean
  getBoundingClientRect(): FakeRect
}

function makeNode(options: {
  parent?: FakeNode | null
  clientHeight?: number
  overflowY?: string
  position?: string
  rect?: FakeRect
}): FakeNode {
  const node: FakeNode = {
    parentElement: options.parent ?? null,
    children: [],
    clientHeight: options.clientHeight ?? 0,
    style: { height: '' },
    computed: {
      overflowY: options.overflowY ?? 'visible',
      position: options.position ?? 'static',
    },
    rect: options.rect ?? { top: 0, bottom: 0, height: 0 },
    contains(target) {
      let current: FakeNode | null = target
      while (current) {
        if (current === node) {
          return true
        }
        current = current.parentElement
      }
      return false
    },
    getBoundingClientRect() {
      return node.rect
    },
  }
  if (options.parent) {
    options.parent.children.push(node)
  }
  return node
}

describe('observeViewHeight', () => {
  it('sizes the wrapper to scroller clientHeight minus bottom overlays and updates on resize', () => {
    const resizeCallbacks: Array<() => void> = []
    const observedTargets: unknown[] = []
    let disconnected = false

    class FakeResizeObserver {
      constructor(cb: () => void) {
        resizeCallbacks.push(cb)
      }
      observe(target: unknown): void {
        observedTargets.push(target)
      }
      disconnect(): void {
        disconnected = true
      }
    }

    const scroller = makeNode({
      clientHeight: 824,
      overflowY: 'auto',
      rect: { top: 76, bottom: 900, height: 824 },
    })
    const viewArea = makeNode({ parent: scroller })
    const wrapper = makeNode({ parent: viewArea })
    const composer = makeNode({
      parent: scroller,
      position: 'sticky',
      rect: { top: 772, bottom: 900, height: 128 },
    })

    vi.stubGlobal('getComputedStyle', (node: FakeNode) => node.computed)
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    vi.stubGlobal('MutationObserver', undefined)

    try {
      const dispose = observeViewHeight(wrapper as unknown as HTMLElement)
      expect(wrapper.style.height).toBe('696px')
      expect(observedTargets).toContain(scroller)
      expect(observedTargets).toContain(composer)

      // Composer grows taller while user types multi-line text.
      composer.rect = { top: 720, bottom: 900, height: 180 }
      for (const cb of resizeCallbacks) {
        cb()
      }
      expect(wrapper.style.height).toBe('644px')

      // Viewport resizes.
      scroller.clientHeight = 1000
      scroller.rect = { top: 76, bottom: 1076, height: 1000 }
      composer.rect = { top: 948, bottom: 1076, height: 128 }
      for (const cb of resizeCallbacks) {
        cb()
      }
      expect(wrapper.style.height).toBe('872px')

      dispose()
      expect(disconnected).toBe(true)
      expect(wrapper.style.height).toBe('')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('ignores non-overlay siblings and returns a no-op when no scroll ancestor exists', () => {
    const scroller = makeNode({
      clientHeight: 800,
      overflowY: 'auto',
      rect: { top: 0, bottom: 800, height: 800 },
    })
    const wrapper = makeNode({ parent: scroller })
    makeNode({
      parent: scroller,
      position: 'static',
      rect: { top: 600, bottom: 800, height: 200 },
    })
    const orphan = makeNode({})

    class NoopResizeObserver {
      observe(): void {}
      disconnect(): void {}
    }

    vi.stubGlobal('getComputedStyle', (node: FakeNode) => node.computed)
    vi.stubGlobal('ResizeObserver', NoopResizeObserver)
    vi.stubGlobal('MutationObserver', undefined)
    try {
      const dispose = observeViewHeight(wrapper as unknown as HTMLElement)
      expect(wrapper.style.height).toBe('800px')
      dispose()

      const disposeOrphan = observeViewHeight(orphan as unknown as HTMLElement)
      expect(orphan.style.height).toBe('')
      disposeOrphan()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
