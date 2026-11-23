// ─────────────────────────────────────────────────────────────
// Core domain types — Personal Race Pace, Elevation & Fueling Planner
// หน่วยภายใน: ระยะทาง = เมตร (m) / กิโลเมตร (km) ระบุในชื่อฟิลด์, เวลา = วินาที (sec)
// ─────────────────────────────────────────────────────────────

/** จุดบนเส้นทางหลังคำนวณระยะสะสมแล้ว */
export interface TrackPoint {
  lat: number
  lon: number
  /** ความสูงดิบจาก GPX (m) */
  ele: number
  /** ความสูงหลังกรองสัญญาณรบกวน (m) */
  eleSmooth: number
  /** ระยะสะสมจากจุดสตาร์ท (m) */
  distM: number
}

/** ช่วง 1 กม. (ช่วงสุดท้ายอาจสั้นกว่า 1 กม.) */
export interface Segment {
  index: number // 0-based
  startKm: number
  endKm: number
  lengthKm: number
  eleStart: number
  eleEnd: number
  gainM: number
  lossM: number
  /** ความชันเฉลี่ย (%) = (eleEnd - eleStart) / length */
  gradePct: number
}

export interface RouteAnalysis {
  name: string
  points: TrackPoint[]
  totalDistanceKm: number
  gainM: number
  lossM: number
  minEle: number
  maxEle: number
  hasElevation: boolean
  segments: Segment[]
  /** จุด waypoint ที่ฝังมากับไฟล์ GPX (<wpt>) */
  gpxWaypoints: { name: string; km: number }[]
}

/** เส้นทางแบบย่อสำหรับเก็บลง storage: [lat, lon, ele][] */
export interface StoredRoute {
  name: string
  source: 'sample' | 'upload' | 'generated'
  pts: [number, number, number][]
  gpxWaypoints?: { name: string; km: number }[]
}

// ── Waypoints / Aid stations ─────────────────────────────────
export type WaypointType = 'water' | 'electrolyte' | 'food' | 'toilet' | 'uturn' | 'hill'

export interface Waypoint {
  id: string
  km: number
  type: WaypointType
  label?: string
}

// ── Race meta & pacing ───────────────────────────────────────
export interface RaceMeta {
  name: string
  /** YYYY-MM-DD */
  date: string
  /** HH:MM */
  startTime: string
  distanceLabel?: string
  /** id ของงานในปฏิทิน (ถ้าสร้างจากปฏิทิน) */
  raceId?: string
}

export type SplitStrategy = 'even' | 'negative' | 'positive'

export interface PacingConfig {
  /** เวลาเป้าหมาย (วินาที) */
  targetSec: number
  strategy: SplitStrategy
  /** ส่วนต่างครึ่งแรก/ครึ่งหลัง (%) เช่น 3 = ครึ่งหลังเร็วกว่า 3% (negative) */
  splitPct: number
  /** ปรับเพซตามความชัน (GAP) */
  gapEnabled: boolean
  /** ความแรงของการปรับ GAP 0–150 (%) ค่าเริ่มต้น 100 */
  gapStrength: number
  /** อุณหภูมิที่คาด (°C) — ว่าง = ไม่ใช้ */
  tempC?: number
  /** ความชื้นสัมพัทธ์ (%) */
  humidity?: number
}

export interface SplitRow {
  index: number
  km: number // ระยะปลายช่วง (km)
  lengthKm: number
  gainM: number
  lossM: number
  gradePct: number
  /** เพซ (วินาที/กม.) */
  paceSec: number
  /** เวลาของช่วง (วินาที, จำนวนเต็ม) */
  splitSec: number
  /** เวลาสะสม (วินาที) */
  elapsedSec: number
  /** เวลานาฬิกา (วินาทีนับจากเที่ยงคืน) */
  clockSec: number
  waypoints: Waypoint[]
  gels: GelEvent[]
}

export interface PacingResult {
  rows: SplitRow[]
  totalSec: number
  avgPaceSec: number
  /** ข้อมูลประเมินผลจากอากาศร้อน/ชื้น */
  heat?: HeatAdjustment
}

export interface HeatAdjustment {
  /** ดัชนี อุณหภูมิ(°F) + จุดน้ำค้าง(°F) */
  index: number
  dewPointC: number
  /** % ที่ควรช้าลง (ช่วงกลางของคำแนะนำ) */
  slowdownPct: number
  level: 'none' | 'low' | 'moderate' | 'high' | 'extreme'
  adjustedTargetSec: number
  adjustedPaceSec: number
}

// ── Fueling ──────────────────────────────────────────────────
export interface GelItem {
  id: string
  name: string
  carbsG: number
  sodiumMg: number
  caffeine: boolean
}

export interface FuelingConfig {
  mode: 'time' | 'distance'
  /** ทุก X นาที หรือ ทุก X กม. */
  interval: number
  /** เจลแรกที่นาที/กม. ที่ (ค่าเริ่มต้น = interval) */
  firstAt: number
  /** ไม่กินเจลในช่วงท้าย X กม. */
  stopBeforeFinishKm: number
  gels: GelItem[]
  /** ใช้เจลคาเฟอีนเฉพาะครึ่งหลัง */
  caffeineSecondHalf: boolean
  /** กินเจลก่อนปล่อยตัว 15 นาที */
  preStartGel: boolean
  snapEnabled: boolean
  /** ระยะสูงสุดที่ยอมเลื่อนไปหาจุดน้ำ (km) */
  snapThresholdKm: number
  /** กินก่อนถึงจุดน้ำ (m) — แนะนำ 200–300 */
  snapOffsetM: number
}

export interface GelEvent {
  n: number
  km: number
  originalKm: number
  elapsedSec: number
  clockSec: number
  gel: GelItem
  snappedToId?: string
  preStart?: boolean
}

export interface FuelingSummary {
  events: GelEvent[]
  totalGels: number
  totalCarbsG: number
  carbsPerHour: number
  totalSodiumMg: number
  caffeineCount: number
}

// ── Plans & archive ──────────────────────────────────────────
export interface PostRaceLog {
  shoes: string
  /** HH:MM:SS */
  actualFinish: string
  avgHr?: number
  notes: string
}

export interface RacePlan {
  id: string
  version: 1
  meta: RaceMeta
  route: StoredRoute
  waypoints: Waypoint[]
  pacing: PacingConfig
  fueling: FuelingConfig
  postRace: PostRaceLog
  /** ข้อมูลสำหรับตารางซ้อม (ไม่บังคับ — แผนเก่าไม่มีฟิลด์นี้) */
  training?: TrainingState
  createdAt: string
  updatedAt: string
}

// ── Race calendar ────────────────────────────────────────────
export interface CalendarRace {
  id: string
  name: string
  /** YYYY-MM-DD (ถ้ามี) */
  date?: string
  /** วันที่แบบข้อความเมื่อไม่ทราบแน่ชัด */
  dateText?: string
  location?: string
  distancesKm: number[]
  organizer?: string
  source: string
  url: string
  custom?: boolean
  /** เปิดรับสมัครอยู่ (จาก race.thai.run) */
  regOpen?: boolean
}

export interface BackupFile {
  app: 'raceplan-byo-gpx'
  version: 1
  exportedAt: string
  plans: RacePlan[]
  customRaces: CalendarRace[]
}

// ── Training plan ────────────────────────────────────────────
export type Experience = 'new' | 'regular' | 'experienced'

export interface TrainingInput {
  /** ระยะวิ่งต่อสัปดาห์ช่วงนี้ (กม.) */
  weeklyKm: number
  /** วิ่งยาวสุดใน 4 สัปดาห์ที่ผ่านมา (กม.) */
  longestRunKm: number
  /** วิ่งกี่วัน/สัปดาห์ (3–6) */
  runsPerWeek: number
  experience: Experience
  /** ผลแข่ง/ไทม์ทดสอบล่าสุด (ใช้ประเมินเป้า) */
  recentRaceKm?: number
  recentRaceSec?: number
}

export interface TrainingState {
  input: TrainingInput
  aiProvider?: 'claude' | 'gemini'
  aiAnalysis?: string
  aiAt?: string
}

export type WorkoutType = 'rest' | 'easy' | 'long' | 'tempo' | 'interval' | 'hill' | 'race-pace' | 'shakeout' | 'race'

export interface Workout {
  /** YYYY-MM-DD */
  date: string
  dow: number // 0=อา. … 6=ส.
  type: WorkoutType
  title: string
  detail: string
  km: number
  pace?: string
  tags?: string[]
  /** โครงสร้างสำหรับส่งเข้านาฬิกา */
  struct?: WorkoutStruct
}

export interface WorkoutStruct {
  wuKm?: number
  cdKm?: number
  /** ช่วงหลักแบบเป็นเซ็ต */
  reps?: number
  repKm?: number
  repSec?: number
  recSec?: number
  /** ช่วงหลักต่อเนื่อง */
  blockKm?: number
  blockMin?: number
  /** เป้าหมายช่วงหลัก */
  target: 'easy' | 'long' | 'tempo' | 'interval' | 'hill' | 'race' | 'marathon'
  /** วิ่งยาวที่ปิดท้ายด้วยเพซแข่ง (กม.) */
  finishRpKm?: number
}

export type Phase = 'base' | 'build' | 'peak' | 'taper' | 'race'

export interface TrainingWeek {
  index: number
  startDate: string
  phase: Phase
  km: number
  longKm: number
  cutback: boolean
  focus: string
  workouts: Workout[]
}

export interface TrainingPaces {
  goal: number
  easy: [number, number]
  long: [number, number]
  marathon: number
  threshold: number
  interval: number
}

export interface Feasibility {
  level: 'ok' | 'stretch' | 'risky' | 'unknown'
  predictedSec?: number
  gapPct?: number
  messages: string[]
}

export interface TrainingPlan {
  weeks: TrainingWeek[]
  paces: TrainingPaces
  feasibility: Feasibility
  raceSpecific: string[]
  totalKm: number
  peakKm: number
  daysToRace: number
}

// ── Race profile (ข้อมูลสนามจากปีที่ผ่านมา) ────────────────
export type CourseType = 'flat' | 'bridges' | 'rolling' | 'hilly' | 'trail'

export interface PastEdition {
  year: number
  date?: string
  note: string
}

export interface RaceProfile {
  raceId: string
  lat: number
  lon: number
  /** เวลาปล่อยตัวตามระยะ เช่น { '42.195': '02:00', '21.1': '02:15' } */
  startTimes: Record<string, string>
  cutoffs?: Record<string, string>
  course: CourseType
  courseNotes: string[]
  climate: { tempC: number; humidity: number; note: string; estimated?: boolean }
  pastEditions: PastEdition[]
  stats: string[]
  sources: { title: string; url: string }[]
  dataLevel: 'good' | 'partial' | 'minimal'
}

export interface WeatherYear {
  year: number
  date: string
  startTempC: number
  endTempC: number
  startRh: number
  endRh: number
  dewC: number
  rainMm: number
  windKmh: number
}
