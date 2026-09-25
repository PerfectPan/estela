import type { ExportReportResult } from '@rivus/agent-trace-rpc'
import { Match, Show, Switch, createSignal, onCleanup } from 'solid-js'
import { ExportIcon } from '@/components/icons.tsx'
import { locale, translate as t } from '@/i18n/locale.ts'
import { formatBytes, formatNumber } from '@/lib/format.ts'
import { scopedClient } from '@/shell/client.ts'

/** Must match `REPORT_MAX_EVENTS` and `REPORT_MAX_BYTES` in `@rivus/agent-trace-rpc` (plan D8). */
const MAX_EVENTS = 2000
const MAX_BYTES = 20 * 1000 * 1000

type ExportState =
  | { status: 'idle' }
  | { status: 'writing' }
  | { status: 'done', result: ExportReportResult }
  | { status: 'error', reason: string }

function reasonOf(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string')
    return error.message
  return String(error)
}

/**
 * "Export report" and its dialog (plan 3.9): what the report holds and what stays in it, then
 * `export-report` for this session, then where it was written.
 */
export function ExportReport(props: { sessionRef: string }) {
  const [open, setOpen] = createSignal(false)
  const [state, setState] = createSignal<ExportState>({ status: 'idle' })
  let confirm: HTMLButtonElement | undefined
  let trigger: HTMLButtonElement | undefined

  function show(): void {
    if (state().status !== 'writing')
      setState({ status: 'idle' })
    setOpen(true)
    queueMicrotask(() => confirm?.focus())
  }
  function hide(): void {
    setOpen(false)
    trigger?.focus()
  }
  async function run(): Promise<void> {
    setState({ status: 'writing' })
    try {
      const ctx = await scopedClient()
      const result = await ctx.rpc.call('export-report', { ref: props.sessionRef, locale: locale() })
      setState({ status: 'done', result })
    }
    catch (error) {
      setState({ status: 'error', reason: reasonOf(error) })
    }
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && open())
      hide()
  }
  window.addEventListener('keydown', onKey)
  onCleanup(() => window.removeEventListener('keydown', onKey))

  const written = () => {
    const current = state()
    return current.status === 'done' ? current.result : undefined
  }
  const failed = () => {
    const current = state()
    return current.status === 'error' ? current.reason : undefined
  }
  const button = 'rounded-md border border-input px-3 py-1.5 text-[13px] text-foreground hover:bg-accent'
  return (
    <>
      <button
        ref={(element) => {
          trigger = element
        }}
        type="button"
        class="flex h-8 items-center gap-[7px] rounded-lg border border-input px-3 text-[13px] whitespace-nowrap text-foreground hover:bg-accent"
        aria-haspopup="dialog"
        data-testid="export-report"
        onClick={show}
      >
        <ExportIcon />
        {t('report.export')}
      </button>
      <Show when={open()}>
        <div class="fixed inset-0 z-50 grid place-items-center bg-background/80 px-6" onClick={event => event.target === event.currentTarget && hide()}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-title"
            class="flex w-full max-w-[520px] flex-col gap-3 rounded-xl border border-border bg-secondary p-5 text-[13px] shadow-lg"
            data-testid="export-dialog"
          >
            <h2 id="export-title" class="m-0 text-[15px] font-semibold text-foreground">{t('report.dialogTitle')}</h2>
            <p class="m-0 text-muted-foreground">{t('report.dialogBody')}</p>
            <p class="m-0 font-medium text-foreground">{t('report.dialogKeeps')}</p>
            <p class="m-0 text-muted-foreground">
              {t('report.dialogLimit', { events: formatNumber(MAX_EVENTS, locale()), size: formatBytes(MAX_BYTES, locale()) })}
            </p>
            <Switch>
              <Match when={state().status === 'writing'}>
                <p class="m-0 text-muted-foreground" role="status">{t('report.writing')}</p>
              </Match>
              <Match when={written()}>
                {result => (
                  <div class="flex flex-col gap-1" role="status" data-testid="export-written">
                    <span class="text-foreground">{t('report.written')}</span>
                    <code class="font-mono text-[12px] break-all text-foreground select-all" data-testid="export-path">{result().path}</code>
                    <span class="text-muted-foreground">
                      {t('report.writtenDetail', { included: formatNumber(result().included, locale()), total: formatNumber(result().total, locale()) })}
                    </span>
                  </div>
                )}
              </Match>
              <Match when={failed()}>
                {reason => <p class="m-0 text-destructive" role="alert">{t('report.failed', { reason: reason() })}</p>}
              </Match>
            </Switch>
            <div class="flex justify-end gap-2 pt-1">
              <button type="button" class={button} onClick={hide}>
                {state().status === 'done' ? t('report.close') : t('report.cancel')}
              </button>
              <Show when={state().status !== 'done'}>
                <button
                  ref={(element) => {
                    confirm = element
                  }}
                  type="button"
                  class="rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                  disabled={state().status === 'writing'}
                  data-testid="export-confirm"
                  onClick={() => void run()}
                >
                  {t('report.confirm')}
                </button>
              </Show>
            </div>
          </div>
        </div>
      </Show>
    </>
  )
}
