import { describe, expect, it } from 'vitest'
import type { CalendarRace } from '../../types/race'
import type { IcuEvent } from '../../coach/types'
import { applyRunPlan, buildRunPlan, distancesOf, estimateInput, goalOptions, oldPlanEvents, planSlug, upcomingRaces } from '../../coach/raceSetup'
import { parseCustomRace } from '../../coach/raceSetupBot'

const R = (id: string, date: string, d: number[] = [10, 21.1], name = id): CalendarRace => ({ id, name, date, distancesKm: d, source: 'x', url: '' })
const today = '2026-11-26'

describe('race setup from LINE', () => {
  it('lists races at least 2 weeks away, searchable, deduped', () => {
    const all = [R('a', '2026-12-01'), R('b', '2027-01-10', [5], 'Chiang Mai Run'), R('c', '2026-12-20'), R('c2', '2026-12-20', [], 'c'), R('d', '2027-03-01')]
    expect(upcomingRaces(all, today).map((r) => r.id)).toEqual(['c', 'b', 'd'])
    expect(upcomingRaces(all, today, 'chiang mai').map((r) => r.id)).toEqual(['b'])
  })
  it('falls back to standard distances', () => {
    expect(distancesOf(R('x', '2027-01-01', []))).toEqual([5, 10, 21.1, 42.195])
    expect(distancesOf(R('x', '2027-01-01', [5, 10, 21.1, 42.195, 60, 100]))).toEqual([42.195, 60, 100].length === 3 ? [21.1, 42.195, 60, 100] : [])
  })
  it('parses custom races', () => {
    expect(parseCustomRace('15/3 21 ลำปางฮาล์ฟ', today)).toMatchObject({ km: 21.1, race: { date: '2027-03-15', name: 'ลำปางฮาล์ฟ' } })
    expect(parseCustomRace('1/12 10', today)?.race.date).toBe('2026-12-01')
    expect(parseCustomRace('1/2/70 มาราธอน งานA', today)).toMatchObject({ km: 42.195, race: { date: '2027-02-01' } })
    expect(parseCustomRace('เชียงใหม่', today)).toBeNull()
  })
  it('estimates fitness and goal options', () => {
    const acts = Array.from({ length: 18 }, (_, i) => ({ id: `a${i}`, type: 'Run', start_date_local: `2026-11-${String(25 - i).padStart(2, '0')}T06:00:00`, distance: i % 6 === 0 ? 16000 : 8000, moving_time: i % 6 === 0 ? 5760 : 2640 }))
    const e = estimateInput(acts as never, today, 21.1)
    expect(e.input.runsPerWeek).toBe(3)
    expect(e.input.longestRunKm).toBe(16)
    expect(e.predictedSec).toBeGreaterThan(5400)
    const g = goalOptions(21.1, e.predictedSec)
    expect(g[0].sec).toBeGreaterThan(g[1].sec)
    expect(g[1].sec).toBeGreaterThan(g[2].sec)
    expect(goalOptions(10)[1].sec).toBe(65 * 60)
  })
  it('builds a plan ending on race day', () => {
    const { plan } = buildRunPlan(R('hy', '2027-03-14'), 21.1, 7140, { weeklyKm: 25, longestRunKm: 12, runsPerWeek: 4, experience: 'regular' }, today)
    const ws = plan.weeks.flatMap((w) => w.workouts)
    expect(ws.at(-1)?.date).toBe('2027-03-14')
    expect(ws.at(-1)?.type).toBe('race')
  })
  it('only replaces future running-plan events', () => {
    const ev = (id: number, ext: string, date: string, category = 'WORKOUT') => ({ id, external_id: ext, start_date_local: `${date}T00:00:00`, category }) as IcuEvent
    const evs = [ev(1, 'rp-old-2026-11-25', '2026-11-25'), ev(2, 'rp-old-2026-11-27', '2026-11-27'), ev(3, 'rp-busy-x', '2026-11-28'), ev(4, 'bd-2026-11-28-court', '2026-11-28'), ev(5, 'rp-coach-2026-11-28', '2026-11-28', 'NOTE'), ev(6, 'rp-old-2027-05-09', '2027-05-09', 'RACE_A'), ev(7, '', '2026-11-29')]
    expect(oldPlanEvents(evs, today).map((e) => e.id)).toEqual([2, 6])
  })
  it('applies plan: deletes old, upserts new, saves config + line plan list', async () => {
    const calls: string[] = []
    let saved: unknown
    const client = {
      events: async () => [{ id: 9, external_id: 'rp-hatyai-2026-12-01', start_date_local: '2026-12-01T00:00:00', category: 'WORKOUT' }],
      deleteEvents: async (ids: number[]) => void calls.push(`del ${ids.join(',')}`),
      upsertEvents: async (e: unknown[]) => void calls.push(`up ${e.length}`),
      saveConfig: async (c: unknown) => void (saved = c),
      loadJson: async () => ({ data: { plans: [] } }),
      saveJson: async (id: string) => void calls.push(`json ${id}`),
    }
    const cfg = { version: 1 as const, planName: 'HATYAi21', from: today, to: '2027-05-09', raceDate: '2027-05-09', lthr: 171, maxHr: 189, autoAdjust: true }
    const r = await applyRunPlan(client as never, cfg, R('bs', '2027-02-20', [21.1], 'Bangsaen21'), 21.1, 7200, { weeklyKm: 25, longestRunKm: 12, runsPerWeek: 4, experience: 'regular' }, today)
    expect(calls[0]).toBe('del 9')
    expect(calls.some((c) => c.startsWith('up '))).toBe(true)
    expect(calls.at(-1)).toBe('json raceplan-line-plans')
    expect(saved).toMatchObject({ planName: 'Bangsaen21 21.1K', raceDate: '2027-02-20', goalSec: 7200, distKm: 21.1, lthr: 171 })
    expect(r.name).toBe('Bangsaen21 21.1K')
    expect(planSlug(r.name)).toBe('bangsaen21-21-1k')
  })
})
