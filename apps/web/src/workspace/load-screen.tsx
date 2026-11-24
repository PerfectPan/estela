import { Show } from 'solid-js'
import { locale, translate as t } from '@/i18n/locale.ts'
import { formatBytes } from '@/lib/format.ts'

/** Bytes read out of the file size while `load-trace` runs (S12), or an indeterminate bar when size is unknown. */
export function LoadingPanel(props: { bytesRead: number; totalBytes: number }) {
  const determinate = () => props.totalBytes > 0
  const ratio = () => (determinate() ? Math.min(1, props.bytesRead / props.totalBytes) : 0)
  const done = () => determinate() && props.bytesRead >= props.totalBytes
  return (
    <div class="grid flex-1 place-items-center px-6" data-testid="loading">
      <div class="flex w-[360px] max-w-full flex-col gap-3">
        <span class="text-[15px] font-semibold text-foreground">{t('workspace.opening')}</span>
        <div
          class="h-1.5 overflow-hidden rounded-full bg-muted shadow-[inset_0_0_0_1px_var(--border)]"
          role="progressbar"
          aria-label={t('workspace.opening')}
          aria-valuemin={determinate() ? 0 : undefined}
          aria-valuemax={determinate() ? 100 : undefined}
          aria-valuenow={determinate() ? Math.round(ratio() * 100) : undefined}
        >
          <Show
            when={determinate()}
            fallback={<div class="loading-indeterminate h-full w-2/5 rounded-full bg-kind-request" />}
          >
            <div
              class="h-full rounded-full bg-kind-request transition-[width] duration-150"
              style={{ width: `${ratio() * 100}%` }}
            />
          </Show>
        </div>
        <span class="font-mono text-[12px] text-muted-foreground">
          <Show when={determinate()} fallback={t('common.loading')}>
            {done()
              ? t('workspace.preparing')
              : t('workspace.bytesOf', {
                  read: formatBytes(props.bytesRead, locale()),
                  total: formatBytes(props.totalBytes, locale()),
                })}
          </Show>
        </span>
      </div>
    </div>
  )
}
