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
import { MENU, MORE, dayLabel, flex, linePush, lineReply, plannedFor, questionMessages, text, workoutLines } from '../src/coach/line'
import type { LineMessage, QuickItem } from '../src/coach/line'
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
import { addDays, daysBetween, dowOf } from '../src/engine/trainingEngine'
import { busyNotes, describeBusy, endBusy, rangeLabel, setBusy, setShort } from '../src/coach/busy'
import { authUrl, checkIdentity, exchangeCode, fmtNight, syncSleep } from '../src/coach/googleHealth'
import type { GoogleCreds, SleepStore } from '../src/coach/googleHealth'
import { loadSleepStore } from '../src/coach/googleHealth'
import { bedtimeFor, dur, kindFromName, napPlan, sleepAdvice, sleepStats, wakeTimesFrom } from '../src/coach/sleepCoach'
import { sleepFlex } from '../src/coach/flex'
import { fmtHMS } from '../src/lib/time'
import type { User, Sport } from '../src/coach/users'
import { createInvite, deleteUser, getUser, listMembers, readInvite, registerToken, readRegisterToken, ukey, updateUser } from '../src/coach/users'
import { handleRegister, registerForm, errorPage } from './register'
import { handleBadminton, BADMINTON_MENU } from '../src/coach/badmintonBot'
import { GUIDE_RE, guideMessages } from '../src/coach/guide'
import { handleRunSetup } from '../src/coach/raceSetupBot'
import type { RunSetup } from '../src/coach/raceSetup'
import { RACE_CALENDAR, mergeCalendar } from '../src/data/raceCalendar'
import type { CalendarRace } from '../src/types/race'
import { HOOK_PATH, HOOK_STALE_MIN, KV_HOOK_START, hookDecide, hookMessages, hookSetup, hookToken, readHookToken } from '../src/coach/watchHook'
import { nightsFromWellness } from '../src/coach/sleepCoach'

export interface Env extends AiEnv {
  LINE_CHANNEL_ACCESS_TOKEN: string
  LINE_CHANNEL_SECRET: string
  LINE_USER_ID?: string
  INTERVALS_ATHLETE_ID: string
  INTERVALS_API_KEY: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  KV?: KVNamespace
}

// ── Google Health (การนอน) ──
const REDIRECT_PATH = '/google/callback'
const KV_REFRESH = 'google_refresh_token'
const KV_STATUS = 'google_sleep_status'
const KV_LAST_SYNC = 'last_manual_sync'

const googleCreds = (env: Env): GoogleCreds | null => (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } : null)

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg))
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
/** ลิงก์เชื่อม Google ใช้ได้ 20 นาที เซ็นด้วย channel secret และผูกกับผู้ใช้ (คนอื่นเอาไปใช้แทนไม่ได้) */
async function makeState(env: Env, uid: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + 20 * 60
  const u = btoa(uid).replace(/=+$/, '')
  return `${exp}.${u}.${await hmacHex(env.LINE_CHANNEL_SECRET, `google:${exp}:${uid}`)}`
}
async function checkState(env: Env, state: string | null): Promise<string | null> {
  const [exp, u, sig] = (state ?? '').split('.')
  if (!exp || !u || !sig || Number(exp) < Date.now() / 1000) return null
  let uid: string
  try {
    uid = atob(u)
  } catch {
    return null
  }
  return (await hmacHex(env.LINE_CHANNEL_SECRET, `google:${exp}:${uid}`)) === sig ? uid : null
}

const clientOf = (u: User) => new IntervalsClient(u.athleteId, u.apiKey)

const WEB_URL = 'https://summertime-2807.github.io/koosom/'
/** ปฏิทินงานวิ่ง: ชุดในแอป + races.json ที่อัปเดตทุกวัน */
async function loadRaces(): Promise<CalendarRace[]> {
  try {
    const res = await fetch(`${WEB_URL}races.json`, { cf: { cacheTtl: 3600, cacheEverything: true } } as RequestInit)
    const j = res.ok ? ((await res.json()) as { races?: CalendarRace[] }) : null
    const remote = (j?.races ?? []).filter((r) => r && typeof r.id === 'string' && typeof r.name === 'string' && Array.isArray(r.distancesKm))
    return mergeCalendar(RACE_CALENDAR, remote)
  } catch {
    return RACE_CALENDAR
  }
}

async function runSleepSync(env: Env, user: User, days = 4): Promise<{ ok: boolean; text: string; store?: SleepStore }> {
  const creds = googleCreds(env)
  const refresh = await env.KV?.get(ukey(user, KV_REFRESH))
  if (!creds || !refresh || !env.KV) return { ok: false, text: 'ยังไม่ได้เชื่อม Google Health' }
  const client = clientOf(user)
  try {
    const r = await syncSleep(client, creds, refresh, todayBkk(), days)
    await env.KV.put(ukey(user, KV_STATUS), JSON.stringify({ at: new Date().toISOString(), ok: true, nights: r.written }))
    const lines = r.nights.slice(-5).map((n) => `${dayLabel(n.date)}  ${fmtNight(n)}`)
    return { ok: true, text: lines.length ? lines.join('\n') : 'ยังไม่มีข้อมูลการนอนใน 4 วันล่าสุด', store: r.store }
  } catch (e) {
    const msg = (e as Error).message.slice(0, 200)
    await env.KV.put(ukey(user, KV_STATUS), JSON.stringify({ at: new Date().toISOString(), ok: false, error: msg }))
    return { ok: false, text: msg }
  }
}

/** ประวัติการนอนของผู้ใช้: จาก Google Health (ถ้าเชื่อม) ไม่งั้นจาก wellness ของ Intervals (เช่น Apple Watch ผ่าน HealthFit) */
async function sleepNights(env: Env, user: User, client: IntervalsClient, sync = false) {
  const google = !!(await env.KV?.get(ukey(user, KV_REFRESH)))
  if (google) {
    if (sync) {
      const r = await runSleepSync(env, user)
      if (r.store) return { nights: r.store.nights, source: 'google' as const, error: r.ok ? undefined : r.text }
    }
    const st = await loadSleepStore(client).catch(() => null)
    if (st) return { nights: st.nights, source: 'google' as const }
  }
  const today = todayBkk()
  const w = await client.wellness(addDays(today, -21), today)
  return { nights: nightsFromWellness(w), source: 'wellness' as const }
}

const page = (title: string, body: string) =>
  new Response(
    `<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:system-ui,sans-serif;background:#0f172a;color:#f1f5f9;padding:32px;line-height:1.6"><h2>${title}</h2><p>${body}</p><p style="color:#94a3b8">ปิดหน้านี้แล้วกลับไปที่ LINE ได้เลย</p></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )

interface LineEvent {
  type: string
  replyToken?: string
  source?: { userId?: string }
  message?: { type: string; text?: string }
  postback?: { data: string; params?: { date?: string; time?: string } }
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
  `สวัสดีครับ 🏃 โค้ชคู่ซ้อม${plan ? ` · ${plan}` : ''}\nแตะเมนูด้านล่าง หรือพิมพ์ถามอะไรก็ได้ เช่น\n• "เมื่อคืนนอนน้อย วันนี้ควรซ้อมไหม"\n• "เพซ easy ของผมควรเท่าไหร่"\n\nคำสั่ง: วันนี้ · สัปดาห์ · สรุป · รายงาน · แข่ง · การ์ดเพซ · ผลแข่ง · รองเท้า · การนอน · ติดงาน · วิ่งสั้น · เจ็บ <อาการ>\n\n📖 ไม่แน่ใจ พิมพ์ "วิธีใช้"`


// ── 💼 ติดงาน ──
function parseDM(s: string, today: string): string | undefined {
  const m = /(\d{1,2})\s*[/.-]\s*(\d{1,2})/.exec(s)
  if (!m) return undefined
  const y = Number(today.slice(0, 4))
  const mk = (yy: number) => `${yy}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`
  const d = mk(y)
  return d < today ? mk(y + 1) : d
}

function busyMenu(today: string) {
  const sunday = addDays(today, (7 - dowOf(today)) % 7)
  return [
    { label: 'วันนี้', data: 'busy|0', text: 'ติดงานวันนี้' },
    { label: 'วันนี้–พรุ่งนี้', data: 'busy|1', text: 'ติดงาน 2 วัน' },
    { label: '3 วัน', data: 'busy|2', text: 'ติดงาน 3 วัน' },
    ...(sunday > addDays(today, 2) ? [{ label: 'ถึงวันอาทิตย์', data: 'busy|sun', text: 'ติดงานถึงวันอาทิตย์' }] : []),
    { label: '📅 เลือกวันสุดท้าย', data: 'busy|pick', pickDate: { initial: addDays(today, 3), min: today, max: addDays(today, 20) } },
    { label: '⏱ ยุ่ง วิ่งสั้นวันนี้', text: 'วิ่งสั้น' },
    { label: '✅ กลับมาซ้อมแล้ว', text: 'กลับมาซ้อม' },
  ]
}
const AFTER_BUSY = [
  { label: '↩️ ยกเลิก/กลับมาซ้อม', text: 'กลับมาซ้อม' },
  { label: '📅 วันนี้ซ้อมอะไร', text: 'วันนี้' },
  { label: '🗓 7 วันข้างหน้า', text: 'สัปดาห์' },
]

async function doBusy(user: User, to: string, today: string): Promise<LineMessage[]> {
  const client = clientOf(user)
  const cfg = await client.loadConfig()
  if (!cfg) return [text('ยังไม่ได้ตั้งค่าโค้ช', MENU)]
  if (to < today) return [text('เลือกวันที่วันนี้หรือหลังจากนี้นะครับ', busyMenu(today))]
  const r = await setBusy(client, cfg, today, to, today)
  return [text(describeBusy(r.period, r.merged), AFTER_BUSY)]
}

// ── 😴 โค้ชการนอน ──
const KV_WAKE = 'wake_notified'
const nowMs = () => Date.now()
const hhmmNow = (plusMin = 0) => new Date(Date.now() + 7 * 3600e3 + plusMin * 60000).toISOString().slice(11, 16)

function sleepQuick(): QuickItem[] {
  return [
    { label: '🛏 ต้องตื่นกี่โมง?', data: 'sleep|wake', pickTime: { initial: hhmmNow(8 * 60).replace(/:\d\d$/, ':00') } },
    { label: '⏰ จะนอนตอนนี้', text: 'นอนตอนนี้' },
    { label: '😪 งีบ', text: 'งีบ' },
    { label: '😴 การ์ดการนอน', text: 'การนอน' },
    { label: '🎯 เป้าการนอน', text: 'เป้าการนอน' },
  ]
}

async function todayKind(client: IntervalsClient, today: string) {
  const evs = plannedFor(await client.events(today, today), today)
  return evs.length ? kindFromName(evs.map((e) => e.name ?? '').join(' ')) : 'rest'
}

function bedtimeText(wake: string, st: ReturnType<typeof sleepStats>): string {
  const p = bedtimeFor(wake, st, nowMs())
  const L = [`🛏 ต้องตื่น ${wake} — ควรเข้านอน:`]
  for (const o of p.options) L.push(`${o.recommended ? '⭐' : '•'} ${o.bed}  (${o.cycles} รอบ = ${dur(o.sleepMin)})${o.tooLate ? ' · ไม่ทันแล้ว' : ''}`)
  L.push('', `เผื่อเวลากว่าจะหลับ ~${p.latencyMin} นาที (จากข้อมูลจริงของคุณ)`, `☕ งดคาเฟอีนหลัง ${p.caffeineCutoff}`)
  if (st.debtMin >= 180) L.push(`หนี้การนอนตอนนี้ ${dur(st.debtMin)} — ถ้าเลือกได้ เอาตัวที่ได้ 6 รอบ`)
  L.push('ตื่นตรงจังหวะจบรอบ (90 นาที) จะงัวเงียน้อยกว่า')
  return L.join('\n')
}

/** ตรวจว่าเพิ่งตื่น → ส่ง "☀️ ตื่นแล้ว" ครั้งเดียวต่อวัน (เฉพาะคนที่เปิดรับข้อความอัตโนมัติ) */
async function wakeCheck(env: Env, user: User) {
  if (!env.KV || !user.push) return
  const today = todayBkk()
  if ((await env.KV.get(ukey(user, KV_WAKE))) === today) return
  const client = clientOf(user)
  const google = !!(await env.KV.get(ukey(user, KV_REFRESH)))
  let nights
  let lastLine: string
  if (google) {
    const r = await runSleepSync(env, user, 2)
    const last = r.store?.nights.at(-1)
    if (!last || last.date !== today || !last.endMs || Date.now() - last.endMs > 4.5 * 3600e3) return // เกิน 4.5 ชม. ถือว่าไม่ใช่ "เพิ่งตื่น"
    nights = r.store!.nights
    lastLine = `☀️ ตื่นแล้ว · นอน ${dur(last.asleepMin)} (${last.start}–${last.end})`
  } else {
    // Apple Watch/อื่น ๆ: ถือว่าตื่นเมื่อการนอนของวันนี้เข้ามาใน Intervals
    const w = await client.wellness(addDays(today, -21), today)
    const t = w.find((x) => x.id === today && (x.sleepSecs ?? 0) > 3600)
    if (!t) return
    nights = nightsFromWellness(w)
    lastLine = `☀️ อรุณสวัสดิ์ · นอน ${dur((t.sleepSecs ?? 0) / 60)}`
  }
  const cfg = await client.loadConfig()
  if (!cfg) return
  await env.KV.put(ukey(user, KV_WAKE), today)
  const st = sleepStats(nights, today, cfg.sleepTargetMin)
  if (user.sport === 'badminton') {
    const { badmintonWake } = await import('../src/coach/badmintonBot')
    const msgs = await badmintonWake(client, cfg, today, st, lastLine)
    if (msgs.length) await linePush(env.LINE_CHANNEL_ACCESS_TOKEN, user.uid, msgs)
    return
  }
  const data = await loadAndAnalyze(client, cfg, today)
  await commitReport(client, cfg, data, today)
  const fresh = await loadAndAnalyze(client, cfg, today)
  const evs = plannedFor(fresh.events, today)
  const kind = evs.length ? kindFromName(evs.map((e) => e.name ?? '').join(' ')) : 'rest'
  const L = [lastLine, `หนี้การนอน 7 วัน ${dur(st.debtMin)} · ${lightDot(fresh.report.overall)} แบตเตอรี่`, '']
  L.push(...sleepAdvice(st, kind).slice(0, 3).map((a) => `💡 ${a}`), '')
  if (evs.length) for (const e of evs) L.push(`📅 วันนี้: ${e.name}`, workoutLines(e))
  else L.push('📅 วันนี้พัก / เดินเบา ๆ')
  const qs = fresh.openQuestions.filter((q) => q.date === today)
  await linePush(env.LINE_CHANNEL_ACCESS_TOKEN, user.uid, [text(L.join('\n').trim(), sleepQuick()), ...questionMessages(qs)].slice(0, 5))
}

let workerOrigin = 'https://raceplan-line-bot.sicasica03.workers.dev'

// ── ผู้ที่ยังไม่ลงทะเบียน: เข้าได้ด้วยรหัสเชิญเท่านั้น ──
async function unregistered(env: Env, uid: string, msg: string): Promise<LineMessage[]> {
  const m = /^(?:ลงทะเบียน|สมัคร|register)?\s*([A-Z0-9]{6})$/i.exec(msg)
  if (m) {
    const code = m[1].toUpperCase()
    const inv = await readInvite(env, code)
    if (!inv) return [text('รหัสเชิญไม่ถูกต้องหรือหมดอายุ (ใช้ได้ 3 วัน ครั้งเดียว) — ขอรหัสใหม่จากคนที่ชวนคุณมานะครับ')]
    const token = await registerToken(env, uid, code)
    return [text(`🎟 รหัสเชิญถูกต้อง!\nแตะลิงก์นี้เพื่อลงทะเบียน (ใช้ได้ 30 นาที):\n${workerOrigin}/register?t=${encodeURIComponent(token)}\n\nเตรียม Athlete ID + API key จาก intervals.icu (Settings → Developer Settings) ไว้ด้วยนะครับ`)]
  }
  return [text('สวัสดีครับ 👋 คู่ซ้อมตอนนี้เปิดให้เฉพาะคนที่ได้รับเชิญ (เบต้า)\nถ้ามีรหัสเชิญ พิมพ์: ลงทะเบียน <รหัส 6 ตัว>')]
}

/** ผูก rich menu ตามกีฬา (แบดมินตันใช้เมนูของตัวเอง) */
async function linkRichMenu(env: Env, uid: string, sport: Sport) {
  const h = { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` }
  if (sport === 'run') {
    await fetch(`https://api.line.me/v2/bot/user/${uid}/richmenu`, { method: 'DELETE', headers: h }) // กลับไปใช้เมนูหลัก
    return
  }
  const list = (await (await fetch('https://api.line.me/v2/bot/richmenu/list', { headers: h })).json()) as { richmenus?: { richMenuId: string; name: string }[] }
  const m = list.richmenus?.find((x) => x.name === 'koosom-badminton')
  if (m) await fetch(`https://api.line.me/v2/bot/user/${uid}/richmenu/${m.richMenuId}`, { method: 'POST', headers: h })
}

async function handle(ev: LineEvent, env: Env, override?: { sport?: Sport }): Promise<LineMessage[]> {
  const userId = ev.source?.userId ?? ''
  const msg = (ev.message?.type === 'text' ? ev.message.text ?? '' : '').trim()

  if (/^(id|ไอดี)$/i.test(msg)) return [text(`LINE user ID ของคุณ:\n${userId}`)]

  const user = await getUser(env, userId)
  if (!user) return unregistered(env, userId, msg)
  if (override?.sport) user.sport = override.sport // ใช้เฉพาะ self-test

  const client = clientOf(user)
  const cfg = await client.loadConfig()
  if (!cfg) return [text('ยังไม่ได้ตั้งค่าโค้ช — เปิดแอปคู่ซ้อม แท็บซ้อม → โค้ช & Garmin แล้วกดบันทึก', MENU)]
  const today = todayBkk()

  // ── ผู้ใช้/บัญชี ──
  if (user.isOwner) {
    const inv = /^เชิญ\s*(แบด|วิ่ง)?$/.exec(msg)
    if (inv) {
      const sport: Sport = inv[1] === 'วิ่ง' ? 'run' : inv[1] === 'แบด' ? 'badminton' : 'run'
      const code = await createInvite(env, userId, sport)
      return [text(`🎟 รหัสเชิญ: ${code}\nใช้ได้ 1 คน ภายใน 3 วัน (${sport === 'badminton' ? 'แบดมินตัน' : 'วิ่ง'})\n\nส่งข้อความนี้ให้คนที่เชิญ 👇`), text(`มาลองใช้ "คู่ซ้อม" โค้ชส่วนตัวใน LINE กัน 🏃🏸\n1) เพิ่มเพื่อน: https://line.me/R/ti/p/@754yhzoj\n2) พิมพ์ในแชท: ลงทะเบียน ${code}`)]
    }
    if (/^(ผู้ใช้|สมาชิก|users)$/i.test(msg)) {
      const ms = await listMembers(env)
      return [text(ms.length ? `👥 ผู้ใช้ ${ms.length} คน\n${ms.map((m) => `• ${m.name} · ${m.sport === 'badminton' ? '🏸' : '🏃'}${m.push ? ' · 🔔' : ''} · ตั้งแต่ ${m.createdAt.slice(0, 10)}`).join('\n')}\n\n🔔 = รับข้อความอัตโนมัติ (ใช้โควตา LINE)` : 'ยังไม่มีผู้ใช้อื่น — พิมพ์ "เชิญ" หรือ "เชิญ แบด" เพื่อสร้างรหัสเชิญ', MENU)]
    }
    const del = /^ลบผู้ใช้\s+(.+)$/.exec(msg)
    if (del) {
      const m = (await listMembers(env)).find((x) => x.name === del[1].trim())
      if (!m) return [text(`ไม่พบผู้ใช้ชื่อ "${del[1].trim()}" — พิมพ์ "ผู้ใช้" เพื่อดูรายชื่อ`)]
      await deleteUser(env, m.uid)
      return [text(`🗑 ลบ ${m.name} ออกจากคู่ซ้อมแล้ว (ข้อมูลใน Intervals ของเขายังอยู่)`)]
    }
  } else if (/^(ลบบัญชี|ยกเลิกบัญชี|delete account)$/i.test(msg)) {
    return [text('ยืนยันลบบัญชีคู่ซ้อม? ระบบจะลบคีย์และการเชื่อมต่อทั้งหมด (ข้อมูลใน Intervals ของคุณไม่ถูกลบ)', [{ label: '🗑 ยืนยันลบ', text: 'ยืนยันลบบัญชี' }, { label: 'ยกเลิก', text: 'เมนู' }])]
  } else if (msg === 'ยืนยันลบบัญชี') {
    await deleteUser(env, userId)
    return [text('ลบบัญชีเรียบร้อยแล้ว ขอบคุณที่ลองใช้คู่ซ้อมครับ 🙏')]
  }
  const sp = /^(?:กีฬา|โหมด)\s*(แบด|แบดมินตัน|วิ่ง)$/.exec(msg)
  if (sp) {
    const sport: Sport = sp[1].startsWith('แบด') ? 'badminton' : 'run'
    await updateUser(env, userId, { sport })
    await linkRichMenu(env, userId, sport).catch(() => undefined)
    return [text(`เปลี่ยนเป็นโหมด${sport === 'badminton' ? 'แบดมินตัน 🏸' : 'วิ่ง 🏃'}แล้ว`, sport === 'badminton' ? BADMINTON_MENU : MENU)]
  }
  const pushM = /^(?:แจ้งเตือน|ข้อความอัตโนมัติ)\s*(เปิด|ปิด)?$/.exec(msg)
  if (pushM) {
    if (!pushM[1]) return [text(`🔔 ข้อความอัตโนมัติ (ตอนตื่น/สรุปค่ำ): ${user.push ? 'เปิด' : 'ปิด'}`, [{ label: '🔔 เปิด', text: 'แจ้งเตือน เปิด' }, { label: '🔕 ปิด', text: 'แจ้งเตือน ปิด' }])]
    await updateUser(env, userId, { push: pushM[1] === 'เปิด' })
    return [text(pushM[1] === 'เปิด' ? '🔔 เปิดแล้ว — จะส่งข้อความหลังคุณตื่นวันละครั้ง' : '🔕 ปิดแล้ว — ยังกดดูทุกอย่างจากเมนูได้ตามปกติ')]
  }

  // 📖 วิธีใช้ (ตามกีฬา)
  if (GUIDE_RE.test(msg)) return guideMessages(user.sport)

  // ⌚ เชื่อม Apple Watch ผ่านคำสั่งลัด (ฟรี)
  if (/^(เชื่อม ?apple( ?watch)?|เชื่อม ?แอปเปิ้ล|apple ?watch|เชื่อม ?นาฬิกา|คำสั่งลัด|shortcuts?)$/i.test(msg)) {
    if (!env.KV) return [text('ระบบยังไม่พร้อม (ไม่มี KV)')]
    return hookSetup(workerOrigin, await hookToken(env.LINE_CHANNEL_SECRET, userId))
  }

  // ── โหมดแบดมินตัน ──
  if (user.sport === 'badminton') {
    const b = await handleBadminton({ ev, msg, user, client, cfg, today })
    if (b) return b
  }

  // ปุ่มเลือกเวลาตื่น
  if (ev.type === 'postback' && ev.postback?.data === 'sleep|wake') {
    const t = ev.postback.params?.time
    if (!t) return [text('ไม่ได้เลือกเวลา', sleepQuick())]
    const sn = await sleepNights(env, user, client)
    return [text(bedtimeText(t, sleepStats(sn.nights, today, cfg.sleepTargetMin)), sleepQuick())]
  }

  // ปุ่ม 💼 ติดงาน
  if (ev.type === 'postback' && ev.postback?.data.startsWith('busy|')) {
    const arg = ev.postback.data.split('|')[1]
    const to = arg === 'pick' ? ev.postback.params?.date : arg === 'sun' ? addDays(today, (7 - dowOf(today)) % 7) : addDays(today, Number(arg) || 0)
    if (!to) return [text('ไม่ได้เลือกวันที่', busyMenu(today))]
    return doBusy(user, to, today)
  }

  // ปุ่มตอบคำถาม
  if (ev.type === 'postback' && ev.postback?.data.startsWith('ans|')) {
    const [, noteDate, qid, yn] = ev.postback.data.split('|')
    const data = await loadAndAnalyze(client, cfg, today)
    if (!data.openQuestions.some((q) => q.id === qid)) return [text('คำถามนี้ตอบไปแล้ว 👍', MENU)]
    await answerQuestion(client, data.notes, noteDate, qid, yn === 'y')
    return [text(yn === 'y' ? '✅ ปรับตารางตามที่เสนอแล้ว — ซิงก์นาฬิกาเพื่ออัปเดต workout' : '👌 คงตารางเดิม', MENU)]
  }
  // 🏁 เพิ่มงานวิ่ง + จัดโปรแกรม (สร้างแผนจาก LINE แล้วเว็บดึงไปด้วย)
  {
    const key = ukey(user, 'runsetup')
    const r = await handleRunSetup({
      ev,
      msg,
      client,
      cfg,
      today,
      webUrl: WEB_URL,
      loadRaces,
      state: {
        get: async () => ((await env.KV?.get(key, 'json')) as RunSetup | null) ?? null,
        put: async (s) => void (await env.KV?.put(key, JSON.stringify(s), { expirationTtl: 3600 })),
        clear: async () => void (await env.KV?.delete(key)),
      },
    })
    if (r) return r
  }

  if (ev.type !== 'message' || ev.message?.type !== 'text') return [text('ตอนนี้โค้ชอ่านได้เฉพาะข้อความตัวอักษรครับ 🙏', MENU)]

  if (/^(เชื่อม ?google|เชื่อมต่อ ?google|google|เชื่อม ?google ?health|connect google)$/i.test(msg)) {
    if (!googleCreds(env) || !env.KV) return [text('ฝั่งระบบยังไม่ได้ใส่ GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET — ทำตามขั้นตอนตั้งค่า Google Cloud ก่อนครับ')]
    const url = `${workerOrigin}/google/login?state=${await makeState(env, userId)}`
    return [text(`🔗 เชื่อม Google Health (ดึงการนอน)\nแตะลิงก์นี้ภายใน 20 นาที → เลือกบัญชี Google ที่ใช้กับแอป Google Health → อนุญาต\n(ถ้าขึ้น "Google hasn't verified this app" กด Advanced → Go to … แล้วไปต่อ เพราะเป็นแอปส่วนตัวของคุณเอง)\n\n${url}`)]
  }
  if (/^(การนอน|นอน|sleep|ซิงก์การนอน|โค้ชการนอน|การ์ดการนอน)$/i.test(msg)) {
    const sn = await sleepNights(env, user, client, true)
    if (sn.error) return [text(`😴 ${sn.error}`, MENU)]
    if (!sn.nights.length) return [text('😴 ยังไม่มีข้อมูลการนอน\n• ใช้ Fitbit/Pixel Watch: พิมพ์ "เชื่อม google"\n• ใช้ Apple Watch: ต้องมีแอป HealthFit (เสียเงินครั้งเดียว) ส่งการนอนเข้า Intervals.icu', MENU)]
    const st = sleepStats(sn.nights, today, cfg.sleepTargetMin)
    const advice = sleepAdvice(st, await todayKind(client, today))
    return [flex(`😴 นอนล่าสุด ${st.last ? dur(st.last.asleepMin) : '-'} · หนี้ ${dur(st.debtMin)}`, sleepFlex(st, advice), sleepQuick())]
  }
  if (/^(นอนกี่โมงดี|คำนวณเวลานอน|ควรนอนกี่โมง|นอนกี่โมง)$/.test(msg)) {
    return [text('🛏 ต้องตื่นกี่โมงครับ? กดเลือกเวลา หรือพิมพ์เช่น "ตื่น 14:00"', sleepQuick())]
  }
  const wakeM = /^(?:ต้อง)?ตื่น\s*(?:ตอน|เวลา)?\s*(\d{1,2})(?:[:.](\d{2}))?\s*(?:น\.?|นาฬิกา)?$/.exec(msg)
  if (wakeM) {
    const h = Number(wakeM[1])
    if (h > 23) return [text('ใส่เวลาแบบ 24 ชม. เช่น "ตื่น 14:00"', sleepQuick())]
    const wake = `${String(h).padStart(2, '0')}:${wakeM[2] ?? '00'}`
    const sn = await sleepNights(env, user, client)
    return [text(bedtimeText(wake, sleepStats(sn.nights, today, cfg.sleepTargetMin)), sleepQuick())]
  }
  if (/^(นอนตอนนี้|จะนอนแล้ว|ไปนอน|จะนอน|นอนเลย)$/.test(msg)) {
    const sn = await sleepNights(env, user, client)
    const st = sleepStats(sn.nights, today, cfg.sleepTargetMin)
    const opts = wakeTimesFrom(nowMs(), st)
    const best = st.debtMin >= 180 ? 6 : 5
    return [text([`⏰ ถ้านอนตอนนี้ (${hhmmNow()}) ตั้งปลุก:`, ...opts.map((o) => `${o.cycles === best ? '⭐' : '•'} ${o.wake}  (${o.cycles} รอบ = ${dur(o.sleepMin)})`), '', `เผื่อเวลากว่าจะหลับ ~${st.latencyMin} นาทีแล้ว`, 'ปิดไฟ ห้องเย็น วางมือถือห่างตัว 🌙 ฝันดีครับ'].join('\n'), sleepQuick())]
  }
  if (/^(งีบ|nap|จะงีบ)$/i.test(msg)) {
    const sn = await sleepNights(env, user, client)
    const st = sleepStats(sn.nights, today, cfg.sleepTargetMin)
    const n = napPlan(nowMs(), st)
    return [text([`😪 งีบตอนนี้ (${hhmmNow()}) ตั้งปลุก:`, `${n.preferFull ? '•' : '⭐'} ${n.power} — งีบสั้น 20 นาที ตื่นมาไม่งัวเงีย`, `${n.preferFull ? '⭐' : '•'} ${n.full} — งีบเต็มรอบ 90 นาที${n.preferFull ? ' (แนะนำ เพราะหนี้การนอนสูง/เมื่อคืนนอนน้อย)' : ''}`, '', 'เลี่ยงงีบ 30–60 นาที (ตื่นกลางหลับลึก จะมึน)', 'ถ้าจะซ้อมหนักหลังงีบ เผื่อเวลาตื่นตัว 20–30 นาที'].join('\n'), sleepQuick())]
  }
  const tgt = /^(?:เป้าการนอน|เป้านอน|นอน ?เป้า)\s*(\d+(?:\.\d+)?)?\s*(?:ชม\.?|ชั่วโมง)?$/.exec(msg)
  if (tgt) {
    const cur = (cfg.sleepTargetMin ?? 450) / 60
    if (!tgt[1]) return [text(`🎯 เป้าการนอนตอนนี้ ${cur} ชม./วัน\nเปลี่ยนได้โดยพิมพ์ เช่น "เป้าการนอน 8"`, [{ label: '7 ชม.', text: 'เป้าการนอน 7' }, { label: '7.5 ชม.', text: 'เป้าการนอน 7.5' }, { label: '8 ชม.', text: 'เป้าการนอน 8' }, { label: '8.5 ชม.', text: 'เป้าการนอน 8.5' }])]
    const h = Number(tgt[1])
    if (h < 5 || h > 10) return [text('ตั้งได้ระหว่าง 5–10 ชม. ครับ')]
    await client.saveConfig({ ...cfg, sleepTargetMin: Math.round(h * 60) })
    return [text(`🎯 ตั้งเป้าการนอน ${h} ชม./วัน แล้ว — หนี้การนอนและคำแนะนำจะคิดจากเป้านี้`, sleepQuick())]
  }
  // 💼 ติดงาน / ⏱ วิ่งสั้น / ✅ กลับมาซ้อม
  if (/^(ติดงาน|ไม่ว่าง|busy)$/i.test(msg)) {
    const events = await client.events(addDays(today, -21), addDays(today, 21))
    const active = busyNotes(events).filter((b) => b.period.to >= today)
    const now = active.length ? `\n\nตอนนี้ตั้งไว้: ${active.map((b) => `${b.period.mode === 'off' ? '💼' : '⏱'} ${rangeLabel(b.period)}`).join(', ')}` : ''
    return [text(`💼 ติดงานถึงวันไหนครับ?\nวันที่เลือกจะไม่นับเป็นขาดซ้อม โค้ชจะย้าย/ข้ามซ้อมให้ และปรับช่วงกลับมาให้เอง\n\nถ้ายุ่งแต่พอวิ่งได้ 20–30 นาที กด "⏱ ยุ่ง วิ่งสั้นวันนี้" ดีกว่าขาดทั้งวัน${now}`, busyMenu(today))]
  }
  const busyN = /^(?:ติดงาน|ไม่ว่าง)\s*(?:วันนี้$|(\d{1,2})\s*วัน|ถึง\s*(.+)|ถึงวันอาทิตย์)$/.exec(msg)
  if (busyN) {
    const to = busyN[1] ? addDays(today, Math.max(1, Number(busyN[1])) - 1) : busyN[2] ? (/อาทิตย์/.test(busyN[2]) ? addDays(today, (7 - dowOf(today)) % 7) : parseDM(busyN[2], today)) : /อาทิตย์/.test(msg) ? addDays(today, (7 - dowOf(today)) % 7) : today
    if (!to) return [text('พิมพ์วันที่แบบ "ติดงาน ถึง 30/11" หรือกดเลือกจากปุ่มได้เลย', busyMenu(today))]
    return doBusy(user, to, today)
  }
  if (/^(วิ่งสั้น|ยุ่ง|วิ่งสั้นวันนี้|วิ่งสั้น พรุ่งนี้|วิ่งสั้นพรุ่งนี้)$/.test(msg)) {
    const day = /พรุ่งนี้/.test(msg) ? addDays(today, 1) : today
    const p = await setShort(client, cfg, day)
    if (!p.createdAt) return [text(`${rangeLabel(p)} ตั้งเป็นวิ่งสั้นไว้แล้วครับ`, AFTER_BUSY)]
    return [text(describeBusy(p), AFTER_BUSY)]
  }
  if (/^(กลับมาซ้อม|กลับมาซ้อมแล้ว|ว่างแล้ว|ยกเลิกติดงาน)$/.test(msg)) {
    const r = await endBusy(client, cfg, today)
    if (!r.ended.length) return [text('ไม่มีช่วงติดงาน/วิ่งสั้นที่ค้างอยู่ครับ ซ้อมตามตารางได้เลย 💪', MENU)]
    const ramp = r.ramp ? `\n\nหยุดไปหลายวัน เลยปรับช่วงกลับมาให้:\n${describeBusy(r.ramp).split('\n').filter((l) => l.startsWith('•')).join('\n')}` : ''
    return [text(`✅ ยินดีต้อนรับกลับครับ!\nยกเลิก ${r.ended.join(', ')} · คืนตารางเดิม ${r.restored} รายการ${ramp}\n\n⌚ ซิงก์นาฬิกาเพื่ออัปเดต workout`, MENU)]
  }

  if (/^(เมนู|menu|สวัสดี|hi|hello|หวัดดี)$/i.test(msg)) return [text(GREETING(cfg.planName), MENU)]
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
    const sn = await sleepNights(env, user, client).catch(() => null)
    return [flex(`📊 สัปดาห์นี้ ${w.actualKm}/${w.plannedKm} กม.`, weeklyFlex(w, cfg.goalSec, shoeWarnings(store, shoeActs), sn?.nights.length ? sleepStats(sn.nights, today, cfg.sleepTargetMin) : undefined), MENU)]
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

  if (/^(ซิงก์|ซิงค์|sync|ปรับตาราง|🔄 ?ซิงก์|อัปเดต|อัพเดท)$/i.test(msg)) {
    // 1) การนอนจาก Google Health  2) ผลวิ่ง/HRV ล่าสุดที่ Garmin ส่งเข้า Intervals  3) โค้ชปรับตาราง  4) สรุป
    const sleep = env.KV && (await env.KV.get(ukey(user, KV_REFRESH))) ? await runSleepSync(env, user, 2) : null
    const lastIso = (await env.KV?.get(ukey(user, KV_LAST_SYNC))) ?? ''
    const data = await loadAndAnalyze(client, cfg, today)
    const r = await commitReport(client, cfg, data, today)
    const fresh = await loadAndAnalyze(client, cfg, today)
    const acts = (await client.activities(addDays(today, -3), today)).filter((a) => (a.distance ?? 0) > 0)
    const newActs = lastIso ? acts.filter((a) => a.start_date_local > lastIso) : acts.slice(-3)
    await env.KV?.put(ukey(user, KV_LAST_SYNC), nowBkkIso())
    const L: string[] = ['🔄 ซิงก์แล้ว', '']
    L.push(
      newActs.length
        ? `🏃 ${lastIso ? 'กิจกรรมใหม่' : 'กิจกรรมล่าสุด'}: ${newActs.map((a) => `${dayLabel(a.start_date_local.slice(0, 10))} ${a.name ?? 'Run'} ${((a.distance ?? 0) / 1000).toFixed(1)} กม.`).join(' · ')}`
        : '🏃 ยังไม่มีกิจกรรมใหม่จาก Garmin (ถ้าเพิ่งวิ่งเสร็จ เปิดแอป Garmin Connect ให้ซิงก์ก่อน แล้วกดอีกครั้ง)',
    )
    if (sleep) L.push(sleep.ok ? `😴 การนอน: ${sleep.text.split('\n').slice(-1)[0]}` : `😴 การนอน: ${sleep.text}`)
    L.push(r.applied ? `🔧 ปรับตาราง ${r.applied} รายการ` : '🔧 ตารางไม่ต้องปรับ')
    L.push('', fresh.report.summary)
    if (r.applied) L.push('', '⌚ เปิดแอป Garmin Connect ให้ซิงก์ workout ที่ปรับแล้วลงนาฬิกา')
    return [text(L.join('\n'), MENU), ...questionMessages(fresh.openQuestions)].slice(0, 5)
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
  const sn = await sleepNights(env, user, client).catch(() => null)
  const sst = sn?.nights.length ? sleepStats(sn.nights, today, cfg.sleepTargetMin) : null
  const sleepCtx = sst
    ? [
        `การนอน (${sn!.source === 'google' ? 'Google Health' : 'นาฬิกา ผ่าน Intervals'}, เป้า ${dur(sst.targetMin)}/วัน${user.isOwner ? ', เจ้าของเปิดร้านอาหาร 24 ชม. เวลานอนไม่ตายตัว' : ''}):`,
        ...sst.nights7.map((n) => `- ตื่น ${n.date}: ${n.start ? `${n.start}–${n.end} ` : ''}หลับ ${dur(n.asleepMin)}${n.napMin ? ` + งีบ ${n.napMin} น.` : ''}`),
        `หนี้การนอน 7 วัน ${dur(sst.debtMin)} · ความสม่ำเสมอ ${sst.regularity ?? '-'} · หลับจริงเฉลี่ย ${sst.effPct ?? '-'}% · กว่าจะหลับ ~${sst.latencyMin} นาที`,
      ]
    : []
  const ctx = buildContext(data, cfg, acts, today, [...sleepCtx, ...(user.sport === 'badminton' ? ['กีฬาหลัก: แบดมินตัน (ไม่ใช่วิ่ง) — ตอบในบริบทแบดมินตัน'] : [])])
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
    const url = new URL(req.url)
    workerOrigin = url.origin
    if (req.method === 'GET' && url.pathname === '/google/login') {
      const creds = googleCreds(env)
      if (!creds) return page('ยังไม่ได้ตั้งค่า', 'ยังไม่มี GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET')
      const state = url.searchParams.get('state')
      if (!(await checkState(env, state))) return page('ลิงก์หมดอายุ', 'พิมพ์ "เชื่อม google" ใน LINE เพื่อขอลิงก์ใหม่')
      return Response.redirect(authUrl(creds, `${url.origin}${REDIRECT_PATH}`, state!), 302)
    }
    if (url.pathname === '/register') {
      if (req.method === 'POST') {
        return handleRegister(req, env, async (uid, name, sport) => {
          await linkRichMenu(env, uid, sport).catch(() => undefined)
          const first =
            sport === 'badminton'
              ? `🏸 ยินดีต้อนรับ ${name}!\nเริ่มจากพิมพ์ "ตั้งค่าแบด" เพื่อบอกวันที่ลงคอร์ดและระดับการเล่น แล้วโค้ชจะจัดตารางฝึกให้\n\nใช้ Apple Watch: พิมพ์ "เชื่อม apple" ให้คู่ซ้อมรู้เองทุกครั้งที่เล่นจบ (ฟรี)\n\n📖 ดูวิธีใช้ทั้งหมด: พิมพ์ "วิธีใช้"`
              : `🏃 ยินดีต้อนรับ ${name}!\nพิมพ์ "วิธีใช้" เพื่อดูวิธีใช้ทีละขั้น · สร้างแผนวิ่งได้ที่แอปคู่ซ้อม https://summertime-2807.github.io/koosom/`
          await linePush(env.LINE_CHANNEL_ACCESS_TOKEN, uid, [text(first, sport === 'badminton' ? BADMINTON_MENU : MENU)])
        })
      }
      const tk = await readRegisterToken(env, url.searchParams.get('t'))
      if (!tk) return errorPage('ลิงก์หมดอายุ', 'ลิงก์ลงทะเบียนใช้ได้ 30 นาที')
      const inv = await readInvite(env, tk.code)
      if (!inv) return errorPage('รหัสเชิญหมดอายุ', 'ขอรหัสเชิญใหม่จากเจ้าของ')
      return registerForm(url.searchParams.get('t')!, inv.sport)
    }
    if (req.method === 'GET' && url.pathname === REDIRECT_PATH) {
      const creds = googleCreds(env)
      if (!creds || !env.KV) return page('ยังไม่ได้ตั้งค่า', 'ระบบยังไม่พร้อม')
      const gUid = await checkState(env, url.searchParams.get('state'))
      const gUser = gUid ? await getUser(env, gUid) : null
      if (!gUser) return page('ลิงก์หมดอายุ', 'พิมพ์ "เชื่อม google" ใน LINE เพื่อขอลิงก์ใหม่')
      if (url.searchParams.get('error')) return page('ยกเลิกแล้ว', `Google ตอบกลับ: ${url.searchParams.get('error')}`)
      try {
        const tok = await exchangeCode(creds, url.searchParams.get('code') ?? '', `${url.origin}${REDIRECT_PATH}`)
        await checkIdentity(tok.access_token!)
        if (tok.refresh_token) await env.KV.put(ukey(gUser, KV_REFRESH), tok.refresh_token)
        else if (!(await env.KV.get(ukey(gUser, KV_REFRESH)))) throw new Error('Google ไม่ส่ง refresh token — ลองเชื่อมใหม่อีกครั้ง')
        const r = await runSleepSync(env, gUser, 7)
        await linePush(env.LINE_CHANNEL_ACCESS_TOKEN, gUser.uid, [text(`✅ เชื่อม Google Health แล้ว\nระบบดึงการนอนให้ทุก 2 ชม. และพิมพ์ "การนอน" ดูได้ตลอด\n\n${r.text}`, MENU)]).catch(() => undefined)
        return page('✅ เชื่อม Google Health สำเร็จ', 'ดึงการนอน 7 วันล่าสุดเข้าโค้ชแล้ว')
      } catch (e) {
        return page('เชื่อมไม่สำเร็จ', (e as Error).message.replace(/</g, '&lt;'))
      }
    }
    // ⌚ คำสั่งลัด Apple Watch: /w/<token>?e=start|end
    if (url.pathname.startsWith(HOOK_PATH)) {
      const hUid = await readHookToken(env.LINE_CHANNEL_SECRET, url.pathname.slice(HOOK_PATH.length))
      const hUser = hUid ? await getUser(env, hUid) : null
      if (!hUser || !env.KV) return new Response('not found', { status: 404 })
      if (req.method !== 'POST') return page('⌚ ลิงก์คำสั่งลัด', 'ลิงก์นี้ใช้ในแอปคำสั่งลัด (วิธี POST) — ไม่ต้องเปิดในเบราว์เซอร์')
      const key = ukey(hUser, KV_HOOK_START)
      const e = url.searchParams.get('e')
      const r = hookDecide(e, e === 'end' ? await env.KV.get(key) : null, Date.now())
      if (r.kind === 'bad') return new Response('bad event', { status: 400 })
      if (r.kind === 'started') {
        await env.KV.put(key, new Date().toISOString(), { expirationTtl: 12 * 3600 })
        return new Response('ok')
      }
      await env.KV.delete(key)
      if (hUser.sport === 'badminton') ctx.waitUntil(linePush(env.LINE_CHANNEL_ACCESS_TOKEN, hUser.uid, hookMessages(r)).catch(() => undefined))
      return new Response('ok')
    }
    if (req.method === 'GET') return new Response('คู่ซ้อม LINE bot OK')
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })
    const body = await req.text()
    if (!(await verify(body, req.headers.get('x-line-signature'), env.LINE_CHANNEL_SECRET))) return new Response('bad signature', { status: 401 })
    const payload = JSON.parse(body) as { events?: LineEvent[]; selftest?: string; relink?: boolean; uid?: string; sport?: Sport }
    // หลังสร้าง rich menu ใหม่: ผูกเมนูแบดให้ผู้ใช้โหมดแบดอีกครั้ง
    if (payload.relink) {
      const ids = (await listMembers(env)).filter((m) => m.sport === 'badminton').map((m) => m.uid)
      const owner = env.LINE_USER_ID ? await getUser(env, env.LINE_USER_ID) : null
      if (owner?.sport === 'badminton') ids.push(owner.uid)
      for (const id of ids) await linkRichMenu(env, id, 'badminton').catch(() => undefined)
      return Response.json({ relinked: ids.length })
    }
    // ทดสอบตัวเอง (ต้องเซ็นด้วย channel secret): รันคำสั่ง แล้วให้ LINE ตรวจรูปแบบข้อความโดยไม่ส่งจริง
    // คืนเฉพาะสถานะ ไม่คืนเนื้อหา (log ของ GitHub Actions เป็นสาธารณะ)
    if (payload.selftest === '__google') {
      const owner = (await getUser(env, env.LINE_USER_ID ?? ''))!
      const st = await env.KV?.get(ukey(owner, KV_STATUS))
      const refresh = await env.KV?.get(ukey(owner, KV_REFRESH))
      const creds = googleCreds(env)
      const ss = refresh ? await loadSleepStore(clientOf(owner)).catch(() => null) : null
      const ln = ss?.nights.at(-1)
      const wake = ln ? { nights: ss!.nights.length, lastIsToday: ln.date === todayBkk(), minsSinceEnd: ln.endMs ? Math.round((Date.now() - ln.endMs) / 60000) : null, notifiedToday: (await env.KV?.get(ukey(owner, KV_WAKE))) === todayBkk() } : null
      return Response.json({ cmd: '__google', kv: !!env.KV, creds: !!creds, connected: !!refresh, last: st ? JSON.parse(st) : null, wake, members: (await listMembers(env)).length })
    }
    if (payload.selftest === '__hook') {
      const sets = [hookMessages({ kind: 'ended', minutes: 95 }), hookMessages({ kind: 'ended', minutes: null }), hookMessages({ kind: 'test', minutes: 3 })]
      const res = []
      for (const msgs of sets) {
        const v = await fetch('https://api.line.me/v2/bot/message/validate/push', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` }, body: JSON.stringify({ messages: msgs }) })
        res.push({ valid: v.status, error: v.ok ? undefined : (await v.text()).slice(0, 200) })
      }
      const tok = await hookToken(env.LINE_CHANNEL_SECRET, 'Uselftest')
      const tokenOk = (await readHookToken(env.LINE_CHANNEL_SECRET, tok)) === 'Uselftest' && (await readHookToken(env.LINE_CHANNEL_SECRET, 'AAAA.0000')) === null
      return Response.json({ cmd: '__hook', res, tokenOk })
    }
    if (payload.selftest) {
      const t0 = Date.now()
      try {
        const src = { userId: payload.uid ?? env.LINE_USER_ID }
        const stEv = (payload.selftest.startsWith('pb:') ? { type: 'postback', replyToken: 'selftest', source: src, postback: { data: payload.selftest.slice(3) } } : { type: 'message', replyToken: 'selftest', source: src, message: { type: 'text', text: payload.selftest } }) as LineEvent
        const msgs = await handle(stEv, env, { sport: payload.sport })
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

  /** cron (เวลา UTC ใน wrangler.toml): ดึงการนอนจาก Google Health ก่อนงานโค้ชตอนเช้า/คืน */
  async scheduled(_ev: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        const owner = env.LINE_USER_ID ? await getUser(env, env.LINE_USER_ID) : null
        if (owner) await wakeCheck(env, owner).catch(() => undefined)
        // ⌚ เริ่มเวิร์กเอาท์แล้วแต่ไม่ได้รับ "จบ" (คำสั่งลัดไม่ทำงาน) → ทักถามเวลาเล่นแทน
        for (const m of (await listMembers(env)).filter((x) => x.sport === 'badminton').slice(0, 20)) {
          const u = await getUser(env, m.uid).catch(() => null)
          const key = u ? ukey(u, KV_HOOK_START) : ''
          const st = u ? await env.KV?.get(key) : null
          if (!u || !st || Date.now() - Date.parse(st) < HOOK_STALE_MIN * 60000) continue
          await env.KV?.delete(key)
          await linePush(env.LINE_CHANNEL_ACCESS_TOKEN, u.uid, hookMessages({ kind: 'ended', minutes: null })).catch(() => undefined)
        }
        // ผู้ใช้อื่นที่เปิดรับข้อความอัตโนมัติ (จำกัด 10 คนต่อรอบ)
        for (const m of (await listMembers(env)).filter((x) => x.push).slice(0, 10)) {
          const u = await getUser(env, m.uid).catch(() => null)
          if (u) await wakeCheck(env, u).catch(() => undefined)
        }
      })(),
    )
  },
}
