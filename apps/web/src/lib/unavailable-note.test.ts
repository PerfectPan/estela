import type { ContextSlot } from '@rivus/agent-trace-schema'
import { afterEach, describe, expect, it } from 'vitest'
import { applyLocale } from '@/i18n/locale.ts'
import { unavailableNote } from './unavailable-note.ts'

const slot = (name: ContextSlot['name'], status: ContextSlot['status']): ContextSlot => ({ name, status, eventIds: [] })

describe('unavailableNote', () => {
  afterEach(() => applyLocale('en'))
  // `applyLocale` sets `<html lang>`; the node test environment has no document.
  globalThis.document ??= { documentElement: {} } as Document

  it('says nothing when every slot is recorded', () => {
    expect(unavailableNote(['systemPrompt'], [slot('system', 'present'), slot('tools', 'empty')])).toBeUndefined()
  })

  it('says the log does not record a slot whose capability the trace does not list', () => {
    expect(
      unavailableNote([], [slot('system', 'unavailable'), slot('tools', 'unavailable'), slot('messages', 'present')]),
    ).toBe(
      'The log of this session does not record the system prompt and tool definitions, so those slots are shown as unavailable instead of being guessed.',
    )
  })

  it('says the log records a listed slot only after this event or on another lane', () => {
    expect(
      unavailableNote(['systemPrompt', 'toolSchemas'], [slot('system', 'present'), slot('tools', 'unavailable')]),
    ).toBe(
      'The log of this session records tool definitions only after this event or on another lane, so those slots are shown as unavailable here instead of being guessed.',
    )
  })

  it('gives both sentences when the two cases mix, in Chinese too', () => {
    const slots = [slot('system', 'unavailable'), slot('tools', 'unavailable'), slot('summary', 'unavailable')]
    expect(unavailableNote(['toolSchemas'], slots)).toBe(
      'The log of this session does not record the system prompt and the compaction summary, so those slots are shown as unavailable instead of being guessed.'
        + ' The log of this session records tool definitions only after this event or on another lane, so those slots are shown as unavailable here instead of being guessed.',
    )
    applyLocale('zh-CN')
    expect(unavailableNote(['toolSchemas'], [slot('tools', 'unavailable')])).toBe(
      '这个会话的日志只在此事件之后或其他泳道上记录了工具定义，所以这些槽位在此处显示为不可用，而不是猜测。',
    )
  })
})
