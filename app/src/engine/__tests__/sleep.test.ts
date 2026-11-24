import { describe, expect, it } from 'vitest'
import { bedtimeFor, kindFromName, napPlan, sleepAdvice, sleepStats, wakeTimesFrom } from '../../coach/sleepCoach'
import { sleepFlex, weeklyFlex } from '../../coach/flex'
import { applyRules, sleepSummary } from '../../coach/engine'
import type { NightSleep } from '../../coach/googleHealth'
import type { CoachConfig, DayRow } from '../../coach/types'

const bkk = (d: string, hm: string) => Date.parse(`${d}T${hm}:00+07:00`)
const night = (date: string, startDay: string, start: string, end: string, asleep: number, lat = 12): NightSleep => ({
  date, asleepMin: asleep, inBedMin: asleep + 30, start, end, sessions: 1, startMs: bkk(startDay, start), endMs: bkk(date, end), latencyMin: lat,
})

// ข้อมูลจริงแบบคนทำร้าน 24 ชม.: แกว่ง
const swing = [
  night('2026-11-20', '2026-11-20', '07:42', '15:55', 484),
  night('2026-11-21', '2026-11-21', '07:28', '17:37', 562),
  night('2026-11-22', '2026-11-22', '08:33', '15:43', 420),
  night('2026-11-23', '2026-11-23', '09:57', '15:52', 358),
  night('2026-11-24', '2026-11-24', '09:53', '15:40', 265),
]

describe('สถิติการนอน', () => {
  it('หนี้การนอน 7 วัน = ผลรวมที่ขาดจากเป้า (ไม่ติดลบ)', () => {
    const st = sleepStats(swing, '2026-11-24', 450)
    // 450*5 - (484+562+420+358+265) = 2250 - 2089 = 161
    expect(st.debtMin).toBe(161)
    expect(st.last?.date).toBe('2026-11-24')
    expect(st.latencyMin).toBe(12)
    expect(st.midMin).toBeGreaterThan(11 * 60) // กลางการนอน ~ 12:00
    expect(st.midMin).toBeLessThan(13 * 60)
    expect(st.regularity).toBe('ดีมาก') // นอนช่วงเดิม ๆ แม้เป็นกลางวัน
  })
  it('จับเวลานอนแกว่ง (กลางวัน ↔ กลางคืน) ข้ามเที่ยงคืนได้ถูก', () => {
    const mixed = [
      night('2026-11-20', '2026-11-19', '23:00', '06:30', 420),
      night('2026-11-21', '2026-11-21', '09:00', '16:00', 400),
      night('2026-11-22', '2026-11-22', '02:00', '09:00', 400),
      night('2026-11-23', '2026-11-23', '14:00', '20:00', 340),
    ]
    const st = sleepStats(mixed, '2026-11-23', 450)
    expect(st.regularity).toBe('แกว่งมาก')
    expect(Math.abs(st.lastShiftH ?? 0)).toBeGreaterThan(8)
    expect(sleepAdvice(st, 'easy').join(' ')).toContain('แกว่งมาก')
  })
})

describe('คำแนะนำ', () => {
  it('นอนน้อยมาก + วันหนัก → แนะนำงีบและเปลี่ยนเป็นวิ่งง่าย', () => {
    const st = sleepStats(swing, '2026-11-24', 450)
    const a = sleepAdvice(st, 'quality').join(' ')
    expect(a).toContain('งีบ')
    expect(a).toContain('วิ่งง่าย')
  })
  it('นอนพอ → ชม', () => {
    const st = sleepStats([night('2026-11-24', '2026-11-23', '23:00', '07:00', 470)], '2026-11-24', 450)
    expect(sleepAdvice(st, 'long')[0]).toContain('ดี')
  })
})

describe('คำนวณเวลานอน', () => {
  const st = sleepStats(swing, '2026-11-24', 450)
  it('ต้องตื่น 14:00 ตอนนี้ 21:41 · มีหนี้ 2.7 ชม. → แนะนำ 6 รอบ เข้านอน 04:48 (เผื่อ 12 นาที)', () => {
    const p = bedtimeFor('14:00', st, bkk('2026-11-24', '21:41'))
    const rec = p.options.find((o) => o.recommended)!
    expect(rec.cycles).toBe(6)
    expect(rec.bed).toBe('04:48')
    expect(p.options.find((o) => o.cycles === 5)!.bed).toBe('06:18')
    expect(p.caffeineCutoff).toBe('22:48')
  })
  it('ไม่มีหนี้ → แนะนำ 5 รอบ (7.5 ชม.)', () => {
    const fresh = sleepStats([night('2026-11-24', '2026-11-23', '23:00', '07:00', 460)], '2026-11-24', 450)
    expect(bedtimeFor('14:00', fresh, bkk('2026-11-24', '21:41')).options.find((o) => o.recommended)!.cycles).toBe(5)
  })
  it('นอนไม่ทันตัวแนะนำ → เลือกตัวที่ยังทัน', () => {
    const p = bedtimeFor('06:00', st, bkk('2026-11-24', '23:30'))
    const rec = p.options.find((o) => o.recommended)!
    expect(rec.tooLate).toBe(false)
    expect(rec.cycles).toBe(4)
  })
  it('นอนตอนนี้ / งีบ', () => {
    const w = wakeTimesFrom(bkk('2026-11-24', '22:00'), st)
    expect(w.map((x) => x.wake)).toEqual(['04:12', '05:42', '07:12'])
    const n = napPlan(bkk('2026-11-24', '13:00'), st)
    expect(n.power).toBe('13:32')
    expect(n.full).toBe('14:42')
    expect(n.preferFull).toBe(true) // เมื่อคืนนอน 4 ชม. 25 น.
  })
})

describe('ปรับซ้อมตามการนอน', () => {
  const cfg: CoachConfig = { version: 1, planName: 'HM', from: '2026-11-01', to: '2027-05-09', lthr: 171, maxHr: 189, autoAdjust: true }
  const day = (date: string, kind: DayRow['kind'], name: string): DayRow => ({
    date, kind, planned: { id: 7, category: 'WORKOUT', start_date_local: `${date}T00:00:00`, name }, plannedKm: 8, actual: [], actualKm: 0, status: 'planned',
  })
  it('นอน < 5.5 ชม. และวันนี้วันหนัก → ถาม (ใช่ = วิ่งง่าย)', () => {
    const sleep = sleepSummary([{ id: '2026-11-24', sleepSecs: 265 * 60 }], '2026-11-24', 450)
    const r = applyRules({ days: [day('2026-11-24', 'quality', 'Tempo 8 กม.')], today: '2026-11-24', cfg, handled: new Set(), battery: [], injuryDates: [], sleep })
    const q = r.questions.find((x) => x.id === 'q-sleep-2026-11-24')
    expect(q?.text).toContain('4 ชม. 25 น.')
    expect(q?.proposal?.[0].patch?.name).toContain('วิ่งง่าย')
  })
  it('นอนพอและหนี้ต่ำ → ไม่ถาม · วันง่าย → ไม่ถาม', () => {
    const ok = sleepSummary([{ id: '2026-11-24', sleepSecs: 460 * 60 }], '2026-11-24', 450)
    expect(applyRules({ days: [day('2026-11-24', 'quality', 'Tempo')], today: '2026-11-24', cfg, handled: new Set(), battery: [], injuryDates: [], sleep: ok }).questions).toHaveLength(0)
    const bad = sleepSummary([{ id: '2026-11-24', sleepSecs: 200 * 60 }], '2026-11-24', 450)
    expect(applyRules({ days: [day('2026-11-24', 'easy', 'วิ่งง่าย')], today: '2026-11-24', cfg, handled: new Set(), battery: [], injuryDates: [], sleep: bad }).questions).toHaveLength(0)
  })
})

describe('ชนิดซ้อมจากชื่อ + การ์ด', () => {
  it('kindFromName', () => {
    expect(kindFromName('วิ่งยาว 14 กม.')).toBe('long')
    expect(kindFromName('Interval 6x800')).toBe('quality')
    expect(kindFromName('Tempo 8 กม.')).toBe('quality')
    expect(kindFromName('วิ่งง่าย 6 กม.')).toBe('easy')
  })
  it('sleepFlex / weeklyFlex มีส่วนการนอน และโครงถูกต้อง', () => {
    const st = sleepStats(swing, '2026-11-24', 450)
    const json = JSON.stringify(sleepFlex(st, sleepAdvice(st, 'quality')))
    expect(json.length).toBeLessThan(30000)
    expect(json).toContain('หนี้การนอน')
    const w = weeklyFlex({ from: '2026-11-23', to: '2026-11-29', days: [], plannedKm: 0, actualKm: 0, sessions: 0, done: 0, longestKm: 0, nextWeekKm: 0 }, undefined, [], st)
    expect(JSON.stringify(w)).toContain('การนอนสัปดาห์นี้')
  })
})
