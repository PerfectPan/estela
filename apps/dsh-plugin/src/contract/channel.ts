import type { EventDetail, TraceViewResult } from '@rivus/estela-rpc/trace-store'
import * as z from 'zod/mini'

export const DSH_VERSION = '0.2.2-rc.5'
export const CHANNEL = '/estela'

export const CHANNEL_ERROR_CODES = [
  'estela/unknown-session',
  'estela/no-log',
  'estela/unknown-trace',
  'estela/stale',
  'estela/failed',
  'estela/bad-request',
  'estela/forbidden',
  'estela/closed',
] as const

export type ChannelErrorCode = (typeof CHANNEL_ERROR_CODES)[number]

const boundedId = z.string().check(
  z.minLength(1),
  z.maxLength(256),
  z.refine(value => !/\p{Cc}/u.test(value), { error: 'must not contain control characters' }),
)

export const channelInputs = {
  'session/open': z.object({ sessionId: boundedId }),
  'trace/view': z.object({ traceId: boundedId }),
  'trace/event': z.object({ traceId: boundedId, id: boundedId }),
} as const

export type ChannelInputs = typeof channelInputs
export type ChannelEndpoint = keyof ChannelInputs

export interface ChannelResults {
  'session/open': { traceId: string }
  'trace/view': TraceViewResult
  'trace/event': EventDetail
}

export type ChannelInput<E extends ChannelEndpoint> = z.output<ChannelInputs[E]>
export type ChannelResult<E extends ChannelEndpoint> = ChannelResults[E]
