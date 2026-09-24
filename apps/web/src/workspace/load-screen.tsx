import type { LoadFailure } from './load-session.ts'
import { Show } from 'solid-js'
import { locale, translate as t } from '@/i18n/locale.ts'
import { formatBytes } from '@/lib/format.ts'
import { hostName } from '@/lib/host-names.ts'

/** Bytes read out of the file size while `load-trace` runs (3.5, S12). */
export function LoadingPanel(props: { bytesRead: number, totalBytes: number }) {
  const ratio = () => props.totalBytes > 0 ? Math.min(1, props.bytesRead / props.totalBytes) : 0
  const done = () => props.totalBytes > 0 && props.bytesRead >= props.totalBytes
  return (
    <div class="grid flex-1 place-items-center px-6" data-testid="loading">
      <div class="flex w-[360px] max-w-full flex-col gap-3">
        <span class="text-[15px] font-semibold text-foreground">{t('workspace.opening')}</span>
        <div
          class="h-1.5 overflow-hidden rounded-full bg-muted shadow-[inset_0_0_0_1px_var(--border)]"
          role="progressbar"
          aria-label={t('workspace.opening')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(ratio() * 100)}
        >
          <div class="h-full rounded-full bg-kind-request transition-[width] duration-150" style={{ width: `${ratio() * 100}%` }} />
        </div>
        <span class="font-mono text-[12px] text-muted-foreground">
          <Show when={props.totalBytes > 0} fallback={t('common.loading')}>
            {done()
              ? t('workspace.preparing')
              : t('workspace.bytesOf', { read: formatBytes(props.bytesRead, locale()), total: formatBytes(props.totalBytes, locale()) })}
          </Show>
        </span>
      </div>
    </div>
  )
}

/** A failed load: host, file, and line when the message carries them, and a way back (3.7). */
export function ErrorPanel(props: { failure: LoadFailure, onRetry: () => void }) {
  return (
    <div class="flex flex-1 flex-col items-start gap-4 px-6 py-10" data-testid="load-error">
      <h1 class="m-0 text-[22px] font-semibold">{t('workspace.couldNotOpen')}</h1>
      <dl class="m-0 grid max-w-3xl grid-cols-[max-content_1fr] gap-x-5 gap-y-1.5 rounded-lg border border-border bg-secondary px-4 py-3 text-[13px]">
        <Show when={props.failure.host}>
          {host => (
            <>
              <dt class="text-subtle">{t('workspace.errorHost')}</dt>
              <dd class="m-0 text-foreground">{hostName(host())}</dd>
            </>
          )}
        </Show>
        <Show when={props.failure.file}>
          {file => (
            <>
              <dt class="text-subtle">{t('workspace.errorFile')}</dt>
              <dd class="m-0 font-mono text-[12px] break-all text-foreground">{file()}</dd>
            </>
          )}
        </Show>
        <Show when={props.failure.line !== undefined}>
          <dt class="text-subtle">{t('workspace.errorLine')}</dt>
          <dd class="m-0 font-mono text-[12px] text-foreground">{props.failure.line}</dd>
        </Show>
        <dt class="text-subtle">{t('workspace.errorReason')}</dt>
        <dd class="m-0 break-words whitespace-pre-wrap text-muted-foreground">{props.failure.reason}</dd>
      </dl>
      <div class="flex items-center gap-4 text-[13px]">
        <a href="#/" class="text-link hover:underline">{t('workspace.back')}</a>
        <button type="button" class="text-muted-foreground hover:text-foreground" onClick={() => props.onRetry()}>{t('workspace.retry')}</button>
      </div>
    </div>
  )
}
