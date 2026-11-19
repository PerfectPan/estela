import { describe, expect, it } from 'vite-plus/test'
import { mcpAuthorization } from './mcp-authorization.ts'

const allows = mcpAuthorization('the-token')

function request(headers: Record<string, string>, url = 'http://localhost:7392/__estela/__mcp'): Request {
  return new Request(url, { method: 'POST', headers })
}

describe('mcpAuthorization', () => {
  it('accepts the token from a client that sends no Origin, as command-line MCP clients do', () => {
    expect(allows(request({ authorization: 'Bearer the-token' }))).toBe(true)
    expect(allows(request({ authorization: '  bearer the-token  ' }))).toBe(true)
  })

  it('accepts the token with a loopback Origin', () => {
    for (const origin of ['http://localhost:7392', 'http://127.0.0.1:7392', 'http://[::1]:7392']) {
      expect(allows(request({ origin, authorization: 'Bearer the-token' })), origin).toBe(true)
    }
  })

  it('accepts a loopback Host and refuses any other, as a DNS-rebinding page sends, even with the token', () => {
    for (const host of ['localhost:7392', '127.0.0.1:7392', '[::1]:7392']) {
      expect(allows(request({ host, authorization: 'Bearer the-token' })), host).toBe(true)
    }
    for (const host of [
      'rebound.example:7392',
      'localhost.evil.example:7392',
      '127.0.0.1.nip.io:7392',
      'not a host',
      'a@localhost:7392',
      'localhost/x',
      'evil.example, localhost',
    ]) {
      expect(allows(request({ host, authorization: 'Bearer the-token' })), host).toBe(false)
    }
    expect(allows(request({ authorization: 'Bearer the-token' }, 'http://rebound.example:7392/__estela/__mcp'))).toBe(
      false,
    )
  })

  it('refuses any other Origin even with the token, so a web page cannot try tokens', () => {
    for (const origin of [
      'http://evil.example',
      'http://rebound.example:7392',
      'http://localhost.evil.example',
      'http://127.0.0.1.nip.io',
      'null',
      'not a url',
    ]) {
      expect(allows(request({ origin, authorization: 'Bearer the-token' })), origin).toBe(false)
    }
  })

  it('refuses a missing, empty, other-scheme, or wrong token', () => {
    for (const authorization of [
      undefined,
      '',
      'Bearer',
      'Bearer ',
      'Basic the-token',
      'Bearer the-tokens',
      'Bearer x y',
    ]) {
      const headers: Record<string, string> = authorization === undefined ? {} : { authorization }
      expect(allows(request(headers)), String(authorization)).toBe(false)
    }
  })
})
