import { Show } from 'solid-js'
import { locale, translate as t } from '@/i18n/locale.ts'
import { formatBytes } from '@/lib/format.ts'

/** Bytes read out of the file size while `load-trace` runs (3.5, S12). */
export function LoadingPanel(props: { bytesRead: number; totalBytes: number }) {
  const ratio = () => (props.totalBytes > 0 ? Math.min(1, props.bytesRead / props.totalBytes) : 0)
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
          <div
            class="h-full rounded-full bg-kind-request transition-[width] duration-150"
            style={{ width: `${ratio() * 100}%` }}
          />
        </div>
        <span class="font-mono text-[12px] text-muted-foreground">
          <Show when={props.totalBytes > 0} fallback={t('common.loading')}>
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
