// ─────────────────────────────────────────────────────────────
// Storage service — abstraction เหนือ localStorage
// ทุกการเข้าถึงข้อมูลผ่าน interface RaceStorage เพื่อย้ายไป Supabase ได้ง่าย
// (เขียน SupabaseStorage ที่ implement interface เดียวกัน แล้วสลับใน getStorage())
// ─────────────────────────────────────────────────────────────
import type { BackupFile, CalendarRace, RacePlan } from '../types/race'

export interface RaceStorage {
  listPlans(): Promise<RacePlan[]>
  getPlan(id: string): Promise<RacePlan | undefined>
  savePlan(plan: RacePlan): Promise<void>
  deletePlan(id: string): Promise<void>
  getActivePlanId(): Promise<string | undefined>
  setActivePlanId(id: string): Promise<void>
  listCustomRaces(): Promise<CalendarRace[]>
  saveCustomRaces(races: CalendarRace[]): Promise<void>
  exportAll(): Promise<BackupFile>
  importAll(data: unknown, mode: 'merge' | 'replace'): Promise<{ plans: number; races: number }>
}

const K = {
  plans: 'rp.plans.v1',
  active: 'rp.active.v1',
  races: 'rp.customRaces.v1',
}

/** in-memory fallback เมื่อ localStorage ใช้ไม่ได้ (เช่น private mode / sandbox) */
const mem = new Map<string, string>()
function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key) ?? mem.get(key) ?? null
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    const raw = mem.get(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  }
}
function write(key: string, value: unknown) {
  const raw = JSON.stringify(value)
  mem.set(key, raw)
  try {
    window.localStorage.setItem(key, raw)
  } catch {
    /* quota / unavailable -> keep in memory */
  }
}

function isPlan(x: unknown): x is RacePlan {
  const p = x as RacePlan
  return !!p && typeof p.id === 'string' && !!p.meta && !!p.route && Array.isArray(p.route.pts) && !!p.pacing && !!p.fueling
}
function isRace(x: unknown): x is CalendarRace {
  const r = x as CalendarRace
  return !!r && typeof r.id === 'string' && typeof r.name === 'string'
}

export class LocalStorageRaceStorage implements RaceStorage {
  async listPlans() {
    return read<RacePlan[]>(K.plans, []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
  async getPlan(id: string) {
    return read<RacePlan[]>(K.plans, []).find((p) => p.id === id)
  }
  async savePlan(plan: RacePlan) {
    const all = read<RacePlan[]>(K.plans, [])
    const i = all.findIndex((p) => p.id === plan.id)
    const next = { ...plan, updatedAt: new Date().toISOString() }
    if (i >= 0) all[i] = next
    else all.push(next)
    write(K.plans, all)
  }
  async deletePlan(id: string) {
    write(K.plans, read<RacePlan[]>(K.plans, []).filter((p) => p.id !== id))
  }
  async getActivePlanId() {
    return read<string | undefined>(K.active, undefined)
  }
  async setActivePlanId(id: string) {
    write(K.active, id)
  }
  async listCustomRaces() {
    return read<CalendarRace[]>(K.races, [])
  }
  async saveCustomRaces(races: CalendarRace[]) {
    write(K.races, races)
  }
  async exportAll(): Promise<BackupFile> {
    return {
      app: 'raceplan-byo-gpx',
      version: 1,
      exportedAt: new Date().toISOString(),
      plans: await this.listPlans(),
      customRaces: await this.listCustomRaces(),
    }
  }
  async importAll(data: unknown, mode: 'merge' | 'replace') {
    const d = data as Partial<BackupFile>
    if (!d || d.app !== 'raceplan-byo-gpx') throw new Error('ไฟล์สำรองไม่ถูกต้อง (ไม่ใช่ไฟล์ของแอปนี้)')
    const plans = (d.plans ?? []).filter(isPlan)
    const races = (d.customRaces ?? []).filter(isRace)
    if (mode === 'replace') {
      write(K.plans, plans)
      write(K.races, races)
    } else {
      const byId = new Map(read<RacePlan[]>(K.plans, []).map((p) => [p.id, p]))
      plans.forEach((p) => byId.set(p.id, p))
      write(K.plans, [...byId.values()])
      const rById = new Map(read<CalendarRace[]>(K.races, []).map((r) => [r.id, r]))
      races.forEach((r) => rById.set(r.id, r))
      write(K.races, [...rById.values()])
    }
    return { plans: plans.length, races: races.length }
  }
}

let instance: RaceStorage | undefined
export function getStorage(): RaceStorage {
  // TODO(Supabase): return new SupabaseRaceStorage(client) เมื่อพร้อมย้าย
  return (instance ??= new LocalStorageRaceStorage())
}
