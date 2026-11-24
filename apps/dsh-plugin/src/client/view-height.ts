function findScrollAncestor(start: HTMLElement): HTMLElement | undefined {
  let current = start.parentElement
  while (current) {
    const overflowY = getComputedStyle(current).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return current
    }
    current = current.parentElement
  }
  return undefined
}

function isOverlayPosition(position: string): boolean {
  return position === 'sticky' || position === 'absolute' || position === 'fixed'
}

/**
 * Sizes the wrapper to its nearest vertically scrollable ancestor minus any bottom-docked
 * overlay siblings (such as dsh's sticky composer seat) so `<estela-workspace>` fills the
 * visible conversation pane and keeps ledger virtualization and inspector scrolling intact.
 */
export function observeViewHeight(wrapper: HTMLElement): () => void {
  const scroller = findScrollAncestor(wrapper)
  if (!scroller || typeof ResizeObserver === 'undefined') {
    return () => {}
  }

  const observed = new Set<Element>()
  let resizeObserver: ResizeObserver | undefined

  const observeOverlays = (): Element[] => {
    const overlays: Element[] = []
    const current = new Set<Element>()
    for (const child of Array.from(scroller.children)) {
      if (child.contains(wrapper)) {
        continue
      }
      if (isOverlayPosition(getComputedStyle(child).position)) {
        overlays.push(child)
        current.add(child)
        if (!observed.has(child)) {
          observed.add(child)
          resizeObserver?.observe(child)
        }
      }
    }
    for (const stale of Array.from(observed)) {
      if (!current.has(stale)) {
        observed.delete(stale)
        resizeObserver?.unobserve(stale)
      }
    }
    return overlays
  }

  const syncHeight = (): void => {
    const scrollerRect = scroller.getBoundingClientRect()
    const overlays = observeOverlays()
    let overlayHeight = 0
    for (const overlay of overlays) {
      const rect = overlay.getBoundingClientRect()
      if (rect.height > 0 && rect.top > scrollerRect.top && rect.top < scrollerRect.bottom) {
        overlayHeight = Math.max(overlayHeight, Math.ceil(scrollerRect.bottom - rect.top))
      }
    }
    const target = Math.floor(scroller.clientHeight - overlayHeight)
    if (target > 0) {
      wrapper.style.height = `${target}px`
    }
  }

  resizeObserver = new ResizeObserver(() => {
    syncHeight()
  })
  resizeObserver.observe(scroller)

  const mutationObserver =
    typeof MutationObserver === 'undefined'
      ? undefined
      : new MutationObserver(() => {
          syncHeight()
        })
  mutationObserver?.observe(scroller, { childList: true })
  syncHeight()

  return () => {
    resizeObserver.disconnect()
    observed.clear()
    mutationObserver?.disconnect()
    wrapper.style.height = ''
  }
}
