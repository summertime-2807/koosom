// ─────────────────────────────────────────────────────────────
// 🏸 คำสั่ง LINE ของโหมดแบดมินตัน
// ─────────────────────────────────────────────────────────────
import type { IntervalsClient } from './intervals'
import type { CoachConfig, IcuEvent } from './types'
import type { User } from './users'
import type { LineMessage, QuickItem } from './line'
import { dayLabel, flex, text } from './line'
import { battery, overallLight, lightDot } from './engine'
import type { SleepStats } from './sleepCoach'
import { dur, sleepAdvice } from './sleepCoach'
import { addDays, daysBetween } from '../engine/trainingEngine'
import {
  B_EXT_PREFIX,
  COOLDOWN,
  DOW_SHORT,
  LEVEL_TH,
  PREHAB,
  WARMUP,
  defaultBStore,
  loadStatus,
  parseLog,
  planBadminton,
  sessionsFrom,
  slotToEvent,
  tournamentTips,
} from './badminton'
import type { BLevel, BLog, BStore, LoadStatus } from './badminton'

export const B_STORE_ID = 'raceplan-badminton'
export const B_STORE_DATE = '2020-01-04'

export const BADMINTON_MENU: QuickItem[] = [
  { label: '📅 วันนี้', text: 'วันนี้' },
  { label: '🗓 สัปดาห์', text: 'สัปดาห์' },
  { label: '🏸 บันทึกเล่น', text: 'บันทึกเล่น' },
  { label: '📈 ภาระ', text: 'ภาระ' },
  { label: '🩹 กันเจ็บ', text: 'กันเจ็บ' },
  { label: '🔥 วอร์ม', text: 'วอร์ม' },
  { label: '😴 การนอน', text: 'การนอน' },
  { label: '🏆 แข่ง', text: 'แข่ง' },
  { label: '⚙️ ตั้งค่าแบด', text: 'ตั้งค่าแบด' },
]

export async function loadB(client: IntervalsClient): Promise<BStore> {
  const { data } = await client.loadJson<BStore>(B_STORE_ID, B_STORE_DATE)
  return { ...defaultBStore(), ...(data ?? {}) }
}
export function saveB(client: IntervalsClient, s: BStore) {
  const cut = addDays(new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10), -60)
  s.logs = s.logs.filter((l) => l.date >= cut)
  return client.saveJson(B_STORE_ID, B_STORE_DATE, '🏸 แบดมินตัน (คู่ซ้อม · อย่าลบ)', s, 'ค่าตั้งค่าและบันทึกแบดมินตัน')
}

/** สร้าง/อัปเดตตาราง 4 สัปดาห์ (ลบของเดิมที่ยังไม่ถึงวันก่อน) */
export async function regenPlan(client: IntervalsClient, s: BStore, today: string): Promise<number> {
  const from = today
  const to = addDays(today, 34)
  const old = (await client.events(from, to)).filter((e) => e.external_id?.startsWith(B_EXT_PREFIX))
  for (const e of old) await client.deleteEvent(e.id)
  const slots = planBadminton(s, today, 5).filter((x) => x.date >= today && x.date <= to)
  if (slots.length) await client.upsertEvents(slots.map(slotToEvent))
  return slots.length
}

const bEvents = (evs: IcuEvent[], d: string) => evs.filter((e) => e.external_id?.startsWith(B_EXT_PREFIX) && e.start_date_local.slice(0, 10) === d)

// ── flex เล็ก ๆ ──
const C = { bg: '#0f172a', card: '#1e293b', text: '#f1f5f9', sub: '#94a3b8', accent: '#34d399', warn: '#fbbf24', bad: '#f87171', track: '#334155', blue: '#38bdf8' }
type N = Record<string, unknown>
const t = (s: string, o: N = {}): N => ({ type: 'text', text: s || ' ', color: C.text, size: 'sm', wrap: true, ...o })
const bx = (layout: string, contents: N[], o: N = {}): N => ({ type: 'box', layout, contents, ...o })
const kv = (k: string, v: string, color = C.text): N => bx('horizontal', [t(k, { color: C.sub, flex: 5 }), t(v, { color, align: 'end', flex: 5, weight: 'bold' })], { margin: 'sm' })

export function loadFlex(ls: LoadStatus): N {
  const max = Math.max(1, ...ls.days.map((d) => d.load))
  const zc = ls.zone === 'พอดี' ? C.accent : ls.zone === 'ระวัง' || ls.zone === 'ต่ำ' ? C.warn : ls.zone === 'สูงเสี่ยงเจ็บ' ? C.bad : C.sub
  const rows = ls.days.map((d) => {
    const w = Math.round((d.load / max) * 100)
    return bx(
      'horizontal',
      [
        t(dayLabel(d.date), { size: 'xs', color: C.sub, flex: 3 }),
        bx('horizontal', [bx('vertical', [], { flex: Math.max(w, 0), backgroundColor: C.blue, height: '10px', cornerRadius: '3px' }), bx('vertical', [], { flex: Math.max(100 - w, 1), height: '10px' })], { flex: 6, offsetTop: '5px' }),
        t(d.minutes ? `${d.minutes} น.` : '—', { size: 'xs', align: 'end', flex: 2 }),
      ],
      { margin: 'sm' },
    )
  })
  return {
    type: 'bubble',
    size: 'mega',
    styles: { header: { backgroundColor: C.card }, body: { backgroundColor: C.bg } },
    header: bx('vertical', [t('📈 ภาระการเล่น/ฝึก', { size: 'lg', weight: 'bold' }), t('เวลา × ความเหนื่อย (1–10) · 7 วันล่าสุด', { size: 'xs', color: C.sub })], { paddingAll: '16px' }),
    body: bx(
      'vertical',
      [
        bx('baseline', [t(ls.acwr != null ? `${ls.acwr}×` : '—', { size: '3xl', weight: 'bold', color: zc, flex: 0 }), t(` ${ls.zone}`, { color: zc, flex: 0, margin: 'sm', weight: 'bold' })]),
        t('เทียบภาระ 7 วันกับค่าเฉลี่ย 4 สัปดาห์ (พอดี 0.8–1.3)', { size: 'xxs', color: C.sub }),
        { type: 'separator', color: C.track, margin: 'md' },
        kv('เล่น/ฝึก 7 วัน', `${ls.sessions7} ครั้ง · ${ls.hours7} ชม.`),
        kv('ภาระ 7 วัน / เฉลี่ยต่อสัปดาห์', `${ls.acute} / ${ls.chronicWeekly}`),
        ...(ls.hardStreak >= 2 ? [kv('หนักติดกัน', `${ls.hardStreak} วัน`, ls.hardStreak >= 3 ? C.bad : C.warn)] : []),
        { type: 'separator', color: C.track, margin: 'md' },
        ...rows,
        ...(ls.warnings.length ? [{ type: 'separator', color: C.track, margin: 'md' }, ...ls.warnings.map((w) => t(`⚠️ ${w}`, { size: 'xs', margin: 'sm', color: C.warn }))] : [t('👍 ภาระอยู่ในช่วงปลอดภัย', { size: 'xs', margin: 'md', color: C.accent })]),
      ],
      { paddingAll: '16px', spacing: 'xs' },
    ),
  }
}

const rpePicker = (prefix: string): QuickItem[] =>
  [3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ label: `${n}${n <= 3 ? ' สบาย' : n <= 5 ? ' พอเหนื่อย' : n <= 7 ? ' เหนื่อย' : n <= 9 ? ' หนักมาก' : ' สุดแรง'}`, data: `${prefix}|${n}`, text: `เหนื่อย ${n}/10` }))

async function statusFor(client: IntervalsClient, s: BStore, cfg: CoachConfig, today: string) {
  const acts = await client.activities(addDays(today, -35), today)
  const sessions = sessionsFrom(acts, s, cfg.maxHr)
  return { sessions, ls: loadStatus(sessions, today) }
}

export interface BCtx {
  ev: { type: string; postback?: { data: string; params?: { date?: string; time?: string } } }
  msg: string
  user: User
  client: IntervalsClient
  cfg: CoachConfig
  today: string
}

function setupLevel(): LineMessage {
  return text('⚙️ ตั้งค่าแบด (1/4)\nเล่นแนวไหนเป็นหลักครับ?', [
    { label: '🏸 ก๊วน/สุขภาพ', data: 'bset|level|casual', text: 'เล่นก๊วน/สุขภาพ' },
    { label: '📈 อยากเก่งขึ้น', data: 'bset|level|improve', text: 'อยากเก่งขึ้น' },
    { label: '🏆 ลงแข่ง', data: 'bset|level|compete', text: 'ลงแข่ง' },
  ])
}
function setupDays(s: BStore): LineMessage {
  const sel = s.courtDays.length ? s.courtDays.sort().map((d) => DOW_SHORT[d]).join(' ') : 'ยังไม่ได้เลือก'
  return text(`⚙️ ตั้งค่าแบด (2/4)\nลงคอร์ดวันไหนบ้าง? แตะเพื่อเลือก/ยกเลิก แล้วกด ✅ เสร็จ\n\nเลือกแล้ว: ${sel}`, [
    ...[1, 2, 3, 4, 5, 6, 0].map((d) => ({ label: `${s.courtDays.includes(d) ? '✅ ' : ''}${DOW_SHORT[d]}`, data: `bset|day|${d}`, text: DOW_SHORT[d] })),
    { label: '✅ เสร็จ', data: 'bset|daysdone', text: 'เลือกวันเสร็จแล้ว' },
  ])
}
function setupMin(): LineMessage {
  return text('⚙️ ตั้งค่าแบด (3/4)\nลงคอร์ดครั้งละประมาณกี่นาที?', [60, 90, 120, 150, 180].map((m) => ({ label: `${m} นาที`, data: `bset|min|${m}`, text: `${m} นาที` })))
}
function setupExtra(): LineMessage {
  return text('⚙️ ตั้งค่าแบด (4/4)\nฝึกเสริมนอกคอร์ด (ฟุตเวิร์ก/เวท/ยืด ทำที่บ้านได้) สัปดาห์ละกี่วัน?', [
    { label: '1 วัน', data: 'bset|extra|1', text: '1 วัน' },
    { label: '2 วัน', data: 'bset|extra|2', text: '2 วัน' },
    { label: '3 วัน', data: 'bset|extra|3', text: '3 วัน' },
  ])
}

function todayText(evs: IcuEvent[], d: string, label: string): string[] {
  const xs = bEvents(evs, d)
  if (!xs.length) return [`📅 ${label} (${dayLabel(d)}): พัก 😌 (เดินเล่น/ยืดเบา ๆ ได้)`]
  return xs.flatMap((e) => [`📅 ${label} (${dayLabel(d)}): ${e.name}`, e.description ?? ''])
}

function parseDM(s: string, today: string): string | undefined {
  const m = /(\d{1,2})\s*[/.-]\s*(\d{1,2})/.exec(s)
  if (!m) return undefined
  const y = Number(today.slice(0, 4))
  const mk = (yy: number) => `${yy}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`
  return mk(y) < today ? mk(y + 1) : mk(y)
}

export async function handleBadminton(c: BCtx): Promise<LineMessage[] | null> {
  const { ev, msg, client, cfg, today } = c
  const pb = ev.type === 'postback' ? ev.postback?.data ?? '' : ''

  // ── ตั้งค่า ──
  if (pb.startsWith('bset|') || /^(ตั้งค่าแบด|ตั้งค่า)$/.test(msg)) {
    const s = await loadB(client)
    if (!pb) return [setupLevel()]
    const [, step, val] = pb.split('|')
    if (step === 'level') {
      s.level = val as BLevel
      await saveB(client, s)
      return [setupDays(s)]
    }
    if (step === 'day') {
      const d = Number(val)
      s.courtDays = s.courtDays.includes(d) ? s.courtDays.filter((x) => x !== d) : [...s.courtDays, d]
      await saveB(client, s)
      return [setupDays(s)]
    }
    if (step === 'daysdone') return s.courtDays.length ? [setupMin()] : [setupDays(s)]
    if (step === 'min') {
      s.courtMin = Number(val)
      await saveB(client, s)
      return [setupExtra()]
    }
    if (step === 'extra') {
      s.extraDays = Number(val)
      s.setupDone = true
      await saveB(client, s)
      const n = await regenPlan(client, s, today)
      return [
        text(
          `✅ ตั้งค่าเสร็จ!\n• ระดับ: ${LEVEL_TH[s.level]}\n• ลงคอร์ด: ${s.courtDays.sort().map((d) => DOW_SHORT[d]).join(' ')} ครั้งละ ${s.courtMin} นาที\n• ฝึกเสริม: ${s.extraDays} วัน/สัปดาห์\n\nจัดตาราง 5 สัปดาห์ให้แล้ว (${n} รายการ)\nมีแข่งเมื่อไหร่ พิมพ์ เช่น "แข่ง 20/12 ชิงแชมป์จังหวัด" ตารางจะลดหนักก่อนแข่งให้เอง`,
          BADMINTON_MENU,
        ),
      ]
    }
  }

  const s = await loadB(client)
  if (!s.setupDone && /^(วันนี้|สัปดาห์|จัดตาราง)$/.test(msg)) return [text('ยังไม่ได้ตั้งค่าแบดครับ เริ่มกันเลย 👇'), setupLevel()]

  // ── ให้คะแนนความเหนื่อย ──
  if (pb.startsWith('rpe|')) {
    const [, actId, n] = pb.split('|')
    s.rpeByActivity[actId] = Number(n)
    await saveB(client, s)
    const { ls } = await statusFor(client, s, cfg, today)
    return [text(`👍 บันทึกความเหนื่อย ${n}/10 แล้ว\nภาระตอนนี้: ${ls.acwr != null ? `${ls.acwr}× (${ls.zone})` : ls.zone}${ls.warnings[0] ? `\n⚠️ ${ls.warnings[0]}` : ''}`, BADMINTON_MENU)]
  }
  // ⌚ หลังจบเวิร์กเอาท์จาก Apple Watch (คำสั่งลัด): เลือกประเภท → ให้คะแนนความเหนื่อย
  if (pb === 'hk|skip') return [text('โอเค ไม่บันทึกครั้งนี้ครับ', BADMINTON_MENU)]
  if (pb.startsWith('hk|')) {
    const [, min, kind, n] = pb.split('|')
    const k = (['court', 'train', 'match'].includes(kind) ? kind : 'court') as BLog['kind']
    const label = k === 'match' ? 'แข่ง' : k === 'train' ? 'ฝึกเสริม' : 'แบด'
    if (!n) return [text(`${label} ${min} นาที — เหนื่อยแค่ไหน? (1 = สบายมาก, 10 = สุดแรง)`, rpePicker(`hk|${min}|${k}`))]
    s.logs.push({ id: `l${Date.now().toString(36)}`, date: today, minutes: Number(min), rpe: Number(n), kind: k })
    await saveB(client, s)
    const { ls } = await statusFor(client, s, cfg, today)
    return [text(`✅ บันทึก${label} ${min} นาที เหนื่อย ${n}/10\nภาระ: ${ls.acwr != null ? `${ls.acwr}× (${ls.zone})` : 'ข้อมูลยังน้อย (ครบ 3 สัปดาห์จะเริ่มประเมินได้)'}${ls.warnings[0] ? `\n⚠️ ${ls.warnings[0]}` : ''}${k !== 'train' ? '\n\nอย่าลืมคูลดาวน์ + ยืด 5 นาที 🧘' : ''}`, BADMINTON_MENU)]
  }
  if (pb.startsWith('blog|')) {
    const [, min, n] = pb.split('|')
    if (!n) return [text(`🏸 ${min} นาที — เหนื่อยแค่ไหน? (1 = สบายมาก, 10 = สุดแรง)`, rpePicker(`blog|${min}`))]
    s.logs.push({ id: `l${Date.now().toString(36)}`, date: today, minutes: Number(min), rpe: Number(n), kind: 'court' })
    await saveB(client, s)
    const { ls } = await statusFor(client, s, cfg, today)
    return [text(`✅ บันทึก แบด ${min} นาที เหนื่อย ${n}/10\nภาระ: ${ls.acwr != null ? `${ls.acwr}× (${ls.zone})` : 'ข้อมูลยังน้อย (ครบ 3 สัปดาห์จะเริ่มประเมินได้)'}${ls.warnings[0] ? `\n⚠️ ${ls.warnings[0]}` : ''}\n\nอย่าลืมคูลดาวน์ + ยืด 5 นาที 🧘`, BADMINTON_MENU)]
  }
  if (/^(บันทึกเล่น|บันทึก|เล่นเสร็จ)$/.test(msg)) {
    const acts = await client.activities(addDays(today, -2), today)
    const unrated = acts.filter((a) => (a.moving_time ?? 0) >= 600 && s.rpeByActivity[a.id] == null).at(-1)
    if (unrated)
      return [text(`⌚ เจอกิจกรรมจากนาฬิกา: ${unrated.name ?? unrated.type} ${Math.round((unrated.moving_time ?? 0) / 60)} นาที (${dayLabel(unrated.start_date_local.slice(0, 10))})\nเหนื่อยแค่ไหนครับ?`, rpePicker(`rpe|${unrated.id}`))]
    return [text('🏸 เล่นไปกี่นาที?\nพิมพ์เองก็ได้ เช่น "แบด 90 นาที เหนื่อย 7"\n(อยากให้บันทึกเองจาก Apple Watch: พิมพ์ "เชื่อม apple")', [60, 90, 120, 150, 180].map((m) => ({ label: `${m} นาที`, data: `blog|${m}`, text: `เล่น ${m} นาที` })))]
  }
  const lg = parseLog(msg, today)
  if (lg) {
    if (lg.rpe == null) return [text(`🏸 ${lg.minutes} นาที — เหนื่อยแค่ไหน?`, rpePicker(`blog|${lg.minutes}`))]
    s.logs.push({ id: `l${Date.now().toString(36)}`, date: lg.date, minutes: lg.minutes, rpe: lg.rpe, kind: lg.kind })
    await saveB(client, s)
    const { ls } = await statusFor(client, s, cfg, today)
    return [text(`✅ บันทึก ${lg.kind === 'match' ? 'แข่ง' : 'แบด'} ${lg.minutes} นาที เหนื่อย ${lg.rpe}/10 (${dayLabel(lg.date)})\nภาระ: ${ls.acwr != null ? `${ls.acwr}× (${ls.zone})` : 'ข้อมูลยังน้อย'}${ls.warnings[0] ? `\n⚠️ ${ls.warnings[0]}` : ''}`, BADMINTON_MENU)]
  }

  // ── วันนี้ / สัปดาห์ / จัดตาราง ──
  if (/^(วันนี้|ซ้อม|today|วันนี้ฝึกอะไร|พรุ่งนี้)$/.test(msg)) {
    const evs = await client.events(today, addDays(today, 1))
    const w = await client.wellness(addDays(today, -8), today)
    const b = battery(w, today)
    const ov = overallLight(b)
    const { ls } = await statusFor(client, s, cfg, today)
    const L = [...todayText(evs, today, 'วันนี้'), '', ...todayText(evs, addDays(today, 1), 'พรุ่งนี้'), '', `${lightDot(ov)} แบตเตอรี่ร่างกาย · 📈 ภาระ ${ls.acwr != null ? `${ls.acwr}× ${ls.zone}` : ls.zone}`]
    if (ov === 'red' || ls.zone === 'สูงเสี่ยงเจ็บ') L.push('⚠️ วันนี้ควรเล่นเบาลง หรือเปลี่ยนเป็นยืดเหยียด')
    for (const x of ls.warnings.slice(0, 1)) L.push(`⚠️ ${x}`)
    return [text(L.join('\n').trim(), BADMINTON_MENU)]
  }
  if (/^(สัปดาห์|week|7 ?วัน)$/.test(msg)) {
    const evs = await client.events(today, addDays(today, 6))
    const L = ['🗓 7 วันข้างหน้า']
    for (let i = 0; i < 7; i++) {
      const d = addDays(today, i)
      const xs = bEvents(evs, d)
      L.push(`${dayLabel(d)}  ${xs.length ? xs.map((e) => e.name).join(', ') : '— พัก'}`)
    }
    return [text(L.join('\n'), [...BADMINTON_MENU.slice(0, 4), { label: '🔄 จัดตารางใหม่', text: 'จัดตาราง' }])]
  }
  if (/^(จัดตาราง|จัดตารางใหม่|ซิงก์|ซิงค์|sync)$/i.test(msg)) {
    const n = await regenPlan(client, s, today)
    const acts = await client.activities(addDays(today, -2), today)
    const unrated = acts.filter((a) => (a.moving_time ?? 0) >= 600 && s.rpeByActivity[a.id] == null).at(-1)
    const out: LineMessage[] = [text(`🔄 จัดตาราง 5 สัปดาห์ใหม่แล้ว (${n} รายการ) ตามวันลงคอร์ดและรายการแข่ง`, BADMINTON_MENU)]
    if (unrated) out.push(text(`⌚ ${unrated.name ?? unrated.type} ${Math.round((unrated.moving_time ?? 0) / 60)} นาที ยังไม่ได้ให้คะแนน — เหนื่อยแค่ไหน?`, rpePicker(`rpe|${unrated.id}`)))
    return out
  }

  // ── ภาระ ──
  if (/^(ภาระ|โหลด|load|ภาระการฝึก)$/i.test(msg)) {
    const { ls } = await statusFor(client, s, cfg, today)
    return [flex(`📈 ภาระ ${ls.acwr != null ? `${ls.acwr}× ${ls.zone}` : ls.zone}`, loadFlex(ls), BADMINTON_MENU)]
  }

  // ── กันเจ็บ / วอร์ม / คูลดาวน์ ──
  if (/^(วอร์ม|วอร์มอัพ|warm ?up)$/i.test(msg)) return [text(`🔥 วอร์มอัพก่อนลงคอร์ด (8–10 นาที)\n${WARMUP.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\nเหงื่อซึม ๆ = พร้อม 💪`, BADMINTON_MENU)]
  if (/^(คูลดาวน์|cool ?down|ยืด)$/i.test(msg)) return [text(`🧘 คูลดาวน์หลังเล่น (5–8 นาที)\n${COOLDOWN.map((x, i) => `${i + 1}. ${x}`).join('\n')}`, BADMINTON_MENU)]
  const pre = /^กันเจ็บ\s*(.*)$/.exec(msg)
  if (pre) {
    const area = Object.keys(PREHAB).find((k) => pre[1] && (pre[1].includes(k) || k.includes(pre[1].trim())))
    if (!area) return [text('🩹 กันบาดเจ็บส่วนไหนครับ? ทำสัปดาห์ละ 2–3 ครั้ง ครั้งละ 10 นาที', Object.keys(PREHAB).map((k) => ({ label: k, text: `กันเจ็บ ${k}` })))]
    const p = PREHAB[area]
    return [text(`🩹 ${p.title}\n${p.items.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\n🚩 ${p.redFlags}\n\nเจ็บอยู่แล้ว พิมพ์ "เจ็บ <อาการ>" เพื่อบันทึก แล้วถามโค้ชได้`, BADMINTON_MENU)]
  }

  // ── แข่ง ──
  const add = /^แข่ง\s+(\d{1,2}\s*[/.-]\s*\d{1,2})\s*(.*)$/.exec(msg)
  if (add) {
    const d = parseDM(add[1], today)
    if (!d) return [text('พิมพ์แบบ "แข่ง 20/12 ชื่อรายการ" ครับ')]
    s.tournaments = [...s.tournaments.filter((x) => x.date !== d), { date: d, name: add[2].trim() || 'รายการแข่ง' }].sort((a, b) => a.date.localeCompare(b.date))
    await saveB(client, s)
    await regenPlan(client, s, today)
    const left = daysBetween(today, d)
    return [text(`🏆 เพิ่ม "${add[2].trim() || 'รายการแข่ง'}" ${dayLabel(d)} (อีก ${left} วัน)\nปรับตารางให้ลดหนักช่วง 7 วันก่อนแข่งแล้ว`, BADMINTON_MENU)]
  }
  const delT = /^ลบแข่ง\s*(.*)$/.exec(msg)
  if (delT) {
    const before = s.tournaments.length
    s.tournaments = s.tournaments.filter((x) => !(x.name.includes(delT[1].trim()) || parseDM(delT[1], today) === x.date))
    await saveB(client, s)
    await regenPlan(client, s, today)
    return [text(before !== s.tournaments.length ? '🗑 ลบรายการแข่งแล้ว และจัดตารางใหม่' : 'ไม่พบรายการนั้น', BADMINTON_MENU)]
  }
  if (/^(แข่ง|ทัวร์นาเมนต์|รายการแข่ง)$/.test(msg)) {
    const next = s.tournaments.find((x) => x.date >= today)
    if (!next) return [text('ยังไม่มีรายการแข่งครับ\nเพิ่มได้โดยพิมพ์ เช่น "แข่ง 20/12 ชิงแชมป์จังหวัด"', BADMINTON_MENU)]
    const left = daysBetween(today, next.date)
    const tip = tournamentTips(left)
    const others = s.tournaments.filter((x) => x.date > next.date).map((x) => `• ${dayLabel(x.date)} ${x.name}`)
    return [text(`🏆 ${next.name} · ${dayLabel(next.date)}\n${left > 0 ? `อีก ${left} วัน` : 'วันนี้! สู้ ๆ'}\n\n✅ ${tip.title}\n${tip.tips.map((x) => `• ${x}`).join('\n')}${others.length ? `\n\nรายการถัดไป:\n${others.join('\n')}` : ''}`, BADMINTON_MENU)]
  }

  if (/^(เมนู|menu|สวัสดี|hi|hello|หวัดดี)$/i.test(msg))
    return [text(`สวัสดีครับ 🏸 โค้ชคู่ซ้อม (แบดมินตัน)\nแตะเมนูด้านล่าง หรือพิมพ์ถามอะไรก็ได้ เช่น\n• "ไหล่ขวาตึงหลังตบ ควรพักไหม"\n• "ก่อนแข่งควรกินอะไร"\n\nบันทึกเร็ว: "แบด 90 นาที เหนื่อย 7"\n📖 ไม่แน่ใจ พิมพ์ "วิธีใช้"`, BADMINTON_MENU)]
  if (/^(เพิ่มเติม|more)$/i.test(msg)) return [text('เลือกได้เลยครับ 👇', [{ label: '📖 วิธีใช้', text: 'วิธีใช้' }, ...BADMINTON_MENU.slice(4), { label: '🔔 แจ้งเตือน', text: 'แจ้งเตือน' }, { label: '⌚ เชื่อม Apple Watch', text: 'เชื่อม apple' }, { label: '🔗 เชื่อม Google', text: 'เชื่อม google' }, { label: '🔄 จัดตารางใหม่', text: 'จัดตาราง' }])]

  return null // ให้คำสั่งร่วม (การนอน, ถามโค้ช AI, เจ็บ ฯลฯ) จัดการต่อ
}

/** ข้อความ "ตื่นแล้ว" สำหรับคนเล่นแบด */
export async function badmintonWake(client: IntervalsClient, cfg: CoachConfig, today: string, st: SleepStats, firstLine: string): Promise<LineMessage[]> {
  const s = await loadB(client)
  const evs = await client.events(today, today)
  const { ls, sessions } = await statusFor(client, s, cfg, today)
  const xs = bEvents(evs, today)
  const kind = xs.some((e) => /ลงคอร์ด|แข่ง|อินเทอร์วัล|ฟุตเวิร์ก/.test(e.name ?? '')) ? 'quality' : xs.length ? 'easy' : 'rest'
  const L = [firstLine, `หนี้การนอน 7 วัน ${dur(st.debtMin)} · 📈 ภาระ ${ls.acwr != null ? `${ls.acwr}× ${ls.zone}` : ls.zone}`, '']
  L.push(...sleepAdvice(st, kind).slice(0, 2).map((a) => `💡 ${a.replace(/วิ่งง่าย/g, 'เล่นเบา/ยืดเหยียด').replace(/วิ่ง/g, 'เล่น')}`))
  for (const w of ls.warnings.slice(0, 1)) L.push(`⚠️ ${w}`)
  L.push('', ...todayText(evs, today, 'วันนี้'))
  const next = s.tournaments.find((x) => x.date >= today)
  if (next && daysBetween(today, next.date) <= 7) L.push('', `🏆 ${next.name} อีก ${daysBetween(today, next.date)} วัน — ${tournamentTips(daysBetween(today, next.date)).tips[0]}`)
  const out: LineMessage[] = [text(L.join('\n').trim(), BADMINTON_MENU)]
  const unrated = sessions.filter((x) => x.source === 'watch' && !x.rated && x.date >= addDays(today, -1)).at(-1)
  if (unrated?.activityId) out.push(text(`⌚ ${unrated.name} ${unrated.minutes} นาที เมื่อ${dayLabel(unrated.date)} — เหนื่อยแค่ไหนครับ?`, rpePicker(`rpe|${unrated.activityId}`)))
  return out
}
