// ─────────────────────────────────────────────────────────────
// ดึงการนอนจาก Google Health (Fitbit / Pixel Watch) → เขียนลง wellness ของ Intervals.icu
// เพื่อให้แบตเตอรี่ร่างกาย/โค้ช AI/รายงาน ใช้การนอนจาก Google แทน Garmin
// API: https://health.googleapis.com/v4  ·  scope: googlehealth.sleep.readonly
// ─────────────────────────────────────────────────────────────
import type { IntervalsClient } from './intervals'
import { addDays } from '../engine/trainingEngine'

export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/googlehealth.sleep.readonly'
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API = 'https://health.googleapis.com/v4/users/me'

export interface GoogleCreds {
  clientId: string
  clientSecret: string
}

export function authUrl(c: GoogleCreds, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `${GOOGLE_AUTH_URL}?${q}`
}

async function tokenCall(body: Record<string, string>): Promise<{ access_token?: string; refresh_token?: string; error?: string; error_description?: string }> {
  const res = await fetch(GOOGLE_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) })
  return (await res.json()) as { access_token?: string; refresh_token?: string; error?: string; error_description?: string }
}

export async function exchangeCode(c: GoogleCreds, code: string, redirectUri: string) {
  const j = await tokenCall({ code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' })
  if (!j.access_token) throw new Error(`Google: ${j.error ?? 'no token'} ${j.error_description ?? ''}`.trim())
  return j
}

export async function accessToken(c: GoogleCreds, refreshToken: string): Promise<string> {
  const j = await tokenCall({ refresh_token: refreshToken, client_id: c.clientId, client_secret: c.clientSecret, grant_type: 'refresh_token' })
  if (!j.access_token) throw new Error(`Google: ${j.error ?? 'refresh failed'}${j.error === 'invalid_grant' ? ' (ต้องเชื่อมใหม่)' : ''}`)
  return j.access_token
}

async function gget<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
  const txt = await res.text()
  if (!res.ok) {
    if (txt.includes('ACCOUNT_NOT_LINKED')) throw new Error('บัญชี Google ยังไม่ได้ลิงก์กับแอป Google Health')
    throw new Error(`Google Health ${res.status}: ${txt.slice(0, 160)}`)
  }
  return JSON.parse(txt) as T
}

export const checkIdentity = (token: string) => gget<{ healthUserId?: string }>(token, '/identity')

// ── ข้อมูลการนอน ──
interface SleepPoint {
  sleep?: {
    interval?: { startTime?: string; endTime?: string; startUtcOffset?: string; endUtcOffset?: string; civilEndTime?: unknown }
    type?: string
    summary?: { minutesInSleepPeriod?: string | number; minutesAsleep?: string | number; minutesAwake?: string | number; minutesToFallAsleep?: string | number }
    metadata?: { mainSleep?: boolean }
  }
}

export interface NightSleep {
  date: string // วันที่ตื่น (เวลาท้องถิ่น)
  asleepMin: number
  inBedMin: number
  start: string // HH:MM ของการนอนหลัก
  end: string
  sessions: number
  /** เวลาจริง (epoch ms) ของการนอนหลัก */
  startMs?: number
  endMs?: number
  /** นาทีกว่าจะหลับ */
  latencyMin?: number
  /** งีบสั้น (< 90 นาที) ที่ไม่นับรวม */
  napMin?: number
}

const num = (v: unknown) => (v == null ? 0 : Number(v) || 0)
const offsetSec = (s?: string) => (s ? Number(String(s).replace('s', '')) || 0 : 7 * 3600)

/** วันที่ท้องถิ่นของเวลาตื่น */
function localDate(iso: string, off?: string): string {
  return new Date(Date.parse(iso) + offsetSec(off) * 1000).toISOString().slice(0, 10)
}
function localHM(iso: string, off?: string): string {
  return new Date(Date.parse(iso) + offsetSec(off) * 1000).toISOString().slice(11, 16)
}

/** รวมการนอนรายวัน (ตามวันตื่น): นับการนอนหลัก + ช่วงนอนอื่นที่ยาว ≥ 90 นาที (นอนแบ่งช่วงของคนทำงานเป็นกะ)
 *  งีบสั้นกว่า 90 นาทีแยกเป็น napMin */
export function nightsFrom(points: SleepPoint[]): NightSleep[] {
  const byDate = new Map<string, NonNullable<SleepPoint['sleep']>[]>()
  for (const p of points) {
    const s = p.sleep
    if (!s?.interval?.endTime || !s.interval.startTime) continue
    const d = localDate(s.interval.endTime, s.interval.endUtcOffset)
    byDate.set(d, [...(byDate.get(d) ?? []), s])
  }
  const out: NightSleep[] = []
  for (const [date, list] of byDate) {
    const main = list.find((s) => s.metadata?.mainSleep) ?? [...list].sort((a, b) => num(b.summary?.minutesAsleep) - num(a.summary?.minutesAsleep))[0]
    const blocks = list.filter((s) => s === main || num(s.summary?.minutesAsleep) >= 90)
    const naps = list.filter((s) => !blocks.includes(s))
    const asleepMin = blocks.reduce((a, s) => a + num(s.summary?.minutesAsleep), 0)
    const inBedMin = blocks.reduce((a, s) => a + (num(s.summary?.minutesInSleepPeriod) || num(s.summary?.minutesAsleep) + num(s.summary?.minutesAwake)), 0)
    if (asleepMin < 60) continue
    const lat = main.summary?.minutesToFallAsleep
    out.push({
      date,
      asleepMin,
      inBedMin,
      start: localHM(main.interval!.startTime!, main.interval!.startUtcOffset),
      end: localHM(main.interval!.endTime!, main.interval!.endUtcOffset),
      sessions: blocks.length,
      startMs: Date.parse(main.interval!.startTime!),
      endMs: Date.parse(main.interval!.endTime!),
      latencyMin: lat == null ? undefined : num(lat),
      napMin: naps.reduce((a, s) => a + num(s.summary?.minutesAsleep), 0) || undefined,
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

// ── เก็บประวัติการนอน 30 วัน (NOTE ใน Intervals — ใช้ร่วมกันระหว่างบอทกับงานอัตโนมัติ) ──
export const SLEEP_STORE_ID = 'raceplan-sleep'
export const SLEEP_STORE_DATE = '2020-01-03'
export interface SleepStore {
  version: 1
  updatedAt: string
  nights: NightSleep[]
}
export async function loadSleepStore(client: IntervalsClient): Promise<SleepStore | null> {
  const { data } = await client.loadJson<SleepStore>(SLEEP_STORE_ID, SLEEP_STORE_DATE)
  return data
}
export async function saveSleepStore(client: IntervalsClient, nights: NightSleep[]): Promise<SleepStore> {
  const prev = (await loadSleepStore(client))?.nights ?? []
  const map = new Map(prev.map((n) => [n.date, n]))
  for (const n of nights) map.set(n.date, n)
  const all = [...map.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-30)
  const store: SleepStore = { version: 1, updatedAt: new Date().toISOString(), nights: all }
  await client.saveJson(SLEEP_STORE_ID, SLEEP_STORE_DATE, '😴 การนอน (คู่ซ้อม · อย่าลบ)', store, 'ประวัติการนอนจาก Google Health 30 วันล่าสุด')
  return store
}

export async function fetchSleep(token: string, fromDate: string): Promise<NightSleep[]> {
  const points: SleepPoint[] = []
  let pageToken = ''
  for (let i = 0; i < 6; i++) {
    const q = new URLSearchParams({ filter: `sleep.interval.civil_end_time >= "${fromDate}"`, pageSize: '25' })
    if (pageToken) q.set('pageToken', pageToken)
    const j = await gget<{ dataPoints?: SleepPoint[]; nextPageToken?: string }>(token, `/dataTypes/sleep/dataPoints:reconcile?${q}`)
    points.push(...(j.dataPoints ?? []))
    if (!j.nextPageToken) break
    pageToken = j.nextPageToken
  }
  return nightsFrom(points)
}

/** เขียนลง wellness ของ Intervals (sleepScore ล้างเป็นว่าง เพราะ Google ไม่มีคะแนน — กันค่าของ Garmin ที่ไม่ตรงกัน) */
export async function pushNights(client: IntervalsClient, nights: NightSleep[]): Promise<number> {
  let n = 0
  for (const x of nights) {
    await client.updateWellness(x.date, { sleepSecs: x.asleepMin * 60, sleepScore: null })
    n++
  }
  return n
}

export async function syncSleep(client: IntervalsClient, creds: GoogleCreds, refreshToken: string, today: string, days = 4) {
  const token = await accessToken(creds, refreshToken)
  const nights = await fetchSleep(token, addDays(today, -days))
  const written = await pushNights(client, nights)
  const store = await saveSleepStore(client, nights)
  return { nights, written, store }
}

export function fmtNight(n: NightSleep): string {
  const h = Math.floor(n.asleepMin / 60)
  const m = n.asleepMin % 60
  const eff = n.inBedMin ? Math.round((n.asleepMin / n.inBedMin) * 100) : undefined
  return `${h} ชม. ${m} น. (${n.start}–${n.end}${eff ? ` · หลับจริง ${eff}%` : ''})`
}

/** ตรวจรูปแบบเวลา (ไม่คืนค่าเวลาจริง) — ใช้ debug เรื่อง timezone */
export async function sleepFormatProbe(token: string, fromDate: string) {
  const q = new URLSearchParams({ filter: `sleep.interval.civil_end_time >= "${fromDate}"`, pageSize: '3' })
  const j = await gget<{ dataPoints?: SleepPoint[] }>(token, `/dataTypes/sleep/dataPoints:reconcile?${q}`)
  const i = j.dataPoints?.[0]?.sleep?.interval as Record<string, unknown> | undefined
  if (!i) return { points: 0 }
  const st = String(i.startTime ?? '')
  return {
    points: j.dataPoints!.length,
    keys: Object.keys(i),
    startEndsZ: st.endsWith('Z'),
    startHasOffset: /[+-]\d\d:?\d\d$/.test(st),
    startLen: st.length,
    startUtcOffset: i.startUtcOffset ?? null,
    civilType: typeof i.civilStartTime,
    civilKeys: i.civilStartTime && typeof i.civilStartTime === 'object' ? Object.keys(i.civilStartTime as object) : null,
    utcHour: Number.isNaN(Date.parse(st)) ? null : new Date(Date.parse(st)).getUTCHours(),
  }
}
