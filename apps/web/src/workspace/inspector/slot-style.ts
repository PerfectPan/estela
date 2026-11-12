import type { ContextSlot, ContextSlotName } from '@rivus/estela-schema'
import type { MessageKey } from '@/i18n/locale.ts'

export const SLOT_LABEL: Record<ContextSlotName, MessageKey> = {
  system: 'inspector.slots.system',
  tools: 'inspector.slots.tools',
  summary: 'inspector.slots.summary',
  messages: 'inspector.slots.messages',
  currentTurn: 'inspector.slots.currentTurn',
}

/** Slot colors from the design: tools orange, summary purple, messages blue, this turn green. */
const SLOT_FILL: Record<ContextSlotName, string> = {
  system: 'bg-subtle',
  tools: 'bg-kind-tool',
  summary: 'bg-kind-reasoning',
  messages: 'bg-kind-request',
  currentTurn: 'bg-kind-user',
}

/** Hatched when the agent does not record the slot, outlined when it is empty, else the slot color. */
export function slotClass(slot: Pick<ContextSlot, 'name' | 'status'>, small = false): string {
  if (slot.status === 'unavailable') {
    return small ? 'hatched hatched-small' : 'hatched'
  }
  return slot.status === 'empty' ? 'border border-input' : SLOT_FILL[slot.name]
}
