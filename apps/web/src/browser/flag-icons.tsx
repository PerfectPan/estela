import { Show } from 'solid-js'
import { translate as t } from '@/i18n/locale.ts'

export function FlagIcons(props: { compactions?: number, subagents?: number, failedTools?: number }) {
  return (
    <div class="flex w-16 shrink-0 items-center gap-2">
      <Show when={(props.compactions ?? 0) > 0}>
        <span title={t('browser.hasCompaction')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted-foreground)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 7 H20 M4 17 H20" />
            <path d="M9 10.5 L12 13.5 L15 10.5" />
          </svg>
        </span>
      </Show>
      <Show when={(props.subagents ?? 0) > 0}>
        <span title={t('browser.hasSubagents')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--kind-subagent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="6" cy="6" r="2.2" />
            <circle cx="6" cy="18" r="2.2" />
            <circle cx="18" cy="9" r="2.2" />
            <path d="M6 8.2 V15.8 M6 13 C6 10 18 13 18 11.2" />
          </svg>
        </span>
      </Show>
      <Show when={(props.failedTools ?? 0) > 0}>
        <span class="flex items-center gap-[3px] text-destructive" title={t('browser.failedTools', { count: props.failedTools ?? 0 })}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 4 L21 19 H3 Z" />
            <path d="M12 10 V13.5" />
            <path d="M12 16.3 V16.4" />
          </svg>
          <span class="data text-[11px]">{props.failedTools}</span>
        </span>
      </Show>
    </div>
  )
}
