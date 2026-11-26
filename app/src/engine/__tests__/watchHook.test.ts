import { describe, expect, it } from 'vitest'
import { hookDecide, hookMessages, hookToken, readHookToken, hookSetup } from '../../coach/watchHook'

describe('Apple Watch shortcut hook', () => {
  it('token round-trips and rejects tampering', async () => {
    const t = await hookToken('sec', 'U123abc')
    expect(await readHookToken('sec', t)).toBe('U123abc')
    expect(await readHookToken('other', t)).toBeNull()
    expect(await readHookToken('sec', t.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')))).toBeNull()
    expect(await readHookToken('sec', 'garbage')).toBeNull()
  })
  it('computes minutes from start to end', () => {
    const now = Date.parse('2026-11-26T12:00:00Z')
    expect(hookDecide('start', null, now)).toEqual({ kind: 'started' })
    expect(hookDecide('end', '2026-11-26T10:30:00Z', now)).toEqual({ kind: 'ended', minutes: 90 })
    expect(hookDecide('end', '2026-11-26T11:55:00Z', now)).toEqual({ kind: 'test', minutes: 5 })
    expect(hookDecide('end', null, now)).toEqual({ kind: 'ended', minutes: null })
    expect(hookDecide('end', '2026-11-25T12:00:00Z', now)).toEqual({ kind: 'ended', minutes: null })
    expect(hookDecide('x', null, now)).toEqual({ kind: 'bad' })
  })
  it('builds messages', () => {
    const m = hookMessages({ kind: 'ended', minutes: 95 })
    expect(m).toHaveLength(1)
    expect(JSON.stringify(m)).toContain('hk|95|court')
    expect(hookMessages({ kind: 'started' })).toHaveLength(0)
    const s = hookSetup('https://x.dev', 'tok')
    expect(s).toHaveLength(4)
    expect(JSON.stringify(s)).toContain('https://x.dev/w/tok?e=end')
  })
})
