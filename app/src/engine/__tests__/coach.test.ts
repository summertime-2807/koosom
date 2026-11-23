import { describe, expect, it } from 'vitest'
import { applyRules, battery, buildDays, buildReport, classify, overallLight, readiness, timeFromVdot, vdotFrom } from '../../coach/engine'
import { toIcuEvent, workoutSteps, bpmRange } from '../../coach/workoutText'
import { computeTrainingPlan } from '../trainingEngine'
import { RACE_PROFILES } from '../../data/raceProfiles'
import type { CoachConfig, IcuActivity, IcuEvent, IcuWellness } from '../../coach/types'

const cfg: CoachConfig = { version: 1, planName: 'Tokyo', from: '2026-11-21', to: '2027-03-07', lthr: 170, maxHr: 190, autoAdjust: true, distKm: 42.195, goalSec: 4 * 3600 }
let id = 1
const ev = (date: string, name: string, km: number): IcuEvent => ({ id: id++, category: 'WORKOUT', start_date_local: `${date}T00:00:00`, name, type: 'Run', distance: km * 1000 })
const act = (date: string, km: number, sec?: number, load?: number): IcuActivity => ({ id: `a${id++}`, start_date_local: `${date}T06:00:00`, type: 'Run', distance: km * 1000, moving_time: sec ?? km * 360, icu_training_load: load ?? km * 6 })

describe('workout text', () => {
  it('bpm from LTHR: easy ~136-150 for LTHR 170', () => {
    expect(bpmRange(170, 'easy')).toEqual([136, 150])
  })
  it('generates structured steps with repeats and HR %', () => {
    const plan = computeTrainingPlan({ weeklyKm: 40, longestRunKm: 18, runsPerWeek: 5, experience: 'regular' }, { distKm: 42.195, goalSec: 4 * 3600, raceDate: '2027-03-07', startTime: '09:10', gainPerKm: 1 }, RACE_PROFILES.bs21, '2026-11-21')
    const all = plan.weeks.flatMap((w) => w.workouts)
    const interval = all.find((w) => w.type === 'interval')!
    const txt = workoutSteps(interval, plan.paces, { lthr: 170 })
    expect(txt).toMatch(/Main Set \dx/)
    expect(txt).toMatch(/\/km Pace/)
    expect(txt).toMatch(/% LTHR/)
    const e = toIcuEvent(all[0], plan.paces, { lthr: 170 }, 'tokyo')
    expect(e.external_id).toBe(`rp-tokyo-${all[0].date}`)
    const race = toIcuEvent(all.at(-1)!, plan.paces, { lthr: 170 }, 'tokyo')
    expect(race.category).toBe('RACE_A')
  })
})

describe('coach engine', () => {
  it('classify', () => {
    expect(classify(ev('2026-11-22', 'Long Run 24 km', 24))).toBe('long')
    expect(classify(ev('2026-11-24', 'อินเทอร์วัล 5x1km', 9))).toBe('quality')
    expect(classify(ev('2026-11-25', 'วิ่งง่าย 6 กม.', 6))).toBe('easy')
  })
  it('days status', () => {
    const events = [ev('2026-11-23', 'easy 6km', 6), ev('2026-11-24', 'tempo 8km', 8), ev('2026-11-26', 'easy 6km', 6)]
    const days = buildDays(events, [act('2026-11-23', 6.2), act('2026-11-25', 10)], '2026-11-23', '2026-11-26', '2026-11-26')
    expect(days.map((d) => d.status)).toEqual(['done', 'missed', 'extra', 'planned'])
  })
  it('missed long run: drop + cap next week; missed easy: no makeup', () => {
    const events = [
      ev('2026-11-16', 'easy 6km', 6), ev('2026-11-18', 'tempo 8km', 8), ev('2026-11-22', 'Long run 20 km', 20),
      ev('2026-11-24', 'easy 6km', 6), ev('2026-11-26', 'tempo 10km', 10), ev('2026-11-29', 'Long run 24 km', 24),
    ]
    const acts = [act('2026-11-16', 6), act('2026-11-18', 8)]
    const days = buildDays(events, acts, '2026-11-16', '2026-11-30', '2026-11-23')
    const r = applyRules({ days, today: '2026-11-23', cfg, handled: new Set(), battery: [], injuryDates: [] })
    const upd = r.adjustments.find((a) => a.eventId > 0)!
    expect(upd.date).toBe('2026-11-29')
    expect(upd.patch!.name).toMatch(/วิ่งยาว 18 กม/)
    // สัปดาห์หน้ารวมต้องไม่เกินสัปดาห์นี้ (34)
    const newKm = Number(/วิ่งยาว (\d+)/.exec(upd.patch!.name!)![1])
    expect(6 + 10 + newKm).toBeLessThanOrEqual(34 + 0.5)
    expect(r.questions.length).toBe(0)
  })
  it('two consecutive misses -> question, no auto change', () => {
    const events = [ev('2026-11-19', 'easy 6km', 6), ev('2026-11-20', 'easy 6km', 6), ev('2026-11-24', 'intervals 5x1km', 9)]
    const days = buildDays(events, [], '2026-11-17', '2026-11-25', '2026-11-22')
    const r = applyRules({ days, today: '2026-11-22', cfg, handled: new Set(), battery: [], injuryDates: [] })
    expect(r.questions[0].id).toMatch(/q-streak/)
    expect(r.adjustments.filter((a) => a.eventId > 0)).toHaveLength(0)
  })
  it('handled dates are not re-processed', () => {
    const events = [ev('2026-11-20', 'easy 6km', 6)]
    const days = buildDays(events, [], '2026-11-19', '2026-11-22', '2026-11-22')
    const r = applyRules({ days, today: '2026-11-22', cfg, handled: new Set(['2026-11-20']), battery: [], injuryDates: [] })
    expect(r.adjustments).toHaveLength(0)
  })
  it('battery lights', () => {
    const w: IcuWellness[] = []
    for (let i = 1; i <= 7; i++) w.push({ id: `2026-11-${String(14 + i).padStart(2, '0')}`, hrv: 60, restingHR: 50, sleepSecs: 7.5 * 3600, ctl: 50, atl: 55 })
    w.push({ id: '2026-11-22', hrv: 48, restingHR: 57, sleepSecs: 5 * 3600, ctl: 50, atl: 80 })
    const b = battery(w, '2026-11-22')
    expect(b.find((x) => x.key === 'hrv')!.light).toBe('red')
    expect(b.find((x) => x.key === 'rhr')!.light).toBe('red')
    expect(overallLight(b)).toBe('red')
  })
  it('vdot round trip & readiness', () => {
    const v = vdotFrom(10000, 50 * 60)
    expect(v).toBeGreaterThan(38)
    expect(timeFromVdot(v, 10000)).toBeCloseTo(3000, -1)
    const acts = [act('2026-11-20', 10, 50 * 60)]
    for (let i = 1; i < 40; i += 2) acts.push(act(`2026-${i < 21 ? '11' : '10'}-${String(i < 21 ? 21 - i : 51 - i).padStart(2, '0')}`, 8))
    const r = readiness(acts, '2026-11-22')
    expect(r.vdot).toBeDefined()
    expect(r.predictedSec!).toBeGreaterThan(timeFromVdot(r.vdot!, 42195))
  })
  it('report builds summary text', () => {
    const rep = buildReport({ events: [ev('2026-11-23', 'easy 6km', 6)], acts: [act('2026-11-21', 8, 2880)], wellness: [], cfg, today: '2026-11-22', handled: new Set(), injuryDates: [] })
    expect(rep.summary).toMatch(/แบตเตอรี่/)
    expect(rep.weekly).toBeDefined() // 22 พ.ย. 2026 = วันอาทิตย์
  })
})
