// ─────────────────────────────────────────────────────────────
// แผนวิ่งที่สร้างจาก LINE → สร้างแผนเดียวกันในเว็บอัตโนมัติ
// อ่าน NOTE "raceplan-line-plans" จาก Intervals.icu (ใช้คีย์ที่เชื่อมไว้ในแท็บซ้อม → โค้ช)
// ─────────────────────────────────────────────────────────────
import type { CalendarRace, RacePlan, Waypoint } from '../types/race'
import { IntervalsClient } from '../coach/intervals'
import { LINE_PLANS_DATE, LINE_PLANS_ID } from '../coach/raceSetup'
import type { LinePlanStore } from '../coach/raceSetup'
import { generateFlatRoute } from '../engine/routeGen'
import { newPlan } from './planFactory'
import { uid } from '../lib/time'

const K_DONE = 'rp.lineImported.v1'
const get = (k: string) => {
  try {
    return localStorage.getItem(k) ?? ''
  } catch {
    return ''
  }
}

export interface LineImport {
  plans: RacePlan[]
  races: CalendarRace[]
}

/** ดึงแผนใหม่จาก LINE ที่ยังไม่เคยนำเข้า (ลบในเว็บแล้วจะไม่ดึงกลับมาอีก) */
export async function importLinePlans(existing: RacePlan[]): Promise<LineImport> {
  const id = get('rp.icu.id').trim()
  const key = get('rp.icu.key').trim()
  if (!id || !key) return { plans: [], races: [] }
  let done: string[] = []
  try {
    done = JSON.parse(get(K_DONE) || '[]') as string[]
  } catch {
    done = []
  }
  const { data } = await new IntervalsClient(id, key).loadJson<LinePlanStore>(LINE_PLANS_ID, LINE_PLANS_DATE)
  const fresh = (data?.plans ?? []).filter((lp) => !done.includes(`${lp.id}@${lp.createdAt}`))
  const plans: RacePlan[] = []
  const races: CalendarRace[] = []
  for (const lp of fresh) {
    const water: Waypoint[] = []
    for (let k = 2.5; k < lp.km - 0.5; k += 2.5) water.push({ id: uid('wp'), km: k, type: 'water', label: 'จุดน้ำ (ประมาณ)' })
    const p = newPlan({ name: lp.name, date: lp.date, route: generateFlatRoute(lp.km, `${lp.raceName} (เส้นทางจำลอง)`), waypoints: water, km: lp.km })
    // ใช้ id เดิมถ้ามีแผนนี้อยู่แล้ว (สร้างซ้ำจาก LINE = อัปเดตเป้า/ข้อมูล)
    const prev = existing.find((x) => x.id === lp.id)
    const plan: RacePlan = prev
      ? { ...prev, meta: { ...prev.meta, date: lp.date, startTime: lp.startTime, raceId: lp.raceId }, pacing: { ...prev.pacing, targetSec: lp.goalSec }, training: { ...prev.training, input: lp.input } }
      : { ...p, id: lp.id, meta: { ...p.meta, raceId: lp.raceId, startTime: lp.startTime }, pacing: { ...p.pacing, targetSec: lp.goalSec }, training: { input: lp.input } }
    plans.push(plan)
    if (lp.raceId?.startsWith('line_')) races.push({ id: lp.raceId, name: lp.raceName, date: lp.date, location: lp.location, distancesKm: [lp.km], source: 'LINE', url: '', custom: true })
    done.push(`${lp.id}@${lp.createdAt}`)
  }
  try {
    localStorage.setItem(K_DONE, JSON.stringify(done.slice(-50)))
  } catch {
    /* ignore */
  }
  return { plans, races }
}
