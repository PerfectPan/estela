import { defineEstelaWorkspace } from '@rivus/estela-web/embed'
import { createEstelaView } from './estela-view.ts'
import type { DshClientContext } from './types.ts'

export const inject = ['slots', 'connection', 'theme', 'locale'] as const

export function apply(ctx: DshClientContext): void {
  defineEstelaWorkspace()
  const EstelaView = createEstelaView(ctx)
  ctx.effect(
    () =>
      ctx.slots.inject('conversation.view', () =>
        ctx.slots.register(
          {
            name: 'conversation.view',
            id: 'estela',
            order: 60,
            label: 'Estela',
            inject: sessionId => ({ sessionId }),
          },
          EstelaView,
        ),
      ),
    'estela: conversation.view',
  )
}
