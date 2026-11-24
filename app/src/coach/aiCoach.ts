// ─────────────────────────────────────────────────────────────
// โค้ช AI ใน LINE — ตอบคำถามอิสระจากข้อมูลจริง (แผน · ผลซ้อม · HRV/การนอน · ความพร้อม)
// ใช้ Gemini ถ้ามี GEMINI_API_KEY ไม่งั้นใช้ Cloudflare Workers AI (ฟรี ไม่ต้องมีคีย์)
// ─────────────────────────────────────────────────────────────
import type { CoachConfig, IcuActivity, IcuEvent } from './types'
import type { CoachData } from './runner'
import { dateOf } from './engine'
import { dayLabel, plannedFor, workoutLines } from './line'
import { addDays, daysBetween } from '../engine/trainingEngine'
import { fmtHMS, fmtMS } from '../lib/time'

export interface AiEnv {
  GEMINI_API_KEY?: string
  AI?: { run(model: string, input: unknown): Promise<unknown> }
}

const SYSTEM = `คุณคือ "โค้ชคู่ซ้อม" โค้ชวิ่งส่วนตัวที่คุยผ่าน LINE ตอบเป็นภาษาไทย เป็นกันเอง กระชับ
กฎ:
- ตอบจาก "ข้อมูลนักวิ่ง" ที่ให้มาเป็นหลัก อ้างตัวเลขจริงเมื่อเกี่ยวข้อง ถ้าข้อมูลไม่พอให้บอกตรง ๆ
- ยาวไม่เกิน ~8 บรรทัด ไม่ใช้ markdown (ไม่มี ** หรือ #) ใช้ • หรืออีโมจิแทนหัวข้อได้
- ถ้าแนะนำให้เปลี่ยนตารางซ้อม ให้บอกว่าจะปรับอย่างไร และบอกว่าพิมพ์ "ซิงก์" เพื่อให้โค้ชอัตโนมัติประเมินใหม่
- อาการเจ็บ: ห้ามวินิจฉัยโรค แนะนำพัก/ลดหนัก และถ้าปวดแหลม บวม เดินลงน้ำหนักไม่ได้ หรือเกิน 3–5 วันไม่ดีขึ้น ให้ไปพบแพทย์/นักกายภาพ และแนะนำให้พิมพ์ "เจ็บ <อาการ>" เพื่อบันทึก
- อาการอันตราย (เจ็บหน้าอก หน้ามืด หายใจไม่ออก ใจสั่นผิดปกติ) ให้หยุดวิ่งและไปพบแพทย์ทันที
- ไม่แนะนำยา/อาหารเสริมเฉพาะยี่ห้อ ไม่ให้ตัวเลขลดน้ำหนักหรือจำกัดอาหาร`

export function buildContext(data: CoachData, cfg: CoachConfig, acts: IcuActivity[], today: string, extra: string[] = []): string {
  const L: string[] = []
  L.push(`วันนี้: ${dayLabel(today)} (${today})`)
  if (cfg.raceDate) L.push(`เป้าหมาย: ${cfg.planName || 'แข่ง'} ${cfg.distKm ?? '?'} กม. วันที่ ${cfg.raceDate} (อีก ${daysBetween(today, cfg.raceDate)} วัน)${cfg.goalSec ? ` เวลาเป้า ${fmtHMS(cfg.goalSec)} (เพซ ${fmtMS(cfg.goalSec / (cfg.distKm || 21.1))}/กม.)` : ''}`)
  L.push(`หัวใจ: LTHR ${cfg.lthr} · Max ${cfg.maxHr}${cfg.restHr ? ` · พัก ${cfg.restHr}` : ''}`)
  const r = data.report.readiness
  if (r.vdot) L.push(`ความพร้อม ${r.shapePct}% · VDOT ${r.vdot} · เวลาคาดการณ์ ${fmtHMS(r.predictedSec!)} · เฉลี่ย ${r.weeklyKmAvg} กม./สัปดาห์ · ยาวสุด 6 สัปดาห์ ${r.longestKm} กม.`)
  L.push('', 'แบตเตอรี่ร่างกาย:')
  for (const b of data.report.battery) L.push(`- ${b.label} ${b.value} (${b.light}) ${b.why}`)
  if (!data.report.battery.length) L.push('- ไม่มีข้อมูล')
  L.push('', 'การวิ่ง 14 วันล่าสุด:')
  const recent = acts
    .filter((a) => (a.distance ?? 0) > 0 && /run/i.test(a.type ?? 'Run') && daysBetween(dateOf(a.start_date_local), today) <= 14)
    .sort((a, b) => a.start_date_local.localeCompare(b.start_date_local))
  for (const a of recent) {
    const km = (a.distance ?? 0) / 1000
    L.push(`- ${dateOf(a.start_date_local)} ${a.name ?? ''} ${km.toFixed(1)} กม.${a.moving_time ? ` เพซ ${fmtMS(a.moving_time / km)}` : ''}${a.average_heartrate ? ` HR ${Math.round(a.average_heartrate)}` : ''}`)
  }
  if (!recent.length) L.push('- ไม่มี')
  L.push('', 'สถานะตาราง 14 วันที่ผ่านมา:')
  for (const d of data.report.days.filter((x) => x.date < today && x.date >= addDays(today, -14) && x.status !== 'rest')) L.push(`- ${d.date} ${d.status} ${d.planned?.name ?? ''} จริง ${d.actualKm} กม.`)
  L.push('', 'แผน 7 วันข้างหน้า:')
  for (let i = 0; i < 7; i++) {
    const day = addDays(today, i)
    const evs: IcuEvent[] = plannedFor(data.events, day)
    L.push(`- ${dayLabel(day)}: ${evs.length ? evs.map((e) => `${e.name} [${workoutLines(e).replace(/\n/g, ' / ')}]`).join(', ') : 'พัก'}`)
  }
  const injuries = data.events
    .filter((e) => e.category === 'NOTE' && /^🩹/.test(e.name ?? '') && daysBetween(dateOf(e.start_date_local), today) <= 14)
    .map((e) => `- ${dateOf(e.start_date_local)} ${e.description ?? e.name}`)
  if (injuries.length) L.push('', 'อาการเจ็บที่แจ้งไว้ (14 วัน):', ...injuries)
  if (data.openQuestions.length) L.push('', 'คำถามที่โค้ชอัตโนมัติรอคำตอบ:', ...data.openQuestions.map((q) => `- ${q.text}`))
  if (extra.length) L.push('', ...extra)
  return L.join('\n')
}

function clean(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .trim()
}

export async function askCoach(env: AiEnv, question: string, context: string, history: { q: string; a: string }[] = []): Promise<string> {
  const prompt = `ข้อมูลนักวิ่ง:\n${context}\n\nคำถาม: ${question}`
  if (env.GEMINI_API_KEY) {
    const contents = [
      ...history.flatMap((h) => [
        { role: 'user', parts: [{ text: h.q }] },
        { role: 'model', parts: [{ text: h.a }] },
      ]),
      { role: 'user', parts: [{ text: prompt }] },
    ]
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents, generationConfig: { temperature: 0.5, maxOutputTokens: 900 } }),
    })
    if (res.ok) {
      const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
      const t = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('')
      if (t) return clean(t)
    }
    if (!env.AI) throw new Error(`Gemini ${res.status}`)
  }
  if (!env.AI) throw new Error('ยังไม่ได้ตั้งค่า AI')
  const messages = [
    { role: 'system', content: SYSTEM },
    ...history.flatMap((h) => [
      { role: 'user', content: h.q },
      { role: 'assistant', content: h.a },
    ]),
    { role: 'user', content: prompt },
  ]
  const out = (await env.AI.run('@cf/google/gemma-3-12b-it', { messages, max_tokens: 700, temperature: 0.5 })) as { response?: string }
  if (!out?.response) throw new Error('AI ไม่ตอบ')
  return clean(out.response)
}
