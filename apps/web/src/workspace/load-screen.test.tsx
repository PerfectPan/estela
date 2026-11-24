// @vitest-environment happy-dom
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { LoadingPanel } from './load-screen.tsx'

let dispose: (() => void) | undefined

function mount(bytesRead: number, totalBytes: number): HTMLElement {
  const host = document.body.appendChild(document.createElement('div'))
  dispose = render(() => <LoadingPanel bytesRead={bytesRead} totalBytes={totalBytes} />, host)
  return host
}

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.innerHTML = ''
})

describe('LoadingPanel', () => {
  it('renders an indeterminate progressbar without aria-valuenow when totalBytes is 0', () => {
    const root = mount(0, 0)
    const bar = root.querySelector('[role="progressbar"]')
    expect(bar).not.toBeNull()
    expect(bar!.getAttribute('aria-valuenow')).toBeNull()
    expect(bar!.getAttribute('aria-valuemin')).toBeNull()
    expect(bar!.getAttribute('aria-valuemax')).toBeNull()
    expect(bar!.querySelector('.loading-indeterminate')).not.toBeNull()
    expect(root.textContent).toContain('Opening session')
    expect(root.textContent).toContain('Loading…')
  })

  it('renders a determinate progressbar with aria-valuenow when totalBytes is positive', () => {
    const root = mount(500, 1000)
    const bar = root.querySelector('[role="progressbar"]')
    expect(bar).not.toBeNull()
    expect(bar!.getAttribute('aria-valuenow')).toBe('50')
    expect(bar!.getAttribute('aria-valuemin')).toBe('0')
    expect(bar!.getAttribute('aria-valuemax')).toBe('100')
    expect(bar!.querySelector('.loading-indeterminate')).toBeNull()
    const fill = bar!.querySelector<HTMLElement>('div')
    expect(fill?.style.width).toBe('50%')
    expect(root.textContent).toContain(' of ')
  })

  it('shows preparing text at 100% once all bytes are read', () => {
    const root = mount(1000, 1000)
    const bar = root.querySelector('[role="progressbar"]')
    expect(bar!.getAttribute('aria-valuenow')).toBe('100')
    expect(root.textContent).toContain('Building the view…')
  })
})
