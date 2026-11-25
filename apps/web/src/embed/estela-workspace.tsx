import type { Accessor, Setter } from 'solid-js'
import type { Locale } from '@/i18n/locale.ts'
import type { WorkspaceSource } from './source.ts'
import type { SplitStylesheet } from './stylesheet.ts'
import { createSignal, ErrorBoundary, Show } from 'solid-js'
import { render } from 'solid-js/web'
import { applyLocale, locale } from '@/i18n/locale.ts'
import { messageOf } from '@/lib/error-message.ts'
import { ErrorPanel } from '@/workspace/error-panel.tsx'
import { Workspace } from '@/workspace/workspace.tsx'
import embedCss from '../styles.css?inline'
import { createSourceClient } from './load-client.ts'
import { acquireSharedStyles, splitStylesheet } from './stylesheet.ts'

let cachedSplit: SplitStylesheet | undefined

function styles(): SplitStylesheet {
  if (!cachedSplit) {
    cachedSplit = splitStylesheet(embedCss)
  }
  return cachedSplit
}

function resolveLocale(value: string | null): Locale {
  return value && value.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

/**
 * `<estela-workspace>` custom element: renders the workspace inside an open shadow root.
 * The host provides `source` (property), `data-theme` (`light` | `dark`), and `lang` (`en` | `zh-CN`);
 * the element never writes `document.documentElement`'s `data-theme` or `lang`.
 */
export class EstelaWorkspaceElement extends HTMLElement {
  static readonly observedAttributes = ['data-theme', 'lang'] as const

  readonly #shadow: ShadowRoot
  readonly #mount: HTMLDivElement
  readonly #style: HTMLStyleElement
  readonly #source: Accessor<WorkspaceSource | undefined>
  readonly #setSource: Setter<WorkspaceSource | undefined>
  #dispose: (() => void) | undefined
  #releaseShared: (() => void) | undefined

  constructor() {
    super()
    const [source, setSource] = createSignal<WorkspaceSource | undefined>(undefined)
    this.#source = source
    this.#setSource = setSource
    this.#shadow = this.attachShadow({ mode: 'open' })
    this.#style = document.createElement('style')
    this.#mount = document.createElement('div')
    this.#mount.id = 'app'
    this.#shadow.append(this.#style, this.#mount)
  }

  get source(): WorkspaceSource | undefined {
    return this.#source()
  }

  set source(next: WorkspaceSource | undefined) {
    this.#setSource(() => next)
  }

  connectedCallback(): void {
    const split = styles()
    if (this.#style.textContent !== split.shadowCss) {
      this.#style.textContent = split.shadowCss
    }
    this.#releaseShared?.()
    this.#releaseShared = acquireSharedStyles(this.ownerDocument, split.documentCss)
    applyLocale(resolveLocale(this.getAttribute('lang')), this)
    if (!this.#dispose) {
      this.#mount.replaceChildren()
      this.#dispose = render(
        () => (
          <Show when={this.#source()} keyed>
            {current => (
              <ErrorBoundary
                fallback={(error, reset) => (
                  <div
                    lang={locale()}
                    class="flex h-full min-h-0 flex-col border-b border-border bg-background text-foreground"
                  >
                    <ErrorPanel failure={{ reason: messageOf(error) }} onRetry={reset} embedded />
                  </div>
                )}
              >
                <Workspace traceId="" connect={async () => createSourceClient(current)} embedded />
              </ErrorBoundary>
            )}
          </Show>
        ),
        this.#mount,
      )
    }
  }

  disconnectedCallback(): void {
    this.#dispose?.()
    this.#dispose = undefined
    this.#mount.replaceChildren()
    this.#releaseShared?.()
    this.#releaseShared = undefined
  }

  attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null): void {
    if (name === 'lang' && this.isConnected) {
      applyLocale(resolveLocale(newValue), this)
    }
  }
}
