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
