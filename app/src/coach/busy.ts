// ─────────────────────────────────────────────────────────────
// 💼 ติดงาน / ⏱ วิ่งสั้น — ปรับตารางเมื่อไม่ว่างซ้อม
//  • ติดงาน (off): ข้ามซ้อมในช่วงนั้น (ไม่นับขาด ไม่ถามซ้ำ) ย้ายวิ่งยาวไปวันว่างแรกในสัปดาห์เดียวกัน
//                  แล้วค่อย ๆ กลับเข้าตารางตามจำนวนวันที่หยุด
//  • วิ่งสั้น (short): เปลี่ยนซ้อมของวันนั้นเป็นวิ่งเบา 25 นาที
//  ทุกการเปลี่ยนเก็บ snapshot ไว้ใน NOTE ของช่วงนั้น → "กลับมาซ้อมแล้ว" คืนค่าเดิมได้
// ─────────────────────────────────────────────────────────────
import type { CoachConfig, IcuEvent } from './types'
import type { IntervalsClient } from './intervals'
import { classify, dateOf, plannedKm } from './engine'
import { bpmRange } from './workoutText'
import { addDays, daysBetween, mondayOf } from '../engine/trainingEngine'

export const BUSY_PREFIX = 'rp-busy-'
export const MAX_BUSY_DAYS = 21

type Snap = Pick<IcuEvent, 'category' | 'start_date_local' | 'name' | 'description' | 'type' | 'distance' | 'moving_time'> & { external_id: string }

export type BusyChange =
  | { kind: 'skip'; eventId: number; date: string; snap: Snap; label: string }
  | { kind: 'move'; eventId: number; from: string; to: string; label: string }
  | { kind: 'edit'; eventId: number; date: string; before: Partial<IcuEvent>; after: Partial<IcuEvent>; label: string }

export interface BusyPeriod {
  version: 1
  mode: 'off' | 'short'
  from: string
  to: string
  createdAt: string
  changes: BusyChange[]
}

const isWorkout = (e: IcuEvent) => (e.category === 'WORKOUT' || /^RACE/.test(e.category)) && (!e.type || /run/i.test(e.type))
const km1 = (n: number) => Math.round(n)

function easyDesc(km: number, lthr: number, why: string) {
  const [a, b] = bpmRange(lthr, 'easy')
  return `🔧 ${why}\n\n- วิ่งง่าย หัวใจ ${a}–${b} ${km}km ${Math.round((a / lthr) * 100)}-${Math.round((b / lthr) * 100)}% LTHR`
}
function longDesc(km: number, lthr: number, why: string) {
  const [a, b] = bpmRange(lthr, 'long')
  return `🔧 ${why}\n\n- วิ่งยาว หัวใจ ${a}–${b} ${km}km ${Math.round((a / lthr) * 100)}-${Math.round((b / lthr) * 100)}% LTHR`
}
function shortDesc(min: number, lthr: number) {
  const [a, b] = bpmRange(lthr, 'easy')
  return `⏱ ยุ่ง — วิ่งเบาสั้น ๆ แทน ดีกว่าขาด\n\n- วิ่งเบา หัวใจ ${a}–${b} ${min}m ${Math.round((a / lthr) * 100)}-${Math.round((b / lthr) * 100)}% LTHR`
}

const snapOf = (e: IcuEvent): Snap => ({
  category: e.category,
  start_date_local: e.start_date_local,
  name: e.name,
  description: e.description,
  type: e.type,
  distance: e.distance,
  moving_time: e.moving_time,
  external_id: e.external_id || `rp-restore-${e.id}`,
})

/** วางแผน "ติดงาน" (ไม่เขียนอะไร) — events = แผนทั้งหมด */
export function planBusy(events: IcuEvent[], from: string, to: string, today: string, cfg: CoachConfig): BusyPeriod {
  const workouts = events.filter(isWorkout)
  const changes: BusyChange[] = []
  const weekMax = (d: string) => Math.max(0, ...workouts.filter((e) => mondayOf(dateOf(e.start_date_local)) === mondayOf(d)).map((e) => plannedKm(e) ?? 0))
  const taken = new Set(workouts.map((e) => dateOf(e.start_date_local)))

  // 1) วันที่ติดงาน: ข้าม (วันแข่งไม่แตะ) · วิ่งยาวย้ายไปวันว่างแรกหลังช่วงนี้ในสัปดาห์เดียวกัน
  const inRange = workouts.filter((e) => {
    const d = dateOf(e.start_date_local)
    return d >= from && d <= to && d >= today && !/^RACE/.test(e.category)
  })
  for (const e of inRange) {
    const d = dateOf(e.start_date_local)
    const kind = classify(e, weekMax(d))
    const label = e.name ?? 'ซ้อม'
    if (kind === 'long') {
      const sunday = addDays(mondayOf(d), 6)
      let target: string | undefined
      for (let x = addDays(to, 1); x <= sunday; x = addDays(x, 1)) {
        if (taken.has(x)) continue
        // ไม่วางติดวันหนัก/วันยาวอื่น
        const neighbor = workouts.find(
          (w) => !inRange.includes(w) && [addDays(x, -1), addDays(x, 1)].includes(dateOf(w.start_date_local)) && classify(w, weekMax(x)) !== 'easy',
        )
        if (neighbor) continue
        target = x
        break
      }
      if (target) {
        taken.add(target)
        changes.push({ kind: 'move', eventId: e.id, from: d, to: target, label })
        continue
      }
    }
    changes.push({ kind: 'skip', eventId: e.id, date: d, snap: snapOf(e), label })
  }

  // 2) กลับเข้าตาราง: หยุดนานแค่ไหนปรับแค่นั้น
  const off = daysBetween(from, to) + 1
  const moved = new Set(changes.filter((c) => c.kind === 'move').map((c) => c.eventId))
  const after = workouts
    .filter((e) => dateOf(e.start_date_local) > to && !/^RACE/.test(e.category) && !moved.has(e.id))
    .sort((a, b) => a.start_date_local.localeCompare(b.start_date_local))
  if (off >= 4) {
    // ซ้อม 2 ครั้งแรกหลังกลับ: วันหนัก/ยาว → วิ่งง่าย · หยุดเกิน 7 วัน: ที่เหลือใน 7 วันแรกลดระยะ 30%
    const rampEnd = addDays(to, 7)
    let n = 0
    for (const e of after) {
      const d = dateOf(e.start_date_local)
      if (d > rampEnd) break
      const kind = classify(e, weekMax(d))
      const km = plannedKm(e) ?? 6
      n++
      if (n > 2 && off <= 7) break
      if (n <= 2 && kind !== 'easy') {
        const newKm = km1(Math.min(km, off > 7 ? 6 : 8))
        changes.push({
          kind: 'edit',
          eventId: e.id,
          date: d,
          before: { name: e.name, description: e.description, distance: e.distance },
          after: { name: `วิ่งง่าย ${newKm} กม. (กลับจากติดงาน)`, description: easyDesc(newKm, cfg.lthr, `หยุด ${off} วัน — เริ่มด้วยวิ่งง่ายก่อน`), distance: newKm * 1000 },
          label: `${e.name ?? ''} → วิ่งง่าย ${newKm} กม.`,
        })
      } else if (off > 7 && km > 4) {
        const newKm = km1(km * 0.7)
        const isLong = kind === 'long'
        changes.push({
          kind: 'edit',
          eventId: e.id,
          date: d,
          before: { name: e.name, description: e.description, distance: e.distance },
          after: {
            name: `${isLong ? 'วิ่งยาว' : 'วิ่งง่าย'} ${newKm} กม. (ลด 30%)`,
            description: (isLong ? longDesc : easyDesc)(newKm, cfg.lthr, `หยุด ${off} วัน — สัปดาห์แรกลดระยะ 30%`),
            distance: newKm * 1000,
          },
          label: `${e.name ?? ''} → ${newKm} กม.`,
        })
      }
    }
  }
  return { version: 1, mode: 'off', from, to, createdAt: new Date().toISOString(), changes }
}

/** วางแผน "วิ่งสั้น" วันเดียว */
export function planShort(events: IcuEvent[], day: string, cfg: CoachConfig, minutes = 25): BusyPeriod {
  const changes: BusyChange[] = []
  for (const e of events.filter(isWorkout).filter((e) => dateOf(e.start_date_local) === day && !/^RACE/.test(e.category))) {
    changes.push({
      kind: 'edit',
      eventId: e.id,
      date: day,
      before: { name: e.name, description: e.description, distance: e.distance, moving_time: e.moving_time },
      after: { name: `วิ่งเบา ${minutes} นาที (ยุ่ง)`, description: shortDesc(minutes, cfg.lthr), distance: 0, moving_time: minutes * 60 },
      label: `${e.name ?? 'ซ้อม'} → วิ่งเบา ${minutes} นาที`,
    })
  }
  return { version: 1, mode: 'short', from: day, to: day, createdAt: new Date().toISOString(), changes }
}

// ── เก็บ/อ่านช่วงติดงาน (NOTE ในปฏิทิน) ──
export function busyNotes(events: IcuEvent[]): { note: IcuEvent; period: BusyPeriod }[] {
  const out: { note: IcuEvent; period: BusyPeriod }[] = []
  for (const n of events.filter((e) => e.category === 'NOTE' && e.external_id?.startsWith(BUSY_PREFIX))) {
    const m = /```json\s*([\s\S]*?)```/.exec(n.description ?? '')
    if (!m) continue
    try {
      out.push({ note: n, period: JSON.parse(m[1]) as BusyPeriod })
    } catch {
      /* ข้าม */
    }
  }
  return out
}

/** วันที่ที่ไม่ควรนับเป็น "ขาดซ้อม" */
export function busyDates(events: IcuEvent[]): string[] {
  const out: string[] = []
  for (const { period } of busyNotes(events)) {
    if (period.mode !== 'off') continue
    for (let d = period.from; d <= period.to; d = addDays(d, 1)) out.push(d)
  }
  return out
}

const fmtD = (d: string) => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`
export const rangeLabel = (p: Pick<BusyPeriod, 'from' | 'to'>) => (p.from === p.to ? fmtD(p.from) : `${fmtD(p.from)}–${fmtD(p.to)}`)

function noteBody(p: BusyPeriod): Partial<IcuEvent> {
  const title = p.mode === 'off' ? `💼 ติดงาน ${rangeLabel(p)}` : `⏱ วิ่งสั้น ${rangeLabel(p)}`
  const lines = p.changes.map((c) => `• ${c.kind === 'skip' ? `ข้าม ${fmtD(c.date)}: ${c.label}` : c.kind === 'move' ? `ย้าย ${c.label} ${fmtD(c.from)} → ${fmtD(c.to)}` : `${fmtD(c.date)}: ${c.label}`}`)
  return {
    external_id: `${BUSY_PREFIX}${p.mode}-${p.from}`,
    category: 'NOTE',
    start_date_local: `${p.from}T00:00:00`,
    name: title,
    description: `${title}\n${lines.join('\n') || '(ไม่มีซ้อมที่ต้องปรับ)'}\n\n\`\`\`json\n${JSON.stringify(p)}\n\`\`\``,
  }
}

async function applyChanges(client: IntervalsClient, p: BusyPeriod) {
  for (const c of p.changes) {
    if (c.kind === 'skip') await client.deleteEvent(c.eventId)
    else if (c.kind === 'move') await client.updateEvent(c.eventId, { start_date_local: `${c.to}T00:00:00` })
    else await client.updateEvent(c.eventId, c.after)
  }
}

/** คืนค่าการเปลี่ยนที่ยังไม่ถึงวัน (วันที่ ≥ today) — คืนจำนวนที่คืนค่า */
async function restoreFuture(client: IntervalsClient, p: BusyPeriod, today: string): Promise<{ restored: number; kept: BusyChange[] }> {
  let restored = 0
  const kept: BusyChange[] = []
  for (const c of p.changes) {
    try {
      if (c.kind === 'skip' && c.date >= today) {
        await client.upsertEvents([{ ...c.snap }])
        restored++
      } else if (c.kind === 'move' && c.from >= today) {
        await client.updateEvent(c.eventId, { start_date_local: `${c.from}T00:00:00` })
        restored++
      } else if (c.kind === 'edit' && c.date >= today) {
        await client.updateEvent(c.eventId, c.before)
        restored++
      } else kept.push(c)
    } catch {
      kept.push(c) // event ถูกลบ/แก้ไปแล้ว — ข้าม
    }
  }
  return { restored, kept }
}

export interface BusyResult {
  period: BusyPeriod
  merged?: string
}

/** ติดงานช่วง from–to (รวมกับช่วงที่ทับกันอยู่แล้ว) */
export async function setBusy(client: IntervalsClient, cfg: CoachConfig, from: string, to: string, today: string): Promise<BusyResult> {
  if (to < from) to = from
  if (daysBetween(from, to) + 1 > MAX_BUSY_DAYS) to = addDays(from, MAX_BUSY_DAYS - 1)
  const range = await client.events(addDays(today, -21), addDays(to, 21))
  let merged: string | undefined
  for (const { note, period } of busyNotes(range)) {
    if (period.mode !== 'off' || period.to < from || period.from > to) continue
    // ช่วงทับกัน → คืนค่าเดิมแล้วรวมเป็นช่วงเดียว
    await restoreFuture(client, period, today)
    await client.deleteEvent(note.id)
    from = period.from < from ? period.from : from
    to = period.to > to ? period.to : to
    merged = rangeLabel(period)
  }
  const fresh = merged ? await client.events(addDays(today, -21), addDays(to, 21)) : range
  const plan = fresh.filter((e) => !e.external_id?.startsWith(BUSY_PREFIX))
  const period = planBusy(plan, from, to, today, cfg)
  await applyChanges(client, period)
  await client.upsertEvents([noteBody(period)])
  return { period, merged }
}

/** วิ่งสั้นวันเดียว */
export async function setShort(client: IntervalsClient, cfg: CoachConfig, day: string, minutes = 25): Promise<BusyPeriod> {
  const events = await client.events(day, day)
  if (busyNotes(events).some((b) => b.period.mode === 'short' && b.period.from === day)) {
    return { version: 1, mode: 'short', from: day, to: day, createdAt: '', changes: [] }
  }
  const period = planShort(events, day, cfg, minutes)
  await applyChanges(client, period)
  await client.upsertEvents([noteBody(period)])
  return period
}

/** กลับมาซ้อมแล้ว: คืนตารางของวันที่ยังไม่ถึง + ตัดช่วงติดงานให้จบเมื่อวาน */
export async function endBusy(client: IntervalsClient, cfg: CoachConfig, today: string): Promise<{ restored: number; ended: string[]; ramp?: BusyPeriod }> {
  const events = await client.events(addDays(today, -MAX_BUSY_DAYS), addDays(today, 30))
  const active = busyNotes(events).filter(({ period }) => period.to >= today)
  let restored = 0
  const ended: string[] = []
  let ramp: BusyPeriod | undefined
  for (const { note, period } of active) {
    const r = await restoreFuture(client, period, today)
    restored += r.restored
    ended.push(`${period.mode === 'off' ? '💼' : '⏱'} ${rangeLabel(period)}`)
    if (period.from >= today) {
      await client.deleteEvent(note.id)
      continue
    }
    // หยุดไปแล้วบางวัน → เก็บช่วงที่ผ่านมา และปรับช่วงกลับเข้าตารางตามจริง
    const kept: BusyPeriod = { ...period, to: addDays(today, -1), changes: r.kept }
    if (period.mode === 'off' && daysBetween(kept.from, kept.to) + 1 >= 4) {
      const fresh = (await client.events(addDays(today, -21), addDays(today, 21))).filter((e) => !e.external_id?.startsWith(BUSY_PREFIX))
      const p = planBusy(fresh, kept.from, kept.to, today, cfg)
      const rampChanges = p.changes.filter((c) => c.kind === 'edit')
      if (rampChanges.length) {
        ramp = { ...p, changes: rampChanges }
        await applyChanges(client, ramp)
        kept.changes = [...kept.changes, ...rampChanges]
      }
    }
    await client.upsertEvents([noteBody(kept)])
  }
  return { restored, ended, ramp }
}

/** ข้อความสรุปสำหรับ LINE */
export function describeBusy(p: BusyPeriod, merged?: string): string {
  const off = daysBetween(p.from, p.to) + 1
  const L: string[] = []
  if (p.mode === 'short') {
    L.push(`⏱ ${rangeLabel(p)} เปลี่ยนเป็นวิ่งเบาสั้น ๆ แล้ว`)
    if (!p.changes.length) L.push('วันนั้นไม่มีซ้อมในตารางอยู่แล้ว — พักได้เลย 👍')
  } else {
    L.push(`💼 ติดงาน ${rangeLabel(p)} (${off} วัน)${merged ? ` · รวมกับช่วงเดิม ${merged}` : ''}`)
    L.push('วันเหล่านี้ไม่นับเป็นขาดซ้อม และโค้ชจะไม่ถามซ้ำ')
  }
  const skip = p.changes.filter((c) => c.kind === 'skip')
  const move = p.changes.filter((c) => c.kind === 'move')
  const edit = p.changes.filter((c) => c.kind === 'edit')
  if (skip.length) L.push('', `ข้าม ${skip.length} ครั้ง:`, ...skip.map((c) => `• ${fmtD(c.date)} ${c.label}`))
  if (move.length) L.push('', 'ย้ายวิ่งยาว:', ...move.map((c) => (c.kind === 'move' ? `• ${c.label} ${fmtD(c.from)} → ${fmtD(c.to)}` : '')))
  if (edit.length) L.push('', p.mode === 'short' ? 'ปรับ:' : 'ช่วงกลับมาซ้อม:', ...edit.map((c) => (c.kind === 'edit' ? `• ${fmtD(c.date)} ${c.label}` : '')))
  if (p.mode === 'off' && off <= 3) L.push('', 'หยุดไม่เกิน 3 วัน กลับมาซ้อมตามตารางเดิมได้เลย')
  if (p.changes.length) L.push('', '⌚ ซิงก์นาฬิกาเพื่ออัปเดต workout')
  return L.join('\n')
}
