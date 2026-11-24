import { describe, expect, it } from 'vitest'
import { busyDates, describeBusy, planBusy, planShort } from '../../coach/busy'
import type { CoachConfig, IcuEvent } from '../../coach/types'

const cfg: CoachConfig = { version: 1, planName: 'HM', from: '2026-11-23', to: '2027-05-09', raceDate: '2027-05-09', goalSec: 7140, distKm: 21.1, lthr: 171, maxHr: 189, autoAdjust: true }
let id = 1
const ev = (date: string, name: string, km: number, category = 'WORKOUT'): IcuEvent => ({ id: id++, category, start_date_local: `${date}T00:00:00`, name, type: 'Run', distance: km * 1000, external_id: `rp-hm-${date}` })

// สัปดาห์ 23–29 พ.ย. (จ.–อา.) + สัปดาห์ถัดไป
const plan = () => {
  id = 1
  return [
    ev('2026-11-23', 'วิ่งง่าย 6 กม.', 6),
    ev('2026-11-24', 'Tempo 8 กม.', 8),
    ev('2026-11-26', 'วิ่งง่าย 6 กม.', 6),
    ev('2026-11-27', 'วิ่งยาว 14 กม.', 14),
    ev('2026-11-30', 'วิ่งง่าย 6 กม.', 6),
    ev('2026-12-01', 'Interval 6x800', 9),
    ev('2026-12-03', 'วิ่งง่าย 7 กม.', 7),
    ev('2026-12-05', 'วิ่งยาว 16 กม.', 16),
    ev('2026-12-07', 'วิ่งง่าย 6 กม.', 6),
    ev('2026-12-08', 'Tempo 9 กม.', 9),
  ]
}

describe('💼 ติดงาน', () => {
  it('2 วัน: ข้ามซ้อม วิ่งยาวย้ายไปวันว่างในสัปดาห์เดียวกัน ไม่ปรับช่วงกลับ', () => {
    const p = planBusy(plan(), '2026-11-26', '2026-11-27', '2026-11-26', cfg)
    const skip = p.changes.filter((c) => c.kind === 'skip')
    const move = p.changes.filter((c) => c.kind === 'move')
    expect(skip.map((c) => (c.kind === 'skip' ? c.date : ''))).toEqual(['2026-11-26'])
    expect(move).toHaveLength(1)
    if (move[0].kind === 'move') expect(['2026-11-28', '2026-11-29']).toContain(move[0].to)
    expect(p.changes.some((c) => c.kind === 'edit')).toBe(false)
    expect(describeBusy(p)).toContain('ไม่เกิน 3 วัน')
  })

  it('ไม่ย้ายวิ่งยาวข้ามสัปดาห์ → ข้ามไป', () => {
    const p = planBusy(plan(), '2026-11-27', '2026-11-29', '2026-11-27', cfg)
    expect(p.changes.find((c) => c.eventId === 4)?.kind).toBe('skip')
  })

  it('5 วัน: 2 ครั้งแรกหลังกลับ ถ้าเป็นวันหนักเปลี่ยนเป็นวิ่งง่าย', () => {
    const p = planBusy(plan(), '2026-11-24', '2026-11-28', '2026-11-24', cfg)
    const edits = p.changes.filter((c) => c.kind === 'edit')
    // หลัง 28/11: 30/11 ง่าย (ไม่ต้องแก้), 1/12 interval → วิ่งง่าย
    expect(edits.map((c) => (c.kind === 'edit' ? c.date : ''))).toEqual(['2026-12-01'])
    if (edits[0].kind === 'edit') expect(edits[0].after.name).toContain('วิ่งง่าย')
  })

  it('10 วัน: 2 ครั้งแรกวันหนัก/ยาวเป็นวิ่งง่าย ที่เหลือใน 7 วันลด 30%', () => {
    const p = planBusy(plan(), '2026-11-23', '2026-12-02', '2026-11-23', cfg)
    const edits = p.changes.filter((c) => c.kind === 'edit')
    const at = (d: string) => edits.find((c) => c.kind === 'edit' && c.date === d)
    const easy = at('2026-12-03') // ครั้งที่ 1 วิ่งง่าย 7 → ลด 30% เหลือ 5
    const long = at('2026-12-05') // ครั้งที่ 2 วิ่งยาว → วิ่งง่าย 6 กม.
    const tempo = at('2026-12-08') // ครั้งที่ 4 → ลด 30%
    expect(easy && easy.kind === 'edit' ? easy.after.distance : 0).toBe(5000)
    expect(long && long.kind === 'edit' ? long.after.distance : 0).toBe(6000)
    expect(tempo && tempo.kind === 'edit' ? tempo.after.distance : 0).toBe(Math.round(9 * 0.7) * 1000)
    expect(edits.every((c) => c.kind === 'edit' && c.date <= '2026-12-09')).toBe(true)
  })

  it('ไม่แตะวันที่ผ่านมาแล้ว และไม่แตะวันแข่ง', () => {
    const events = [...plan(), ev('2026-11-25', 'HM race', 21.1, 'RACE_A')]
    const p = planBusy(events, '2026-11-23', '2026-11-25', '2026-11-24', cfg)
    expect(p.changes.some((c) => c.kind === 'skip' && c.date === '2026-11-23')).toBe(false)
    expect(p.changes.some((c) => c.kind === 'skip' && c.snap.category === 'RACE_A')).toBe(false)
  })

  it('busyDates อ่านช่วงจาก NOTE', () => {
    const p = planBusy(plan(), '2026-11-26', '2026-11-28', '2026-11-26', cfg)
    const note: IcuEvent = { id: 99, category: 'NOTE', start_date_local: '2026-11-26T00:00:00', name: '💼', external_id: 'rp-busy-off-2026-11-26', description: `x\n\`\`\`json\n${JSON.stringify(p)}\n\`\`\`` }
    expect(busyDates([note])).toEqual(['2026-11-26', '2026-11-27', '2026-11-28'])
  })
})

describe('⏱ วิ่งสั้น', () => {
  it('เปลี่ยนซ้อมของวันนั้นเป็นวิ่งเบา 25 นาที และเก็บค่าเดิมไว้คืน', () => {
    const p = planShort(plan(), '2026-11-24', cfg)
    expect(p.changes).toHaveLength(1)
    const c = p.changes[0]
    if (c.kind !== 'edit') throw new Error('kind')
    expect(c.after.name).toContain('25 นาที')
    expect(c.after.description).toContain('25m')
    expect(c.before.name).toBe('Tempo 8 กม.')
    expect(planShort(plan(), '2026-11-25', cfg).changes).toHaveLength(0)
  })
})
