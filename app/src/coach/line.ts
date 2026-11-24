// ─────────────────────────────────────────────────────────────
// LINE Messaging API — ส่ง/ตอบข้อความ + ปุ่ม quick reply
// ใช้ได้ทั้ง Node (งานทุกคืน) และ Cloudflare Worker (ตัวรับข้อความ)
// ─────────────────────────────────────────────────────────────
import type { CoachQuestion, IcuEvent } from './types'
import { dateOf } from './engine'
import { DOW_TH, dowOf } from '../engine/trainingEngine'

export interface QuickItem {
  label: string
  text?: string
  data?: string
}
export type QuickReply = { items: unknown[] }
export type LineMessage =
  | { type: 'text'; text: string; quickReply?: QuickReply }
  | { type: 'flex'; altText: string; contents: unknown; quickReply?: QuickReply }

const API = 'https://api.line.me/v2/bot/message'
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

function quickReply(quick?: QuickItem[]): QuickReply | undefined {
  if (!quick?.length) return undefined
  return {
    items: quick.slice(0, 13).map((q) => ({
      type: 'action',
      action: q.data
        ? { type: 'postback', label: cut(q.label, 20), data: q.data, displayText: q.text ?? q.label }
        : { type: 'message', label: cut(q.label, 20), text: q.text ?? q.label },
    })),
  }
}

export function text(t: string, quick?: QuickItem[]): LineMessage {
  const m: LineMessage = { type: 'text', text: cut(t, 4900) }
  const qr = quickReply(quick)
  if (qr) m.quickReply = qr
  return m
}

/** Flex message (การ์ด) — altText คือข้อความที่โชว์ในแจ้งเตือน */
export function flex(altText: string, contents: unknown, quick?: QuickItem[]): LineMessage {
  const m: LineMessage = { type: 'flex', altText: cut(altText, 390), contents }
  const qr = quickReply(quick)
  if (qr) m.quickReply = qr
  return m
}

export const MENU: QuickItem[] = [
  { label: '📅 วันนี้ซ้อมอะไร', text: 'วันนี้' },
  { label: '🗓 7 วันข้างหน้า', text: 'สัปดาห์' },
  { label: '🔋 แบตเตอรี่/สรุป', text: 'สรุป' },
  { label: '📊 รายงานสัปดาห์', text: 'รายงาน' },
  { label: '💬 ถามโค้ช AI', text: 'ถามโค้ช' },
  { label: '❓ คำถามค้าง', text: 'คำถาม' },
  { label: '↻ ซิงก์ & ปรับตาราง', text: 'ซิงก์' },
  { label: '🩹 แจ้งเจ็บ', text: 'เจ็บ ' },
]

/** เมนู "เพิ่มเติม" จาก rich menu */
export const MORE: QuickItem[] = [
  { label: '🏁 สัปดาห์แข่ง', text: 'แข่ง' },
  { label: '⏱ การ์ดเพซ', text: 'การ์ดเพซ' },
  { label: '🏅 วิเคราะห์ผลแข่ง', text: 'ผลแข่ง' },
  { label: '👟 รองเท้า', text: 'รองเท้า' },
  { label: '😴 การนอน (Google)', text: 'การนอน' },
  { label: '🎯 เป้า & ความพร้อม', text: 'เป้า' },
  { label: '❓ คำถามค้าง', text: 'คำถาม' },
  { label: '↻ ซิงก์ & ปรับตาราง', text: 'ซิงก์' },
  { label: '🩹 แจ้งเจ็บ', text: 'เจ็บ ' },
]

export function questionMessages(qs: (CoachQuestion & { noteDate: string })[]): LineMessage[] {
  return qs.slice(0, 3).map((q) =>
    text(
      `❓ ${q.text}${q.proposal?.length ? '\n\n' + q.proposal.map((p) => `🔧 ${p.date.slice(5)}: ${p.note}`).join('\n') : ''}`,
      q.proposal?.length
        ? [
            { label: '✅ ปรับตามที่เสนอ', data: `ans|${q.noteDate}|${q.id}|y` },
            { label: '❌ คงตารางเดิม', data: `ans|${q.noteDate}|${q.id}|n` },
          ]
        : [{ label: '👌 รับทราบ', data: `ans|${q.noteDate}|${q.id}|n` }],
    ),
  )
}

/** ขั้นตอน workout แบบอ่านง่ายบนมือถือ (ตัด % LTHR / Pace syntax ออก) */
export function workoutLines(e: IcuEvent): string {
  const desc = (e.description ?? '').split('\n')
  const out: string[] = []
  for (const l of desc) {
    const s = l.trim()
    if (!s) continue
    if (s.startsWith('- ')) {
      out.push(
        '• ' +
          s
            .slice(2)
            .replace(/\s\d+-\d+% LTHR/g, '')
            .replace(/(\d+:\d{2})-(\d+:\d{2})\/km Pace/g, 'เพซ $1–$2')
            .trim(),
      )
    } else if (/^(Warmup|Cooldown|Main Set)/.test(s)) out.push(s.replace('Warmup', 'วอร์ม').replace('Cooldown', 'คูลดาวน์').replace('Main Set', 'ช่วงหลัก'))
    else out.push(s)
  }
  return out.join('\n')
}

export function dayLabel(date: string) {
  return `${DOW_TH[dowOf(date)]} ${Number(date.slice(8))}/${Number(date.slice(5, 7))}`
}

export function plannedFor(events: IcuEvent[], date: string) {
  return events.filter((e) => (e.category === 'WORKOUT' || /^RACE/.test(e.category)) && dateOf(e.start_date_local) === date)
}

export async function linePush(token: string, to: string, messages: LineMessage[]): Promise<void> {
  if (!messages.length) return
  const res = await fetch(`${API}/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, messages: messages.slice(0, 5) }),
  })
  if (!res.ok) throw new Error(`LINE push ${res.status}`)
}

export async function lineReply(token: string, replyToken: string, messages: LineMessage[]): Promise<void> {
  const res = await fetch(`${API}/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ replyToken, messages: messages.slice(0, 5) }),
  })
  if (!res.ok) throw new Error(`LINE reply ${res.status}`)
}
