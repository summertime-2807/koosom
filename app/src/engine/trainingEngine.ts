// ─────────────────────────────────────────────────────────────
// Training engine — ตารางซ้อมแบบแบ่งช่วง (base → build → peak → taper → race)
// ปรับตามลักษณะสนาม: ความชัน/สะพาน, อากาศร้อน/เย็น, เวลาปล่อยตัว (ตี 2 / กลางคืน)
// pure TS ไม่มี side effect → ทดสอบได้
// ─────────────────────────────────────────────────────────────
import type {
  Feasibility,
  Phase,
  RaceProfile,
  TrainingInput,
  TrainingPaces,
  TrainingPlan,
  TrainingWeek,
  Workout,
  WorkoutType,
} from '../types/race'
import { fmtHMS, fmtPace, parseHM } from '../lib/time'

// ── วันที่ (ทำงานกับ YYYY-MM-DD แบบ UTC เพื่อไม่ให้เพี้ยนตาม timezone) ──
const DAY = 864e5
export const toUTC = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
export const fromUTC = (t: number) => new Date(t).toISOString().slice(0, 10)
export const addDays = (iso: string, n: number) => fromUTC(toUTC(iso) + n * DAY)
export const dowOf = (iso: string) => new Date(toUTC(iso)).getUTCDay()
export const daysBetween = (a: string, b: string) => Math.round((toUTC(b) - toUTC(a)) / DAY)
/** วันจันทร์ของสัปดาห์ */
export const mondayOf = (iso: string) => addDays(iso, -((dowOf(iso) + 6) % 7))

/** Riegel: เวลาเทียบเท่าที่ระยะอื่น */
export const riegel = (timeSec: number, fromKm: number, toKm: number) => timeSec * (toKm / fromKm) ** 1.06

export function computePaces(goalSec: number, distKm: number): TrainingPaces {
  const at = (km: number) => riegel(goalSec, distKm, km) / km
  const mp = at(42.195)
  const hmp = at(21.0975)
  const tenK = at(10)
  const fiveK = at(5)
  return {
    goal: goalSec / distKm,
    easy: [mp * 1.12, mp * 1.25],
    long: [mp * 1.06, mp * 1.16],
    marathon: mp,
    threshold: (hmp + tenK) / 2,
    interval: fiveK,
  }
}

export function assessGoal(input: TrainingInput, goalSec: number, distKm: number, weeks: number): Feasibility {
  const messages: string[] = []
  let level: Feasibility['level'] = 'unknown'
  let predictedSec: number | undefined
  let gapPct: number | undefined
  if (input.recentRaceKm && input.recentRaceSec && input.recentRaceKm > 0 && input.recentRaceSec > 0) {
    predictedSec = riegel(input.recentRaceSec, input.recentRaceKm, distKm)
    // ระยะไกลกว่าที่เคยวิ่งมาก (เช่น 10K → 42K) Riegel มักมองโลกในแง่ดี → บวกเผื่อ
    if (distKm > 30 && input.recentRaceKm < 21) predictedSec *= 1.04
    gapPct = ((predictedSec - goalSec) / goalSec) * 100
    // ซ้อมได้ดีขึ้นราว 0.4%/สัปดาห์ (สูงสุด ~5%)
    const trainable = Math.min(5, Math.max(0, weeks - 1) * 0.4)
    if (gapPct <= trainable * 0.5) level = 'ok'
    else if (gapPct <= trainable + 2) level = 'stretch'
    else level = 'risky'
    messages.push(
      `จากผล ${input.recentRaceKm} กม. ใน ${fmtHMS(input.recentRaceSec)} คาดว่าทำได้ราว ${fmtHMS(predictedSec)} ` +
        (gapPct > 0 ? `(ช้ากว่าเป้า ${gapPct.toFixed(1)}%)` : `(เร็วกว่าเป้า ${Math.abs(gapPct).toFixed(1)}%)`),
    )
  } else {
    messages.push('ใส่ผลแข่ง/ไทม์ทดสอบล่าสุด เพื่อให้ประเมินว่าเป้าหมายสมจริงไหม')
  }
  if (distKm > 30) {
    if (input.weeklyKm < 25) messages.push('ระยะซ้อมต่อสัปดาห์ยังน้อยสำหรับมาราธอน — ค่อย ๆ เพิ่ม และเผื่อเป้าเวลาไว้')
    if (input.longestRunKm < 16 && weeks < 10) messages.push('วิ่งยาวยังไม่ถึง 16 กม. และเวลาเหลือน้อย — เน้นจบอย่างปลอดภัยก่อนทำเวลา')
  } else if (distKm > 15) {
    if (input.longestRunKm < 10 && weeks < 6) messages.push('วิ่งยาวยังไม่ถึง 10 กม. — เป้าแรกคือจบฮาล์ฟอย่างแข็งแรง')
  }
  if (weeks <= 2) messages.push('เหลือเวลาไม่ถึง 2 สัปดาห์ — ช่วงนี้สร้างความฟิตเพิ่มไม่ได้แล้ว เน้นพักให้สดและทำตามแผนวันแข่ง')
  if (level === 'risky') messages.push('เป้านี้เสี่ยงต่อการหมดแรงช่วงท้าย ลองตั้งเป้าตามเวลาที่คาดการณ์ แล้วค่อยเร่งใน 3–5 กม. สุดท้าย')
  return { level, predictedSec, gapPct, messages }
}

interface Traits {
  hills: boolean
  hot: boolean
  cool: boolean
  earlyStart: boolean
  night: boolean
  startTime: string
}

export function raceTraits(profile: RaceProfile, startTime: string, gainPerKm: number): Traits {
  const s = parseHM(startTime)
  return {
    hills: profile.course !== 'flat' || gainPerKm >= 4,
    hot: profile.climate.tempC >= 25,
    cool: profile.climate.tempC <= 20,
    earlyStart: Number.isFinite(s) && s < 4 * 3600,
    night: Number.isFinite(s) && s >= 16 * 3600,
    startTime,
  }
}

/** ค่าวิ่งยาวสูงสุดและระยะ/สัปดาห์ช่วงพีค ตามระยะแข่งและประสบการณ์ */
function targets(distKm: number, exp: TrainingInput['experience']) {
  const e = exp === 'new' ? 0 : exp === 'regular' ? 1 : 2
  if (distKm > 30) return { longPeak: [28, 30, 32][e], weeklyPeak: [45, 60, 75][e], taper: 3 }
  if (distKm > 15) return { longPeak: [16, 18, 20][e], weeklyPeak: [30, 40, 55][e], taper: 2 }
  if (distKm > 7) return { longPeak: [10, 12, 15][e], weeklyPeak: [20, 30, 40][e], taper: 1 }
  return { longPeak: [7, 8, 10][e], weeklyPeak: [15, 20, 30][e], taper: 1 }
}

/** วันวิ่งในสัปดาห์ (offset จากวันวิ่งยาว; 0 = วันวิ่งยาว) */
const TEMPLATES: Record<number, { off: number; role: 'long' | 'q1' | 'q2' | 'easy' }[]> = {
  3: [
    { off: -5, role: 'q1' },
    { off: -3, role: 'easy' },
    { off: 0, role: 'long' },
  ],
  4: [
    { off: -5, role: 'q1' },
    { off: -3, role: 'q2' },
    { off: -1, role: 'easy' },
    { off: 0, role: 'long' },
  ],
  5: [
    { off: -5, role: 'q1' },
    { off: -4, role: 'easy' },
    { off: -3, role: 'q2' },
    { off: -1, role: 'easy' },
    { off: 0, role: 'long' },
  ],
  6: [
    { off: -6, role: 'easy' },
    { off: -5, role: 'q1' },
    { off: -4, role: 'easy' },
    { off: -3, role: 'q2' },
    { off: -1, role: 'easy' },
    { off: 0, role: 'long' },
  ],
}

const r1 = (n: number) => Math.round(n * 2) / 2 // ปัดทีละ 0.5 กม.
const paceRange = ([a, b]: [number, number]) => `${fmtPace(a)}–${fmtPace(b)}`

interface Ctx {
  paces: TrainingPaces
  traits: Traits
  distKm: number
  weeksToRace: number
}

function quality(role: 'q1' | 'q2', phase: Phase, wIdx: number, ctx: Ctx): Omit<Workout, 'date' | 'dow'> {
  const { paces, traits, distKm } = ctx
  const fm = distKm > 30
  const wu = 2 // วอร์มอัพ/คูลดาวน์ รวม ~4 กม.
  if (phase === 'base') {
    if (role === 'q1' && traits.hills)
      return { type: 'hill', title: 'ขึ้นเนิน/สะพาน', detail: `วอร์ม ${wu} กม. → ขึ้นเนินหรือสะพาน 6–8 × 60 วิ (แรงแต่คุมฟอร์ม) เดินลงพัก → คูลดาวน์ ${wu} กม.`, km: 7, tags: ['สนามมีสะพาน/เนิน'] }
    return { type: 'easy', title: 'วิ่งง่าย + สไตรด์', detail: `วิ่งสบาย ๆ แล้วปิดท้ายด้วยสไตรด์ 6 × 20 วิ`, km: 6, pace: paceRange(paces.easy) }
  }
  if (phase === 'taper' || phase === 'race') {
    return {
      type: 'race-pace',
      title: 'เร่งเพซแข่งสั้น ๆ',
      detail: `วอร์ม ${wu} กม. → ${fm ? '3 × 1.6 กม.' : '3 × 1 กม.'} ที่เพซแข่ง พัก 2 นาที → คูลดาวน์`,
      km: fm ? 9 : 7,
      pace: fmtPace(paces.goal),
    }
  }
  // build / peak
  if (role === 'q1') {
    if (traits.hills && wIdx % 3 === 0)
      return { type: 'hill', title: 'วิ่งซ้ำบนสะพาน', detail: `วอร์ม ${wu} กม. → ขึ้นสะพาน/เนิน 8–10 × 90 วิ ที่แรงระดับเทมโป วิ่งเบาลง → คูลดาวน์`, km: 9, tags: ['จำลองสะพานในสนาม'] }
    const reps = phase === 'peak' ? 6 : 5
    return {
      type: 'interval',
      title: 'อินเทอร์วัล',
      detail: `วอร์ม ${wu} กม. → ${reps} × 1 กม. พักจ๊อก 2–3 นาที → คูลดาวน์ ${wu} กม.`,
      km: wu * 2 + reps + reps * 0.4,
      pace: fmtPace(paces.interval),
    }
  }
  // q2
  if (phase === 'peak' || (fm && phase === 'build' && wIdx % 2 === 1)) {
    const block = fm ? (phase === 'peak' ? 10 : 8) : distKm > 15 ? 2 * 4 : 4
    return {
      type: 'race-pace',
      title: 'ซ้อมเพซแข่ง',
      detail: fm ? `วอร์ม ${wu} กม. → ${block} กม. ที่เพซมาราธอน → คูลดาวน์` : `วอร์ม ${wu} กม. → ${distKm > 15 ? '2 × 4 กม.' : '4 × 1 กม.'} ที่เพซแข่ง พัก 2 นาที → คูลดาวน์`,
      km: wu * 2 + block,
      pace: fmtPace(fm ? paces.marathon : paces.goal),
    }
  }
  const mins = phase === 'build' ? 20 : 25
  return { type: 'tempo', title: 'เทมโป', detail: `วอร์ม ${wu} กม. → ${mins} นาทีต่อเนื่องที่เพซเทมโป (เหนื่อยแต่คุมได้) → คูลดาวน์`, km: wu * 2 + mins / (paces.threshold / 60), pace: fmtPace(paces.threshold) }
}

export interface TrainingTarget {
  distKm: number
  goalSec: number
  raceDate: string
  startTime: string
  gainPerKm: number
  /** ช่วงห่างกินเจล (นาที) ใช้ซ้อมกินเจลในวิ่งยาว */
  gelEveryMin?: number
}

export function computeTrainingPlan(input: TrainingInput, target: TrainingTarget, profile: RaceProfile, today: string): TrainingPlan {
  const distKm = target.distKm
  const paces = computePaces(target.goalSec, distKm)
  const traits = raceTraits(profile, target.startTime, target.gainPerKm)
  const daysToRace = daysBetween(today, target.raceDate)
  const raceDow = dowOf(target.raceDate)
  const firstMon = mondayOf(today)
  const raceMon = mondayOf(target.raceDate)
  const nWeeks = daysToRace < 0 ? 0 : daysBetween(firstMon, raceMon) / 7 + 1
  const feasibility = assessGoal(input, target.goalSec, distKm, nWeeks)
  const t = targets(distKm, input.experience)
  const runs = Math.max(3, Math.min(6, Math.round(input.runsPerWeek)))

  const raceSpecific: string[] = []
  if (traits.hills) raceSpecific.push('สนามมีสะพาน/เนิน → มีวิ่งขึ้นเนินหรือสะพานสลับในวันคุณภาพ และให้วิ่งยาวผ่านสะพานหรือทางลาด')
  if (traits.hot) raceSpecific.push(`อากาศวันแข่งราว ${profile.climate.tempC}°C ชื้น ${profile.climate.humidity}% → 3–4 สัปดาห์สุดท้าย วิ่งง่ายตอนอากาศอุ่นบ้าง ฝึกดื่มน้ำทุกจุด ซ้อมโดยยึดความเหนื่อยแทนเพซ`)
  if (traits.cool) raceSpecific.push(`วันแข่งน่าจะเย็นกว่าที่ซ้อม (~${profile.climate.tempC}°C) → อย่าออกตัวเร็วเกินแผนเพราะรู้สึกดี เตรียมเสื้อกันหนาวทิ้งได้ไว้ที่จุดปล่อยตัว`)
  if (traits.earlyStart) raceSpecific.push(`ปล่อยตัว ${traits.startTime} → 4 สัปดาห์สุดท้าย ให้วิ่งยาว 2 ครั้งเริ่มเวลาเดียวกับวันแข่ง ซ้อมมื้อเช้าและการกินเจลตอนตี 1–2 และขยับเวลานอนในสัปดาห์แข่ง`)
  if (traits.night) raceSpecific.push(`วิ่งกลางคืน (${traits.startTime}) → ซ้อมวิ่งช่วงเย็น/ค่ำ และลองมื้อกลางวัน + ของว่างก่อนวิ่งให้เหมือนวันจริง`)
  if (profile.course === 'trail') raceSpecific.push('สนามเทรล → เพิ่มวิ่งขึ้นลงเขา/บันได และฝึกขาลง')
  if (distKm > 15 && target.gelEveryMin) raceSpecific.push(`วิ่งยาวที่เกิน 75 นาที ให้ซ้อมกินเจลทุก ${target.gelEveryMin} นาที ตามแผนเจลวันแข่ง`)
  if (distKm > 42.3) raceSpecific.push('ระยะเกินมาราธอน: ตารางนี้ใช้โครงมาราธอนเป็นฐาน ควรเพิ่มวิ่งยาวต่อเนื่อง 2 วันในช่วงพีค')

  // ── จัดช่วง ──
  const taperW = Math.min(t.taper, Math.max(1, nWeeks)) // รวมสัปดาห์แข่ง
  const buildW = Math.max(0, nWeeks - taperW)
  const phases: Phase[] = []
  for (let i = 0; i < nWeeks; i++) {
    if (i === nWeeks - 1) phases.push('race')
    else if (i >= buildW) phases.push('taper')
    else if (buildW >= 6 && i < Math.ceil(buildW / 3)) phases.push('base')
    else if (i >= buildW - 2 && buildW >= 4) phases.push('peak')
    else phases.push('build')
  }

  // ── ระยะ/สัปดาห์ ──
  const startKm = Math.max(input.weeklyKm, runs * 4)
  const peakKm = Math.max(startKm, Math.min(t.weeklyPeak, startKm * 1.1 ** Math.max(0, buildW - 1)))
  const startLong = Math.max(input.longestRunKm, distKm > 15 ? 8 : 5)
  const longPeak = Math.max(startLong, Math.min(t.longPeak, startLong + (buildW - 1) * (distKm > 30 ? 2 : 1.5)))
  const taperFactors = distKm > 30 ? [0.8, 0.6, 0.4] : distKm > 15 ? [0.7, 0.45] : [0.5]

  const weeks: TrainingWeek[] = []
  let prevKm = input.weeklyKm
  let prevLong = input.longestRunKm
  const tmpl = TEMPLATES[runs]
  const ctx: Ctx = { paces, traits, distKm, weeksToRace: nWeeks }

  for (let i = 0; i < nWeeks; i++) {
    const phase = phases[i]
    const weekStart = addDays(firstMon, i * 7)
    const cutback = phase !== 'taper' && phase !== 'race' && buildW >= 5 && (i + 1) % 4 === 0 && i < buildW - 1
    let km: number
    let longKm: number
    if (phase === 'taper' || phase === 'race') {
      const ti = i - buildW
      const f = taperFactors[Math.max(0, Math.min(taperFactors.length - 1, taperFactors.length - taperW + ti))] ?? 0.5
      km = peakKm * f
      longKm = phase === 'race' ? 0 : Math.min(longPeak * (f + 0.05), distKm > 30 ? 22 : distKm * 0.7)
    } else {
      const frac = buildW <= 1 ? 1 : i / (buildW - 1)
      km = Math.min(startKm + (peakKm - startKm) * frac, prevKm * 1.1 + 2)
      longKm = Math.min(startLong + (longPeak - startLong) * frac, prevLong + (distKm > 30 ? 3 : 2))
      if (cutback) {
        km *= 0.8
        longKm *= 0.75
      }
      longKm = Math.min(longKm, km * (runs <= 3 ? 0.45 : 0.4) + 3)
    }
    if (!cutback) {
      prevKm = km
      prevLong = longKm || prevLong
    }

    // ── วันในสัปดาห์ ──
    const workouts: Workout[] = []
    const longDow = raceDow
    const dayFor = (off: number) => {
      const dow = (longDow + off + 7) % 7
      const date = addDays(weekStart, (dow + 6) % 7)
      return { dow, date }
    }
    if (phase === 'race') {
      const raceDate = target.raceDate
      const pre = [
        { off: -5, w: quality('q1', 'race', i, ctx) },
        { off: -3, w: { type: 'easy' as WorkoutType, title: 'วิ่งง่าย + สไตรด์', detail: 'วิ่งสบาย ๆ + สไตรด์ 4 × 20 วิ', km: distKm > 15 ? 6 : 5, pace: paceRange(paces.easy) } },
        { off: -1, w: { type: 'shakeout' as WorkoutType, title: 'เขย่าขา', detail: 'จ๊อกเบา ๆ 15–20 นาที เตรียมของ ติดเบอร์ เช็กแผนเจล นอนเร็ว', km: 3, pace: paceRange(paces.easy) } },
      ]
      for (const p of pre) {
        const date = addDays(raceDate, p.off)
        if (daysBetween(today, date) < 0 || daysBetween(weekStart, date) < 0) continue
        workouts.push({ date, dow: dowOf(date), ...p.w, km: r1(p.w.km) })
      }
      workouts.push({
        date: raceDate,
        dow: raceDow,
        type: 'race',
        title: 'วันแข่ง 🏁',
        detail: `ปล่อยตัว ${target.startTime} · เป้า ${fmtHMS(target.goalSec)} (${fmtPace(paces.goal)}/กม.) · ทำตามแผนเพซและเจลในแท็บวางแผน`,
        km: Math.round(distKm * 10) / 10,
        pace: fmtPace(paces.goal),
      })
    } else {
      const roles = tmpl
      const longW: Omit<Workout, 'date' | 'dow'> = {
        type: 'long',
        title: phase === 'peak' && distKm > 15 ? 'วิ่งยาว + ช่วงท้ายเพซแข่ง' : 'วิ่งยาว',
        detail:
          phase === 'peak' && distKm > 15
            ? `วิ่งสบาย แล้ว ${distKm > 30 ? '8–10' : '3–5'} กม. สุดท้ายที่เพซแข่ง`
            : 'วิ่งสบาย คุยได้ ไม่ต้องรีบ',
        km: longKm,
        pace: paceRange(paces.long),
        tags: [],
      }
      if (traits.earlyStart && i >= nWeeks - 5 && (phase === 'peak' || phase === 'build' || phase === 'taper') && i % 2 === 0)
        longW.tags!.push(`เริ่ม ${traits.startTime} เหมือนวันแข่ง`)
      if (traits.hills) longW.tags!.push('ผ่านสะพาน/ทางลาด')
      if (target.gelEveryMin && longKm * (paces.long[0] / 60) > 75) longW.tags!.push(`ซ้อมเจลทุก ${target.gelEveryMin} นาที`)
      if (traits.hot && i >= nWeeks - 5) longW.tags!.push('ฝึกดื่มน้ำ/เกลือแร่')

      const planned: { off: number; w: Omit<Workout, 'date' | 'dow'> }[] = []
      for (const slot of roles) {
        if (slot.role === 'long') planned.push({ off: slot.off, w: longW })
        else if (slot.role === 'q1') planned.push({ off: slot.off, w: quality('q1', phase, i, ctx) })
        else if (slot.role === 'q2') {
          if (phase === 'base' || phase === 'taper' || cutback) planned.push({ off: slot.off, w: { type: 'easy', title: 'วิ่งง่าย', detail: 'วิ่งสบาย ๆ', km: 0, pace: paceRange(paces.easy) } })
          else planned.push({ off: slot.off, w: quality('q2', phase, i, ctx) })
        } else planned.push({ off: slot.off, w: { type: 'easy', title: 'วิ่งง่าย', detail: traits.hot && i >= nWeeks - 5 ? 'วิ่งสบาย ๆ ช่วงอากาศอุ่น (ฝึกทนร้อน)' : 'วิ่งสบาย ๆ', km: 0, pace: paceRange(paces.easy) } })
      }
      if (cutback) {
        for (const p of planned) if (p.w.type !== 'long' && p.w.type !== 'easy') p.w = { ...p.w, km: p.w.km * 0.8, title: p.w.title + ' (เบาลง)' }
      }
      // เติมวันวิ่งง่ายให้ครบระยะสัปดาห์
      const fixed = planned.filter((p) => p.w.km > 0).reduce((s, p) => s + p.w.km, 0)
      const easies = planned.filter((p) => p.w.km === 0)
      const each = easies.length ? Math.max(4, (km - fixed) / easies.length) : 0
      for (const e of easies) e.w = { ...e.w, km: Math.min(each, Math.max(4, longKm * 0.6)) }

      for (const p of planned) {
        const { dow, date } = dayFor(p.off)
        if (daysBetween(today, date) < 0) continue // วันที่ผ่านไปแล้ว
        if (daysBetween(date, target.raceDate) <= 0) continue
        workouts.push({ date, dow, ...p.w, km: r1(p.w.km) })
      }
    }
    workouts.sort((a, b) => a.date.localeCompare(b.date))
    const total = workouts.reduce((s, w) => s + w.km, 0)
    weeks.push({
      index: i + 1,
      startDate: weekStart,
      phase,
      km: Math.round(total),
      longKm: r1(Math.max(0, ...workouts.filter((w) => w.type === 'long').map((w) => w.km))),
      cutback,
      focus: focusText(phase, cutback, traits),
      workouts,
    })
  }

  return {
    weeks,
    paces,
    feasibility,
    raceSpecific,
    totalKm: Math.round(weeks.reduce((s, w) => s + w.km, 0)),
    peakKm: Math.max(0, ...weeks.map((w) => w.km)),
    daysToRace,
  }
}

function focusText(phase: Phase, cutback: boolean, tr: Traits): string {
  if (cutback) return 'สัปดาห์พักฟื้น ลดระยะให้ร่างกายซึมซับ'
  switch (phase) {
    case 'base':
      return tr.hills ? 'สร้างฐาน + แรงขาขึ้นเนิน' : 'สร้างฐานความทนทาน'
    case 'build':
      return 'เพิ่มความเร็วและความทน'
    case 'peak':
      return 'ช่วงพีค ซ้อมเพซแข่งเฉพาะสนาม'
    case 'taper':
      return 'ลดระยะ คงความเร็ว ให้ขาสด'
    case 'race':
      return 'สัปดาห์แข่ง พักให้เต็มที่'
  }
}

export const PHASE_TH: Record<Phase, string> = { base: 'ฐาน', build: 'เสริม', peak: 'พีค', taper: 'ลดระยะ', race: 'แข่ง' }
export const DOW_TH = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.']
