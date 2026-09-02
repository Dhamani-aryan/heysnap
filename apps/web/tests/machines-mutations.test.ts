import { describe, expect, it } from 'vitest'
import { upsertComputerInList } from '../src/lib/machines/machines-cache.ts'
import type { CloudComputer } from '../src/lib/machines/machines-api.ts'

const computer = (
  id: string,
  overrides: Partial<CloudComputer> = {},
): CloudComputer => ({
  id,
  name: `Computer ${id}`,
  kind: 'cloud',
  status: 'creating',
  ownerUserId: 'user-1',
  machineServerVersion: null,
  lastHeartbeatAt: null,
  tunnelConnected: false,
  createdAt: `2026-01-01T00:00:0${id}.000Z`,
  updatedAt: `2026-01-01T00:00:0${id}.000Z`,
  ...overrides,
})

describe('upsertComputerInList', () => {
  it('adds a created computer when the list cache is empty', () => {
    const created = computer('1')

    expect(upsertComputerInList(undefined, created)).toEqual([created])
  })

  it('preserves existing computers when adding a new one', () => {
    const existing = computer('1')
    const created = computer('2')

    expect(upsertComputerInList([existing], created)).toEqual([
      existing,
      created,
    ])
  })

  it('replaces an existing computer with the same id', () => {
    const existing = computer('1', { name: 'Old name' })
    const updated = computer('1', { name: 'New name' })

    expect(upsertComputerInList([existing], updated)).toEqual([updated])
  })
})
