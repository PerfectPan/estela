import { translate as t } from '@/i18n/locale.ts'

/** "Lost the connection to the agent-trace server" and a Reload button: a new page load opens a new connection. */
export function ConnectionLost(props: { compact?: boolean }) {
  return (
    <div
      class={props.compact
        ? 'flex shrink-0 items-center gap-3 border-b border-border bg-secondary px-5 py-2 text-[13px]'
        : 'flex flex-col items-start gap-3 text-[13px]'}
      role="alert"
      data-testid="connection-lost"
    >
      <span class="text-foreground">{t('common.connectionLost')}</span>
      <button
        type="button"
        class="rounded-md border border-input px-2.5 py-1 text-[12.5px] text-foreground hover:bg-accent"
        onClick={() => location.reload()}
      >
        {t('common.reload')}
      </button>
    </div>
  )
}
