import { ESTELA_WORKSPACE_TAG, type EstelaWorkspaceElement } from '@rivus/estela-web/embed'
import { createElement, useEffect, useRef, type ComponentType } from 'react'
import { bindAppearance } from './appearance.ts'
import { createEstelaSource } from './source.ts'
import type { DshClientContext } from './types.ts'
import { observeViewHeight } from './view-height.ts'

interface EstelaViewProps {
  readonly sessionId: string
}

/** Creates the React component mounted into dsh's `conversation.view` slot (no JSX). */
export function createEstelaView(ctx: DshClientContext): ComponentType<EstelaViewProps> {
  return function EstelaView({ sessionId }: EstelaViewProps) {
    const wrapperRef = useRef<HTMLDivElement | null>(null)
    const workspaceRef = useRef<EstelaWorkspaceElement | null>(null)

    useEffect(() => {
      const element = workspaceRef.current
      if (!element) {
        return
      }
      element.source = createEstelaSource(ctx.connection.rpc, sessionId)
    }, [sessionId])

    useEffect(() => {
      const element = workspaceRef.current
      if (!element) {
        return
      }
      return bindAppearance(ctx, element)
    }, [])

    useEffect(() => {
      const wrapper = wrapperRef.current
      if (!wrapper) {
        return
      }
      return observeViewHeight(wrapper)
    }, [])

    return createElement(
      'div',
      { ref: wrapperRef, style: { width: '100%', minHeight: 0 } },
      createElement(ESTELA_WORKSPACE_TAG, { ref: workspaceRef }),
    )
  }
}
