import type { Capability, ContextSlot, ContextSlotName } from '@rivus/agent-trace-schema'
import type { MessageKey } from '@/i18n/locale.ts'
import { translate as t } from '@/i18n/locale.ts'

const SLOT_PHRASE: Record<ContextSlotName, MessageKey> = {
  system: 'inspector.slotPhrases.system',
  tools: 'inspector.slotPhrases.tools',
  summary: 'inspector.slotPhrases.summary',
  messages: 'inspector.slotPhrases.messages',
  currentTurn: 'inspector.slotPhrases.currentTurn',
}

/** Capability that says a trace records a slot's content somewhere, for the slots that have one. */
const SLOT_CAPABILITY: Partial<Record<ContextSlotName, Capability>> = {
  system: 'systemPrompt',
  tools: 'toolSchemas',
}

function phraseList(slots: readonly ContextSlot[]): string {
  const phrases = slots.map(slot => t(SLOT_PHRASE[slot.name]))
  return phrases.length > 1 ? `${phrases.slice(0, -1).join(t('inspector.listSeparator'))}${t('inspector.listJoin')}${phrases.at(-1)}` : phrases[0]!
}

/**
 * The Model saw note for the unavailable slots, from what this trace lacks: a
 * slot its log never records, or one it records only after this event or on
 * another lane (its capability is listed, but no record precedes the event).
 */
export function unavailableNote(capabilities: readonly Capability[], slots: readonly ContextSlot[]): string | undefined {
  const unavailable = slots.filter(slot => slot.status === 'unavailable')
  const elsewhere = (slot: ContextSlot) => {
    const capability = SLOT_CAPABILITY[slot.name]
    return capability !== undefined && capabilities.includes(capability)
  }
  const never = unavailable.filter(slot => !elsewhere(slot))
  const later = unavailable.filter(elsewhere)
  const lines = [
    never.length > 0 ? t('inspector.unavailableNote', { slots: phraseList(never) }) : '',
    later.length > 0 ? t('inspector.unavailableHereNote', { slots: phraseList(later) }) : '',
  ].filter(Boolean)
  return lines.length > 0 ? lines.join(' ') : undefined
}
