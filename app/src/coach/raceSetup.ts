// ─────────────────────────────────────────────────────────────
// 🏁 สร้างแผนวิ่งจาก LINE: เลือกงาน → ระยะ → เป้าเวลา → ยืนยัน → ส่งตารางเข้า Intervals.icu
// และบันทึกรายการไว้ใน NOTE "raceplan-line-plans" ให้เว็บดึงไปสร้างแผนเดียวกัน
// ─────────────────────────────────────────────────────────────
import type { CalendarRace, Feasibility, TrainingInput, TrainingPlan } from '../types/race'
import type { CoachConfig, IcuActivity, IcuEvent } from './types'
import type { IntervalsClient } from './intervals'
import { EXT_PREFIX } from './intervals'
import { readiness, vdotFrom } from './engine'
import { toIcuEvent } from './workoutText'
import { computeTrainingPlan, daysBetween, addDays } from '../engine/trainingEngine'
import { getRaceProfile, startTimeFor } from '../data/raceProfiles'
import { fmtHMS, fmtPace } from '../lib/time'

export const LINE_PLANS_ID = 'raceplan-line-plans'
export const LINE_PLANS_DATE = '2020-01-05'
/** ต้องเหลือเวลาอย่างน้อยเท่านี้ถึงจะจัดแผนได้ */
export const MIN_DAYS = 14

/** ชื่อแผน → key ใน external_id (ใช้ร่วมกับเว็บ ให้ได้ id เดียวกัน) */
export const planSlug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9ก-๙]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24) || 'plan'

export const kmLabel = (km: number) => (km >= 42 ? '42.195K' : km >= 21 && km < 21.2 ? '21.1K' : `${km}K`)
export const planName = (race: { name: string }, km: number) => `${race.name} ${kmLabel(km)}`

/** แผนที่สร้างจาก LINE (เก็บใน Intervals ให้เว็บดึงไป) */
export interface LinePlan {
  id: string
  name: string
  raceName: string
  date: string
  km: number
  raceId?: string
  location?: string
  goalSec: number
  startTime: string
  input: TrainingInput
  createdAt: string
}
export interface LinePlanStore {
  plans: LinePlan[]
}

/** สถานะระหว่างตั้งค่า (เก็บใน KV) */
export interface RunSetup {
  list?: CalendarRace[]
  race?: CalendarRace
  km?: number
  goalSec?: number
  runsPerWeek?: number
}

// ── รายการงาน ──
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')
export function upcomingRaces(all: CalendarRace[], today: string, q = ''): CalendarRace[] {
  const qq = norm(q)
  const seen = new Set<string>()
  return all
    .filter((r) => r.date && daysBetween(today, r.date) >= MIN_DAYS)
    .filter((r) => !qq || norm(`${r.name} ${r.location ?? ''} ${r.organizer ?? ''}`).includes(qq))
    .filter((r) => {
      const k = `${norm(r.name)}|${r.date}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .sort((a, b) => a.date!.localeCompare(b.date!))
}

/** ระยะที่ให้เลือก (ถ้างานไม่ระบุ ใช้ระยะมาตรฐาน) */
export function distancesOf(r: CalendarRace): number[] {
  const ds = [...new Set(r.distancesKm.filter((d) => d >= 3 && d <= 100))].sort((a, b) => a - b)
  return (ds.length ? ds : [5, 10, 21.1, 42.195]).slice(-4)
}

// ── ความฟิตปัจจุบันจากกิจกรรมจริง ──
export function estimateInput(acts: IcuActivity[], today: string, distKm: number): { input: TrainingInput; predictedSec?: number; runs6w: number } {
  const isRun = (a: IcuActivity) => /run/i.test(a.type ?? '') && (a.distance ?? 0) > 0
  const runs = acts.filter((a) => isRun(a) && daysBetween(a.start_date_local.slice(0, 10), today) <= 42 && daysBetween(a.start_date_local.slice(0, 10), today) >= 0)
  const r = readiness(acts, today, distKm)
  const weeklyKm = Math.round(r.weeklyKmAvg)
  const runsPerWeek = Math.max(3, Math.min(6, Math.round(runs.length / 6) || 3))
  // ผลดีที่สุด (≥5 กม.) ใน 60 วัน → ใช้ประเมินเป้า
  let best: IcuActivity | undefined
  let bestV = 0
  for (const a of acts.filter(isRun)) {
    const age = daysBetween(a.start_date_local.slice(0, 10), today)
    if (age < 0 || age > 60 || !a.distance || !a.moving_time || a.distance < 5000) continue
    const v = vdotFrom(a.distance, a.moving_time)
    if (v > 20 && v < 85 && v > bestV) {
      bestV = v
      best = a
    }
  }
  const input: TrainingInput = {
    weeklyKm: Math.max(weeklyKm, 5),
    longestRunKm: Math.max(Math.round(r.longestKm), 3),
    runsPerWeek,
    experience: weeklyKm >= 40 ? 'experienced' : weeklyKm >= 12 ? 'regular' : 'new',
    ...(best ? { recentRaceKm: Math.round(best.distance! / 100) / 10, recentRaceSec: best.moving_time ?? undefined } : {}),
  }
  return { input, predictedSec: r.predictedSec, runs6w: runs.length }
}

const roundMin = (s: number) => Math.round(s / 60) * 60
export function defaultGoal(km: number): number {
  if (km <= 5.5) return 32 * 60
  if (km <= 11) return 65 * 60
  if (km <= 22) return 2 * 3600 + 20 * 60
  return 5 * 3600
}
/** ตัวเลือกเป้าเวลา: ตามความฟิต / ท้าทาย / เต็มที่ */
export function goalOptions(km: number, predictedSec?: number): { label: string; sec: number }[] {
  const base = predictedSec && predictedSec > 0 ? predictedSec : defaultGoal(km)
  const tag = predictedSec ? '' : ' (ประมาณ)'
  return [
    { label: `สบาย ๆ${tag}`, sec: roundMin(base * 1.04) },
    { label: `ตามความฟิต${tag}`, sec: roundMin(base) },
    { label: 'ท้าทาย', sec: roundMin(base * 0.96) },
  ]
}

// ── สร้างแผน ──
export function buildRunPlan(race: CalendarRace, km: number, goalSec: number, input: TrainingInput, today: string): { plan: TrainingPlan; startTime: string } {
  const profile = getRaceProfile(race, race.date)
  const startTime = startTimeFor(profile, km, km > 22 ? '03:00' : km > 11 ? '04:30' : '05:30')
  const plan = computeTrainingPlan(input, { distKm: km, goalSec, raceDate: race.date!, startTime, gainPerKm: 0, gelEveryMin: km > 15 ? 30 : undefined }, profile, today)
  return { plan, startTime }
}

export const FEAS_TH: Record<Feasibility['level'], string> = { ok: '🟢 เป้าสมจริง', stretch: '🟡 ท้าทายแต่เป็นไปได้', risky: '🔴 เสี่ยง', unknown: '⚪ ยังประเมินไม่ได้' }

/** event ของแผนวิ่งเดิมที่ยังไม่ถึงวัน (จะถูกแทนด้วยแผนใหม่) — ไม่แตะโน้ต/ติดงาน/แบด */
export function oldPlanEvents(events: IcuEvent[], today: string): IcuEvent[] {
  return events.filter(
    (e) =>
      (e.category === 'WORKOUT' || /^RACE/.test(e.category)) &&
      !!e.external_id?.startsWith(EXT_PREFIX) &&
      !e.external_id.startsWith(`${EXT_PREFIX}busy`) &&
      e.start_date_local.slice(0, 10) >= today,
  )
}

/** ส่งแผนเข้า Intervals + บันทึก config + รายการให้เว็บ */
export async function applyRunPlan(
  client: IntervalsClient,
  cfg: CoachConfig,
  race: CalendarRace,
  km: number,
  goalSec: number,
  input: TrainingInput,
  today: string,
): Promise<{ plan: TrainingPlan; removed: number; added: number; name: string; cfg: CoachConfig }> {
  const { plan, startTime } = buildRunPlan(race, km, goalSec, input, today)
  const name = planName(race, km)
  const key = planSlug(name)
  // ลบตารางวิ่งเดิมที่ยังไม่ถึงวัน
  const horizon = cfg.raceDate && cfg.raceDate > race.date! ? cfg.raceDate : race.date!
  const old = oldPlanEvents(await client.events(today, addDays(horizon, 1)), today)
  if (old.length) await client.deleteEvents(old.map((e) => e.id))
  const evs = plan.weeks
    .flatMap((w) => w.workouts)
    .filter((w) => w.date >= today && w.type !== 'rest')
    .map((w) => toIcuEvent(w, plan.paces, { lthr: cfg.lthr }, key))
  for (let i = 0; i < evs.length; i += 50) await client.upsertEvents(evs.slice(i, i + 50))
  const next: CoachConfig = { ...cfg, planName: name, from: today, to: race.date!, raceDate: race.date, goalSec, distKm: km }
  await client.saveConfig(next)
  // ให้เว็บรู้ว่ามีแผนใหม่จาก LINE
  const { data } = await client.loadJson<LinePlanStore>(LINE_PLANS_ID, LINE_PLANS_DATE)
  const lp: LinePlan = { id: `line-${key}`, name, raceName: race.name, date: race.date!, km, raceId: race.id, location: race.location, goalSec, startTime, input, createdAt: new Date().toISOString() }
  const plans = [...(data?.plans ?? []).filter((p) => p.id !== lp.id), lp].slice(-10)
  await client.saveJson(LINE_PLANS_ID, LINE_PLANS_DATE, '🏁 แผนวิ่งจาก LINE (คู่ซ้อม · อย่าลบ)', { plans }, 'แผนที่สร้างจาก LINE — เว็บคู่ซ้อมจะดึงไปสร้างแผนเดียวกัน')
  return { plan, removed: old.length, added: evs.length, name, cfg: next }
}

export const paceOf = (goalSec: number, km: number) => `${fmtPace(goalSec / km)}/กม.`
export { fmtHMS }
