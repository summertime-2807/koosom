import { describe, expect, it } from 'vitest'
import { RACE_CALENDAR, mergeCalendar } from '../../data/raceCalendar'
import { getRaceProfile } from '../../data/raceProfiles'
import type { CalendarRace } from '../../types/race'

const r = (id: string, name: string, date: string, location?: string): CalendarRace => ({ id, name, date, location, distancesKm: [], source: 'race.thai.run', url: 'x' })

describe('calendar merge', () => {
  it('drops static race.thai.run entries, keeps researched, dedupes', () => {
    const remote = [r('tr_bangsaen', 'Bangsaen21 2026', '2026-12-20'), r('tr_new', 'งานใหม่ 2027', '2027-02-01', 'Nakhon Nayok')]
    const out = mergeCalendar(RACE_CALENDAR, remote)
    expect(out.some((x) => x.id === 'tr_ram27')).toBe(false)
    expect(out.some((x) => x.id === 'bs21')).toBe(true)
    expect(out.some((x) => x.id === 'tr_bangsaen')).toBe(false)
    expect(out.some((x) => x.id === 'tr_new')).toBe(true)
  })
  it('no remote -> unchanged', () => {
    expect(mergeCalendar(RACE_CALENDAR, undefined)).toBe(RACE_CALENDAR)
  })
  it('english province -> coords & region climate', () => {
    const p = getRaceProfile(r('a', 'x', '2027-01-10', 'Chiang Mai'))
    expect(p.lat).toBeCloseTo(18.79, 1)
    expect(p.climate.tempC).toBeLessThan(18)
    const h = getRaceProfile(r('b', 'x', '2027-01-10', 'Songkhla'))
    expect(h.lat).toBeLessThan(8)
  })
})
