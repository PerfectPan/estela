import * as z from 'zod/mini'
import { expect } from 'vite-plus/test'
import { waitFor, type Server } from './cli-process.ts'

export const reply = z.object({ id: z.number(), result: z.optional(z.unknown()), error: z.optional(z.unknown()) })
export const toolList = z.object({
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      inputSchema: z.object({ type: z.literal('object'), properties: z.record(z.string(), z.unknown()) }),
    }),
  ),
})
/** The `estela_list_sessions` result: the sessions it lists, and how many match in all. */
export const sessions = z.object({
  sessions: z.array(
    z.object({
      traceId: z.string(),
      agent: z.string(),
      title: z.optional(z.string()),
      error: z.optional(z.unknown()),
    }),
  ),
  total: z.number(),
})
export const callResult = z.object({
  isError: z.optional(z.boolean()),
  content: z.array(z.object({ type: z.literal('text'), text: z.string() })),
})

const rpcMessage = z.object({
  jsonrpc: z.string(),
  method: z.optional(z.string()),
  id: z.optional(z.union([z.string(), z.number()])),
  result: z.optional(z.unknown()),
  error: z.optional(z.unknown()),
})

/**
 * Whether `line` is a whole JSON-RPC 2.0 message: a request or a notification, which names a `method`, or a
 * response, which carries its `id` and a `result` or an `error`. A line that is not JSON, or is none of
 * these, is not.
 */
export function isProtocolMessage(line: string): boolean {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return false
  }
  const message = z.safeParse(rpcMessage, value)
  if (!message.success) {
    return false
  }
  const { jsonrpc, method, id, result, error } = message.data
  return (
    jsonrpc === '2.0' && (method !== undefined || (id !== undefined && (result !== undefined || error !== undefined)))
  )
}

/** An MCP client over the CLI's stdin and stdout: newline-delimited JSON-RPC, as the stdio transport speaks it. */
export function mcpClient(server: Server) {
  let next = 0
  const lines = () =>
    server
      .output()
      .stdout.split('\n')
      .filter(text => text.trim().length > 0)
  const request = async (method: string, params: unknown): Promise<unknown> => {
    next += 1
    const id = next
    server.send(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    const mine = (line: string) => line.includes(`"id":${id},`) || line.endsWith(`"id":${id}}`)
    await waitFor(`mcp reply ${id}`, () => lines().some(mine))
    const message = z.parse(reply, JSON.parse(lines().find(mine)!))
    expect(message.error).toBeUndefined()
    return message.result
  }
  return {
    lines,
    async initialize() {
      await request('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'estela-smoke', version: '0.0.0' },
      })
      server.send(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
    },
    tools: async () => z.parse(toolList, await request('tools/list', {})).tools,
    /** The tool's reply text: a JSON result, or the error message when `isError`. */
    async call(name: string, args: unknown): Promise<{ isError: boolean; text: string }> {
      const result = z.parse(callResult, await request('tools/call', { name, arguments: args }))
      return { isError: result.isError === true, text: result.content[0]!.text }
    },
  }
}
