// Time & number formatting helpers (pure)

/** "HH:MM:SS" | "H:MM:SS" | "MM:SS" -> seconds. คืนค่า NaN ถ้ารูปแบบผิด */
export function parseHMS(s: string): number {
  const parts = s.trim().split(':').map((p) => p.trim())
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => p === '' || !/^\d+$/.test(p))) return NaN
  const nums = parts.map(Number)
  if (nums.length === 2) {
    const [m, sec] = nums
    if (sec >= 60) return NaN
    return m * 60 + sec
  }
  const [h, m, sec] = nums
  if (m >= 60 || sec >= 60) return NaN
  return h * 3600 + m * 60 + sec
}

/** "HH:MM" -> seconds from midnight */
export function parseHM(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return NaN
  const h = Number(m[1])
  const mi = Number(m[2])
  if (h > 23 || mi > 59) return NaN
  return h * 3600 + mi * 60
}

const pad = (n: number) => String(n).padStart(2, '0')

/** seconds -> "H:MM:SS" */
export function fmtHMS(totalSec: number): string {
  const s = Math.round(totalSec)
  const sign = s < 0 ? '-' : ''
  const a = Math.abs(s)
  const h = Math.floor(a / 3600)
  const m = Math.floor((a % 3600) / 60)
  const sec = a % 60
  return `${sign}${h}:${pad(m)}:${pad(sec)}`
}

/** seconds -> "M:SS" (สำหรับเวลาช่วงสั้น/เพซ) */
export function fmtMS(totalSec: number): string {
  const s = Math.round(totalSec)
  const m = Math.floor(s / 60)
  return `${m}:${pad(s % 60)}`
}

/** เพซ วินาที/กม. -> "M:SS" */
export const fmtPace = fmtMS

/** seconds from midnight -> "HH:MM" (วนรอบ 24 ชม.) */
export function fmtClock(secFromMidnight: number, withSeconds = false): string {
  const day = 24 * 3600
  const s = ((Math.round(secFromMidnight) % day) + day) % day
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return withSeconds ? `${pad(h)}:${pad(m)}:${pad(s % 60)}` : `${pad(h)}:${pad(m)}`
}

export function fmtKm(km: number, digits = 2): string {
  return km.toFixed(digits)
}

export function signed(n: number, digits = 0): string {
  const v = Number(n.toFixed(digits))
  return (v > 0 ? '+' : v < 0 ? '' : '±') + v.toFixed(digits)
}

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
export const TH_MONTHS_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']

/** "2026-11-29" -> "29 พ.ย. 2569" */
export function fmtThaiDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  return `${Number(m[3])} ${TH_MONTHS[Number(m[2]) - 1]} ${Number(m[1]) + 543}`
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`
}
