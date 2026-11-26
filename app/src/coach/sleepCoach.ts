// ─────────────────────────────────────────────────────────────
// 😴 โค้ชการนอน — ออกแบบสำหรับเวลานอนไม่ตายตัว (ร้านเปิด 24 ชม.)
//  • หนี้การนอน 7 วัน เทียบเป้า (ค่าเริ่มต้น 7.5 ชม.)
//  • ความสม่ำเสมอ = การแกว่งของ "จุดกึ่งกลางการนอน" (circular SD) ไม่ได้บังคับให้นอนกลางคืน
//  • คำแนะนำตามการนอน + ซ้อมวันนี้ · คำนวณเวลาเข้านอนตามรอบ 90 นาที · งีบ 20/90 นาที
// ─────────────────────────────────────────────────────────────
import type { NightSleep } from './googleHealth'
import { addDays } from '../engine/trainingEngine'

export const DEFAULT_TARGET_MIN = 450
const TZ_MS = 7 * 3600e3 // เวลาไทย
const CYCLE = 90

export interface SleepStats {
  targetMin: number
  last?: NightSleep
  nights7: NightSleep[]
  avgMin?: number
  debtMin: number
  effPct?: number
  latencyMin: number
  /** จุดกึ่งกลางการนอนเฉลี่ย (นาทีนับจากเที่ยงคืน เวลาไทย) */
  midMin?: number
  /** ส่วนเบี่ยงเบนของจุดกึ่งกลาง (นาที) */
  midSdMin?: number
  regularity?: 'ดีมาก' | 'ดี' | 'แกว่ง' | 'แกว่งมาก'
  /** จุดกึ่งกลางเปลี่ยนจากคืนก่อนกี่ชม. (บวก = นอนช้าลง) */
  lastShiftH?: number
}

export const hm = (min: number) => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
export const dur = (min: number) => {
  const m = Math.max(0, Math.round(min))
  return `${Math.floor(m / 60)} ชม.${m % 60 ? ` ${m % 60} น.` : ''}`
}
const localMin = (ms: number) => Math.floor(((ms + TZ_MS) % 86400e3) / 60000)

/** ค่าเฉลี่ย/SD แบบวงกลม (เวลาในรอบ 24 ชม.) */
function circular(mins: number[]): { mean: number; sd: number } | undefined {
  if (!mins.length) return undefined
  const a = mins.map((m) => (m / 1440) * 2 * Math.PI)
  const s = a.reduce((x, t) => x + Math.sin(t), 0) / a.length
  const c = a.reduce((x, t) => x + Math.cos(t), 0) / a.length
  const R = Math.min(1, Math.sqrt(s * s + c * c))
  const mean = ((Math.atan2(s, c) / (2 * Math.PI)) * 1440 + 1440) % 1440
  const sd = R > 0 ? (Math.sqrt(-2 * Math.log(R)) / (2 * Math.PI)) * 1440 : 720
  return { mean, sd }
}

const midOf = (n: NightSleep) => (n.startMs && n.endMs ? localMin((n.startMs + n.endMs) / 2) : undefined)

export function sleepStats(nights: NightSleep[], today: string, targetMin = DEFAULT_TARGET_MIN): SleepStats {
  const from = addDays(today, -6)
  const nights7 = nights.filter((n) => n.date >= from && n.date <= today).sort((a, b) => a.date.localeCompare(b.date))
  const last = [...nights].sort((a, b) => a.date.localeCompare(b.date)).filter((n) => n.date <= today).at(-1)
  const avgMin = nights7.length ? nights7.reduce((s, n) => s + n.asleepMin, 0) / nights7.length : undefined
  const debtMin = Math.max(0, nights7.reduce((s, n) => s + (targetMin - n.asleepMin), 0))
  const effs = nights7.filter((n) => n.inBedMin > 0).map((n) => n.asleepMin / n.inBedMin)
  const lats = nights7.map((n) => n.latencyMin).filter((x): x is number => x != null && x >= 0)
  const mids = nights7.map(midOf).filter((x): x is number => x != null)
  const circ = circular(mids)
  let lastShiftH: number | undefined
  if (nights7.length >= 2) {
    const a = midOf(nights7[nights7.length - 2])
    const b = midOf(nights7[nights7.length - 1])
    if (a != null && b != null) {
      let d = b - a
      if (d > 720) d -= 1440
      if (d < -720) d += 1440
      lastShiftH = Math.round((d / 60) * 10) / 10
    }
  }
  const sd = circ?.sd
  return {
    targetMin,
    last,
    nights7,
    avgMin,
    debtMin,
    effPct: effs.length ? Math.round((effs.reduce((s, x) => s + x, 0) / effs.length) * 100) : undefined,
    latencyMin: lats.length ? Math.round(lats.reduce((s, x) => s + x, 0) / lats.length) : 15,
    midMin: circ?.mean,
    midSdMin: sd != null ? Math.round(sd) : undefined,
    regularity: sd == null || mids.length < 3 ? undefined : sd <= 45 ? 'ดีมาก' : sd <= 90 ? 'ดี' : sd <= 150 ? 'แกว่ง' : 'แกว่งมาก',
    lastShiftH,
  }
}

export type TrainKind = 'long' | 'quality' | 'easy' | 'race' | 'rest'

/** คำแนะนำวันนี้ (สั้น อ่านจบในมือถือ) */
export function sleepAdvice(st: SleepStats, todayKind: TrainKind = 'rest'): string[] {
  const out: string[] = []
  const last = st.last?.asleepMin ?? st.targetMin
  const debtH = st.debtMin / 60
  const hard = todayKind === 'long' || todayKind === 'quality'
  if (last < 300) {
    out.push(`นอนน้อยมาก (${dur(last)}) — ถ้ามีช่วงว่าง งีบ 20 นาที หรือ 90 นาที (ครบ 1 รอบ) ก่อนเริ่มงาน`)
    if (hard) out.push('วันนี้เป็นวันหนัก แนะนำเปลี่ยนเป็นวิ่งง่าย หรือเลื่อนไปหลังได้งีบ — การนอนน้อยทำให้หัวใจสูง เจ็บง่าย')
    else if (todayKind === 'easy') out.push('วิ่งง่ายได้ แต่คุมหัวใจให้อยู่โซน easy และสั้นลงได้')
  } else if (last < st.targetMin - 60) {
    out.push(`นอน ${dur(last)} ต่ำกว่าเป้า — การนอนรอบถัดไปพยายามให้ได้ ≥ ${dur(st.targetMin)}`)
    if (hard && debtH >= 6) out.push('หนี้การนอนสะสมสูง วันหนักวันนี้ลดความเร็วลง หรือเปลี่ยนเป็นวิ่งง่าย')
  } else out.push(`นอนได้ ${dur(last)} ดีครับ 👍`)
  if (debtH >= 6) out.push(`หนี้การนอน 7 วัน ${dur(st.debtMin)} — 2–3 วันนี้นอนเพิ่มรอบละ 60–90 นาที (อย่าชดเชยรวดเดียว)`)
  else if (debtH >= 3) out.push(`หนี้การนอน ${dur(st.debtMin)} — นอนเพิ่ม 30–60 นาทีในรอบถัดไป`)
  if (st.regularity === 'แกว่งมาก') out.push('เวลานอนแกว่งมาก — ถ้าทำได้ ให้มี "เวลาหลักนอน" อย่างน้อย 4 ชม. ที่ตรงกันทุกวัน แล้วค่อยเสริมด้วยงีบ')
  else if (st.lastShiftH != null && Math.abs(st.lastShiftH) >= 4) out.push(`รอบนี้เวลานอนเลื่อนไป ${Math.abs(st.lastShiftH)} ชม. เหมือนเจ็ตแล็ก — โดนแดดทันทีหลังตื่น และงดคาเฟอีน 6 ชม. ก่อนนอน`)
  if (st.effPct != null && st.effPct < 85) out.push(`หลับจริงเฉลี่ย ${st.effPct}% — ห้องมืด เย็น (~25°C) ใช้ผ้าปิดตา/ที่อุดหู ช่วยได้มากตอนนอนกลางวัน`)
  return out
}

// ── คำนวณเวลาเข้านอน / ตื่น / งีบ ──
export interface BedPlan {
  wake: string
  options: { cycles: number; bed: string; sleepMin: number; recommended: boolean; tooLate: boolean }[]
  caffeineCutoff: string
  latencyMin: number
}

/** ต้องตื่น HH:MM → ควรเข้านอนกี่โมง (นับ latency) */
export function bedtimeFor(wakeHHMM: string, st: SleepStats, nowMs: number): BedPlan {
  const [h, m] = wakeHHMM.split(':').map(Number)
  const nowMin = localMin(nowMs)
  let wakeMin = h * 60 + m
  // เวลาตื่นที่ผ่านไปแล้ววันนี้ = พรุ่งนี้
  const wakeAbs = wakeMin <= nowMin ? wakeMin + 1440 : wakeMin
  const want = st.targetMin + Math.min(90, st.debtMin / 3)
  const cycles = [6, 5, 4]
  const rec = cycles.reduce((best, c) => (Math.abs(c * CYCLE - want) < Math.abs(best * CYCLE - want) ? c : best), 5)
  const options = cycles.map((c) => {
    const bedAbs = wakeAbs - c * CYCLE - st.latencyMin
    return { cycles: c, bed: hm(bedAbs), sleepMin: c * CYCLE, recommended: c === rec, tooLate: bedAbs < nowMin }
  })
  // ถ้าตัวแนะนำนอนไม่ทันแล้ว แนะนำตัวที่ยังทัน
  if (options.find((o) => o.recommended)?.tooLate) {
    options.forEach((o) => (o.recommended = false))
    const ok = options.find((o) => !o.tooLate)
    if (ok) ok.recommended = true
  }
  wakeMin = wakeAbs
  const recBed = options.find((o) => o.recommended) ?? options[options.length - 1]
  const recBedMin = wakeMin - recBed.cycles * CYCLE - st.latencyMin
  return { wake: wakeHHMM, options, caffeineCutoff: hm(recBedMin - 360), latencyMin: st.latencyMin }
}

/** จะนอนตอนนี้ → ตื่นกี่โมงดี */
export function wakeTimesFrom(nowMs: number, st: SleepStats): { cycles: number; wake: string; sleepMin: number }[] {
  const now = localMin(nowMs)
  return [4, 5, 6].map((c) => ({ cycles: c, wake: hm(now + st.latencyMin + c * CYCLE), sleepMin: c * CYCLE }))
}

/** งีบ: 20 นาที (ไม่งัวเงีย) หรือ 90 นาที (ครบรอบ) */
export function napPlan(nowMs: number, st: SleepStats): { power: string; full: string; preferFull: boolean } {
  const now = localMin(nowMs)
  const lat = Math.min(st.latencyMin, 15)
  return { power: hm(now + lat + 20), full: hm(now + lat + CYCLE), preferFull: st.debtMin >= 240 || (st.last?.asleepMin ?? 999) < 300 }
}

/** เดาชนิดซ้อมจากชื่อ workout */
export function kindFromName(name: string): TrainKind {
  if (/แข่ง|race/i.test(name)) return 'race'
  if (/ยาว|long/i.test(name)) return 'long'
  if (/tempo|interval|threshold|เทมโป|อินเทอร์วัล|เพซแข่ง|race pace|fartlek|hill|x\s*\d+|\d+\s*x/i.test(name)) return 'quality'
  return 'easy'
}

/** การนอนจาก wellness ของ Intervals (Apple Watch/Garmin) — มีแค่ระยะเวลา ไม่มีเวลาเข้านอน/ตื่น */
export function nightsFromWellness(w: { id: string; sleepSecs?: number | null }[]): NightSleep[] {
  return w
    .filter((x) => (x.sleepSecs ?? 0) >= 3600)
    .map((x) => ({ date: x.id, asleepMin: Math.round((x.sleepSecs ?? 0) / 60), inBedMin: 0, start: '', end: '', sessions: 1 }))
    .sort((a, b) => a.date.localeCompare(b.date))
}
