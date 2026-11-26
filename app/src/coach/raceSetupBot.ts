// ─────────────────────────────────────────────────────────────
// 🏁 คำสั่ง LINE: เพิ่มงานวิ่ง + จัดโปรแกรมซ้อม (ไม่ต้องเข้าเว็บ)
// งานวิ่ง [คำค้น] → เลือกงาน/ระยะ → เลือกเป้า → ยืนยัน → ส่งเข้า Garmin + เว็บ
// ─────────────────────────────────────────────────────────────
import type { CalendarRace } from '../types/race'
import type { CoachConfig } from './types'
import type { IntervalsClient } from './intervals'
import type { LineMessage, QuickItem } from './line'
import { dayLabel, flex, text, MENU } from './line'
import { addDays, daysBetween } from '../engine/trainingEngine'
import { fmtPace, parseHMS } from '../lib/time'
import type { RunSetup } from './raceSetup'
import { FEAS_TH, MIN_DAYS, applyRunPlan, buildRunPlan, distancesOf, estimateInput, fmtHMS, goalOptions, kmLabel, paceOf, planName, upcomingRaces } from './raceSetup'

export interface RunSetupCtx {
  ev: { type: string; postback?: { data: string } }
  msg: string
  client: IntervalsClient
  cfg: CoachConfig
  today: string
  state: { get(): Promise<RunSetup | null>; put(s: RunSetup): Promise<void>; clear(): Promise<void> }
  loadRaces: () => Promise<CalendarRace[]>
  webUrl: string
}

export const RUN_SETUP_RE = /^(งานวิ่ง|เพิ่มงานวิ่ง|สร้างแผน|สร้างแผนวิ่ง|แผนใหม่|เลือกงานวิ่ง|เปลี่ยนงานวิ่ง)(?:\s+(.+))?$/

type N = Record<string, unknown>
const C = { bg: '#0f172a', card: '#1e293b', text: '#f1f5f9', sub: '#94a3b8', btn: '#0ea5e9' }
const t = (s: string, o: N = {}): N => ({ type: 'text', text: s || ' ', color: C.text, size: 'sm', wrap: true, ...o })

function raceBubble(r: CalendarRace, i: number, today: string): N {
  const left = daysBetween(today, r.date!)
  return {
    type: 'bubble',
    size: 'kilo',
    styles: { body: { backgroundColor: C.bg }, footer: { backgroundColor: C.bg } },
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '14px',
      spacing: 'sm',
      contents: [
        t(r.name, { weight: 'bold', size: 'md', maxLines: 3 }),
        t(`📅 ${dayLabel(r.date!)}/${Number(r.date!.slice(0, 4)) + 543 - 2500} · อีก ${Math.floor(left / 7)} สัปดาห์`, { size: 'xs', color: C.sub }),
        ...(r.location ? [t(`📍 ${r.location}`, { size: 'xs', color: C.sub })] : []),
        ...(!r.distancesKm.length ? [t('ไม่ระบุระยะ — เลือกระยะที่สมัคร', { size: 'xxs', color: C.sub })] : []),
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      paddingAll: '12px',
      contents: distancesOf(r).map((km) => ({ type: 'button', style: 'primary', height: 'sm', color: C.btn, action: { type: 'postback', label: kmLabel(km), data: `rr|${i}|${km}`, displayText: `${r.name} ${kmLabel(km)}` } })),
    },
  }
}

function parseKm(s: string): number | null {
  if (/ฮาล์ฟ|half/i.test(s)) return 21.1
  if (/มาราธอน|marathon|ฟูล|full/i.test(s)) return 42.195
  const n = Number(/(\d+(?:\.\d+)?)/.exec(s)?.[1])
  if (!n) return null
  if (n === 21) return 21.1
  if (n === 42) return 42.195
  return n >= 3 && n <= 100 ? n : null
}
/** "15/3 21 ชื่องาน" → งานที่ผู้ใช้กำหนดเอง */
export function parseCustomRace(arg: string, today: string): { race: CalendarRace; km: number } | null {
  const m = /^(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{2,4}))?\s+(\S+)\s*(.*)$/.exec(arg.trim())
  if (!m) return null
  const km = parseKm(m[4])
  if (!km) return null
  let y = m[3] ? Number(m[3]) : Number(today.slice(0, 4))
  if (y > 2400) y -= 543
  else if (y < 100) y += y > 50 ? 1957 : 2000 // 70 = พ.ศ. 2570 → 2027
  let date = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  if (!m[3] && date < today) date = `${y + 1}${date.slice(4)}`
  if (Number.isNaN(Date.parse(date))) return null
  const name = m[5].trim() || `งานวิ่ง ${kmLabel(km)}`
  return { race: { id: `line_${date}_${km}`, name, date, distancesKm: [km], source: 'LINE', url: '', custom: true }, km }
}

async function goalStep(c: RunSetupCtx, st: RunSetup): Promise<LineMessage[]> {
  const race = st.race!
  const km = st.km!
  const acts = await c.client.activities(addDays(c.today, -70), c.today)
  const est = estimateInput(acts, c.today, km)
  st.runsPerWeek ??= est.input.runsPerWeek
  await c.state.put(st)
  const opts = goalOptions(km, est.predictedSec)
  const fit = est.runs6w
    ? `📊 ความฟิตตอนนี้ (6 สัปดาห์): ~${est.input.weeklyKm} กม./สัปดาห์ · ยาวสุด ${est.input.longestRunKm} กม.${est.predictedSec ? `\n🔮 ถ้าแข่งตอนนี้ คาดทำได้ ~${fmtHMS(est.predictedSec)}` : ''}`
    : '📊 ยังไม่มีข้อมูลวิ่งใน 6 สัปดาห์ — โค้ชจะเริ่มแผนแบบค่อยเป็นค่อยไป'
  return [
    text(`🏁 ${planName(race, km)}\n📅 ${dayLabel(race.date!)} · อีก ${Math.floor(daysBetween(c.today, race.date!) / 7)} สัปดาห์\n\n${fit}\n\n🎯 ตั้งเป้าเวลาเท่าไหร่ครับ?\n(พิมพ์เองก็ได้ เช่น "เป้า 1:55:00")`, [
      ...opts.map((o) => ({ label: `${fmtHMS(o.sec)} ${o.label}`.slice(0, 20), data: `rg|${o.sec}`, text: `เป้า ${fmtHMS(o.sec)}` })),
      { label: '🏁 แค่จบ', data: `rg|${Math.round((opts[0].sec * 1.08) / 60) * 60}`, text: 'เป้า แค่จบสบาย ๆ' },
      { label: '✖️ ยกเลิก', data: 'rc|no', text: 'ยกเลิก' },
    ]),
  ]
}

async function confirmStep(c: RunSetupCtx, st: RunSetup): Promise<LineMessage[]> {
  const race = st.race!
  const km = st.km!
  const acts = await c.client.activities(addDays(c.today, -70), c.today)
  const est = estimateInput(acts, c.today, km)
  const input = { ...est.input, runsPerWeek: st.runsPerWeek ?? est.input.runsPerWeek }
  const { plan, startTime } = buildRunPlan(race, km, st.goalSec!, input, c.today)
  const name = planName(race, km)
  const replacing = c.cfg.raceDate && c.cfg.raceDate >= c.today && c.cfg.planName && c.cfg.planName !== name
  const L = [
    `🏁 ${name}`,
    `📅 ${dayLabel(race.date!)} · ปล่อยตัว ~${startTime}`,
    `🎯 เป้า ${fmtHMS(st.goalSec!)} (เพซ ${paceOf(st.goalSec!, km)})`,
    `${FEAS_TH[plan.feasibility.level]}${plan.feasibility.messages[0] ? `\n${plan.feasibility.messages[0]}` : ''}`,
    '',
    `🗓 แผน ${plan.weeks.length} สัปดาห์ · วิ่ง ${input.runsPerWeek} วัน/สัปดาห์`,
    `📈 พีค ${Math.round(plan.peakKm)} กม./สัปดาห์ · รวม ${Math.round(plan.totalKm)} กม.`,
    `🐢 เพซวิ่งง่าย ${fmtPace(Math.min(...plan.paces.easy))}–${fmtPace(Math.max(...plan.paces.easy))}/กม.`,
    ...(replacing ? ['', `⚠️ จะแทนแผนเดิม "${c.cfg.planName}" — ตารางที่ยังไม่ถึงวันจะถูกลบ แล้วใส่ตารางใหม่แทน`] : []),
  ]
  const runQ: QuickItem[] = [3, 4, 5, 6].filter((n) => n !== input.runsPerWeek).map((n) => ({ label: `วิ่ง ${n} วัน/สัปดาห์`, data: `rd|${n}`, text: `วิ่ง ${n} วัน/สัปดาห์` }))
  return [text(L.join('\n'), [{ label: '✅ สร้างแผนเลย', data: 'rc|go', text: 'สร้างแผนเลย' }, ...runQ, { label: '🎯 เปลี่ยนเป้า', data: 'rg|', text: 'เปลี่ยนเป้า' }, { label: '✖️ ยกเลิก', data: 'rc|no', text: 'ยกเลิก' }])]
}

export async function handleRunSetup(c: RunSetupCtx): Promise<LineMessage[] | null> {
  const pb = c.ev.type === 'postback' ? (c.ev.postback?.data ?? '') : ''
  const msg = c.msg.trim()

  // ── เริ่ม: ค้นหา / งานกำหนดเอง ──
  const start = pb ? null : RUN_SETUP_RE.exec(msg)
  if (start) {
    const arg = (start[2] ?? '').trim()
    const custom = arg ? parseCustomRace(arg, c.today) : null
    if (custom) {
      if (daysBetween(c.today, custom.race.date!) < MIN_DAYS) return [text(`เหลือไม่ถึง ${MIN_DAYS / 7} สัปดาห์ จัดแผนใหม่ไม่ทันครับ — ใช้ตารางเดิม แล้วพิมพ์ "แข่ง" ดูวิธีเตรียมตัวสัปดาห์แข่ง`)]
      return goalStep(c, { race: custom.race, km: custom.km })
    }
    const list = upcomingRaces(await c.loadRaces(), c.today, arg).slice(0, 10)
    if (!list.length)
      return [text(`ไม่เจองาน${arg ? ` "${arg}"` : ''} ที่เหลือเวลาเกิน ${MIN_DAYS / 7} สัปดาห์ครับ\n\nเพิ่มเองได้: พิมพ์ "งานวิ่ง วัน/เดือน ระยะ ชื่องาน"\nเช่น "งานวิ่ง 15/3 21 ลำปางฮาล์ฟ"`)]
    await c.state.put({ list })
    return [
      flex(`เลือกงานวิ่ง (${list.length} งาน)`, { type: 'carousel', contents: list.map((r, i) => raceBubble(r, i, c.today)) }),
      text(`👆 เลื่อนดู แล้วแตะระยะที่จะลง\n\n🔎 ค้นหา: "งานวิ่ง เชียงใหม่" หรือ "งานวิ่ง marathon"\n➕ ไม่มีในรายการ: "งานวิ่ง 15/3 21 ชื่องาน"`),
    ]
  }

  if (!/^r[rgdc]\|/.test(pb) && !/^เป้า\s+\d/.test(msg)) return null
  const st = await c.state.get()

  if (pb.startsWith('rr|')) {
    const [, i, km] = pb.split('|')
    const race = st?.list?.[Number(i)]
    if (!race) return [text('รายการหมดเวลาแล้ว พิมพ์ "งานวิ่ง" ใหม่อีกครั้งครับ')]
    return goalStep(c, { race, km: Number(km) })
  }
  if (!st?.race) return pb.startsWith('rc|') || pb.startsWith('rg|') || pb.startsWith('rd|') ? [text('ขั้นตอนหมดเวลาแล้ว พิมพ์ "งานวิ่ง" เพื่อเริ่มใหม่ครับ')] : null

  const typed = /^เป้า\s+(\d{1,2}:\d{2}(?::\d{2})?)$/.exec(msg)
  if (typed || pb.startsWith('rg|')) {
    const v = typed ? typed[1] : pb.slice(3)
    if (!v) return goalStep(c, st)
    const sec = typed ? parseHMS(v.split(':').length === 2 && st.km! > 15 ? `${v}:00` : v) : Number(v)
    const pace = sec / st.km!
    if (!sec || pace < 150 || pace > 900) return [text('เป้าเวลาดูไม่ถูกต้องครับ พิมพ์เช่น "เป้า 1:55:00" (ชม:นาที:วินาที)')]
    st.goalSec = sec
    await c.state.put(st)
    return confirmStep(c, st)
  }
  if (pb.startsWith('rd|')) {
    st.runsPerWeek = Math.max(3, Math.min(6, Number(pb.slice(3)) || 4))
    await c.state.put(st)
    return st.goalSec ? confirmStep(c, st) : goalStep(c, st)
  }
  if (pb === 'rc|no') {
    await c.state.clear()
    return [text('ยกเลิกแล้ว ตารางเดิมยังอยู่ครบครับ', MENU)]
  }
  if (pb === 'rc|go') {
    if (!st.goalSec) return goalStep(c, st)
    const acts = await c.client.activities(addDays(c.today, -70), c.today)
    const est = estimateInput(acts, c.today, st.km!)
    const input = { ...est.input, runsPerWeek: st.runsPerWeek ?? est.input.runsPerWeek }
    const r = await applyRunPlan(c.client, c.cfg, st.race, st.km!, st.goalSec, input, c.today)
    await c.state.clear()
    const first = r.plan.weeks
      .flatMap((w) => w.workouts)
      .filter((w) => w.date >= c.today && w.date <= addDays(c.today, 6))
      .map((w) => `• ${dayLabel(w.date)} ${w.title}${w.km ? ` ${w.km} กม.` : ''}`)
    return [
      text(
        [
          `✅ สร้างแผน "${r.name}" แล้ว`,
          `ส่ง ${r.added} วันซ้อมเข้า Intervals → Garmin${r.removed ? ` (ลบตารางเดิม ${r.removed} รายการ)` : ''}`,
          '',
          first.length ? `7 วันแรก:\n${first.join('\n')}` : 'สัปดาห์นี้ยังไม่มีวันซ้อม',
          '',
          '⌚ เปิด Garmin Connect ให้ซิงก์ ตารางจะขึ้นบนนาฬิกา',
          `🌐 เว็บคู่ซ้อม (เครื่องที่เคยเชื่อม Intervals) จะเพิ่มแผนนี้ให้เองตอนเปิด:\n${c.webUrl}`,
        ].join('\n'),
        MENU,
      ),
    ]
  }
  return null
}
