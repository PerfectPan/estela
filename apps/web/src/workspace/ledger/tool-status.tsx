import { Match, Switch } from 'solid-js'
import { CheckIcon, WarningIcon } from '@/components/icons.tsx'
import { translate as t } from '@/i18n/locale.ts'
import { exitCode } from '@/lib/event-text.ts'
import { isFailedResult } from '@/lib/ledger-model.ts'

export function ToolStatus(props: { result?: Parameters<typeof isFailedResult>[0] }) {
  const code = () => exitCode(props.result)
  return (
    <Switch>
      <Match when={isFailedResult(props.result)}>
        <span class="flex shrink-0 items-center gap-[5px] text-[12px] text-destructive" data-testid="failed-tool">
          <WarningIcon size={13} />
          <span class="font-mono">
            {code() !== undefined ? t('ledger.exit', { code: code()! }) : t('ledger.failed')}
          </span>
        </span>
      </Match>
      <Match when={code() === 0}>
        <span class="flex shrink-0 items-center gap-[5px] text-[12px] text-muted-foreground">
          <CheckIcon size={13} class="text-kind-user" />
          <span class="font-mono">{t('ledger.exit', { code: 0 })}</span>
        </span>
      </Match>
    </Switch>
  )
}
