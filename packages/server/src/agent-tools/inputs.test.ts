import { describe, expect, it } from 'vite-plus/test'
import { getEventInput, inputJsonSchema, listSessionsInput, parseToolInput } from './inputs.ts'

describe('tool inputs', () => {
  it('advertises named properties with their bounds and no positional args', () => {
    const schema = inputJsonSchema(getEventInput)
    expect(schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['eventId'],
      properties: { maxChars: { type: 'integer', minimum: 256, maximum: 20000 } },
    })
    expect(Object.keys(schema.properties as object)).toEqual(['traceId', 'eventId', 'maxChars', 'original'])
    expect(schema).not.toHaveProperty('$schema')
  })

  it('names the tool and the field in an error', () => {
    for (const since of ['yesterday', '2026-11-01T09:30:00']) {
      expect(() => parseToolInput('t', listSessionsInput, { since })).toThrow('t: since: expected an ISO 8601 date')
    }
    expect(parseToolInput('t', listSessionsInput, { until: '2026-11-01T09:30:00+08:00' })).toEqual({
      until: '2026-11-01T09:30:00+08:00',
    })
    expect(() => parseToolInput('t', getEventInput, {})).toThrow('t: eventId: expected a non-empty event id string')
    expect(parseToolInput('t', listSessionsInput, undefined)).toEqual({})
  })
})
