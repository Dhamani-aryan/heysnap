import { describe, expect, it } from 'vitest'
import { agentQueryKeys } from '../src/lib/agent/agent-queries.ts'
import { normalizeGatewayConnectionIdentity } from '../src/lib/gateway-url.ts'

describe('agent query keys', () => {
  it('stay stable across access-token URL changes', () => {
    const firstIdentity = normalizeGatewayConnectionIdentity(
      'https://api.heysnap.xyz/gateway/computers/c1/agent?accessToken=first',
    )
    const secondIdentity = normalizeGatewayConnectionIdentity(
      'https://api.heysnap.xyz/gateway/computers/c1/agent?accessToken=second',
    )

    expect(agentQueryKeys.threadGroups(secondIdentity)).toEqual(
      agentQueryKeys.threadGroups(firstIdentity),
    )
    expect(agentQueryKeys.thread(secondIdentity, 'thread-1')).toEqual(
      agentQueryKeys.thread(firstIdentity, 'thread-1'),
    )
  })
})
