// ─────────────────────────────────────────────────────────────
// ฟีเจอร์เสริมของโค้ช: รายงานสัปดาห์ · สัปดาห์แข่ง · การ์ดเพซ · วิเคราะห์หลังแข่ง · รองเท้า
// ใช้ร่วมกันระหว่างงานบนคลาวด์ (scripts/coach.ts) และบอท LINE (worker)
// ─────────────────────────────────────────────────────────────
import type { CoachConfig, IcuActivity, IcuEvent, IcuWellness } from './types'
import type { IntervalsClient } from './intervals'
import { buildDays, dateOf, readiness, vdotFrom } from './engine'
import { addDays, daysBetween, mondayOf } from '../engine/trainingEngine'
import { computePacing, heatAdjustment, kmAtElapsed } from '../engine/pacingEngine'
import { RACE_CALENDAR } from '../data/raceCalendar'
import { RACE_PROFILES, startTimeFor } from '../data/raceProfiles'
import { parseHM } from '../lib/time'
import type { Segment, SplitRow } from '../types/race'

const isRun = (a: IcuActivity) => /run/i.test(a.type ?? 'Run') && (a.distance ?? 0) > 0
const r1 = (n: number) => Math.round(n * 10) / 10

// ── รายงานสัปดาห์ ──────────────────────────────────────────────
export interface WeekDay {
  date: string
  plannedKm: number
  actualKm: number
  status: string
  name?: string
}
export interface WeeklyData {
  from: string
  to: string
  days: WeekDay[]
  plannedKm: number
  actualKm: number
  sessions: number
  done: number
  longestKm: number
  ctl?: number
  ctlPrev?: number
  atl?: number
  hrv?: number
  hrvPrev?: number
  nextWeekKm: number
  predictedSec?: number
  shapePct?: number
}

export function weeklyData(events: IcuEvent[], acts: IcuActivity[], wellness: IcuWellness[], cfg: CoachConfig, today: string): WeeklyData {
  const from = mondayOf(today)
  const to = addDays(from, 6)
  const rows = buildDays(events, acts, from, to, today)
  const days: WeekDay[] = rows.map((d) => ({ date: d.date, plannedKm: r1(d.plannedKm ?? 0), actualKm: d.actualKm, status: d.status, name: d.planned?.name }))
  const nextRows = buildDays(events, [], addDays(from, 7), addDays(from, 13), today)
  const ws = [...wellness].sort((a, b) => a.id.localeCompare(b.id))
  const lastWith = (pred: (w: IcuWellness) => boolean) => [...ws].reverse().find(pred)
  const avg = (a: string, b: string) => {
    const xs = ws.filter((w) => w.id >= a && w.id <= b && w.hrv != null).map((w) => w.hrv as number)
    return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : undefined
  }
  const nowW = lastWith((w) => w.id <= today && w.ctl != null)
  const rd = readiness(acts, today, cfg.distKm ?? 21.1)
  return {
    from,
    to,
    days,
    plannedKm: r1(days.reduce((s, d) => s + d.plannedKm, 0)),
    actualKm: r1(days.reduce((s, d) => s + d.actualKm, 0)),
    sessions: rows.filter((d) => d.planned && d.date <= today).length,
    done: rows.filter((d) => d.planned && d.status === 'done').length,
    longestKm: r1(Math.max(0, ...rows.map((d) => d.actualKm))),
    ctl: nowW?.ctl ?? undefined,
    atl: nowW?.atl ?? undefined,
    ctlPrev: lastWith((w) => w.id < from && w.ctl != null)?.ctl ?? undefined,
    hrv: avg(from, today),
    hrvPrev: avg(addDays(from, -7), addDays(from, -1)),
    nextWeekKm: r1(nextRows.reduce((s, d) => s + (d.plannedKm ?? 0), 0)),
    predictedSec: rd.predictedSec,
    shapePct: rd.vdot ? rd.shapePct : undefined,
  }
}

// ── ข้อมูลสนาม (พิกัด/เวลาปล่อยตัว) ───────────────────────────
export interface RaceInfo {
  name: string
  date: string
  distKm: number
  lat?: number
  lon?: number
  startTime: string
  climateTempC?: number
  climateHumidity?: number
}

export function raceInfo(cfg: CoachConfig): RaceInfo | null {
  if (!cfg.raceDate) return null
  const distKm = cfg.distKm ?? 21.1
  const cal = RACE_CALENDAR.find((r) => r.date === cfg.raceDate)
  const prof = cal ? RACE_PROFILES[cal.id] : undefined
  const fallback = distKm > 30 ? '03:00' : distKm > 15 ? '04:30' : '05:30'
  return {
    name: cfg.planName || cal?.name || 'วันแข่ง',
    date: cfg.raceDate,
    distKm,
    lat: prof?.lat,
    lon: prof?.lon,
    startTime: prof ? startTimeFor(prof, distKm, fallback) : fallback,
    climateTempC: prof?.climate.tempC,
    climateHumidity: prof?.climate.humidity,
  }
}

// ── พยากรณ์อากาศวันแข่ง (Open-Meteo, ได้ล่วงหน้าไม่เกิน ~16 วัน) ──
export interface RaceWeather {
  tempC: number
  humidity: number
  rainPct?: number
  tempEndC?: number
}

export async function raceWeather(info: RaceInfo): Promise<RaceWeather | null> {
  if (info.lat == null || info.lon == null) return null
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${info.lat}&longitude=${info.lon}` +
    `&hourly=temperature_2m,relative_humidity_2m,precipitation_probability&timezone=Asia%2FBangkok&start_date=${info.date}&end_date=${info.date}`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const j = (await res.json()) as { hourly?: { temperature_2m: number[]; relative_humidity_2m: number[]; precipitation_probability?: (number | null)[] } }
    const h = j.hourly
    if (!h?.temperature_2m?.length) return null
    const startH = Math.floor(parseHM(info.startTime) / 3600)
    const endH = Math.min(23, startH + Math.ceil((info.distKm / 10) * 1.1))
    const at = (i: number) => h.temperature_2m[Math.min(i, h.temperature_2m.length - 1)]
    const rains = (h.precipitation_probability ?? []).slice(startH, endH + 1).filter((x): x is number => x != null)
    return {
      tempC: r1(at(startH)),
      tempEndC: r1(at(endH)),
      humidity: Math.round(h.relative_humidity_2m[Math.min(startH, h.relative_humidity_2m.length - 1)]),
      rainPct: rains.length ? Math.max(...rains) : undefined,
    }
  } catch {
    return null
  }
}

// ── การ์ดเพซ (เส้นทางราบ + เจล) ────────────────────────────────
export interface PaceCard {
  targetSec: number
  avgPaceSec: number
  startTime: string
  splits: { km: number; elapsedSec: number; clockSec: number }[]
  gels: { km: number; elapsedSec: number; caffeine: boolean }[]
  rows: SplitRow[]
  heatPct?: number
}

export function flatSegments(distKm: number): Segment[] {
  const segs: Segment[] = []
  for (let k = 0; k < distKm - 1e-9; k++) {
    const end = Math.min(distKm, k + 1)
    segs.push({ index: k, startKm: k, endKm: end, lengthKm: end - k, eleStart: 0, eleEnd: 0, gainM: 0, lossM: 0, gradePct: 0 })
  }
  return segs
}

export function paceCard(info: RaceInfo, targetSec: number, weather?: RaceWeather | null): PaceCard {
  const start = parseHM(info.startTime)
  const pacing = computePacing(flatSegments(info.distKm), { targetSec, strategy: 'even', splitPct: 2, gapEnabled: false, gapStrength: 100 }, start)
  const rows = pacing.rows
  const marks: number[] = []
  for (let k = 5; k < info.distKm - 0.5; k += 5) marks.push(k)
  marks.push(info.distKm)
  const splits = marks.map((km) => {
    const row = rows.find((r) => r.km >= km - 1e-6) ?? rows[rows.length - 1]
    const prev = rows[row.index - 1]
    const frac = row.lengthKm > 0 ? (km - (prev?.km ?? 0)) / row.lengthKm : 1
    const elapsedSec = Math.round((prev?.elapsedSec ?? 0) + row.splitSec * frac)
    return { km, elapsedSec, clockSec: start + elapsedSec }
  })
  // เจล: ทุก 30 นาที เริ่มนาทีที่ 30 ไม่กินในช่วง 2 กม.สุดท้าย · คาเฟอีนครึ่งหลัง
  const gels: PaceCard['gels'] = []
  for (let m = 30; m * 60 < pacing.totalSec; m += 30) {
    const km = kmAtElapsed(rows, m * 60)
    if (km > info.distKm - 2) break
    gels.push({ km: r1(km), elapsedSec: m * 60, caffeine: km > info.distKm / 2 })
  }
  const heat = weather ? heatAdjustment(weather.tempC, weather.humidity, targetSec, info.distKm) : undefined
  return { targetSec, avgPaceSec: pacing.avgPaceSec, startTime: info.startTime, splits, gels, rows, heatPct: heat?.slowdownPct }
}

// ── สัปดาห์แข่ง ─────────────────────────────────────────────────
export function raceWeekTip(daysLeft: number, info: RaceInfo): { title: string; tips: string[] } {
  const wake = (() => {
    const s = parseHM(info.startTime) - 2.5 * 3600
    const t = (s + 86400) % 86400
    return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}`
  })()
  if (daysLeft > 7)
    return {
      title: 'ยังไม่ถึงสัปดาห์แข่ง',
      tips: ['ซ้อมตามตาราง เน้นวิ่งยาวให้ครบทุกสัปดาห์', 'ซ้อมกินเจลระหว่างวิ่งยาว ให้ท้องชินกับยี่ห้อที่จะใช้วันแข่ง', 'โหมดสัปดาห์แข่งจะส่งให้อัตโนมัติทุกเช้าตอนเหลือ 7 วัน'],
    }
  if (daysLeft >= 5)
    return {
      title: 'ช่วงลดระยะ (taper)',
      tips: ['ซ้อมตามตาราง ระยะลดลงแต่ยังมีช่วงเพซแข่งสั้น ๆ', 'นอนให้ได้ 7–9 ชม. ทุกคืน', 'ห้ามลองรองเท้า/เจล/อาหารใหม่', 'ดื่มน้ำสม่ำเสมอ ปัสสาวะสีเหลืองอ่อน'],
    }
  if (daysLeft >= 2)
    return {
      title: 'เติมคาร์บ',
      tips: ['เพิ่มสัดส่วนแป้งในทุกมื้อ (ข้าว ขนมปัง เส้น) ลดของมัน/ใยอาหารสูง', 'ดื่มน้ำ + เกลือแร่ วันละ 1–2 ขวด', 'เดินน้อยลง เลี่ยงยืนนาน ๆ', 'เช็กการ์ดเพซและจุดกินเจล'],
    }
  if (daysLeft === 1)
    return {
      title: 'พรุ่งนี้แข่ง!',
      tips: [
        `ตั้งปลุก ${wake} (ก่อนปล่อยตัว ~2.5 ชม.)`,
        'วางชุด: BIB + เข็มกลัด · เสื้อ/กางเกง · ถุงเท้า · รองเท้าคู่ที่ซ้อมยาวมาแล้ว',
        'นาฬิกาชาร์จเต็ม + ซิงก์ workout วันแข่ง',
        'เจลตามแผน + เจลสำรอง 1 ซอง · วาสลีน/เทปกันเสียดสี',
        'มื้อเย็นแป้งเยอะ ย่อยง่าย กินก่อน 19:00 แล้วนอนเร็ว',
      ],
    }
  return {
    title: 'วันแข่ง 🏁',
    tips: ['มื้อเช้าเบา ๆ 2–3 ชม. ก่อนปล่อยตัว (ขนมปัง/กล้วย)', 'วอร์ม 10 นาที + strides 2–3 เที่ยว', '3 กม.แรกคุมเพซ อย่าตามคนอื่น', 'กินเจลตามการ์ด แม้ยังไม่รู้สึกหิว'],
  }
}

// ── วิเคราะห์หลังแข่ง ───────────────────────────────────────────
export interface RaceReview {
  activityId: string
  date: string
  name: string
  distKm: number
  finishSec: number
  goalSec?: number
  kmSplits: number[] // วินาทีต่อกิโล
  firstHalfSec: number
  secondHalfSec: number
  splitPct: number // + = ครึ่งหลังช้ากว่า
  fastestKm: number
  slowestKm: number
  avgHr?: number
  vdot?: number
  offPlan: { km: number; diffSec: number }[] // กิโลที่ห่างแผนเกิน 10 วิ
  verdict: string[]
}

/** หา race activity: วันแข่ง (± 1 วันเผื่อวันที่คาดการณ์) และระยะ ≥ 85% */
export function findRaceActivity(acts: IcuActivity[], cfg: CoachConfig): IcuActivity | undefined {
  if (!cfg.raceDate) return undefined
  const dist = (cfg.distKm ?? 21.1) * 1000
  return acts
    .filter(isRun)
    .filter((a) => Math.abs(daysBetween(cfg.raceDate!, dateOf(a.start_date_local))) <= 1 && (a.distance ?? 0) >= dist * 0.85)
    .sort((a, b) => (b.distance ?? 0) - (a.distance ?? 0))[0]
}

export function kmSplitsFromStreams(time: number[], dist: number[]): number[] {
  const out: number[] = []
  let next = 1000
  let prevT = 0
  for (let i = 1; i < dist.length; i++) {
    const d0 = dist[i - 1]
    const d1 = dist[i]
    if (!Number.isFinite(d0) || !Number.isFinite(d1) || !Number.isFinite(time[i])) continue
    while (d1 >= next) {
      const f = d1 > d0 ? (next - d0) / (d1 - d0) : 1
      const t = time[i - 1] + f * (time[i] - time[i - 1])
      out.push(Math.round(t - prevT))
      prevT = t
      next += 1000
    }
  }
  return out
}

export function analyzeRace(a: IcuActivity, streams: Record<string, number[]>, cfg: CoachConfig, isRace: boolean): RaceReview {
  const time = streams.time ?? []
  const dist = streams.distance ?? []
  const km = kmSplitsFromStreams(time, dist)
  const distKm = r1((a.distance ?? dist[dist.length - 1] ?? 0) / 1000)
  const finishSec = Math.round(Number.isFinite(time[time.length - 1]) && time.length ? time[time.length - 1] : (a.moving_time ?? 0))
  const halfIdx = Math.floor(km.length / 2)
  const firstHalfSec = km.slice(0, halfIdx).reduce((s, x) => s + x, 0)
  const secondHalfSec = km.slice(halfIdx, halfIdx * 2).reduce((s, x) => s + x, 0)
  const splitPct = firstHalfSec > 0 ? r1(((secondHalfSec - firstHalfSec) / firstHalfSec) * 100) : 0
  const fastestKm = km.length ? km.indexOf(Math.min(...km)) + 1 : 0
  const slowestKm = km.length ? km.indexOf(Math.max(...km)) + 1 : 0
  const goalSec = isRace ? cfg.goalSec : undefined
  const goalPace = cfg.goalSec && cfg.distKm ? cfg.goalSec / cfg.distKm : undefined
  const offPlan = goalPace ? km.map((s, i) => ({ km: i + 1, diffSec: Math.round(s - goalPace) })).filter((x) => Math.abs(x.diffSec) > 10) : []
  const hr = (streams.heartrate ?? []).filter(Number.isFinite)
  const avgHr = a.average_heartrate ?? (hr.length ? Math.round(hr.reduce((s, x) => s + x, 0) / hr.length) : undefined)
  const vdot = a.distance && finishSec ? r1(vdotFrom(a.distance, finishSec)) : undefined

  const v: string[] = []
  if (goalSec) {
    const d = finishSec - goalSec
    v.push(d <= 0 ? `ทำได้ตามเป้า เร็วกว่าเป้า ${fmt(-d)} 🎉` : `ช้ากว่าเป้า ${fmt(d)}`)
  }
  if (splitPct <= -1) v.push(`ครึ่งหลังเร็วกว่าครึ่งแรก ${Math.abs(splitPct)}% (negative split) คุมเพซดีมาก`)
  else if (splitPct <= 2) v.push(`เพซสม่ำเสมอ ครึ่งหลังต่างจากครึ่งแรก ${splitPct}%`)
  else if (splitPct <= 5) v.push(`ครึ่งหลังช้าลง ${splitPct}% อาจออกตัวเร็วไปเล็กน้อย`)
  else v.push(`ครึ่งหลังช้าลง ${splitPct}% ออกตัวเร็วเกินไป ครั้งหน้าลอง 3 กม.แรกช้ากว่าเพซเป้า 5–10 วิ/กม.`)
  if (goalPace && km.length >= 3) {
    const early = km.slice(0, 3).reduce((s, x) => s + x, 0) / 3
    if (early < goalPace - 8) v.push(`3 กม.แรกเร็วกว่าเพซเป้า ${Math.round(goalPace - early)} วิ/กม.`)
  }
  if (km.length >= 6) {
    const tail = km.slice(-3).reduce((s, x) => s + x, 0) / 3
    const mid = km.slice(0, -3).reduce((s, x) => s + x, 0) / (km.length - 3)
    if (tail > mid * 1.06) v.push('3 กม.สุดท้ายช้าลงชัดเจน ควรเพิ่มวิ่งยาวที่ปิดท้ายด้วยเพซแข่ง')
    else if (tail < mid * 0.98) v.push('ปิดท้ายแรง แปลว่ายังมีแรงเหลือ เป้าครั้งหน้าตั้งเร็วขึ้นได้')
  }
  if (vdot) v.push(`VDOT จากผลนี้ ≈ ${vdot}`)
  return {
    activityId: a.id,
    date: dateOf(a.start_date_local),
    name: a.name ?? 'Run',
    distKm,
    finishSec,
    goalSec,
    kmSplits: km,
    firstHalfSec,
    secondHalfSec,
    splitPct,
    fastestKm,
    slowestKm,
    avgHr: avgHr ?? undefined,
    vdot,
    offPlan,
    verdict: v,
  }
}

function fmt(sec: number) {
  const s = Math.round(Math.abs(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`
}

export const REVIEW_PREFIX = 'rp-race-review-'

/** วิเคราะห์ผลแข่ง (หรือวิ่งยาวล่าสุดถ้ายังไม่ได้แข่ง) */
export async function reviewLatest(client: IntervalsClient, cfg: CoachConfig, acts: IcuActivity[]): Promise<{ review: RaceReview; isRace: boolean } | null> {
  const race = findRaceActivity(acts, cfg)
  const target =
    race ??
    acts
      .filter(isRun)
      .filter((a) => (a.distance ?? 0) >= 5000)
      .sort((a, b) => b.start_date_local.localeCompare(a.start_date_local))[0]
  if (!target) return null
  const streams = await client.activityStreams(target.id)
  return { review: analyzeRace(target, streams, cfg, !!race), isRace: !!race }
}

// ── รองเท้า ────────────────────────────────────────────────────
export const SHOES_EXTERNAL_ID = 'raceplan-shoes'
export const SHOES_DATE = '2020-01-02'

export interface Shoe {
  id: string
  name: string
  /** ระยะสะสมที่ปิดยอดแล้ว (กม.) */
  km: number
  /** เริ่มใส่คู่นี้เมื่อ (ISO) — มีเฉพาะคู่ที่ใช้อยู่ */
  activeSince?: string
  retired?: boolean
}
export interface ShoeStore {
  version: 1
  limitKm: number
  shoes: Shoe[]
}

export const emptyShoes = (): ShoeStore => ({ version: 1, limitKm: 700, shoes: [] })

export async function loadShoes(client: IntervalsClient): Promise<ShoeStore> {
  const { data } = await client.loadJson<ShoeStore>(SHOES_EXTERNAL_ID, SHOES_DATE)
  return data ?? emptyShoes()
}
export function saveShoes(client: IntervalsClient, s: ShoeStore) {
  return client.saveJson(SHOES_EXTERNAL_ID, SHOES_DATE, '👟 รองเท้า (คู่ซ้อม · อย่าลบ)', s, 'ระยะรองเท้าที่บอท LINE ใช้นับ')
}

const sinceKm = (acts: IcuActivity[], since: string) =>
  acts.filter(isRun).filter((a) => a.start_date_local >= since).reduce((s, a) => s + (a.distance ?? 0), 0) / 1000

export function shoeKm(shoe: Shoe, acts: IcuActivity[]): number {
  return r1(shoe.km + (shoe.activeSince ? sinceKm(acts, shoe.activeSince) : 0))
}

export const activeShoe = (s: ShoeStore) => s.shoes.find((x) => x.activeSince && !x.retired)

export function findShoe(s: ShoeStore, q: string): Shoe | undefined {
  const t = q.trim().toLowerCase()
  if (!t) return undefined
  return s.shoes.find((x) => x.name.toLowerCase() === t) ?? s.shoes.find((x) => x.name.toLowerCase().includes(t))
}

/** สลับคู่ที่ใช้: ปิดยอดคู่เดิมด้วยระยะจริงตั้งแต่เริ่มใส่ */
export function switchShoe(s: ShoeStore, to: Shoe, acts: IcuActivity[], nowIso: string): ShoeStore {
  const cur = activeShoe(s)
  if (cur && cur.id !== to.id) {
    cur.km = shoeKm(cur, acts)
    delete cur.activeSince
  }
  if (!to.activeSince) to.activeSince = nowIso
  to.retired = false
  return s
}

export function shoeWarnings(s: ShoeStore, acts: IcuActivity[]): string[] {
  const out: string[] = []
  for (const sh of s.shoes.filter((x) => !x.retired)) {
    const km = shoeKm(sh, acts)
    if (km >= s.limitKm) out.push(`👟 ${sh.name} ${km} กม. — เกิน ${s.limitKm} กม. แล้ว ควรเปลี่ยนคู่ใหม่`)
    else if (km >= s.limitKm * 0.85) out.push(`👟 ${sh.name} ${km} กม. — ใกล้ครบ ${s.limitKm} กม. เริ่มหาคู่ใหม่มาสลับ`)
  }
  return out
}

/** ช่วงวันที่ต้องโหลดกิจกรรมเพื่อนับระยะรองเท้า */
export function shoesOldest(s: ShoeStore, fallback: string): string {
  const xs = s.shoes.filter((x) => x.activeSince).map((x) => x.activeSince!.slice(0, 10))
  return xs.length ? xs.sort()[0] : fallback
}
