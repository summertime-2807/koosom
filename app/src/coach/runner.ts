// ─────────────────────────────────────────────────────────────
// Runner — โหลดข้อมูลจาก Intervals.icu, รันโค้ช, เขียนผลกลับ
// ใช้ร่วมกันระหว่างแอป (ปุ่ม "ซิงก์ & ปรับตาราง") และงานบนคลาวด์ทุกคืน
// สรุปประจำวันเก็บเป็น NOTE ในปฏิทิน Intervals.icu (external_id = rp-coach-YYYY-MM-DD)
// ─────────────────────────────────────────────────────────────
import type { CoachConfig, CoachQuestion, CoachReport, IcuEvent } from './types'
import { IntervalsClient, CONFIG_EXTERNAL_ID } from './intervals'
import { buildReport, dateOf } from './engine'
import { addDays } from '../engine/trainingEngine'
import { busyDates } from './busy'

export const NOTE_PREFIX = 'rp-coach-'

export interface StoredNote {
  handled: string[]
  questions: (CoachQuestion & { answered?: 'yes' | 'no' })[]
}

export function parseNote(e?: IcuEvent): StoredNote {
  const m = e?.description ? /```json\s*([\s\S]*?)```/.exec(e.description) : null
  if (!m) return { handled: [], questions: [] }
  try {
    const j = JSON.parse(m[1]) as Partial<StoredNote>
    return { handled: j.handled ?? [], questions: j.questions ?? [] }
  } catch {
    return { handled: [], questions: [] }
  }
}

export interface CoachData {
  events: IcuEvent[]
  notes: IcuEvent[]
  report: CoachReport
  openQuestions: (CoachQuestion & { noteDate: string })[]
}

export async function loadAndAnalyze(client: IntervalsClient, cfg: CoachConfig, today: string): Promise<CoachData> {
  const [events, acts, wellness] = await Promise.all([
    client.events(addDays(today, -21) < cfg.from ? addDays(today, -21) : cfg.from, addDays(today, 30) > cfg.to ? cfg.to : addDays(today, 30)),
    client.activities(addDays(today, -70), today),
    client.wellness(addDays(today, -50), today),
  ])
  const notes = events.filter((e) => e.category === 'NOTE' && e.external_id?.startsWith(NOTE_PREFIX))
  const handled = new Set<string>()
  const openQuestions: CoachData['openQuestions'] = []
  const askedIds = new Set<string>()
  for (const n of notes) {
    const s = parseNote(n)
    s.handled.forEach((h) => handled.add(h))
    for (const q of s.questions) {
      askedIds.add(q.id)
      if (q.answered) handled.add(q.date)
      else openQuestions.push({ ...q, noteDate: dateOf(n.start_date_local) })
    }
  }
  // วันที่แจ้ง "ติดงาน" ไม่นับขาด ไม่ถาม
  busyDates(events).forEach((d) => handled.add(d))
  // คำถามที่เปิดอยู่แล้ว ไม่ต้องถามซ้ำ
  openQuestions.forEach((q) => handled.add(q.date))
  const injuryDates = events.filter((e) => e.category === 'NOTE' && /^🩹/.test(e.name ?? '')).map((e) => dateOf(e.start_date_local))
  const plan = events.filter((e) => e.external_id !== CONFIG_EXTERNAL_ID && !e.external_id?.startsWith(NOTE_PREFIX))
  const report = buildReport({ events: plan, acts, wellness, cfg, today, handled, injuryDates })
  // คำถามใหม่ที่ซ้ำ id กับที่ค้างอยู่ ตัดออก
  // ถามไปแล้ว (ตอบแล้วหรือยังค้าง) ไม่ถามซ้ำ
  report.questions = report.questions.filter((q) => !askedIds.has(q.id))
  return { events: plan, notes, report, openQuestions }
}

/** เขียนผล: ปรับตาราง (ถ้าเปิด autoAdjust) + NOTE สรุปของวันนี้ */
export async function commitReport(client: IntervalsClient, cfg: CoachConfig, data: CoachData, today: string): Promise<{ applied: number }> {
  const { report } = data
  let applied = 0
  if (cfg.autoAdjust) {
    for (const a of report.adjustments) {
      if (a.eventId > 0 && a.patch) {
        await client.updateEvent(a.eventId, a.patch)
        applied++
      }
    }
  }
  const pastDates = report.days.filter((d) => d.date < today && (d.status === 'missed' || d.status === 'extra')).map((d) => d.date)
  const existing = data.notes.find((n) => n.external_id === `${NOTE_PREFIX}${today}`)
  const prev = parseNote(existing)
  const stored: StoredNote = {
    handled: [...new Set([...prev.handled, ...pastDates])],
    questions: [...prev.questions, ...report.questions.filter((q) => !prev.questions.some((p) => p.id === q.id))],
  }
  const lightIcon = { green: '🟢', yellow: '🟡', red: '🔴', none: '⚪' }[report.overall]
  await client.upsertEvents([
    {
      external_id: `${NOTE_PREFIX}${today}`,
      category: 'NOTE',
      start_date_local: `${today}T00:00:00`,
      name: `${lightIcon} โค้ชสรุป${report.questions.length ? ' ❓' : ''}`,
      description: `${report.summary}\n\n\`\`\`json\n${JSON.stringify(stored)}\n\`\`\``,
    },
  ])
  return { applied }
}

/** ตอบคำถาม ❓ จากแอป */
export async function answerQuestion(client: IntervalsClient, notes: IcuEvent[], noteDate: string, qid: string, yes: boolean): Promise<void> {
  const note = notes.find((n) => n.external_id === `${NOTE_PREFIX}${noteDate}`)
  if (!note) return
  const s = parseNote(note)
  const q = s.questions.find((x) => x.id === qid)
  if (!q) return
  if (yes) for (const a of q.proposal ?? []) if (a.eventId > 0 && a.patch) await client.updateEvent(a.eventId, a.patch)
  q.answered = yes ? 'yes' : 'no'
  s.handled.push(q.date)
  const desc = (note.description ?? '').replace(/```json[\s\S]*?```/, '```json\n' + JSON.stringify(s) + '\n```')
  await client.updateEvent(note.id, { description: desc, name: (note.name ?? '').replace(' ❓', s.questions.some((x) => !x.answered) ? ' ❓' : '') })
}

/** แจ้งอาการเจ็บ (ผู้ใช้กรอกเอง) */
export function injuryNote(date: string, text: string): Partial<IcuEvent> {
  return { external_id: `rp-injury-${date}`, category: 'NOTE', start_date_local: `${date}T00:00:00`, name: `🩹 ${text.slice(0, 40)}`, description: text }
}
