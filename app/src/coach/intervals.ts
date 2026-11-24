// ─────────────────────────────────────────────────────────────
// Intervals.icu API client — ใช้ได้ทั้งในเบราว์เซอร์ (แอป) และ Node (งานบนคลาวด์)
// เอกสาร: https://intervals.icu/api-docs.html  · auth = Basic base64("API_KEY:<key>")
// ห้าม log ข้อมูลสุขภาพ/คีย์ — repo เป็นสาธารณะ log ของ GitHub Actions ก็สาธารณะ
// ─────────────────────────────────────────────────────────────
import type { CoachConfig, IcuActivity, IcuAthlete, IcuEvent, IcuWellness } from './types'

const BASE = 'https://intervals.icu/api/v1'
export const CONFIG_EXTERNAL_ID = 'raceplan-coach-config'
export const EXT_PREFIX = 'rp-'

function b64(s: string): string {
  if (typeof btoa === 'function') return btoa(s)
  return (globalThis as unknown as { Buffer: { from(s: string): { toString(enc: string): string } } }).Buffer.from(s).toString('base64')
}

export class IntervalsClient {
  private athleteId: string
  private apiKey: string
  constructor(athleteId: string, apiKey: string) {
    this.athleteId = athleteId
    this.apiKey = apiKey
  }

  private async req<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      method: init.method ?? 'GET',
      signal: init.signal,
      headers: {
        Authorization: 'Basic ' + b64(`API_KEY:${this.apiKey}`),
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
    if (res.status === 401 || res.status === 403) throw new Error('Intervals.icu ปฏิเสธ — เช็ก Athlete ID / API key')
    if (!res.ok) throw new Error(`Intervals.icu ${res.status}`)
    const text = await res.text()
    return (text ? JSON.parse(text) : null) as T
  }

  private get a() {
    return `/athlete/${encodeURIComponent(this.athleteId || '0')}`
  }

  athlete(signal?: AbortSignal) {
    return this.req<IcuAthlete>(this.a, { signal })
  }
  events(oldest: string, newest: string, signal?: AbortSignal) {
    return this.req<IcuEvent[]>(`${this.a}/events?oldest=${oldest}&newest=${newest}`, { signal })
  }
  activities(oldest: string, newest: string, signal?: AbortSignal) {
    return this.req<IcuActivity[]>(`${this.a}/activities?oldest=${oldest}&newest=${newest}`, { signal })
  }
  wellness(oldest: string, newest: string, signal?: AbortSignal) {
    return this.req<IcuWellness[]>(`${this.a}/wellness?oldest=${oldest}&newest=${newest}`, { signal })
  }
  /** สร้าง/อัปเดตหลายรายการ โดยใช้ external_id กันซ้ำ */
  upsertEvents(events: Partial<IcuEvent>[]) {
    return this.req<IcuEvent[]>(`${this.a}/events/bulk?upsert=true`, { method: 'POST', body: events })
  }
  updateEvent(id: number, patch: Partial<IcuEvent>) {
    return this.req<IcuEvent>(`${this.a}/events/${id}`, { method: 'PUT', body: patch })
  }
  deleteEvent(id: number) {
    return this.req<unknown>(`${this.a}/events/${id}`, { method: 'DELETE' })
  }
  /** สตรีมของกิจกรรม (เวลา/ระยะ/หัวใจ) — ใช้วิเคราะห์ split หลังแข่ง */
  async activityStreams(activityId: string, types = ['time', 'distance', 'heartrate']): Promise<Record<string, number[]>> {
    const raw = await this.req<{ type: string; data: (number | null)[] }[]>(`/activity/${encodeURIComponent(activityId)}/streams.json?types=${types.join(',')}`)
    const out: Record<string, number[]> = {}
    for (const s of raw ?? []) out[s.type] = (s.data ?? []).map((v) => (v == null ? NaN : v))
    return out
  }

  // ── ข้อมูล JSON ทั่วไป (เก็บเป็น NOTE ในปฏิทิน เช่น รองเท้า) ──
  async loadJson<T>(externalId: string, date: string): Promise<{ data: T | null; eventId?: number }> {
    const ev = await this.events(date, date)
    const hit = ev.find((e) => e.external_id === externalId)
    if (!hit?.description) return { data: null, eventId: hit?.id }
    const m = /```json\s*([\s\S]*?)```/.exec(hit.description)
    try {
      return { data: JSON.parse(m ? m[1] : hit.description) as T, eventId: hit.id }
    } catch {
      return { data: null, eventId: hit.id }
    }
  }
  saveJson(externalId: string, date: string, name: string, data: unknown, intro = '') {
    return this.upsertEvents([
      {
        external_id: externalId,
        category: 'NOTE',
        start_date_local: `${date}T00:00:00`,
        name,
        description: `${intro ? intro + '\n' : ''}\`\`\`json\n${JSON.stringify(data)}\n\`\`\``,
      },
    ])
  }

  // ── config (เก็บเป็น NOTE ในปฏิทิน) ──
  async loadConfig(): Promise<CoachConfig | null> {
    const ev = await this.events('2020-01-01', '2020-01-01')
    const hit = ev.find((e) => e.external_id === CONFIG_EXTERNAL_ID)
    if (!hit?.description) return null
    try {
      const m = /```json\s*([\s\S]*?)```/.exec(hit.description)
      return JSON.parse(m ? m[1] : hit.description) as CoachConfig
    } catch {
      return null
    }
  }
  saveConfig(cfg: CoachConfig) {
    return this.upsertEvents([
      {
        external_id: CONFIG_EXTERNAL_ID,
        category: 'NOTE',
        start_date_local: '2020-01-01T00:00:00',
        name: '⚙️ raceplan coach config (อย่าลบ)',
        description: 'ค่าตั้งค่าของแอปแผนวิ่ง ใช้ร่วมกับงานอัตโนมัติ\n```json\n' + JSON.stringify(cfg, null, 1) + '\n```',
      },
    ])
  }
}

/** ค่า LTHR / max HR จากการตั้งค่ากีฬา Run ใน Intervals.icu */
export function runHrSettings(a: IcuAthlete): { lthr?: number; maxHr?: number } {
  const s = a.sportSettings?.find((x) => x.types?.includes('Run'))
  return { lthr: s?.lthr ?? undefined, maxHr: s?.max_hr ?? undefined }
}
