// ─────────────────────────────────────────────────────────────
// LINE bot (Cloudflare Worker) — ตัวรับข้อความจาก LINE แล้วคุยกับ Intervals.icu
// คำสั่ง: วันนี้ · สัปดาห์ · สรุป · คำถาม · ซิงก์ · เจ็บ <อาการ> · id · เมนู
// ปุ่มตอบคำถาม ❓ ส่งมาเป็น postback: ans|<noteDate>|<questionId>|y|n
// ─────────────────────────────────────────────────────────────
import { IntervalsClient } from '../src/coach/intervals'
import { loadAndAnalyze, commitReport, answerQuestion, injuryNote } from '../src/coach/runner'
import { lightDot } from '../src/coach/engine'
import { MENU, dayLabel, lineReply, plannedFor, questionMessages, text, workoutLines } from '../src/coach/line'
import type { LineMessage } from '../src/coach/line'
import { addDays } from '../src/engine/trainingEngine'
import { fmtHMS } from '../src/lib/time'

export interface Env {
  LINE_CHANNEL_ACCESS_TOKEN: string
  LINE_CHANNEL_SECRET: string
  LINE_USER_ID?: string
  INTERVALS_ATHLETE_ID: string
  INTERVALS_API_KEY: string
}

interface LineEvent {
  type: string
  replyToken?: string
  source?: { userId?: string }
  message?: { type: string; text?: string }
  postback?: { data: string }
}

const todayBkk = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)

async function verify(body: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  const b64 = btoa(String.fromCharCode(...new Uint8Array(mac)))
  if (b64.length !== signature.length) return false
  let diff = 0
  for (let i = 0; i < b64.length; i++) diff |= b64.charCodeAt(i) ^ signature.charCodeAt(i)
  return diff === 0
}

async function handle(ev: LineEvent, env: Env): Promise<LineMessage[]> {
  const userId = ev.source?.userId ?? ''
  const msg = (ev.message?.type === 'text' ? ev.message.text ?? '' : '').trim()

  if (/^(id|ไอดี)$/i.test(msg)) return [text(`LINE user ID ของคุณ:\n${userId}`)]
  if (env.LINE_USER_ID && userId !== env.LINE_USER_ID) return [] // ตอบเฉพาะเจ้าของ

  const client = new IntervalsClient(env.INTERVALS_ATHLETE_ID, env.INTERVALS_API_KEY)
  const cfg = await client.loadConfig()
  if (!cfg) return [text('ยังไม่ได้ตั้งค่าโค้ช — เปิดแอปแผนวิ่ง แท็บซ้อม → โค้ช & Garmin แล้วกดบันทึก', MENU)]
  const today = todayBkk()

  // ปุ่มตอบคำถาม
  if (ev.type === 'postback' && ev.postback?.data.startsWith('ans|')) {
    const [, noteDate, qid, yn] = ev.postback.data.split('|')
    const data = await loadAndAnalyze(client, cfg, today)
    if (!data.openQuestions.some((q) => q.id === qid)) return [text('คำถามนี้ตอบไปแล้ว 👍', MENU)]
    await answerQuestion(client, data.notes, noteDate, qid, yn === 'y')
    return [text(yn === 'y' ? '✅ ปรับตารางตามที่เสนอแล้ว — ซิงก์นาฬิกาเพื่ออัปเดต workout' : '👌 คงตารางเดิม', MENU)]
  }

  if (/^(วันนี้|ซ้อม|today|พรุ่งนี้)/i.test(msg)) {
    const data = await loadAndAnalyze(client, cfg, today)
    const out: string[] = []
    for (const [label, d] of [
      ['วันนี้', today],
      ['พรุ่งนี้', addDays(today, 1)],
    ] as const) {
      const evs = plannedFor(data.events, d)
      out.push(`📅 ${label} (${dayLabel(d)})`)
      if (!evs.length) out.push('พัก / เดินเบา ๆ')
      for (const e of evs) out.push(`${e.name}\n${workoutLines(e)}`)
      out.push('')
    }
    out.push(`${lightDot(data.report.overall)} แบตเตอรี่วันนี้`)
    return [text(out.join('\n').trim(), MENU)]
  }

  if (/^(สัปดาห์|week|7 ?วัน)/i.test(msg)) {
    const data = await loadAndAnalyze(client, cfg, today)
    const lines = ['🗓 7 วันข้างหน้า']
    for (let i = 0; i < 7; i++) {
      const d = addDays(today, i)
      const evs = plannedFor(data.events, d)
      lines.push(`${dayLabel(d)}  ${evs.length ? evs.map((e) => e.name).join(', ') : '—'}`)
    }
    return [text(lines.join('\n'), MENU)]
  }

  if (/^(สรุป|แบต|summary|status)/i.test(msg)) {
    const data = await loadAndAnalyze(client, cfg, today)
    const msgs = [text(data.report.summary, MENU)]
    return [...msgs, ...questionMessages(data.openQuestions)].slice(0, 5)
  }

  if (/^(คำถาม|ถาม|\?)/.test(msg)) {
    const data = await loadAndAnalyze(client, cfg, today)
    if (!data.openQuestions.length) return [text('ไม่มีคำถามค้าง 👍', MENU)]
    return questionMessages(data.openQuestions)
  }

  if (/^(ซิงก์|sync|ปรับ)/i.test(msg)) {
    const data = await loadAndAnalyze(client, cfg, today)
    const r = await commitReport(client, cfg, data, today)
    const fresh = await loadAndAnalyze(client, cfg, today)
    return [text(`${r.applied ? `🔧 ปรับตาราง ${r.applied} รายการ\n\n` : ''}${fresh.report.summary}`, MENU), ...questionMessages(fresh.openQuestions)].slice(0, 5)
  }

  const inj = /^(เจ็บ|ตึง|ปวด|บาดเจ็บ)\s*(.*)$/s.exec(msg)
  if (inj) {
    const detail = (inj[2] || '').trim()
    if (!detail) return [text('พิมพ์อาการต่อท้ายได้เลย เช่น "เจ็บ น่องซ้ายตึงหลังวิ่ง"')]
    await client.upsertEvents([injuryNote(today, `${inj[1]} ${detail}`)])
    return [text(`🩹 บันทึกแล้ว: ${inj[1]} ${detail}\nพิมพ์ "ซิงก์" ถ้าอยากให้โค้ชถามปรับวันหนักตอนนี้เลย หรือรอสรุป 21:07`, MENU)]
  }

  if (/^(เป้า|goal|พร้อม)/i.test(msg)) {
    const data = await loadAndAnalyze(client, cfg, today)
    const r = data.report.readiness
    return [text(r.vdot ? `🏁 ความพร้อม ${r.shapePct}% · คาด ${fmtHMS(r.predictedSec!)}${cfg.goalSec ? ` (เป้า ${fmtHMS(cfg.goalSec)})` : ''}\nVDOT ${r.vdot} · เฉลี่ย ${r.weeklyKmAvg} กม./สัปดาห์` : 'ยังมีข้อมูลวิ่งไม่พอสำหรับประเมิน', MENU)]
  }

  return [text(`สวัสดีครับ 🏃 โค้ช${cfg.planName ? ` · ${cfg.planName}` : ''}\nพิมพ์หรือแตะปุ่มด้านล่างได้เลย\n• วันนี้ · สัปดาห์ · สรุป · คำถาม · ซิงก์ · เป้า\n• เจ็บ <อาการ>`, MENU)]
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (req.method === 'GET') return new Response('raceplan LINE bot OK')
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })
    const body = await req.text()
    if (!(await verify(body, req.headers.get('x-line-signature'), env.LINE_CHANNEL_SECRET))) return new Response('bad signature', { status: 401 })
    const payload = JSON.parse(body) as { events?: LineEvent[] }
    ctx.waitUntil(
      (async () => {
        for (const ev of payload.events ?? []) {
          if (!ev.replyToken || (ev.type !== 'message' && ev.type !== 'postback')) continue
          try {
            const msgs = await handle(ev, env)
            if (msgs.length) await lineReply(env.LINE_CHANNEL_ACCESS_TOKEN, ev.replyToken, msgs)
          } catch (e) {
            await lineReply(env.LINE_CHANNEL_ACCESS_TOKEN, ev.replyToken, [text(`ขออภัย เกิดข้อผิดพลาด: ${(e as Error).message.slice(0, 120)}`)]).catch(() => undefined)
          }
        }
      })(),
    )
    return new Response('ok')
  },
}
