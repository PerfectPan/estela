import type { LoadProgress } from '@rivus/estela-rpc'
import type { LoadClient } from '@/workspace/load-session.ts'
import { devframeClient, scopedClient } from '@/shell/client.ts'
import { connectionLost } from '@/shell/connection.ts'
import { ExportReport } from '@/workspace/export-report.tsx'
import { Workspace } from '@/workspace/workspace.tsx'

async function connectDevframeClient(): Promise<LoadClient> {
  const base = await devframeClient()
  const ctx = await scopedClient()
  return {
    get status() {
      return base.status
    },
    onStatus: listener => base.events.on('connection:status', status => listener(status)),
    loadTrace: traceId => ctx.rpc.call('load-trace', { traceId }),
    traceView: traceId => ctx.rpc.call('get-trace-view', { traceId }),
    event: (traceId, id) => ctx.rpc.call('get-event', { traceId, id }),
    subscribe: (channel, id) => ctx.rpc.streaming.subscribe<LoadProgress>(channel, id),
  }
}

/** Standalone workspace shell: connects through DevFrame, watches the socket, and offers "Export report". */
export function AppShell(props: { traceId: string }) {
  return (
    <Workspace
      traceId={props.traceId}
      connect={connectDevframeClient}
      lost={connectionLost}
      export={<ExportReport traceId={props.traceId} />}
    />
  )
}
