// ─────────────────────────────────────────────────────────────
// คู่ซ้อม LINE bot (Cloudflare Worker) — รับข้อความจาก LINE แล้วคุยกับ Intervals.icu
// คำสั่ง: วันนี้ · สัปดาห์ · สรุป · รายงาน · คำถาม · ซิงก์ · เจ็บ <อาการ> · เป้า
//        แข่ง · การ์ดเพซ · ผลแข่ง · รองเท้า [เพิ่ม|ใช้|ปลด] · ถามโค้ช · เพิ่มเติม · id
// ข้อความอื่น ๆ → โค้ช AI ตอบจากข้อมูลจริง
// ปุ่มตอบคำถาม ❓ ส่งมาเป็น postback: ans|<noteDate>|<questionId>|y|n
// ─────────────────────────────────────────────────────────────
import { IntervalsClient } from '../src/coach/intervals'
import { loadAndAnalyze, commitReport, answerQuestion, injuryNote } from '../src/coach/runner'
import { lightDot } from '../src/coach/engine'
import { MENU, MORE, dayLabel, flex, lineReply, plannedFor, questionMessages, text, workoutLines } from '../src/coach/line'
import type { LineMessage } from '../src/coach/line'
import {
  activeShoe,
  findShoe,
  loadShoes,
  paceCard,
  raceInfo,
  raceWeather,
  reviewLatest,
  saveShoes,
  shoeWarnings,
  shoesOldest,
  switchShoe,
  weeklyData,
} from '../src/coach/extras'
import { paceCardFlex, raceWeekFlex, reviewFlex, shoesFlex, weeklyFlex } from '../src/coach/flex'
import { askCoach, buildContext } from '../src/coach/aiCoach'
import type { AiEnv } from '../src/coach/aiCoach'
import { aiTrace } from '../src/coach/aiCoach'
import { addDays, daysBetween } from '../src/engine/trainingEngine'
import { fmtHMS } from '../src/lib/time'

export interface Env extends AiEnv {
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
const nowBkkIso = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 19)

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

// ── ความจำบทสนทนาสั้น ๆ กับโค้ช AI (เก็บใน cache ของ Cloudflare ~2 ชม.) ──
type Hist = { q: string; a: string }[]
const histKey = (uid: string) => new Request(`https://koosom.internal/chat/${encodeURIComponent(uid)}`)
async function loadHist(uid: string): Promise<Hist> {
  try {
    const r = await caches.default.match(histKey(uid))
    return r ? ((await r.json()) as Hist) : []
  } catch {
    return []
  }
}
async function saveHist(uid: string, h: Hist) {
  try {
    await caches.default.put(histKey(uid), new Response(JSON.stringify(h.slice(-4)), { headers: { 'Cache-Control': 'max-age=7200', 'Content-Type': 'application/json' } }))
  } catch {
    /* ไม่เป็นไร */
  }
}

const GREETING = (plan?: string) =>
  `สวัสดีครับ 🏃 โค้ชคู่ซ้อม${plan ? ` · ${plan}` : ''}\nแตะเมนูด้านล่าง หรือพิมพ์ถามอะไรก็ได้ เช่น\n• "เมื่อคืนนอนน้อย วันนี้ควรซ้อมไหม"\n• "เพซ easy ของผมควรเท่าไหร่"\n\nคำสั่ง: วันนี้ · สัปดาห์ · สรุป · รายงาน · แข่ง · การ์ดเพซ · ผลแข่ง · รองเท้า · เจ็บ <อาการ>`

async function handle(ev: LineEvent, env: Env): Promise<LineMessage[]> {
  const userId = ev.source?.userId ?? ''
  const msg = (ev.message?.type === 'text' ? ev.message.text ?? '' : '').trim()

  if (/^(id|ไอดี)$/i.test(msg)) return [text(`LINE user ID ของคุณ:\n${userId}`)]
  if (env.LINE_USER_ID && userId !== env.LINE_USER_ID) return [] // ตอบเฉพาะเจ้าของ

  const client = new IntervalsClient(env.INTERVALS_ATHLETE_ID, env.INTERVALS_API_KEY)
  const cfg = await client.loadConfig()
  if (!cfg) return [text('ยังไม่ได้ตั้งค่าโค้ช — เปิดแอปคู่ซ้อม แท็บซ้อม → โค้ช & Garmin แล้วกดบันทึก', MENU)]
  const today = todayBkk()

  // ปุ่มตอบคำถาม
  if (ev.type === 'postback' && ev.postback?.data.startsWith('ans|')) {
    const [, noteDate, qid, yn] = ev.postback.data.split('|')
    const data = await loadAndAnalyze(client, cfg, today)
    if (!data.openQuestions.some((q) => q.id === qid)) return [text('คำถามนี้ตอบไปแล้ว 👍', MENU)]
    await answerQuestion(client, data.notes, noteDate, qid, yn === 'y')
    return [text(yn === 'y' ? '✅ ปรับตารางตามที่เสนอแล้ว — ซิงก์นาฬิกาเพื่ออัปเดต workout' : '👌 คงตารางเดิม', MENU)]
  }
  if (ev.type !== 'message' || ev.message?.type !== 'text') return [text('ตอนนี้โค้ชอ่านได้เฉพาะข้อความตัวอักษรครับ 🙏', MENU)]

  if (/^(เมนู|menu|help|ช่วย|สวัสดี|hi|hello|หวัดดี)$/i.test(msg)) return [text(GREETING(cfg.planName), MENU)]
  if (/^(เพิ่มเติม|more)$/i.test(msg)) return [text('เลือกได้เลยครับ 👇', MORE)]
  if (/^(ถามโค้ช|โค้ช ?ai|ai)$/i.test(msg)) return [text('💬 พิมพ์คำถามมาได้เลยครับ เช่น\n• "ขาตึงนิดหน่อย พรุ่งนี้ควรวิ่งอินเทอร์วัลไหม"\n• "สัปดาห์นี้ซ้อมขาดไป 2 วัน ต้องชดเชยไหม"\n• "เป้า sub 2 ยังไหวไหม"')]

  if (/^(วันนี้|ซ้อม|ซ้อมอะไร|today|พรุ่งนี้|วันนี้ซ้อมอะไร)$/i.test(msg)) {
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

  if (/^(สัปดาห์แข่ง|แข่ง|race ?week|นับถอยหลัง)$/i.test(msg)) {
    const info = raceInfo(cfg)
    if (!info) return [text('ยังไม่ได้ตั้งวันแข่งในโค้ช', MENU)]
    const left = daysBetween(today, info.date)
    if (left < 0) return [text('ผ่านวันแข่งไปแล้ว พิมพ์ "ผลแข่ง" เพื่อดูการวิเคราะห์', MENU)]
    const weather = left <= 15 ? await raceWeather(info) : null
    const card = cfg.goalSec ? paceCard(info, cfg.goalSec, weather) : undefined
    return [flex(`🏁 อีก ${left} วัน · ${info.name}`, raceWeekFlex(info, left, weather, card), MORE)]
  }

  if (/^(การ์ดเพซ|เพซ|pace ?card|แผนเพซ)$/i.test(msg)) {
    const info = raceInfo(cfg)
    if (!info || !cfg.goalSec) return [text('ต้องมีวันแข่งและเวลาเป้าในโค้ชก่อน', MENU)]
    const left = daysBetween(today, info.date)
    const weather = left >= 0 && left <= 15 ? await raceWeather(info) : null
    return [flex(`⏱ การ์ดเพซ ${fmtHMS(cfg.goalSec)}`, paceCardFlex(info, paceCard(info, cfg.goalSec, weather)), MORE)]
  }

  if (/^(ผลแข่ง|วิเคราะห์|วิเคราะห์ผลแข่ง|review)$/i.test(msg)) {
    const acts = await client.activities(addDays(today, -30), today)
    const r = await reviewLatest(client, cfg, acts)
    if (!r) return [text('ยังไม่มีการวิ่ง 5 กม.ขึ้นไปใน 30 วันให้วิเคราะห์', MENU)]
    return [flex(`${r.isRace ? '🏅 ผลแข่ง' : '🔎 วิ่งล่าสุด'} ${fmtHMS(r.review.finishSec)}`, reviewFlex(r.review, r.isRace, cfg.goalSec && cfg.distKm ? cfg.goalSec / cfg.distKm : undefined), MORE)]
  }

  const shoeCmd = /^(รองเท้า|shoes?)\s*(เพิ่ม|add|ใช้|use|ปลด|retire|ลบ)?\s*(.*)$/is.exec(msg)
  if (shoeCmd && (shoeCmd[2] || !(shoeCmd[3] ?? '').trim())) {
    const verb = (shoeCmd[2] ?? '').toLowerCase()
    let rest = (shoeCmd[3] ?? '').trim()
    const store = await loadShoes(client)
    const acts = await client.activities(shoesOldest(store, addDays(today, -1)), today)
    const shoeQuick = () => [
      ...store.shoes.filter((s) => !s.retired && !s.activeSince).slice(0, 5).map((s) => ({ label: `👟 ใช้ ${s.name}`, text: `รองเท้า ใช้ ${s.name}` })),
      { label: '➕ เพิ่มคู่ใหม่', text: 'รองเท้า เพิ่ม ' },
      ...MORE.slice(0, 3),
    ]
    if (verb === 'เพิ่ม' || verb === 'add') {
      const m = /^(.*?)\s+(\d+(?:\.\d+)?)\s*(?:กม\.?|km)?$/i.exec(rest)
      const km = m ? Number(m[2]) : 0
      if (m) rest = m[1].trim()
      if (!rest) return [text('พิมพ์ชื่อรองเท้าด้วยครับ เช่น "รองเท้า เพิ่ม Pegasus 41 120" (120 = กม.ที่วิ่งไปแล้ว ไม่ใส่ก็ได้)')]
      if (findShoe(store, rest)?.name.toLowerCase() === rest.toLowerCase()) return [text(`มี ${rest} อยู่แล้ว`, shoeQuick())]
      const shoe = { id: `s${Date.now().toString(36)}`, name: rest.slice(0, 40), km }
      store.shoes.push(shoe)
      if (!activeShoe(store)) switchShoe(store, shoe, acts, nowBkkIso())
      await saveShoes(client, store)
      return [flex('👟 เพิ่มรองเท้าแล้ว', shoesFlex(store, acts), shoeQuick())]
    }
    if (verb === 'ใช้' || verb === 'use') {
      const s = findShoe(store, rest)
      if (!s) return [text(`ไม่พบรองเท้า "${rest}"`, shoeQuick())]
      switchShoe(store, s, acts, nowBkkIso())
      await saveShoes(client, store)
      return [flex(`👟 เปลี่ยนเป็น ${s.name}`, shoesFlex(store, acts), shoeQuick())]
    }
    if (verb === 'ปลด' || verb === 'retire' || verb === 'ลบ') {
      const s = findShoe(store, rest)
      if (!s) return [text(`ไม่พบรองเท้า "${rest}"`, shoeQuick())]
      if (s.activeSince) {
        s.km = Math.round((s.km + acts.filter((a) => (a.distance ?? 0) > 0 && /run/i.test(a.type ?? 'Run') && a.start_date_local >= s.activeSince!).reduce((x, a) => x + (a.distance ?? 0), 0) / 1000) * 10) / 10
        delete s.activeSince
      }
      s.retired = true
      await saveShoes(client, store)
      return [flex(`👟 ปลดระวาง ${s.name}`, shoesFlex(store, acts), shoeQuick())]
    }
    return [flex('👟 รองเท้า', shoesFlex(store, acts), shoeQuick())]
  }

  if (/^(รายงาน|report|สรุปสัปดาห์|รายงานสัปดาห์)$/i.test(msg)) {
    const data = await loadAndAnalyze(client, cfg, today)
    const [acts, wellness, store] = await Promise.all([client.activities(addDays(today, -70), today), client.wellness(addDays(today, -21), today), loadShoes(client)])
    const shoeActs = store.shoes.length ? await client.activities(shoesOldest(store, today), today) : []
    const w = weeklyData(data.events, acts, wellness, cfg, today)
    return [flex(`📊 สัปดาห์นี้ ${w.actualKm}/${w.plannedKm} กม.`, weeklyFlex(w, cfg.goalSec, shoeWarnings(store, shoeActs)), MENU)]
  }

  if (/^(สัปดาห์|week|7 ?วัน|7 วันข้างหน้า)$/i.test(msg)) {
    const data = await loadAndAnalyze(client, cfg, today)
    const lines = ['🗓 7 วันข้างหน้า']
    for (let i = 0; i < 7; i++) {
      const d = addDays(today, i)
      const evs = plannedFor(data.events, d)
      lines.push(`${dayLabel(d)}  ${evs.length ? evs.map((e) => e.name).join(', ') : '—'}`)
    }
    return [text(lines.join('\n'), MENU)]
  }

  if (/^(สรุป|แบต|summary|status)$/i.test(msg)) {
    const data = await loadAndAnalyze(client, cfg, today)
    const msgs = [text(data.report.summary, MENU)]
    return [...msgs, ...questionMessages(data.openQuestions)].slice(0, 5)
  }

  if (/^(คำถาม|\?)$/.test(msg)) {
    const data = await loadAndAnalyze(client, cfg, today)
    if (!data.openQuestions.length) return [text('ไม่มีคำถามค้าง 👍', MENU)]
    return questionMessages(data.openQuestions)
  }

  if (/^(ซิงก์|sync|ปรับตาราง)$/i.test(msg)) {
    const data = await loadAndAnalyze(client, cfg, today)
    const r = await commitReport(client, cfg, data, today)
    const fresh = await loadAndAnalyze(client, cfg, today)
    return [text(`${r.applied ? `🔧 ปรับตาราง ${r.applied} รายการ\n\n` : ''}${fresh.report.summary}`, MENU), ...questionMessages(fresh.openQuestions)].slice(0, 5)
  }

  const inj = /^(เจ็บ|ตึง|ปวด|บาดเจ็บ)(?:\s+(.*))?$/s.exec(msg)
  if (inj && (inj[2] ?? '').length <= 80 && !/[?？]|ไหม|มั้ย|ควร|ยังไง|อย่างไร/.test(msg)) {
    const detail = (inj[2] || '').trim()
    if (!detail) return [text('พิมพ์อาการต่อท้ายได้เลย เช่น "เจ็บ น่องซ้ายตึงหลังวิ่ง"')]
    await client.upsertEvents([injuryNote(today, `${inj[1]} ${detail}`)])
    return [text(`🩹 บันทึกแล้ว: ${inj[1]} ${detail}\nพิมพ์ "ซิงก์" ถ้าอยากให้โค้ชถามปรับวันหนักตอนนี้เลย หรือรอสรุป 21:07\nถ้าอยากถามวิธีดูแล พิมพ์ถามมาได้เลย เช่น "น่องตึงควรพักกี่วัน"`, MENU)]
  }

  if (/^(เป้า|goal|พร้อม|ความพร้อม)$/i.test(msg)) {
    const data = await loadAndAnalyze(client, cfg, today)
    const r = data.report.readiness
    return [text(r.vdot ? `🏁 ความพร้อม ${r.shapePct}% · คาด ${fmtHMS(r.predictedSec!)}${cfg.goalSec ? ` (เป้า ${fmtHMS(cfg.goalSec)})` : ''}\nVDOT ${r.vdot} · เฉลี่ย ${r.weeklyKmAvg} กม./สัปดาห์` : 'ยังมีข้อมูลวิ่งไม่พอสำหรับประเมิน', MENU)]
  }

  // ── อื่น ๆ → โค้ช AI ──
  if (msg.length < 2) return [text(GREETING(cfg.planName), MENU)]
  const data = await loadAndAnalyze(client, cfg, today)
  const acts = await client.activities(addDays(today, -21), today)
  const ctx = buildContext(data, cfg, acts, today)
  const hist = await loadHist(userId)
  try {
    const answer = await askCoach(env, msg.slice(0, 600), ctx, hist)
    await saveHist(userId, [...hist, { q: msg.slice(0, 300), a: answer.slice(0, 800) }])
    return [text(`💬 ${answer}`, MENU)]
  } catch (e) {
    return [text(`ขอโทษครับ โค้ช AI ตอบไม่ได้ตอนนี้ (${(e as Error).message.slice(0, 160)})\nลองใช้คำสั่งในเมนูก่อนได้ครับ`, MENU)]
  }
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (req.method === 'GET') return new Response('คู่ซ้อม LINE bot OK')
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })
    const body = await req.text()
    if (!(await verify(body, req.headers.get('x-line-signature'), env.LINE_CHANNEL_SECRET))) return new Response('bad signature', { status: 401 })
    const payload = JSON.parse(body) as { events?: LineEvent[]; selftest?: string }
    // ทดสอบตัวเอง (ต้องเซ็นด้วย channel secret): รันคำสั่ง แล้วให้ LINE ตรวจรูปแบบข้อความโดยไม่ส่งจริง
    // คืนเฉพาะสถานะ ไม่คืนเนื้อหา (log ของ GitHub Actions เป็นสาธารณะ)
    if (payload.selftest) {
      const t0 = Date.now()
      try {
        const msgs = await handle({ type: 'message', replyToken: 'selftest', source: { userId: env.LINE_USER_ID }, message: { type: 'text', text: payload.selftest } }, env)
        const v = await fetch('https://api.line.me/v2/bot/message/validate/reply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
          body: JSON.stringify({ messages: msgs.slice(0, 5) }),
        })
        const vtxt = v.ok ? '' : (await v.text()).slice(0, 300)
        const first = msgs[0]
        const preview = first?.type === 'text' ? first.text.slice(0, 2) : first?.altText.slice(0, 2)
        return Response.json({ cmd: payload.selftest, ms: Date.now() - t0, count: msgs.length, types: msgs.map((m) => m.type), valid: v.status, error: vtxt || undefined, ai: first?.type === 'text' && first.text.startsWith('💬'), aiFail: first?.type === 'text' && first.text.includes('โค้ช AI ตอบไม่ได้'), aiErr: first?.type === 'text' && first.text.includes('โค้ช AI ตอบไม่ได้') ? /\(([^)]*)\)/.exec(first.text)?.[1] : undefined, lead: preview, model: aiTrace.model, skipped: aiTrace.skipped.length ? aiTrace.skipped : undefined })
      } catch (e) {
        return Response.json({ cmd: payload.selftest, ms: Date.now() - t0, thrown: (e as Error).message.slice(0, 200) })
      }
    }
    ctx.waitUntil(
      (async () => {
        for (const ev of payload.events ?? []) {
          if (!ev.replyToken || (ev.type !== 'message' && ev.type !== 'postback')) continue
          try {
            const msgs = await handle(ev, env)
            if (msgs.length) await lineReply(env.LINE_CHANNEL_ACCESS_TOKEN, ev.replyToken, msgs)
          } catch (e) {
            await lineReply(env.LINE_CHANNEL_ACCESS_TOKEN, ev.replyToken, [text(`ขออภัย เกิดข้อผิดพลาด: ${(e as Error).message.slice(0, 120)}`, MENU)]).catch(() => undefined)
          }
        }
      })(),
    )
    return new Response('ok')
  },
}
