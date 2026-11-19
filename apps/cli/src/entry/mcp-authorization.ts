import { createHash, timingSafeEqual } from 'node:crypto'
import { isLoopbackHost } from './host.ts'

/** Equal-length digests, so the comparison takes the same time whatever the given token's length. */
function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

function isLoopbackUrl(url: string): boolean {
  try {
    return isLoopbackHost(new URL(url).hostname)
  } catch {
    // `null` (a sandboxed frame, a file) and anything else that is not a URL.
    return false
  }
}

/**
 * The `--mcp` route's identity check, given to DevFrame as its `authorization` callback with DevFrame's own Origin gate
 * off, which refuses the requests without `Origin` that command-line MCP clients send. Whatever token it carries, a
 * request is refused when its `Host` is not a loopback name, as a page reached through DNS rebinding sends (its
 * same-origin GETs carry no `Origin`), and when its `Origin` is not a loopback one, as a browser sends with every POST.
 * A cross-origin request from a page either carries `Origin` or cannot carry `Authorization`, so no web page can use
 * the route or try tokens on it. Then the bearer token must match, compared in constant time.
 */
export function mcpAuthorization(token: string): (request: Request) => boolean {
  const expected = digest(token)
  return request => {
    // Without a Host header, srvx builds the URL from the socket's local address, which the loopback bind makes local.
    const host = request.headers.get('host')
    // URL parsing would read `a@localhost` or `localhost/x` as localhost; no Host a browser sends has these characters.
    if (host !== null && /[@/\\,\s]/.test(host)) {
      return false
    }
    if (!isLoopbackUrl(host === null ? request.url : `http://${host}`)) {
      return false
    }
    const origin = request.headers.get('origin')
    if (origin !== null && !isLoopbackUrl(origin)) {
      return false
    }
    // Parsed as DevFrame parses the header for a string token.
    const given = /^Bearer (\S+)$/i.exec(request.headers.get('authorization')?.trim() ?? '')?.[1]
    return given !== undefined && timingSafeEqual(digest(given), expected)
  }
}
