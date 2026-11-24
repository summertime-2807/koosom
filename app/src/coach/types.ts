// ─────────────────────────────────────────────────────────────
// Coach types — ข้อมูลจาก Intervals.icu + ผลวิเคราะห์ของโค้ช
// ─────────────────────────────────────────────────────────────

export interface IcuEvent {
  id: number
  category: string // WORKOUT | NOTE | RACE_A | ...
  start_date_local: string // YYYY-MM-DDT00:00:00
  name?: string
  description?: string | null
  type?: string | null // Run
  distance?: number | null // m (แผน)
  moving_time?: number | null // s (แผน)
  icu_training_load?: number | null
  external_id?: string | null
  workout_doc?: { distance?: number; duration?: number } | null
}

export interface IcuActivity {
  id: string
  start_date_local: string
  type?: string
  name?: string
  distance?: number | null // m
  moving_time?: number | null // s
  icu_training_load?: number | null
  average_heartrate?: number | null
  paired_event_id?: number | null
}

export interface IcuWellness {
  id: string // YYYY-MM-DD
  ctl?: number | null
  atl?: number | null
  restingHR?: number | null
  hrv?: number | null
  sleepSecs?: number | null
  sleepScore?: number | null
  injury?: number | null
}

export interface IcuAthlete {
  id: string
  name?: string
  sportSettings?: { types?: string[]; lthr?: number | null; max_hr?: number | null; threshold_pace?: number | null }[]
}

/** ค่าตั้งค่าโค้ช — เก็บเป็น NOTE ใน Intervals.icu ให้ทั้งแอปและงานบนคลาวด์อ่านค่าเดียวกัน */
export interface CoachConfig {
  version: 1
  planName: string
  /** ช่วงแผนที่แอปดูแล */
  from: string
  to: string
  raceDate?: string
  goalSec?: number
  distKm?: number
  lthr: number
  maxHr: number
  restHr?: number
  /** วันที่เริ่มให้งานอัตโนมัติปรับตาราง */
  autoAdjust: boolean
  /** เป้าการนอนต่อวัน (นาที) — ค่าเริ่มต้น 450 = 7.5 ชม. */
  sleepTargetMin?: number
}

export type Light = 'green' | 'yellow' | 'red' | 'none'

export interface BatteryItem {
  key: 'hrv' | 'rhr' | 'sleep' | 'form' | 'ramp'
  label: string
  value: string
  light: Light
  why: string
}

export type DayStatus = 'done' | 'partial' | 'missed' | 'extra' | 'planned' | 'rest'

export interface DayRow {
  date: string
  planned?: IcuEvent
  plannedKm?: number
  kind?: 'long' | 'quality' | 'easy' | 'race' | 'other'
  actual: IcuActivity[]
  actualKm: number
  status: DayStatus
}

export interface Adjustment {
  /** ลบ/แก้ event ในอนาคต */
  action: 'delete' | 'update'
  eventId: number
  date: string
  patch?: Partial<IcuEvent>
  note: string // 🔧 เหตุผล
}

export interface CoachQuestion {
  id: string
  date: string
  text: string
  /** ข้อเสนอ (ถ้าตอบตกลงจะทำ) */
  proposal?: Adjustment[]
}

export interface Readiness {
  shapePct: number // ความพร้อมมาราธอน (%)
  vdot?: number
  predictedSec?: number
  weeklyKmAvg: number
  longestKm: number
  requiredWeeklyKm?: number
  requiredLongKm?: number
}

export interface CoachReport {
  date: string
  battery: BatteryItem[]
  overall: Light
  days: DayRow[]
  adjustments: Adjustment[]
  questions: CoachQuestion[]
  readiness: Readiness
  summary: string
  weekly?: string
}
