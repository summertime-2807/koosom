import { describe, expect, it } from 'vitest'
import { computeTrainingPlan, computePaces, dowOf, mondayOf, riegel } from '../trainingEngine'
import { RACE_PROFILES, getRaceProfile } from '../../data/raceProfiles'
import { RACE_CALENDAR } from '../../data/raceCalendar'
import type { TrainingInput } from '../../types/race'

const input: TrainingInput = { weeklyKm: 30, longestRunKm: 14, runsPerWeek: 4, experience: 'regular', recentRaceKm: 10, recentRaceSec: 55 * 60 }

describe('training engine', () => {
  it('date helpers', () => {
    expect(dowOf('2026-11-29')).toBe(0)
    expect(mondayOf('2026-11-29')).toBe('2026-11-23')
    expect(mondayOf('2026-11-23')).toBe('2026-11-23')
  })
  it('riegel & paces sane', () => {
    expect(riegel(3600, 10, 21.0975)).toBeGreaterThan(7600)
    const p = computePaces(2 * 3600, 21.0975)
    expect(p.interval).toBeLessThan(p.threshold)
    expect(p.threshold).toBeLessThan(p.goal + 1)
    expect(p.easy[0]).toBeGreaterThan(p.goal)
  })
  it('HM in 4 weeks: race on race day, nothing after race, nothing in past', () => {
    const plan = computeTrainingPlan(input, { distKm: 21.1, goalSec: 2 * 3600, raceDate: '2026-12-20', startTime: '04:00', gainPerKm: 0, gelEveryMin: 30 }, RACE_PROFILES.bs21, '2026-11-21')
    const all = plan.weeks.flatMap((w) => w.workouts)
    expect(all.at(-1)!.type).toBe('race')
    expect(all.at(-1)!.date).toBe('2026-12-20')
    expect(all.every((w) => w.date >= '2026-11-21' && w.date <= '2026-12-20')).toBe(true)
    expect(plan.weeks.at(-1)!.phase).toBe('race')
    expect(plan.feasibility.level).not.toBe('unknown')
  })
  it('FM 20 weeks: progression capped at +10%/wk-ish, taper 3 weeks, long ≤ 32', () => {
    const plan = computeTrainingPlan({ ...input, runsPerWeek: 5 }, { distKm: 42.195, goalSec: 4.5 * 3600, raceDate: '2027-04-11', startTime: '03:00', gainPerKm: 1 }, getRaceProfile(undefined, '2027-04-11'), '2026-11-21')
    expect(plan.weeks.length).toBeGreaterThan(18)
    expect(plan.weeks.filter((w) => w.phase === 'taper').length).toBe(2)
    expect(Math.max(...plan.weeks.map((w) => w.longKm))).toBeLessThanOrEqual(32)
    const builds = plan.weeks.slice(1).filter((w) => w.phase !== 'taper' && w.phase !== 'race' && !w.cutback)
    for (let i = 1; i < builds.length; i++) expect(builds[i].km).toBeLessThanOrEqual(builds[i - 1].km * 1.2 + 4)
    expect(plan.raceSpecific.some((s) => s.includes('03:00'))).toBe(true)
  })
  it('race 8 days away -> race week mode', () => {
    const plan = computeTrainingPlan(input, { distKm: 21.1, goalSec: 2 * 3600, raceDate: '2026-11-29', startTime: '02:00', gainPerKm: 3 }, RACE_PROFILES.atmb26, '2026-11-21')
    expect(plan.weeks.length).toBe(2)
    expect(plan.feasibility.messages.some((m) => m.includes('2 สัปดาห์'))).toBe(true)
  })
  it('profiles exist for every calendar race (real or estimated)', () => {
    for (const r of RACE_CALENDAR) {
      const p = getRaceProfile(r)
      expect(Number.isFinite(p.lat)).toBe(true)
      expect(p.climate.tempC).toBeGreaterThan(10)
    }
  })
})
