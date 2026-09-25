import { createSignal } from 'solid-js'
import { devframeClient } from '@/shell/client.ts'

const [lost, setLost] = createSignal(false)
let watching = false

/**
 * True once the DevFrame WebSocket has closed or failed. DevFrame 1.0.0 does not reconnect a
 * closed client, so every later call would fail: the screens show "Lost the connection" with a
 * Reload button instead of waiting. A static build has no socket and never reports a loss.
 */
export function connectionLost(): boolean {
  if (!watching) {
    watching = true
    void devframeClient().then((client) => {
      if (client.transport === 'static')
        return
      if (client.status === 'disconnected' || client.status === 'error')
        setLost(true)
      client.events.on('connection:status', (status) => {
        if (status === 'disconnected' || status === 'error')
          setLost(true)
      })
    }).catch(() => setLost(true))
  }
  return lost()
}
