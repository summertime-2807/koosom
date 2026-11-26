// ─────────────────────────────────────────────────────────────
// 🏸 โหมดแบดมินตัน — ตารางฝึก · ภาระสะสม (ACWR) · กันบาดเจ็บ · เตรียมแข่ง
// ใช้ได้กับ Apple Watch (ผ่าน HealthFit → Intervals) หรือบันทึกเองใน LINE
// ─────────────────────────────────────────────────────────────
import type { IcuActivity, IcuEvent } from './types'
import { addDays, daysBetween, dowOf, mondayOf } from '../engine/trainingEngine'

export type BLevel = 'casual' | 'improve' | 'compete'
export type SlotKind = 'court' | 'footwork' | 'strength' | 'conditioning' | 'mobility'

export interface BTournament {
  date: string
  name: string
}
export interface BLog {
  id: string
  date: string
  minutes: number
  rpe: number
  kind: 'court' | 'train' | 'match'
  /** ผูกกับกิจกรรมจากนาฬิกา (ถ้ามี) */
  activityId?: string
}
export interface BStore {
  version: 1
  level: BLevel
  /** วันลงคอร์ด (0=อา. … 6=ส.) */
  courtDays: number[]
  courtMin: number
  /** วันฝึกเสริมต่อสัปดาห์ (นอกคอร์ด) */
  extraDays: number
  tournaments: BTournament[]
  logs: BLog[]
  /** คะแนนความเหนื่อยของกิจกรรมจากนาฬิกา */
  rpeByActivity: Record<string, number>
  setupDone: boolean
}

export const defaultBStore = (): BStore => ({
  version: 1,
  level: 'improve',
  courtDays: [],
  courtMin: 90,
  extraDays: 2,
  tournaments: [],
  logs: [],
  rpeByActivity: {},
  setupDone: false,
})

export const LEVEL_TH: Record<BLevel, string> = { casual: 'เล่นก๊วน/สุขภาพ', improve: 'อยากเก่งขึ้น', compete: 'ลงแข่ง' }
export const DOW_SHORT = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.']

// ── คลังท่า ──
export const WARMUP = [
  'เดิน/จ็อกเบา ๆ หรือกระโดดเชือก 3 นาที',
  'หมุนแขน หมุนไหล่ หน้า-หลัง 10 รอบ',
  'เหวี่ยงขาหน้า-หลัง และข้าง ข้างละ 10',
  'ลันจ์ + บิดตัว เดิน 8 ก้าว',
  'สไลด์ข้าง (side shuffle) ซ้าย-ขวา 2 เที่ยว',
  'Split-step กระโดดเตรียมรับ 10 ครั้ง',
  'สวิงไม้เปล่า (shadow) ทั้ง forehand/backhand 1 นาที',
]
export const COOLDOWN = [
  'เดินช้า ๆ 2–3 นาที ให้หัวใจลง',
  'ยืดน่อง (ดันกำแพง) ข้างละ 30 วิ',
  'ยืดต้นขาหน้า + สะโพกด้านหน้า (hip flexor) ข้างละ 30 วิ',
  'ยืดต้นขาหลัง ข้างละ 30 วิ',
  'ยืดไหล่ข้ามลำตัว + ยืดหลังแขน ข้างละ 30 วิ',
  'ยืดปลายแขน/ข้อมือ คว่ำ-หงาย ข้างละ 20 วิ',
]

interface Drill {
  title: string
  min: number
  items: string[]
}
const FOOTWORK: Drill = {
  title: 'ฟุตเวิร์ก & ความคล่อง',
  min: 25,
  items: ['วอร์มอัพ 8 นาที', 'Shadow 6 มุมคอร์ด: 40 วิ เต็มที่ / พัก 40 วิ × 6', 'Split-step + ออกตัวไปหน้าเน็ต 10 ครั้ง × 2', 'Chassé ถอยหลังไปมุมหลัง 8 ครั้ง × 2', 'บันไดเชือก/เส้นบนพื้น เท้าเร็ว 20 วิ × 4', 'คูลดาวน์ + ยืด 5 นาที'],
}
const CONDITIONING: Drill = {
  title: 'ฟิตเนสแบบแบด (อินเทอร์วัล)',
  min: 25,
  items: ['วอร์มอัพ 8 นาที', 'Shadow footwork 30 วิ เร็วสุด / พัก 30 วิ × 10', 'พัก 2 นาที', 'กระโดดตบ (jump smash shadow) 10 ครั้ง × 3', 'คูลดาวน์ + ยืด 5 นาที'],
}
const STRENGTH_A: Drill = {
  title: 'เวทขา + แกนกลาง',
  min: 30,
  items: ['Squat 3×12', 'Reverse lunge 3×10/ข้าง', 'Single-leg RDL 3×8/ข้าง (กันเข่า-ข้อเท้า)', 'Calf raise ขาเดียว 3×15 (กันเอ็นร้อยหวาย)', 'Lateral band walk 3×12 ก้าว', 'Plank 3×40 วิ · Side plank 2×30 วิ/ข้าง'],
}
const STRENGTH_B: Drill = {
  title: 'เวทไหล่ + แขน + กันเจ็บ',
  min: 30,
  items: ['ยางยืดหมุนไหล่ออก (external rotation) 3×15/ข้าง', 'Y-T-W คว่ำบนเตียง/ม้านั่ง 2×8 แต่ละท่า', 'Push-up 3×10', 'Row ดึงยางยืด 3×12', 'ข้อมือ: งอ-เหยียด ถือขวดน้ำ 2×15', 'Dead bug 3×10'],
}
const MOBILITY: Drill = {
  title: 'ยืดเหยียด & ความยืดหยุ่น',
  min: 15,
  items: ['สะโพก 90/90 ข้างละ 1 นาที', 'บิดอกช่วงบน (open book) ข้างละ 8', 'ข้อเท้า: ดันเข่าเข้ากำแพง ข้างละ 10', 'ไหล่: sleeper stretch ข้างละ 30 วิ', 'น่อง + ต้นขาหลัง ข้างละ 30 วิ'],
}

const COURT_FOCUS = ['ฟุตเวิร์ก 4 มุม + split-step ทุกลูก', 'เกมหน้าเน็ต (net kill/net shot)', 'ตบ + เดินเท้ากลับกลางคอร์ด', 'รับลูกตบ / ป้องกัน', 'แรลลี่ยาว คุมเกม ไม่เสียง่าย']

export interface BSlot {
  date: string
  kind: SlotKind
  name: string
  min: number
  items: string[]
}

const isTaper = (d: string, ts: BTournament[]) => ts.find((t) => t.date >= d && daysBetween(d, t.date) <= 7)

/** สร้างตารางฝึก n สัปดาห์ เริ่มจากวันจันทร์ของ from */
export function planBadminton(s: BStore, from: string, weeks = 4): BSlot[] {
  const out: BSlot[] = []
  const start = mondayOf(from)
  for (let w = 0; w < weeks; w++) {
    const monday = addDays(start, w * 7)
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
    const court = days.filter((d) => s.courtDays.includes(dowOf(d)))
    // ลงคอร์ด
    court.forEach((d, i) => {
      const t = isTaper(d, s.tournaments)
      const left = t ? daysBetween(d, t.date) : 99
      if (t && left === 0) return // วันแข่ง (ใส่แยก)
      const focus = s.level === 'casual' ? 'สนุก + เล่นให้ครบ ไม่ฝืนลูกที่เจ็บ' : COURT_FOCUS[(w * 2 + i) % COURT_FOCUS.length]
      const min = t && left <= 2 ? Math.min(60, s.courtMin) : s.courtMin
      out.push({
        date: d,
        kind: 'court',
        name: `🏸 ลงคอร์ด ${min} นาที${t && left <= 3 ? ' (เบา ก่อนแข่ง)' : ''}`,
        min,
        items: ['วอร์มอัพ 8–10 นาทีก่อนลง (พิมพ์ "วอร์ม")', `โฟกัสวันนี้: ${t && left <= 3 ? 'ตีเบา ๆ ให้มือคุ้น ไม่เล่นจนหมดแรง' : focus}`, 'ดื่มน้ำทุกเกม · เกิน 90 นาทีจิบเกลือแร่', 'จบแล้วคูลดาวน์ + ยืด 5 นาที (พิมพ์ "คูลดาวน์")'],
      })
    })
    // วันฝึกเสริม: ไม่ใช่วันคอร์ด · เลี่ยงวันก่อนคอร์ดสำหรับงานขาหนัก
    const free = days.filter((d) => !s.courtDays.includes(dowOf(d)))
    const want: SlotKind[] =
      s.level === 'casual' ? ['strength', 'mobility'] : s.level === 'improve' ? ['footwork', 'strength', 'mobility'] : ['footwork', 'strength', 'conditioning', 'mobility', 'strength']
    const n = Math.min(free.length - 1, Math.max(1, s.extraDays) + 1) // +1 = mobility เบา ๆ · เหลือพักอย่างน้อย 1 วัน
    const kinds = want.slice(0, Math.max(1, n))
    // ระดับแข่ง: ยืดเหยียดอยู่ในคูลดาวน์อยู่แล้ว ใส่เป็นวันแยกเมื่อมีที่ว่างพอ
    if (!kinds.includes('mobility') && n >= 2 && s.level !== 'compete') kinds[kinds.length - 1] = 'mobility'
    const used = new Set<string>()
    let strengthCount = 0
    for (const k of kinds) {
      const heavyLegs = k === 'footwork' || k === 'conditioning' || (k === 'strength' && strengthCount === 0)
      const pick =
        free.find((d) => !used.has(d) && (!heavyLegs || !s.courtDays.includes(dowOf(addDays(d, 1))))) ?? free.find((d) => !used.has(d))
      if (!pick) break
      used.add(pick)
      const t = isTaper(pick, s.tournaments)
      const left = t ? daysBetween(pick, t.date) : 99
      if (t && left <= 4 && (k === 'strength' || k === 'conditioning')) continue // ช่วงก่อนแข่ง: ตัดเวท/อินเทอร์วัล
      const drill = k === 'footwork' ? FOOTWORK : k === 'conditioning' ? CONDITIONING : k === 'mobility' ? MOBILITY : strengthCount++ % 2 === 0 ? STRENGTH_A : STRENGTH_B
      const short = t && left <= 3 && k === 'footwork'
      out.push({
        date: pick,
        kind: k,
        name: `${k === 'footwork' ? '👟' : k === 'conditioning' ? '🔥' : k === 'mobility' ? '🧘' : '💪'} ${drill.title}${short ? ' (สั้น ก่อนแข่ง)' : ''} ${short ? 15 : drill.min} นาที`,
        min: short ? 15 : drill.min,
        items: short ? ['วอร์มอัพ 8 นาที', 'Shadow 6 มุม: 20 วิ เร็ว / พัก 40 วิ × 4 (ไวแต่ไม่เหนื่อย)'] : drill.items,
      })
    }
  }
  // วันแข่ง
  for (const t of s.tournaments.filter((x) => x.date >= start && x.date < addDays(start, weeks * 7))) {
    out.push({ date: t.date, kind: 'court', name: `🏆 แข่ง: ${t.name}`, min: 0, items: matchDayTips() })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

export const B_EXT_PREFIX = 'bd-'
export function slotToEvent(s: BSlot): Partial<IcuEvent> {
  return {
    external_id: `${B_EXT_PREFIX}${s.date}-${s.kind}`,
    category: 'WORKOUT',
    type: s.kind === 'strength' ? 'WeightTraining' : 'Workout',
    start_date_local: `${s.date}T00:00:00`,
    name: s.name,
    moving_time: s.min * 60,
    description: s.items.map((x) => `• ${x}`).join('\n'),
  }
}

// ── ภาระการฝึก (session-RPE × นาที) + ACWR ──
export interface BSession {
  date: string
  minutes: number
  rpe: number
  load: number
  source: 'watch' | 'log'
  name: string
  activityId?: string
  rated: boolean
}

/** ประมาณความเหนื่อยจากหัวใจเฉลี่ย ถ้ายังไม่ได้ให้คะแนน */
export function estRpe(avgHr: number | null | undefined, maxHr: number): number {
  if (!avgHr) return 5
  const p = avgHr / maxHr
  return Math.max(2, Math.min(9, Math.round(p * 14 - 4)))
}

export function sessionsFrom(acts: IcuActivity[], s: BStore, maxHr: number): BSession[] {
  const out: BSession[] = []
  const usedLogs = new Set<string>()
  for (const a of acts) {
    const min = Math.round((a.moving_time ?? 0) / 60)
    if (min < 10) continue
    const d = a.start_date_local.slice(0, 10)
    // บันทึกเองวันเดียวกัน ความยาวใกล้กัน = คะแนนของกิจกรรมนี้
    const log = s.logs.find((l) => !usedLogs.has(l.id) && (l.activityId === a.id || (!l.activityId && l.date === d && Math.abs(l.minutes - min) <= Math.max(20, min * 0.3))))
    if (log) usedLogs.add(log.id)
    const rated = s.rpeByActivity[a.id] ?? log?.rpe
    const rpe = rated ?? estRpe(a.average_heartrate, maxHr)
    out.push({ date: d, minutes: min, rpe, load: min * rpe, source: 'watch', name: a.name ?? a.type ?? 'กิจกรรม', activityId: a.id, rated: rated != null })
  }
  for (const l of s.logs.filter((x) => !usedLogs.has(x.id))) {
    out.push({ date: l.date, minutes: l.minutes, rpe: l.rpe, load: l.minutes * l.rpe, source: 'log', name: l.kind === 'match' ? 'แข่ง' : l.kind === 'train' ? 'ฝึก' : 'แบด', rated: true })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

export interface LoadStatus {
  acute: number
  chronicWeekly: number
  acwr?: number
  zone: 'ต่ำ' | 'พอดี' | 'ระวัง' | 'สูงเสี่ยงเจ็บ' | 'ข้อมูลน้อย'
  hours7: number
  sessions7: number
  hardStreak: number
  warnings: string[]
  days: { date: string; load: number; minutes: number }[]
}

export function loadStatus(sessions: BSession[], today: string): LoadStatus {
  const in7 = sessions.filter((x) => x.date > addDays(today, -7) && x.date <= today)
  const in28 = sessions.filter((x) => x.date > addDays(today, -28) && x.date <= today)
  const acute = in7.reduce((a, x) => a + x.load, 0)
  const chronicWeekly = in28.reduce((a, x) => a + x.load, 0) / 4
  const firstDate = sessions[0]?.date
  const enoughHistory = firstDate != null && daysBetween(firstDate, today) >= 21
  const acwr = chronicWeekly > 0 && enoughHistory ? Math.round((acute / chronicWeekly) * 100) / 100 : undefined
  const zone: LoadStatus['zone'] = acwr == null ? 'ข้อมูลน้อย' : acwr < 0.8 ? 'ต่ำ' : acwr <= 1.3 ? 'พอดี' : acwr <= 1.5 ? 'ระวัง' : 'สูงเสี่ยงเจ็บ'
  // วันหนักติดกัน (RPE ≥ 7 หรือ load ≥ 600)
  let hardStreak = 0
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, -i)
    const hard = sessions.some((x) => x.date === d && (x.rpe >= 7 || x.load >= 600))
    if (hard) hardStreak++
    else if (i > 0) break
  }
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(today, i - 6)
    const xs = sessions.filter((x) => x.date === d)
    return { date: d, load: xs.reduce((a, x) => a + x.load, 0), minutes: xs.reduce((a, x) => a + x.minutes, 0) }
  })
  const warnings: string[] = []
  if (zone === 'สูงเสี่ยงเจ็บ') warnings.push(`ภาระ 7 วันสูงกว่าปกติ ${acwr}× — ลดเวลาเล่น/ความหนัก 2–3 วัน ช่วงนี้เสี่ยงเจ็บมากที่สุด`)
  else if (zone === 'ระวัง') warnings.push(`ภาระเพิ่มเร็ว (${acwr}×) — สัปดาห์นี้อย่าเพิ่มเกมเกินนี้`)
  else if (zone === 'ต่ำ') warnings.push('ภาระต่ำกว่าปกติ — ถ้าไม่ได้พักฟื้น เพิ่มกลับทีละน้อย (ไม่เกิน +20%/สัปดาห์)')
  if (hardStreak >= 3) warnings.push(`เล่นหนัก ${hardStreak} วันติด — พรุ่งนี้ควรพักหรือยืดเหยียดเบา ๆ`)
  return { acute: Math.round(acute), chronicWeekly: Math.round(chronicWeekly), acwr, zone, hours7: Math.round((in7.reduce((a, x) => a + x.minutes, 0) / 60) * 10) / 10, sessions7: in7.length, hardStreak, warnings, days }
}

// ── กันบาดเจ็บ ──
export const PREHAB: Record<string, { title: string; items: string[]; redFlags: string }> = {
  ไหล่: {
    title: 'ไหล่ (rotator cuff)',
    items: ['ยางยืดหมุนไหล่ออก 3×15/ข้าง (ศอกแนบตัว)', 'ยางยืดหมุนไหล่เข้า 2×15/ข้าง', 'Y-T-W คว่ำ 2×8', 'Sleeper stretch ข้างละ 30 วิ × 2', 'ก่อนตบเต็มแรง วอร์มไหล่ด้วยสวิงเบา ๆ 20 ครั้ง'],
    redFlags: 'ปวดตอนกลางคืน ยกแขนเหนือหัวไม่ได้ หรืออ่อนแรง → พบแพทย์/นักกายภาพ',
  },
  เข่า: {
    title: 'เข่า',
    items: ['Spanish squat / wall sit 3×30–45 วิ', 'Step-down ลงช้า ๆ 3×10/ข้าง (เข่าไม่ล้มเข้าใน)', 'Lateral band walk 3×12', 'ยืดต้นขาหน้าและสะโพก ข้างละ 30 วิ', 'ลงน้ำหนักลันจ์ให้เข่าชี้ตามปลายเท้า'],
    redFlags: 'บวม เข่าล็อก ทรุด หรือเจ็บแปลบตอนบิด → หยุดเล่น พบแพทย์',
  },
  ข้อเท้า: {
    title: 'ข้อเท้า',
    items: ['ยืนขาเดียว 30 วิ × 3/ข้าง (หลับตาถ้าง่ายไป)', 'Calf raise ขาเดียว 3×15', 'วาดตัวอักษร A–Z ด้วยปลายเท้า', 'กระโดดเบา ๆ ซ้าย-ขวา 20 วิ × 3', 'ใส่รองเท้าแบด (ไม่ใช้รองเท้าวิ่ง) — พื้นยึดเกาะด้านข้างดีกว่า'],
    redFlags: 'บวมช้ำ ลงน้ำหนักไม่ได้ → ประคบเย็น ยกสูง และพบแพทย์',
  },
  เอ็นร้อยหวาย: {
    title: 'น่อง & เอ็นร้อยหวาย',
    items: ['Calf raise ขาตรง 3×15 + เข่างอ 3×15 (ลงช้า 3 วิ)', 'ยืดน่องดันกำแพง ข้างละ 30 วิ × 2', 'วอร์มน่องก่อนเล่นทุกครั้ง', 'เลี่ยงเพิ่มชั่วโมงเล่นกะทันหัน'],
    redFlags: 'มีเสียงดัง "ป๊อก" รู้สึกเหมือนโดนเตะหลังเท้า → หยุดทันที พบแพทย์ด่วน',
  },
  ข้อมือ: {
    title: 'ข้อมือ / ข้อศอก (tennis elbow)',
    items: ['งอ-เหยียดข้อมือถือขวดน้ำ 2×15', 'บิดคว่ำ-หงายถือไม้ 2×15', 'บีบลูกบอลนุ่ม 2×20', 'ยืดปลายแขนทั้งสองด้าน ข้างละ 20 วิ', 'เช็กขนาดด้ามจับ/ความตึงเอ็นไม้ อาจตึงไป'],
    redFlags: 'ชา ปวดร้าวลงนิ้ว หรือบวมที่ข้อศอก → พบแพทย์',
  },
  หลัง: {
    title: 'หลังส่วนล่าง',
    items: ['Bird-dog 3×10/ข้าง', 'Dead bug 3×10', 'Glute bridge 3×12', 'บิดอกช่วงบน (open book) ข้างละ 8', 'ยกของ/ก้มเก็บลูก ย่อเข่า ไม่ก้มหลังตรง ๆ'],
    redFlags: 'ปวดร้าวลงขา ชา หรือกลั้นปัสสาวะไม่อยู่ → พบแพทย์ทันที',
  },
}

// ── เตรียมแข่ง ──
export function matchDayTips(): string[] {
  return [
    'กินมื้อหลัก 2–3 ชม. ก่อนแมตช์แรก (ข้าว/ขนมปัง + โปรตีนเบา ๆ)',
    'ระหว่างแมตช์: ของว่างแป้งย่อยง่าย (กล้วย ขนมปัง) + จิบเกลือแร่',
    'วอร์มอัพ 10 นาทีก่อนทุกแมตช์ · ใส่เสื้อคลุมระหว่างรอ',
    'จบแมตช์: เดินเบา + ยืด 5 นาที แล้วเติมน้ำ',
    'พกเสื้อสำรอง ผ้าเช็ดเหงื่อ เทปพันด้าม ลูกแบดที่คุ้น',
  ]
}

export function tournamentTips(daysLeft: number): { title: string; tips: string[] } {
  if (daysLeft > 14) return { title: 'ช่วงสร้างฟอร์ม', tips: ['ฝึกตามตาราง เน้นฟุตเวิร์กและแรลลี่ยาว', 'ลองเล่นแบบนับแต้มจริง ฝึกช่วงสำคัญ (19–19)', 'เวทสัปดาห์ละ 2 ครั้งยังทำได้เต็มที่'] }
  if (daysLeft > 7) return { title: 'เตรียมแข่ง 2 สัปดาห์', tips: ['เพิ่มเกมแข่งจริง ลดฝึกเทคนิคใหม่', 'เวทลดเหลือ 1 ครั้ง/สัปดาห์', 'นอนให้ได้ 7–9 ชม. ทุกคืน'] }
  if (daysLeft > 3) return { title: 'ลดหนัก (taper)', tips: ['ลงคอร์ดสั้นลง 30–40% แต่ยังตีเร็ว/คมเหมือนเดิม', 'งดเวทหนักและอินเทอร์วัล', 'เช็กไม้ เอ็น ด้าม รองเท้า — ไม่เปลี่ยนของใหม่'] }
  if (daysLeft > 0) return { title: 'ใกล้แข่งแล้ว', tips: ['ตีเบา ๆ 30–60 นาที ให้มือคุ้น หรือพัก', 'นอนให้พอ 2 คืนก่อนแข่งสำคัญที่สุด', 'เตรียมกระเป๋า: ไม้ 2 อัน เสื้อสำรอง เกลือแร่ ของว่าง', 'ดูตารางแข่ง เวลา และสนาม'] }
  return { title: 'วันแข่ง 🏆', tips: matchDayTips() }
}

// ── แยกข้อความบันทึกเล่น ──
/** "แบด 90 นาที เหนื่อย 7" · "เล่นแบด 2 ชม. 8" · "แข่ง 1.5 ชม 9 เมื่อวาน" */
export function parseLog(msg: string, today: string): { minutes: number; rpe?: number; date: string; kind: BLog['kind'] } | null {
  const m = /^(?:บันทึก\s*)?(แบด|เล่นแบด|ตีแบด|แข่ง|ฝึก|ซ้อม)\s*(\d+(?:\.\d+)?)\s*(ชม\.?|ชั่วโมง|นาที|น\.?|h|min)?\s*(?:เหนื่อย|rpe|ระดับ)?\s*(\d{1,2})?\s*(เมื่อวาน)?$/i.exec(msg.trim())
  if (!m) return null
  const n = Number(m[2])
  const unit = m[3] ?? (n <= 5 ? 'ชม' : 'นาที')
  const minutes = Math.round(/ชม|ชั่วโมง|h/i.test(unit) ? n * 60 : n)
  if (minutes < 10 || minutes > 600) return null
  const rpe = m[4] ? Math.max(1, Math.min(10, Number(m[4]))) : undefined
  return { minutes, rpe, date: m[5] ? addDays(today, -1) : today, kind: m[1] === 'แข่ง' ? 'match' : m[1] === 'ฝึก' || m[1] === 'ซ้อม' ? 'train' : 'court' }
}
