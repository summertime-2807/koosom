// ─────────────────────────────────────────────────────────────
// ปฏิทินงานวิ่ง (snapshot) — อ้างอิง race.thai.run และแหล่งรวมงานวิ่งอื่น
// race.thai.run เป็นเว็บแบบ SPA ไม่มี API สาธารณะ และเบราว์เซอร์ดึงข้ามโดเมนไม่ได้ (CORS)
// จึงเก็บเป็นข้อมูลชุดเริ่มต้น + ให้ผู้ใช้เพิ่ม/แก้งานเองได้ (เก็บใน storage)
// อัปเดตล่าสุด: 20 พ.ย. 2569
// ─────────────────────────────────────────────────────────────
import type { CalendarRace } from '../types/race'

export const CALENDAR_UPDATED = '2026-11-20'
export const THAIRUN_URL = 'https://race.thai.run/'

const TR = 'race.thai.run'
const FR = 'FrontRunnr'
const AH = 'ahotu'
const AH_DEC = 'https://www.ahotu.com/calendar/running/december/thailand'
const AH_BKK = 'https://www.ahotu.com/calendar/running/thailand/bangkok-tha'
const AH_TH = 'https://www.ahotu.com/calendar/running/thailand'

export const RACE_CALENDAR: CalendarRace[] = [
  { id: 'atmb26', name: 'Amazing Thailand Marathon Bangkok 2026', date: '2026-11-29', dateText: '28–29 พ.ย. 2569', location: 'กรุงเทพฯ', distancesKm: [10, 21.1, 42.195], organizer: 'Thailand Tri-League', source: FR, url: 'https://raceplan.frontrunnr.run/th/' },
  { id: 'acd26', name: 'International Anti-Corruption Day Run', date: '2026-12-05', location: 'กรุงเทพฯ', distancesKm: [5, 10, 21.1], source: AH, url: AH_BKK },
  { id: 'garmin26', name: 'Garmin Run Asia Series – Thailand Half Marathon', date: '2026-12-06', location: 'กรุงเทพฯ', distancesKm: [5, 10, 21.1], source: AH, url: AH_DEC },
  { id: 'npm26', name: 'Scenic Half Marathon Nakhon Phanom', date: '2026-12-13', dateText: '12–13 ธ.ค. 2569', location: 'นครพนม', distancesKm: [5, 10, 21.1, 42.195], source: AH, url: AH_DEC },
  { id: 'kathu26', name: 'Kathu Marathon', date: '2026-12-13', location: 'กะทู้ ภูเก็ต', distancesKm: [6, 10.5, 21.1, 42.195], source: AH, url: AH_DEC },
  { id: 'photak26', name: 'Photak Marathon', date: '2026-12-13', location: 'โพธิ์ตาก หนองคาย', distancesKm: [5, 10, 21.1, 42.195], source: AH, url: AH_DEC },
  { id: 'bs21', name: 'Bangsaen21 Half Marathon', date: '2026-12-20', location: 'บางแสน ชลบุรี', distancesKm: [21.1], source: FR, url: 'https://raceplan.frontrunnr.run/th/' },
  { id: 'cmm26', name: 'Chiang Mai Marathon', date: '2026-12-20', location: 'เชียงใหม่', distancesKm: [3, 10, 21.1, 42.195], source: AH, url: AH_DEC },
  { id: 'sakon26', name: 'Sakon Run Der', date: '2026-12-20', location: 'สกลนคร', distancesKm: [6, 10.5, 21.1], source: AH, url: AH_DEC },
  { id: 'sriracha26', name: 'Sriracha Ultra 100', date: '2026-12-26', location: 'ศรีราชา ชลบุรี', distancesKm: [60, 100], source: AH, url: AH_DEC },
  // ── จาก race.thai.run (วันที่ตามหน้ารายการ — ควรตรวจซ้ำในหน้างาน) ──
  { id: 'tr_bbl27', name: 'Bangkok Bank Friend Run 2027', date: '2027-01-08', organizer: 'ธนาคารกรุงเทพ', distancesKm: [], source: TR, url: THAIRUN_URL },
  { id: 'tr_mute27', name: 'MUTEYOU : MOVE GROOVE RUN', date: '2027-01-08', organizer: 'Muteyou', distancesKm: [], source: TR, url: THAIRUN_URL },
  { id: 'tr_efin27', name: 'efin Let’s PROFIT RUN 2027', date: '2027-01-08', organizer: 'efin', distancesKm: [], source: TR, url: THAIRUN_URL },
  { id: 'tr_ram27', name: 'Ram Hero Run 2027', date: '2027-01-09', organizer: 'โรงพยาบาลรามคำแหง', distancesKm: [], source: TR, url: THAIRUN_URL },
  { id: 'tr_vtrail27', name: 'V Trail 2027', date: '2027-01-16', organizer: 'Green Step', distancesKm: [], source: TR, url: THAIRUN_URL },
  { id: 'tr_hcmc27', name: 'HCMC MARATHON 2027', date: '2027-01-16', location: 'โฮจิมินห์ เวียดนาม', organizer: 'Pulse Active', distancesKm: [], source: TR, url: THAIRUN_URL },
  { id: 'tr_ranl27', name: 'RUN ALONE BUT NOT LONELY 2027', date: '2027-02-06', organizer: 'บริษัท มดยักษ์ใหญ่ จำกัด', distancesKm: [], source: TR, url: THAIRUN_URL },
  { id: 'tr_bsf27', name: 'บึงสีไฟไนท์รัน 2027', date: '2027-02-12', location: 'พิจิตร', organizer: 'เทศบาลเมืองพิจิตร', distancesKm: [], source: TR, url: THAIRUN_URL },
  { id: 'tr_nyk27', name: 'NYK MARATHON 2027', dateText: 'ดูวันที่บนเว็บ', organizer: 'RUN HAPPY SERIES', distancesKm: [], source: TR, url: THAIRUN_URL },
  { id: 'tr_nm27', name: 'Nongmuang Mini Marathon 2027', dateText: 'ดูวันที่บนเว็บ', distancesKm: [], source: TR, url: THAIRUN_URL },
  { id: 'tr_cyp27', name: 'Chaiyaphum Marathon – The First Marathon', dateText: 'ดูวันที่บนเว็บ', location: 'ชัยภูมิ', organizer: 'Runvegas Series', distancesKm: [], source: TR, url: THAIRUN_URL },
  { id: 'rama8_27', name: 'Rama 8 Half Marathon', date: '2027-05-16', location: 'กรุงเทพฯ', distancesKm: [5, 10, 21.1], source: AH, url: AH_TH },
]

// ── ข้อมูลอัปเดตอัตโนมัติ (races.json สร้างโดย GitHub Actions ทุกวัน) ──
export interface RemoteCalendar {
  updatedAt: string
  races: CalendarRace[]
}

export async function loadRemoteCalendar(signal?: AbortSignal): Promise<RemoteCalendar | null> {
  try {
    const res = await fetch('./races.json', { cache: 'no-cache', signal })
    if (!res.ok) return null
    const j = (await res.json()) as Partial<RemoteCalendar>
    if (!Array.isArray(j.races) || !j.updatedAt) return null
    const races = j.races.filter((r): r is CalendarRace => !!r && typeof r.id === 'string' && typeof r.name === 'string' && Array.isArray(r.distancesKm))
    return { updatedAt: j.updatedAt, races }
  } catch {
    return null
  }
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/20\d\d|25\d\d/g, '')
    .replace(/half marathon|marathon|มาราธอน|run|รัน/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')

/** รวมข้อมูลชุดเริ่มต้นกับข้อมูลอัปเดต: งานที่มีข้อมูลสนามละเอียดเก็บไว้ งานซ้ำตัดออก */
export function mergeCalendar(base: CalendarRace[], remote: CalendarRace[] | undefined): CalendarRace[] {
  if (!remote?.length) return base
  const keep = base.filter((r) => r.source !== 'race.thai.run')
  const keys = keep.map((r) => ({ k: norm(r.name), month: r.date?.slice(0, 7) }))
  const fresh = remote.filter((r) => {
    const k = norm(r.name)
    if (!k) return true
    return !keys.some((x) => x.k && (x.k === k || ((x.k.includes(k) || k.includes(x.k)) && Math.min(x.k.length, k.length) >= 6)) && (!x.month || !r.date || x.month === r.date.slice(0, 7)))
  })
  return [...keep, ...fresh]
}
