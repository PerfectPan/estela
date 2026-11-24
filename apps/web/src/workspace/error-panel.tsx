import type { LoadFailure } from './load-session.ts'
import { Show } from 'solid-js'
import { UnknownFormatHint } from '@/components/unknown-format-hint.tsx'
import { translate as t } from '@/i18n/locale.ts'
import { agentName } from '@/lib/agent-names.ts'
import { ConnectionLost } from '@/shell/connection-lost.tsx'

/** A failed load: agent, file, and line when the message carries them, and a way back. */
export function ErrorPanel(props: { failure: LoadFailure; onRetry: () => void; embedded?: boolean }) {
  return (
    <Show
      when={props.failure.lost}
      fallback={
        <div class="flex flex-1 flex-col items-start gap-4 px-6 py-10" data-testid="load-error">
          <h1 class="m-0 text-[22px] font-semibold">{t('workspace.couldNotOpen')}</h1>
          <dl class="m-0 grid max-w-3xl grid-cols-[max-content_1fr] gap-x-5 gap-y-1.5 rounded-lg border border-border bg-secondary px-4 py-3 text-[13px]">
            <Show when={props.failure.agent}>
              {agent => (
                <>
                  <dt class="text-subtle">{t('workspace.errorAgent')}</dt>
                  <dd class="m-0 text-foreground">{agentName(agent())}</dd>
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
          <UnknownFormatHint reason={props.failure.reason} />
          <div class="flex items-center gap-4 text-[13px]">
            <Show when={!props.embedded}>
              <a href="#/" class="text-link hover:underline">
                {t('workspace.back')}
              </a>
            </Show>
            <button type="button" class="text-muted-foreground hover:text-foreground" onClick={() => props.onRetry()}>
              {t('workspace.retry')}
            </button>
          </div>
        </div>
      }
    >
      <div class="flex flex-1 flex-col items-start gap-4 px-6 py-10" data-testid="load-error">
        <h1 class="m-0 text-[22px] font-semibold">{t('workspace.couldNotOpen')}</h1>
        <Show
          when={!props.embedded}
          fallback={
            <div class="flex flex-col items-start gap-3 text-[13px]" role="alert">
              <span class="text-foreground">{t('common.connectionLost')}</span>
              <button
                type="button"
                class="rounded-md border border-input px-2.5 py-1 text-[12.5px] text-foreground hover:bg-accent"
                onClick={() => props.onRetry()}
              >
                {t('workspace.retry')}
              </button>
            </div>
          }
        >
          <ConnectionLost />
        </Show>
      </div>
    </Show>
  )
}
