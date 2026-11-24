import { describe, expect, it } from 'vitest'
import {
  analyzeRace,
  emptyShoes,
  findRaceActivity,
  flatSegments,
  kmSplitsFromStreams,
  paceCard,
  raceInfo,
  raceWeekTip,
  shoeKm,
  shoeWarnings,
  switchShoe,
  weeklyData,
} from '../../coach/extras'
import { paceCardFlex, raceWeekFlex, reviewFlex, shoesFlex, weeklyFlex } from '../../coach/flex'
import type { CoachConfig, IcuActivity, IcuEvent } from '../../coach/types'

const cfg: CoachConfig = {
  version: 1,
  planName: 'HATYAi21 2027',
  from: '2026-11-23',
  to: '2027-05-09',
  raceDate: '2027-05-09',
  goalSec: 7140,
  distKm: 21.1,
  lthr: 171,
  maxHr: 189,
  autoAdjust: true,
}

/** ตรวจโครงสร้าง Flex: flex ต้องเป็นจำนวนเต็ม ≥ 0 ข้อความต้องไม่ว่าง ขนาด < 30KB */
function checkFlex(node: unknown) {
  const json = JSON.stringify(node)
  expect(json.length).toBeLessThan(30000)
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk)
    if (n && typeof n === 'object') {
      const o = n as Record<string, unknown>
      if ('flex' in o) {
        expect(Number.isInteger(o.flex)).toBe(true)
        expect(o.flex as number).toBeGreaterThanOrEqual(0)
      }
      if (o.type === 'text') expect(String(o.text).length).toBeGreaterThan(0)
      if (o.type === 'box') expect(Array.isArray(o.contents)).toBe(true)
      Object.values(o).forEach(walk)
    }
  }
  walk(node)
}

describe('การ์ดเพซ', () => {
  it('segments ครบระยะ', () => {
    const s = flatSegments(21.1)
    expect(s.length).toBe(22)
    expect(s.reduce((a, x) => a + x.lengthKm, 0)).toBeCloseTo(21.1, 6)
  })
  it('เวลารวมตรงเป้า + split ทุก 5 กม. + เจลไม่อยู่ใน 2 กม.สุดท้าย', () => {
    const info = raceInfo(cfg)!
    expect(info.startTime).toBe('04:00')
    expect(info.lat).toBeCloseTo(7.0086, 3)
    const card = paceCard(info, cfg.goalSec!)
    expect(card.splits.map((s) => s.km)).toEqual([5, 10, 15, 20, 21.1])
    expect(card.splits[card.splits.length - 1].elapsedSec).toBe(cfg.goalSec)
    expect(card.gels.length).toBeGreaterThanOrEqual(2)
    expect(card.gels.every((g) => g.km <= 21.1 - 2)).toBe(true)
    checkFlex(paceCardFlex(info, card))
  })
})

describe('สัปดาห์แข่ง', () => {
  it('คำแนะนำเปลี่ยนตามจำนวนวัน', () => {
    const info = raceInfo(cfg)!
    expect(raceWeekTip(20, info).title).toContain('ยังไม่ถึง')
    expect(raceWeekTip(6, info).title).toContain('taper')
    expect(raceWeekTip(3, info).title).toContain('คาร์บ')
    expect(raceWeekTip(1, info).tips[0]).toContain('01:30') // ปล่อยตัว 04:00 → ตื่น 01:30
    expect(raceWeekTip(0, info).title).toContain('วันแข่ง')
    checkFlex(raceWeekFlex(info, 3, { tempC: 26, tempEndC: 28, humidity: 85, rainPct: 20 }, paceCard(info, 7140, { tempC: 26, humidity: 85 })))
    checkFlex(raceWeekFlex(info, 30, null))
  })
})

describe('วิเคราะห์หลังแข่ง', () => {
  const makeStreams = (paces: number[]) => {
    const time: number[] = [0]
    const distance: number[] = [0]
    for (const p of paces) {
      for (let k = 1; k <= 10; k++) {
        time.push(time[time.length - 1] + p / 10)
        distance.push(distance[distance.length - 1] + 100)
      }
    }
    return { time, distance }
  }
  it('split รายกิโลจากสตรีม', () => {
    const s = makeStreams([300, 310, 320])
    expect(kmSplitsFromStreams(s.time, s.distance)).toEqual([300, 310, 320])
  })
  it('positive split ถูกจับได้ + flex ถูกต้อง', () => {
    const paces = [...Array(10).fill(320), ...Array(11).fill(360)]
    const s = makeStreams(paces)
    const act: IcuActivity = { id: 'i1', start_date_local: '2027-05-09T04:00:00', type: 'Run', name: 'HATYAi21', distance: 21000, moving_time: 7120 }
    expect(findRaceActivity([act], cfg)?.id).toBe('i1')
    const r = analyzeRace(act, s, cfg, true)
    expect(r.kmSplits.length).toBe(21)
    expect(r.splitPct).toBeGreaterThan(5)
    expect(r.verdict.join(' ')).toContain('ออกตัวเร็วเกินไป')
    checkFlex(reviewFlex(r, true, cfg.goalSec! / cfg.distKm!))
  })
  it('ไม่นับวิ่งสั้นเป็นวันแข่ง', () => {
    const act: IcuActivity = { id: 'i2', start_date_local: '2027-05-09T06:00:00', type: 'Run', distance: 5000, moving_time: 1500 }
    expect(findRaceActivity([act], cfg)).toBeUndefined()
  })
})

describe('รองเท้า', () => {
  const acts: IcuActivity[] = [
    { id: 'a', start_date_local: '2026-11-20T06:00:00', type: 'Run', distance: 10000 },
    { id: 'b', start_date_local: '2026-11-22T06:00:00', type: 'Run', distance: 8000 },
    { id: 'c', start_date_local: '2026-11-24T06:00:00', type: 'Run', distance: 5000 },
    { id: 'd', start_date_local: '2026-11-24T07:00:00', type: 'Ride', distance: 30000 },
  ]
  it('นับเฉพาะวิ่งตั้งแต่เริ่มใส่ และปิดยอดตอนสลับคู่', () => {
    const s = emptyShoes()
    const a = { id: 'A', name: 'Pegasus', km: 100 }
    const b = { id: 'B', name: 'Vaporfly', km: 0 }
    s.shoes.push(a, b)
    switchShoe(s, a, acts, '2026-11-21T00:00:00')
    expect(shoeKm(a, acts)).toBe(113)
    switchShoe(s, b, acts, '2026-11-23T00:00:00')
    expect(a.activeSince).toBeUndefined()
    expect(a.km).toBe(113)
    expect(shoeKm(b, acts)).toBe(5)
    a.km = 650
    expect(shoeWarnings(s, acts)[0]).toContain('ใกล้ครบ')
    checkFlex(shoesFlex(s, acts))
    checkFlex(shoesFlex(emptyShoes(), acts))
  })
})

describe('รายงานสัปดาห์', () => {
  it('รวมแผน/จริงของสัปดาห์ (จันทร์–อาทิตย์)', () => {
    const ev = (date: string, km: number, name = `Easy ${km} กม.`): IcuEvent => ({ id: Number(date.replace(/-/g, '')), category: 'WORKOUT', start_date_local: `${date}T00:00:00`, name, type: 'Run', distance: km * 1000 })
    const events = [ev('2026-11-23', 6), ev('2026-11-25', 8), ev('2026-11-27', 6), ev('2026-11-29', 12, 'Long run 12 กม.'), ev('2026-12-01', 7)]
    const acts: IcuActivity[] = [
      { id: '1', start_date_local: '2026-11-23T06:00:00', type: 'Run', distance: 6200, moving_time: 2300 },
      { id: '2', start_date_local: '2026-11-25T06:00:00', type: 'Run', distance: 8000, moving_time: 2900 },
      { id: '3', start_date_local: '2026-11-29T06:00:00', type: 'Run', distance: 12500, moving_time: 4800 },
    ]
    const w = weeklyData(events, acts, [{ id: '2026-11-29', ctl: 30, atl: 38 }, { id: '2026-11-22', ctl: 28 }], cfg, '2026-11-29')
    expect(w.from).toBe('2026-11-23')
    expect(w.plannedKm).toBe(32)
    expect(w.actualKm).toBeCloseTo(26.7, 1)
    expect(w.done).toBe(3)
    expect(w.sessions).toBe(4)
    expect(w.nextWeekKm).toBe(7)
    expect(w.ctl).toBe(30)
    expect(w.ctlPrev).toBe(28)
    checkFlex(weeklyFlex(w, 7140, ['👟 test']))
  })
})
