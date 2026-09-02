import { describe, expect, it } from 'vitest'
import { normalizeGatewayConnectionIdentity } from '../src/lib/gateway-url.ts'

describe('normalizeGatewayConnectionIdentity', () => {
  it('ignores volatile gateway token and view params', () => {
    const first = normalizeGatewayConnectionIdentity(
      'wss://api.heysnap.xyz/gateway/computers/c1/filesystem?accessToken=a&path=src&showHidden=1&v=1',
    )
    const second = normalizeGatewayConnectionIdentity(
      'wss://api.heysnap.xyz/gateway/computers/c1/filesystem?accessToken=b&path=docs&showHidden=0&v=2',
    )

    expect(second).toBe(first)
  })

  it('keeps real route and machine changes distinct', () => {
    const filesystem = normalizeGatewayConnectionIdentity(
      'https://api.heysnap.xyz/gateway/computers/c1/filesystem?accessToken=a',
    )
    const agent = normalizeGatewayConnectionIdentity(
      'https://api.heysnap.xyz/gateway/computers/c1/agent?accessToken=a',
    )
    const otherMachine = normalizeGatewayConnectionIdentity(
      'https://api.heysnap.xyz/gateway/computers/c2/filesystem?accessToken=a',
    )

    expect(agent).not.toBe(filesystem)
    expect(otherMachine).not.toBe(filesystem)
  })

  it('sorts stable query params', () => {
    const first = normalizeGatewayConnectionIdentity(
      'https://api.heysnap.xyz/gateway/computers/c1/agent?b=2&a=1&accessToken=a',
    )
    const second = normalizeGatewayConnectionIdentity(
      'https://api.heysnap.xyz/gateway/computers/c1/agent?accessToken=b&a=1&b=2',
    )

    expect(second).toBe(first)
  })
})
