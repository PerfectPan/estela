import { EstelaWorkspaceElement } from './estela-workspace.tsx'

export const ESTELA_WORKSPACE_TAG = 'estela-workspace'

/** Defines `<estela-workspace>` when it is not registered yet. */
export function defineEstelaWorkspace(): void {
  if (!customElements.get(ESTELA_WORKSPACE_TAG)) {
    customElements.define(ESTELA_WORKSPACE_TAG, EstelaWorkspaceElement)
  }
}

export { EstelaWorkspaceElement } from './estela-workspace.tsx'
export { NoLogError, StaleError, type WorkspaceSource } from './source.ts'
