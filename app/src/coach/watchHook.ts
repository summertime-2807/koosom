// ─────────────────────────────────────────────────────────────
// ⌚ Apple Watch → คู่ซ้อม ผ่าน "คำสั่งลัด" (Shortcuts) ของ iPhone — ฟรี ไม่ต้องใช้ HealthFit
// ระบบอัตโนมัติ 2 ตัว: เริ่มเวิร์กเอาท์ → POST ?e=start, จบเวิร์กเอาท์ → POST ?e=end
// worker จับเวลาเอง แล้วทักถามใน LINE ว่าเล่นอะไร/เหนื่อยแค่ไหน
// ─────────────────────────────────────────────────────────────
import type { LineMessage, QuickItem } from './line'
import { text } from './line'
import { hmacHex } from './users'

export const HOOK_PATH = '/w/'
export const KV_HOOK_START = 'hk:start'
/** ถ้าไม่ได้รับ "จบ" ภายในเวลานี้ จะทักถามแทน */
export const HOOK_STALE_MIN = 5 * 60

const b64u = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64u = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/'))

/** โทเคนประจำผู้ใช้ (ใส่ใน URL ของคำสั่งลัด) — เซ็นด้วย channel secret ปลอมไม่ได้ */
export async function hookToken(secret: string, uid: string): Promise<string> {
  return `${b64u(uid)}.${(await hmacHex(secret, `watchhook:${uid}`)).slice(0, 32)}`
}
export async function readHookToken(secret: string, tok: string): Promise<string | null> {
  const [u, sig] = tok.split('.')
  if (!u || !sig) return null
  let uid: string
  try {
    uid = unb64u(u)
  } catch {
    return null
  }
  return (await hmacHex(secret, `watchhook:${uid}`)).slice(0, 32) === sig ? uid : null
}

/** ข้อความสอนตั้งค่า + ลิงก์ 2 อัน (แยกข้อความ เพื่อกดค้างคัดลอกได้ง่าย) */
export function hookSetup(base: string, token: string): LineMessage[] {
  const steps = [
    '⌚ เชื่อม Apple Watch ผ่านแอป "คำสั่งลัด" (ฟรี · ทำครั้งเดียว ~3 นาที)',
    '',
    'ตัวที่ 1 — ตอนเริ่มเล่น',
    '1) เปิดแอป คำสั่งลัด (Shortcuts) → แถบ ระบบอัตโนมัติ (Automation) → แตะ +',
    '2) เลื่อนหา เวิร์กเอาท์ Apple Watch (Apple Watch Workout)',
    '3) เลือก "เริ่มต้น" (Starts) · ประเภท: เวิร์กเอาท์ใดๆ (Any Workout)',
    '4) เลือก เรียกใช้ทันที (Run Immediately) → ถัดไป',
    '5) แตะ การทำงานใหม่ที่ว่าง (New Blank Automation)',
    '6) ค้นหาการทำงาน "รับเนื้อหาของ URL" (Get Contents of URL)',
    '7) แตะช่อง URL → วาง "ลิงก์เริ่ม" (ข้อความถัดไป)',
    '8) แตะลูกศร > ข้างการทำงาน → วิธี (Method) เปลี่ยนเป็น POST → เสร็จ',
    '',
    'ตัวที่ 2 — ตอนจบ',
    'ทำซ้ำข้อ 1–8 แต่ข้อ 3 เลือก "สิ้นสุด" (Ends) และข้อ 7 ใช้ "ลิงก์จบ"',
    '',
    'เสร็จแล้ว ✅ ต่อไปแค่กดเริ่ม/จบเวิร์กเอาท์บนนาฬิกาตามปกติ (เช่น แบดมินตัน) → คู่ซ้อมจะทักมาถามว่าเหนื่อยแค่ไหน',
    '',
    '💡 คัดลอกลิงก์: กดค้างที่ข้อความลิงก์ → คัดลอก',
    '🔒 ลิงก์นี้เป็นของคุณคนเดียว อย่าส่งต่อให้คนอื่น',
  ]
  return [
    text(steps.join('\n')),
    text(`${base}${HOOK_PATH}${token}?e=start`),
    text(`${base}${HOOK_PATH}${token}?e=end`),
    text('ตั้งเสร็จแล้วลองทดสอบได้: เริ่มเวิร์กเอาท์บนนาฬิกา ~1 นาทีแล้วกดจบ → ควรมีข้อความจากคู่ซ้อมเด้งมา (ถ้าสั้นกว่า 10 นาทีจะแจ้งว่าเป็นการทดสอบ)', [
      { label: '🏸 บันทึกเล่น', text: 'บันทึกเล่น' },
    ]),
  ]
}

export const HOOK_KINDS: { key: 'court' | 'train' | 'match'; label: string }[] = [
  { key: 'court', label: '🏸 เล่นแบด' },
  { key: 'train', label: '🏋️ ฝึกเสริม' },
  { key: 'match', label: '🏆 แข่ง' },
]

export const kindPicker = (min: number): QuickItem[] => [
  ...HOOK_KINDS.map((k) => ({ label: k.label, data: `hk|${min}|${k.key}`, text: k.label.slice(3) })),
  { label: '✖️ ไม่ต้องบันทึก', data: 'hk|skip', text: 'ไม่ต้องบันทึก' },
]

export type HookResult = { kind: 'started' } | { kind: 'ended'; minutes: number | null } | { kind: 'test'; minutes: number } | { kind: 'bad' }

/** คำนวณผลจากเหตุการณ์ start/end (แยกออกมาเพื่อทดสอบได้) */
export function hookDecide(e: string | null, startIso: string | null, nowMs: number): HookResult {
  if (e === 'start') return { kind: 'started' }
  if (e !== 'end') return { kind: 'bad' }
  if (!startIso) return { kind: 'ended', minutes: null }
  const min = Math.round((nowMs - Date.parse(startIso)) / 60000)
  if (!Number.isFinite(min) || min < 0 || min > 8 * 60) return { kind: 'ended', minutes: null }
  if (min < 10) return { kind: 'test', minutes: min }
  return { kind: 'ended', minutes: min }
}

/** ข้อความที่ push หลังจบเวิร์กเอาท์ */
export function hookMessages(r: HookResult): LineMessage[] {
  if (r.kind === 'test') return [text(`✅ เชื่อม Apple Watch สำเร็จ! (เวิร์กเอาท์นี้ ${r.minutes} นาที สั้นเกินไป เลยไม่บันทึก)\nต่อไปเล่นจบ คู่ซ้อมจะทักมาถามเอง`)]
  if (r.kind === 'ended' && r.minutes != null) return [text(`⌚ จบเวิร์กเอาท์ ${r.minutes} นาที — เป็นอะไรครับ?`, kindPicker(r.minutes))]
  if (r.kind === 'ended') return [text('⌚ จบเวิร์กเอาท์แล้ว แต่ไม่ได้รับเวลาเริ่ม — เล่นไปกี่นาทีครับ?', [60, 90, 120, 150, 180].map((m) => ({ label: `${m} นาที`, data: `blog|${m}`, text: `เล่น ${m} นาที` })))]
  return []
}
