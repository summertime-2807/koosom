import { describe, expect, it } from 'vitest'
import { defaultBStore, estRpe, loadStatus, parseLog, planBadminton, sessionsFrom, slotToEvent, tournamentTips } from '../../coach/badminton'
import type { BStore } from '../../coach/badminton'
import { loadFlex } from '../../coach/badmintonBot'
import { decrypt, encrypt, readRegisterToken, registerToken } from '../../coach/users'
import { dowOf } from '../../engine/trainingEngine'
import type { IcuActivity } from '../../coach/types'

const store = (p: Partial<BStore> = {}): BStore => ({ ...defaultBStore(), courtDays: [2, 4, 6], courtMin: 120, extraDays: 2, setupDone: true, ...p })

describe('🏸 ตารางฝึก', () => {
  it('ลงคอร์ดตรงวันที่เลือก · ฝึกเสริมไม่ชนวันคอร์ด · มีวันพัก', () => {
    const slots = planBadminton(store({ level: 'improve' }), '2026-11-30', 1) // จ. 30 พ.ย.
    const court = slots.filter((x) => x.kind === 'court')
    expect(court.map((x) => dowOf(x.date)).sort()).toEqual([2, 4, 6])
    const extra = slots.filter((x) => x.kind !== 'court')
    expect(extra.every((x) => ![2, 4, 6].includes(dowOf(x.date)))).toBe(true)
    expect(extra.map((x) => x.kind).sort()).toEqual(['footwork', 'mobility', 'strength'])
    const usedDays = new Set(slots.map((x) => x.date))
    expect(usedDays.size).toBeLessThan(7)
    // ฟุตเวิร์ก (ขาหนัก) ไม่อยู่วันก่อนลงคอร์ด
    const fw = extra.find((x) => x.kind === 'footwork')!
    expect([2, 4, 6]).not.toContain((dowOf(fw.date) + 1) % 7)
  })
  it('ระดับแข่ง มีอินเทอร์วัล + เวท · ระดับก๊วน เบากว่า', () => {
    const c = planBadminton(store({ level: 'compete', extraDays: 3 }), '2026-11-30', 1).map((x) => x.kind)
    expect(c).toContain('conditioning')
    const casual = planBadminton(store({ level: 'casual', extraDays: 1 }), '2026-11-30', 1).filter((x) => x.kind !== 'court')
    expect(casual.length).toBeLessThanOrEqual(2)
  })
  it('ก่อนแข่ง 7 วัน: ตัดเวท/อินเทอร์วัลช่วง 4 วันสุดท้าย คอร์ดสั้นลง และมีวันแข่ง', () => {
    const s = store({ level: 'compete', extraDays: 3, tournaments: [{ date: '2026-12-06', name: 'ชิงแชมป์' }] })
    const slots = planBadminton(s, '2026-11-30', 1)
    const late = slots.filter((x) => x.date >= '2026-12-02' && x.date < '2026-12-06')
    expect(late.some((x) => x.kind === 'strength' || x.kind === 'conditioning')).toBe(false)
    expect(slots.find((x) => x.date === '2026-12-05' && x.kind === 'court')?.min).toBeLessThanOrEqual(60)
    expect(slots.some((x) => x.date === '2026-12-06' && x.name.includes('แข่ง'))).toBe(true)
  })
  it('แปลงเป็น event ของ Intervals', () => {
    const e = slotToEvent(planBadminton(store(), '2026-11-30', 1)[0])
    expect(e.external_id).toMatch(/^bd-2026-/)
    expect(e.category).toBe('WORKOUT')
    expect(e.description).toContain('•')
  })
})

describe('📈 ภาระ', () => {
  const act = (d: string, min: number, hr?: number, id = d): IcuActivity => ({ id, start_date_local: `${d}T19:00:00`, type: 'Workout', name: 'Badminton', moving_time: min * 60, average_heartrate: hr })
  it('ประมาณ RPE จากหัวใจ และใช้คะแนนที่ให้เองถ้ามี', () => {
    expect(estRpe(undefined, 190)).toBe(5)
    expect(estRpe(160, 190)).toBeGreaterThanOrEqual(7)
    const s = store({ rpeByActivity: { a1: 9 } })
    const ses = sessionsFrom([act('2026-11-25', 90, 140, 'a1')], s, 190)
    expect(ses[0].rpe).toBe(9)
    expect(ses[0].load).toBe(810)
  })
  it('บันทึกเองวันเดียวกัน ความยาวใกล้กัน = คะแนนของกิจกรรมนาฬิกา (ไม่นับซ้ำ)', () => {
    const s = store({ logs: [{ id: 'l1', date: '2026-11-25', minutes: 95, rpe: 6, kind: 'court' }] })
    const ses = sessionsFrom([act('2026-11-25', 90, 150)], s, 190)
    expect(ses).toHaveLength(1)
    expect(ses[0].rpe).toBe(6)
  })
  it('ACWR: เพิ่มเล่นกะทันหัน → เสี่ยง · หนักติดกัน 3 วัน → เตือน', () => {
    const acts: IcuActivity[] = []
    // 3 สัปดาห์ก่อน: สัปดาห์ละ 3 ครั้ง × 90 นาที
    for (const d of ['2026-11-03', '2026-11-05', '2026-11-07', '2026-11-10', '2026-11-12', '2026-11-14', '2026-11-17', '2026-11-19', '2026-11-21']) acts.push(act(d, 90, 140))
    // สัปดาห์นี้: 6 ครั้ง × 150 นาที หนัก
    for (const d of ['2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26']) acts.push(act(d, 150, 170, `h${d}`))
    const ls = loadStatus(sessionsFrom(acts, store(), 190), '2026-11-26')
    expect(ls.zone).toBe('สูงเสี่ยงเจ็บ')
    expect(ls.hardStreak).toBeGreaterThanOrEqual(3)
    expect(ls.warnings.join(' ')).toContain('ติด')
    expect(JSON.stringify(loadFlex(ls)).length).toBeLessThan(30000)
  })
  it('ประวัติไม่ถึง 3 สัปดาห์ → ข้อมูลน้อย', () => {
    const ls = loadStatus(sessionsFrom([act('2026-11-25', 90, 150)], store(), 190), '2026-11-26')
    expect(ls.zone).toBe('ข้อมูลน้อย')
  })
})

describe('บันทึกด้วยข้อความ + เตรียมแข่ง', () => {
  it('parseLog', () => {
    expect(parseLog('แบด 90 นาที เหนื่อย 7', '2026-11-26')).toEqual({ minutes: 90, rpe: 7, date: '2026-11-26', kind: 'court' })
    expect(parseLog('เล่นแบด 2 ชม. 8', '2026-11-26')).toMatchObject({ minutes: 120, rpe: 8 })
    expect(parseLog('แข่ง 1.5 ชม 9 เมื่อวาน', '2026-11-26')).toMatchObject({ minutes: 90, rpe: 9, date: '2026-11-25', kind: 'match' })
    expect(parseLog('แบด 2', '2026-11-26')).toMatchObject({ minutes: 120, rpe: undefined })
    expect(parseLog('แข่ง 20/12 ชิงแชมป์', '2026-11-26')).toBeNull()
    expect(parseLog('แบดตอนไหนดี', '2026-11-26')).toBeNull()
  })
  it('tournamentTips ตามจำนวนวัน', () => {
    expect(tournamentTips(20).title).toContain('ฟอร์ม')
    expect(tournamentTips(5).title).toContain('taper')
    expect(tournamentTips(0).title).toContain('วันแข่ง')
  })
})

describe('👥 ผู้ใช้', () => {
  it('เข้ารหัส/ถอดรหัสคีย์ และ token ลงทะเบียน (ปลอมไม่ได้ หมดอายุได้)', async () => {
    const enc = await encrypt('sec', 'my-api-key')
    expect(enc).not.toContain('my-api-key')
    expect(await decrypt('sec', enc)).toBe('my-api-key')
    await expect(decrypt('other', enc)).rejects.toBeTruthy()
    const env = { LINE_CHANNEL_SECRET: 'sec', INTERVALS_ATHLETE_ID: 'i1', INTERVALS_API_KEY: 'k' }
    const tok = await registerToken(env, 'Uabc', 'ABC234')
    expect(await readRegisterToken(env, tok)).toEqual({ uid: 'Uabc', code: 'ABC234' })
    expect(await readRegisterToken({ ...env, LINE_CHANNEL_SECRET: 'x' }, tok)).toBeNull()
    const [p, sig] = tok.split('.')
    const forged = `${btoa(atob(p).replace('Uabc', 'Uevil'))}.${sig}`
    expect(await readRegisterToken(env, forged)).toBeNull()
  })
})
