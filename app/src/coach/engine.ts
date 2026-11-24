// ─────────────────────────────────────────────────────────────
// Coach engine — pure TS (ใช้ทั้งในแอปและงานบนคลาวด์)
//  • เทียบแผนกับผลวิ่งจริง
//  • แบตเตอรี่ร่างกาย 🟢🟡🔴 (HRV, HR พัก, การนอน, ฟอร์ม, การเพิ่มโหลด)
//  • กฎปรับตาราง (ตามที่ผู้ใช้กำหนด):
//     - ขาดลองรัน → ตัดทิ้ง ไม่ย้ายวัน + สัปดาห์หน้าไม่เพิ่มระยะ
//     - ขาดซ้อมวันอื่น → ไม่ชดเชย ทำตามตารางต่อ
//     - ขาดหลายวันติด / วิ่งนอกแผนหนัก / มีอาการเจ็บ / แบตแดงก่อนวันหนัก → ถามก่อน ไม่ปรับเอง
//  • ความพร้อมมาราธอน + เวลาคาดการณ์ (แนวทางแบบ Runalyze — ค่าประมาณ)
// ─────────────────────────────────────────────────────────────
import type { Adjustment, BatteryItem, CoachConfig, CoachQuestion, CoachReport, DayRow, IcuActivity, IcuEvent, IcuWellness, Light, Readiness } from './types'
import { addDays, daysBetween, dowOf, mondayOf } from '../engine/trainingEngine'
import { fmtHMS } from '../lib/time'
import { bpmRange } from './workoutText'

export const dateOf = (s: string) => s.slice(0, 10)
/** วิ่ง และมีข้อมูลระยะจริง (กิจกรรมจาก Strava บางรายการมาแค่หัวข้อ ไม่มีระยะ) */
const isRun = (a: IcuActivity) => /run/i.test(a.type ?? 'Run') && (a.distance ?? 0) > 0

// ── แผน ──
export function plannedKm(e: IcuEvent): number | undefined {
  if (e.distance && e.distance > 0) return e.distance / 1000
  if (e.workout_doc?.distance) return e.workout_doc.distance / 1000
  const m = /(\d+(?:\.\d+)?)\s*(?:กม|km)/i.exec(`${e.name ?? ''}`)
  if (m) return Number(m[1])
  if (e.moving_time) return e.moving_time / 390 // ~6:30/กม.
  return undefined
}

export function classify(e: IcuEvent, weekMaxKm = 0): DayRow['kind'] {
  if (/^RACE/i.test(e.category)) return 'race'
  const t = `${e.name ?? ''} ${(e.description ?? '').slice(0, 200)}`
  if (/long|ยาว|lsd/i.test(e.name ?? '')) return 'long'
  if (/tempo|interval|threshold|เทมโป|อินเทอร์|เพซแข่ง|race ?pace|\bMP\b|\d\s?[x×]\s?\d|เนิน|hill|fartlek|สะพาน|speed|ความเร็ว/i.test(t)) return 'quality'
  const km = plannedKm(e) ?? 0
  if (weekMaxKm > 0 && km >= weekMaxKm * 0.95 && km >= 12) return 'long'
  return 'easy'
}

export function buildDays(events: IcuEvent[], acts: IcuActivity[], from: string, to: string, today: string): DayRow[] {
  const workouts = events.filter((e) => e.category === 'WORKOUT' || /^RACE/.test(e.category)).filter((e) => !e.type || /run/i.test(e.type))
  const weekMax = new Map<string, number>()
  for (const e of workouts) {
    const wk = mondayOf(dateOf(e.start_date_local))
    weekMax.set(wk, Math.max(weekMax.get(wk) ?? 0, plannedKm(e) ?? 0))
  }
  const days: DayRow[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const planned = workouts.find((e) => dateOf(e.start_date_local) === d)
    const actual = acts.filter((a) => isRun(a) && dateOf(a.start_date_local) === d)
    const actualKm = actual.reduce((s, a) => s + (a.distance ?? 0), 0) / 1000
    const pk = planned ? plannedKm(planned) : undefined
    let status: DayRow['status']
    if (!planned) status = actual.length ? 'extra' : 'rest'
    else if (d > today || (d === today && !actual.length)) status = 'planned'
    else if (!actual.length) status = 'missed'
    else if (!pk || actualKm >= pk * 0.8) status = 'done'
    else status = actualKm >= pk * 0.3 ? 'partial' : 'missed'
    days.push({
      date: d,
      planned,
      plannedKm: pk,
      kind: planned ? classify(planned, weekMax.get(mondayOf(d))) : undefined,
      actual,
      actualKm: Math.round(actualKm * 10) / 10,
      status,
    })
  }
  return days
}

// ── แบตเตอรี่ ──
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)

export function battery(wellness: IcuWellness[], today: string): BatteryItem[] {
  const sorted = [...wellness].filter((w) => w.id <= today).sort((a, b) => a.id.localeCompare(b.id))
  const cur = [...sorted].reverse().find((w) => w.hrv || w.restingHR || w.sleepSecs) ?? sorted.at(-1)
  const prev = sorted.filter((w) => cur && w.id < cur.id && daysBetween(w.id, cur.id) <= 7)
  const items: BatteryItem[] = []

  const hrvBase = mean(prev.map((w) => w.hrv ?? NaN).filter(Number.isFinite))
  if (cur?.hrv && Number.isFinite(hrvBase)) {
    const d = ((cur.hrv - hrvBase) / hrvBase) * 100
    const light: Light = d >= -5 ? 'green' : d >= -12 ? 'yellow' : 'red'
    items.push({
      key: 'hrv',
      label: 'HRV',
      value: `${Math.round(cur.hrv)} ms`,
      light,
      why: light === 'green' ? `ใกล้/สูงกว่าค่าปกติ 7 วัน (${Math.round(hrvBase)}) ร่างกายฟื้นดี` : `ต่ำกว่าค่าปกติ ${Math.abs(d).toFixed(0)}% — ระบบประสาทยังเหนื่อย/เครียด`,
    })
  }
  const rhrBase = mean(prev.map((w) => w.restingHR ?? NaN).filter(Number.isFinite))
  if (cur?.restingHR && Number.isFinite(rhrBase)) {
    const d = cur.restingHR - rhrBase
    const light: Light = d <= 2 ? 'green' : d <= 5 ? 'yellow' : 'red'
    items.push({
      key: 'rhr',
      label: 'HR พัก',
      value: `${Math.round(cur.restingHR)} bpm`,
      light,
      why: light === 'green' ? `ปกติ (ฐาน ${Math.round(rhrBase)})` : `สูงกว่าฐาน ${d.toFixed(0)} bpm — อาจล้า พักไม่พอ หรือเริ่มป่วย`,
    })
  }
  if (cur?.sleepSecs) {
    const h = cur.sleepSecs / 3600
    const light: Light = h >= 7 ? 'green' : h >= 6 ? 'yellow' : 'red'
    items.push({
      key: 'sleep',
      label: 'การนอน',
      value: `${Math.floor(h)} ชม. ${Math.round((h % 1) * 60)} น.${cur.sleepScore ? ` · ${Math.round(cur.sleepScore)}` : ''}`,
      light,
      why: light === 'green' ? 'นอนพอ' : light === 'yellow' ? 'นอนน้อยไปนิด คืนนี้เข้านอนเร็วขึ้น' : 'นอนน้อยมาก วันนี้อย่าฝืนวันหนัก',
    })
  }
  const last = [...sorted].reverse().find((w) => w.ctl != null && w.atl != null)
  if (last?.ctl != null && last.atl != null) {
    const tsb = last.ctl - last.atl
    const light: Light = tsb > -10 ? 'green' : tsb > -25 ? 'yellow' : 'red'
    items.push({
      key: 'form',
      label: 'ฟอร์ม (TSB)',
      value: `${tsb > 0 ? '+' : ''}${tsb.toFixed(0)}`,
      light,
      why: light === 'green' ? 'ความล้าสะสมอยู่ในระดับรับได้' : light === 'yellow' ? 'ล้าสะสมจากการซ้อม — ปกติช่วงสร้างฟิต' : 'ล้าสะสมสูง เสี่ยงบาดเจ็บ ควรมีวันเบา',
    })
    const ratio = last.ctl > 0 ? last.atl / last.ctl : 1
    const l2: Light = ratio <= 1.2 ? 'green' : ratio <= 1.5 ? 'yellow' : 'red'
    items.push({
      key: 'ramp',
      label: 'โหลด 7 วัน : 6 สัปดาห์',
      value: ratio.toFixed(2),
      light: l2,
      why: l2 === 'green' ? 'เพิ่มโหลดอย่างปลอดภัย' : l2 === 'yellow' ? 'เพิ่มโหลดเร็ว ระวัง' : 'เพิ่มโหลดเร็วเกินไป เสี่ยงบาดเจ็บ',
    })
  }
  return items
}

export function overallLight(items: BatteryItem[]): Light {
  if (!items.length) return 'none'
  const reds = items.filter((i) => i.light === 'red').length
  const yellows = items.filter((i) => i.light === 'yellow').length
  if (reds >= 2 || (reds === 1 && yellows >= 1)) return 'red'
  if (reds === 1 || yellows >= 2) return 'yellow'
  return 'green'
}

// ── VDOT (Daniels) ──
export function vdotFrom(distM: number, sec: number): number {
  const t = sec / 60
  const v = distM / t
  const vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v
  const pct = 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t)
  return vo2 / pct
}
export function timeFromVdot(vdot: number, distM: number): number {
  let lo = 60
  let hi = 60 * 60 * 10
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (vdotFrom(distM, mid) > vdot) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

export function readiness(acts: IcuActivity[], today: string, distKm = 42.195): Readiness {
  const runs = acts.filter(isRun).filter((a) => daysBetween(dateOf(a.start_date_local), today) <= 42 && daysBetween(dateOf(a.start_date_local), today) >= 0)
  const totalKm = runs.reduce((s, a) => s + (a.distance ?? 0), 0) / 1000
  const weeklyKmAvg = totalKm / 6
  const longestKm = Math.max(0, ...runs.map((a) => (a.distance ?? 0) / 1000))
  // VDOT จากวิ่งที่ดีที่สุด (≥ 5 กม.) ใน 60 วัน
  let vdot: number | undefined
  for (const a of acts.filter(isRun)) {
    const age = daysBetween(dateOf(a.start_date_local), today)
    if (age < 0 || age > 60 || !a.distance || !a.moving_time || a.distance < 5000) continue
    const v = vdotFrom(a.distance, a.moving_time)
    if (v > 20 && v < 85 && (!vdot || v > vdot)) vdot = v
  }
  if (!vdot) return { shapePct: 0, weeklyKmAvg, longestKm }
  const requiredWeeklyKm = vdot ** 1.135
  const requiredLongKm = Math.log(vdot / 4) * 12 - 5
  const shape = Math.min(1, weeklyKmAvg / requiredWeeklyKm) * (2 / 3) + Math.min(1, longestKm / requiredLongKm) * (1 / 3)
  const base = timeFromVdot(vdot, distKm * 1000)
  const penalty = distKm > 30 ? 0.15 : distKm > 15 ? 0.06 : 0.02
  return {
    shapePct: Math.round(shape * 100),
    vdot: Math.round(vdot * 10) / 10,
    predictedSec: Math.round(base * (1 + penalty * (1 - shape))),
    weeklyKmAvg: Math.round(weeklyKmAvg * 10) / 10,
    longestKm: Math.round(longestKm * 10) / 10,
    requiredWeeklyKm: Math.round(requiredWeeklyKm),
    requiredLongKm: Math.round(requiredLongKm),
  }
}

// ── กฎปรับตาราง ──
export interface RuleInput {
  days: DayRow[]
  today: string
  cfg: CoachConfig
  /** วันที่จัดการแล้ว (จาก NOTE 🔧 / ❓ ที่เคยเขียน) */
  handled: Set<string>
  battery: BatteryItem[]
  /** วันที่ผู้ใช้แจ้งอาการเจ็บ (NOTE ขึ้นต้น 🩹) */
  injuryDates: string[]
}

function longRunText(kmVal: number, lthr: number) {
  const [a, b] = bpmRange(lthr, 'long')
  return `- วิ่งยาว หัวใจ ${a}–${b} ${kmVal}km ${Math.round((a / lthr) * 100)}-${Math.round((b / lthr) * 100)}% LTHR`
}
function easyText(kmVal: number, lthr: number) {
  const [a, b] = bpmRange(lthr, 'easy')
  return `- วิ่งง่าย หัวใจ ${a}–${b} ${kmVal}km ${Math.round((a / lthr) * 100)}-${Math.round((b / lthr) * 100)}% LTHR`
}

export function applyRules(r: RuleInput): { adjustments: Adjustment[]; questions: CoachQuestion[] } {
  const { days, today, cfg } = r
  const adjustments: Adjustment[] = []
  const questions: CoachQuestion[] = []
  const past = days.filter((d) => d.date < today && daysBetween(d.date, today) <= 7)
  const future = days.filter((d) => d.date >= today && d.planned)

  // ขาดหลายวันติด (วันที่มีแผนติดกัน ≥ 2 วันที่ขาด)
  const plannedPast = past.filter((d) => d.planned)
  let streak: DayRow[] = []
  let streakQ = false
  for (const d of plannedPast) {
    if (d.status === 'missed') streak.push(d)
    else streak = []
    if (streak.length >= 2 && !streak.every((x) => r.handled.has(x.date))) {
      const last = streak[streak.length - 1]
      questions.push({
        id: `q-streak-${last.date}`,
        date: last.date,
        text: `ขาดซ้อม ${streak.length} ครั้งติด (${streak.map((x) => x.date.slice(5)).join(', ')}) — จะให้ลดความหนักสัปดาห์นี้ หรือทำตามตารางเดิม?`,
        proposal: future
          .filter((f) => f.kind === 'quality' && daysBetween(today, f.date) <= 6)
          .map((f) => ({
            action: 'update' as const,
            eventId: f.planned!.id,
            date: f.date,
            patch: { name: `วิ่งง่าย ${Math.round(f.plannedKm ?? 6)} กม. (ปรับจากวันหนัก)`, description: `🔧 เปลี่ยนวันหนักเป็นวิ่งง่าย หลังขาดซ้อมหลายวัน\n\n${easyText(Math.round(f.plannedKm ?? 6), cfg.lthr)}` },
            note: 'เปลี่ยนวันหนักเป็นวิ่งง่าย เพื่อกลับเข้าตารางอย่างปลอดภัย',
          })),
      })
      streakQ = true
      streak = []
    }
  }

  for (const d of past) {
    if (r.handled.has(d.date) || !d.planned) continue
    if (d.status !== 'missed') continue
    if (streakQ && questions.some((q) => q.id.includes(d.date))) continue
    if (d.kind === 'long') {
      // ตัดทิ้ง + สัปดาห์หน้าไม่เพิ่มระยะ
      const thisWeek = mondayOf(d.date)
      const nextWeek = addDays(thisWeek, 7)
      const weekTotal = (wk: string) => days.filter((x) => mondayOf(x.date) === wk && x.plannedKm).reduce((s, x) => s + (x.plannedKm ?? 0), 0)
      const cur = weekTotal(thisWeek)
      const nxt = weekTotal(nextWeek)
      const nextLong = days.filter((x) => mondayOf(x.date) === nextWeek && x.kind === 'long' && x.planned && x.date >= today)[0]
      if (nxt > cur && nextLong?.plannedKm) {
        const cut = Math.min(nxt - cur, nextLong.plannedKm * 0.4)
        const newKm = Math.round(Math.max(nextLong.plannedKm * 0.6, nextLong.plannedKm - cut))
        adjustments.push({
          action: 'update',
          eventId: nextLong.planned!.id,
          date: nextLong.date,
          patch: {
            name: `วิ่งยาว ${newKm} กม. (ปรับ)`,
            description: `🔧 ลดจาก ${Math.round(nextLong.plannedKm)} กม. เพราะขาดลองรัน ${d.date.slice(5)} — สัปดาห์นี้ไม่เพิ่มระยะ\n\n${longRunText(newKm, cfg.lthr)}`,
          },
          note: `ขาดลองรัน ${d.date.slice(5)} → ตัดทิ้ง ไม่ย้ายวัน และลดลองรันสัปดาห์หน้าเหลือ ${newKm} กม. ให้ระยะรวมไม่เกินสัปดาห์นี้`,
        })
      } else {
        adjustments.push({ action: 'update', eventId: -1, date: d.date, note: `ขาดลองรัน ${d.date.slice(5)} → ตัดทิ้ง ไม่ย้ายวัน (สัปดาห์หน้าไม่ได้เพิ่มระยะอยู่แล้ว)` })
      }
    } else if (d.kind !== 'race') {
      adjustments.push({ action: 'update', eventId: -1, date: d.date, note: `ขาด${d.kind === 'quality' ? 'วันคุณภาพ' : 'วิ่งง่าย'} ${d.date.slice(5)} → ไม่ชดเชย ทำตามตารางต่อ` })
    }
  }

  // วิ่งนอกแผนหนัก ๆ
  const loads = past.filter((d) => d.planned && d.actual.length).flatMap((d) => d.actual.map((a) => a.icu_training_load ?? 0)).filter((x) => x > 0)
  const typical = loads.length ? loads.sort((a, b) => a - b)[Math.floor(loads.length / 2)] : 0
  for (const d of past) {
    if (r.handled.has(d.date)) continue
    const extraHard = d.actual.some((a) => (typical && (a.icu_training_load ?? 0) > typical * 1.5) || (a.distance ?? 0) >= 15000)
    if ((d.status === 'extra' || (d.kind === 'easy' && d.actualKm > (d.plannedKm ?? 0) * 1.5)) && extraHard) {
      questions.push({
        id: `q-extra-${d.date}`,
        date: d.date,
        text: `วันที่ ${d.date.slice(5)} วิ่งนอกแผน/หนักกว่าแผน (${d.actualKm} กม.) — จะให้เปลี่ยนวันหนักถัดไปเป็นวิ่งง่ายไหม?`,
        proposal: future
          .filter((f) => f.kind === 'quality')
          .slice(0, 1)
          .map((f) => ({
            action: 'update' as const,
            eventId: f.planned!.id,
            date: f.date,
            patch: { name: `วิ่งง่าย ${Math.round(f.plannedKm ?? 6)} กม. (ปรับ)`, description: `🔧 เปลี่ยนเป็นวิ่งง่าย หลังวิ่งนอกแผนหนัก\n\n${easyText(Math.round(f.plannedKm ?? 6), cfg.lthr)}` },
            note: 'เปลี่ยนวันหนักถัดไปเป็นวิ่งง่าย',
          })),
      })
    }
  }

  // อาการเจ็บที่แจ้งไว้ 3 วันล่าสุด
  const recentInjury = r.injuryDates.filter((x) => daysBetween(x, today) >= 0 && daysBetween(x, today) <= 3).sort().at(-1)
  if (recentInjury && !r.handled.has(`inj-${recentInjury}`)) {
    questions.push({ id: `q-injury-${recentInjury}`, date: recentInjury, text: 'คุณแจ้งอาการเจ็บ/ตึงไว้ — จะให้เปลี่ยนวันหนักใน 3 วันข้างหน้าเป็นวิ่งง่ายหรือพักไหม?',
      proposal: future.filter((f) => f.kind !== 'easy' && f.kind !== 'race' && daysBetween(today, f.date) <= 3).map((f) => ({
        action: 'update' as const, eventId: f.planned!.id, date: f.date,
        patch: { name: `วิ่งง่าย ${Math.min(6, Math.round(f.plannedKm ?? 6))} กม. (ปรับ: เจ็บ)`, description: `🔧 ลดเป็นวิ่งง่ายเพราะแจ้งอาการเจ็บ\n\n${easyText(Math.min(6, Math.round(f.plannedKm ?? 6)), cfg.lthr)}` },
        note: 'ลดเป็นวิ่งง่ายเพราะมีอาการเจ็บ',
      })) })
  }

  // แบตแดงก่อนวันหนัก
  const ov = overallLight(r.battery)
  const nextHard = future.find((f) => (f.kind === 'quality' || f.kind === 'long') && daysBetween(today, f.date) <= 1)
  if (ov === 'red' && nextHard && !r.handled.has(`bat-${today}`)) {
    questions.push({
      id: `q-battery-${today}`,
      date: today,
      text: `ค่าร่างกายแดง และ${nextHard.date === today ? 'วันนี้' : 'พรุ่งนี้'}มี${nextHard.kind === 'long' ? 'ลองรัน' : 'วันหนัก'} — จะให้สลับเป็นวิ่งง่ายไหม?`,
      proposal: [
        {
          action: 'update',
          eventId: nextHard.planned!.id,
          date: nextHard.date,
          patch: { name: `วิ่งง่าย ${Math.min(8, Math.round(nextHard.plannedKm ?? 6))} กม. (ปรับ: ร่างกายล้า)`, description: `🔧 ร่างกายล้า (แบตแดง) เปลี่ยนเป็นวิ่งง่าย\n\n${easyText(Math.min(8, Math.round(nextHard.plannedKm ?? 6)), cfg.lthr)}` },
          note: 'เปลี่ยนเป็นวิ่งง่ายเพราะค่าร่างกายแดง',
        },
      ],
    })
  }
  return { adjustments, questions }
}

// ── สรุปข้อความ ──
const DOT: Record<Light, string> = { green: '🟢', yellow: '🟡', red: '🔴', none: '⚪' }
export const lightDot = (l: Light) => DOT[l]

export function buildReport(input: {
  events: IcuEvent[]
  acts: IcuActivity[]
  wellness: IcuWellness[]
  cfg: CoachConfig
  today: string
  handled: Set<string>
  injuryDates: string[]
}): CoachReport {
  const { events, acts, wellness, cfg, today } = input
  const from = addDays(today, -13)
  const to = addDays(today, 14)
  const days = buildDays(events, acts, from, to, today).filter((d) => d.date >= cfg.from && d.date <= cfg.to || d.status === 'extra')
  const bat = battery(wellness, today)
  const ov = overallLight(bat)
  const { adjustments, questions } = applyRules({ days, today, cfg, handled: input.handled, battery: bat, injuryDates: input.injuryDates })
  const rd = readiness(acts, today, cfg.distKm ?? 42.195)

  const L: string[] = []
  L.push(`${DOT[ov]} แบตเตอรี่วันนี้`)
  for (const b of bat) L.push(`${DOT[b.light]} ${b.label} ${b.value} — ${b.why}`)
  if (!bat.length) L.push('ยังไม่มีข้อมูล HRV/HR พัก/การนอน (ซิงก์นาฬิกาแล้วรอ Intervals.icu ดึงข้อมูล)')
  const td = days.find((d) => d.date === today)
  const yd = days.find((d) => d.date === addDays(today, -1))
  const fmtDay = (d?: DayRow) =>
    !d ? '—' : d.status === 'done' ? `✅ ${d.actualKm} กม.` : d.status === 'partial' ? `⚠️ ${d.actualKm}/${d.plannedKm?.toFixed(0)} กม.` : d.status === 'missed' ? '❌ ขาด' : d.status === 'extra' ? `➕ นอกแผน ${d.actualKm} กม.` : d.planned ? `📅 ${d.planned.name}` : 'พัก'
  L.push('', `เมื่อวาน: ${fmtDay(yd)}`, `วันนี้: ${fmtDay(td)}`)
  const tm = days.find((d) => d.date === addDays(today, 1))
  if (tm?.planned) L.push(`พรุ่งนี้: ${tm.planned.name}`)
  const notes = adjustments.map((a) => `🔧 ${a.note}`)
  if (notes.length) L.push('', ...notes)
  if (questions.length) L.push('', '❓ ขอความเห็น', ...questions.map((q) => `• ${q.text}`))
  if (rd.vdot) {
    L.push('', `🏁 ความพร้อม${(cfg.distKm ?? 42) > 30 ? 'มาราธอน' : ''} ${rd.shapePct}% · เวลาคาดการณ์ ${fmtHMS(rd.predictedSec!)}${cfg.goalSec ? ` (เป้า ${fmtHMS(cfg.goalSec)})` : ''}`)
    L.push(`   วิ่งเฉลี่ย ${rd.weeklyKmAvg} กม./สัปดาห์ (ควรมี ~${rd.requiredWeeklyKm}) · ยาวสุด ${rd.longestKm} กม. (ควรมี ~${rd.requiredLongKm})`)
  }

  let weekly: string | undefined
  if (dowOf(today) === 0) {
    const wk = mondayOf(today)
    const wd = days.filter((d) => mondayOf(d.date) === wk)
    const plan = wd.reduce((s, d) => s + (d.plannedKm ?? 0), 0)
    const done = wd.reduce((s, d) => s + d.actualKm, 0)
    const sessions = wd.filter((d) => d.planned)
    const ok = sessions.filter((d) => d.status === 'done').length
    const ws = [...wellness].sort((a, b) => a.id.localeCompare(b.id))
    const hrvAvg = (a: string, b: string) => mean(ws.filter((w) => w.id >= a && w.id <= b).map((w) => w.hrv ?? NaN).filter(Number.isFinite))
    const h1 = hrvAvg(wk, today)
    const h0 = hrvAvg(addDays(wk, -7), addDays(wk, -1))
    const ctlNow = [...ws].reverse().find((w) => w.ctl != null)?.ctl
    const ctlPrev = [...ws].reverse().find((w) => w.id < wk && w.ctl != null)?.ctl
    weekly = [
      '📊 สรุปสัปดาห์',
      `ระยะ ${done.toFixed(1)} / ${plan.toFixed(0)} กม. (${plan ? Math.round((done / plan) * 100) : 0}%) · ทำครบ ${ok}/${sessions.length} ครั้ง`,
      Number.isFinite(h1) && Number.isFinite(h0) ? `HRV เฉลี่ย ${h1.toFixed(0)} (สัปดาห์ก่อน ${h0.toFixed(0)}) ${h1 >= h0 ? '↗ ดีขึ้น' : '↘ ลดลง'}` : '',
      ctlNow != null && ctlPrev != null ? `ความฟิต (CTL) ${ctlPrev.toFixed(0)} → ${ctlNow.toFixed(0)} ${ctlNow >= ctlPrev ? '↗' : '↘'}` : '',
    ]
      .filter(Boolean)
      .join('\n')
    L.push('', weekly)
  }
  return { date: today, battery: bat, overall: ov, days, adjustments, questions, readiness: rd, summary: L.join('\n'), weekly }
}
