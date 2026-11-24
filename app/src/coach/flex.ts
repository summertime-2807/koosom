// ─────────────────────────────────────────────────────────────
// การ์ด Flex ของ LINE (ไม่ต้องสร้างรูป ไม่ต้องฝากไฟล์สาธารณะ)
// สีเข้มตามธีมแอปคู่ซ้อม
// ─────────────────────────────────────────────────────────────
import type { PaceCard, RaceInfo, RaceReview, RaceWeather, ShoeStore, WeeklyData } from './extras'
import type { IcuActivity } from './types'
import { raceWeekTip, shoeKm } from './extras'
import { dayLabel } from './line'
import { fmtClock, fmtHMS, fmtMS } from '../lib/time'
import type { SleepStats } from './sleepCoach'
import { dur, hm } from './sleepCoach'

const C = {
  bg: '#0f172a',
  card: '#1e293b',
  text: '#f1f5f9',
  sub: '#94a3b8',
  accent: '#34d399',
  blue: '#38bdf8',
  warn: '#fbbf24',
  bad: '#f87171',
  track: '#334155',
}

type Node = Record<string, unknown>
const txt = (text: string, o: Node = {}): Node => ({ type: 'text', text: text || ' ', color: C.text, size: 'sm', wrap: true, ...o })
const box = (layout: 'vertical' | 'horizontal' | 'baseline', contents: Node[], o: Node = {}): Node => ({ type: 'box', layout, contents, ...o })
const sep = (): Node => ({ type: 'separator', color: C.track, margin: 'md' })
const kv = (k: string, v: string, color = C.text): Node =>
  box('horizontal', [txt(k, { color: C.sub, flex: 5 }), txt(v, { color, align: 'end', flex: 5, weight: 'bold' })], { margin: 'sm' })

function bubble(title: string, subtitle: string, body: Node[], footer?: Node[]): Node {
  return {
    type: 'bubble',
    size: 'mega',
    styles: { header: { backgroundColor: C.card }, body: { backgroundColor: C.bg }, footer: { backgroundColor: C.bg } },
    header: box('vertical', [txt(title, { size: 'lg', weight: 'bold' }), txt(subtitle, { color: C.sub, size: 'xs', margin: 'xs' })], { paddingAll: '16px' }),
    body: box('vertical', body, { paddingAll: '16px', spacing: 'xs' }),
    ...(footer?.length ? { footer: box('vertical', footer, { paddingAll: '12px', paddingTop: '0px', spacing: 'xs' }) } : {}),
  }
}

/** แท่งแนวนอน: ส่วนที่ทำแล้ว (สี) + ส่วนที่เหลือของแผน (เทา) */
function bar(done: number, plan: number, max: number, color: string): Node {
  const unit = 10
  const d = Math.round(done * unit)
  const rest = Math.max(0, Math.round((plan - done) * unit))
  const empty = Math.max(0, Math.round(max * unit) - d - rest)
  const parts: Node[] = []
  if (d > 0) parts.push(box('vertical', [], { flex: d, backgroundColor: color, height: '10px', cornerRadius: '3px' }))
  if (rest > 0) parts.push(box('vertical', [], { flex: rest, backgroundColor: C.track, height: '10px', cornerRadius: '3px' }))
  if (empty > 0) parts.push(box('vertical', [], { flex: empty, height: '10px' }))
  if (!parts.length) parts.push(box('vertical', [], { flex: 1, height: '10px' }))
  return box('horizontal', parts, { spacing: 'none', flex: 6, height: '10px', offsetTop: '5px' })
}

const STATUS_COLOR: Record<string, string> = { done: C.accent, partial: C.warn, missed: C.bad, extra: C.blue, planned: C.track, rest: C.track }

// ── รายงานสัปดาห์ ──
export function weeklyFlex(w: WeeklyData, goalSec?: number, warnings: string[] = [], sleep?: SleepStats): Node {
  const max = Math.max(1, ...w.days.map((d) => Math.max(d.plannedKm, d.actualKm)))
  const pct = w.plannedKm ? Math.round((w.actualKm / w.plannedKm) * 100) : 0
  const rows = w.days.map((d) =>
    box(
      'horizontal',
      [
        txt(dayLabel(d.date), { color: C.sub, size: 'xs', flex: 3 }),
        bar(d.actualKm, d.plannedKm, max, STATUS_COLOR[d.status] ?? C.accent),
        txt(d.plannedKm || d.actualKm ? `${d.actualKm || 0}/${d.plannedKm || 0}` : 'พัก', { size: 'xs', align: 'end', flex: 3, color: d.status === 'missed' ? C.bad : C.text }),
      ],
      { margin: 'sm' },
    ),
  )
  const body: Node[] = [
    box('baseline', [txt(`${w.actualKm}`, { size: '3xl', weight: 'bold', color: C.accent, flex: 0 }), txt(` / ${w.plannedKm} กม. (${pct}%)`, { color: C.sub, flex: 0, margin: 'sm' })]),
    txt(`ทำครบ ${w.done}/${w.sessions} ครั้ง · ยาวสุด ${w.longestKm} กม.`, { color: C.sub, size: 'xs' }),
    sep(),
    ...rows,
    sep(),
  ]
  if (w.ctl != null) body.push(kv('ความฟิต (CTL)', `${w.ctlPrev != null ? `${Math.round(w.ctlPrev)} → ` : ''}${Math.round(w.ctl)}${w.ctlPrev != null ? (w.ctl >= w.ctlPrev ? ' ↗' : ' ↘') : ''}`))
  if (w.atl != null && w.ctl != null) {
    const tsb = Math.round(w.ctl - w.atl)
    body.push(kv('ความสดชื่น (TSB)', `${tsb > 0 ? '+' : ''}${tsb}`, tsb < -25 ? C.bad : tsb < -10 ? C.warn : C.accent))
  }
  if (w.hrv != null) body.push(kv('HRV เฉลี่ย', `${Math.round(w.hrv)}${w.hrvPrev != null ? ` (ก่อน ${Math.round(w.hrvPrev)})` : ''}`, w.hrvPrev != null && w.hrv < w.hrvPrev * 0.93 ? C.warn : C.text))
  if (w.predictedSec) body.push(kv('เวลาคาดการณ์', `${fmtHMS(w.predictedSec)}${goalSec ? ` / เป้า ${fmtHMS(goalSec)}` : ''}`, goalSec && w.predictedSec <= goalSec ? C.accent : C.warn))
  body.push(kv('สัปดาห์หน้า', `${w.nextWeekKm} กม.`))
  if (sleep?.nights7.length) {
    body.push(sep(), txt('😴 การนอนสัปดาห์นี้', { weight: 'bold', margin: 'md' }))
    if (sleep.avgMin != null) body.push(kv('เฉลี่ย/วัน', `${dur(sleep.avgMin)} (เป้า ${dur(sleep.targetMin)})`, sleep.avgMin >= sleep.targetMin - 30 ? C.accent : C.warn))
    body.push(kv('หนี้การนอน', dur(sleep.debtMin), sleep.debtMin >= 360 ? C.bad : sleep.debtMin >= 180 ? C.warn : C.accent))
    if (sleep.regularity) body.push(kv('ความสม่ำเสมอ', `${sleep.regularity} (±${Math.round((sleep.midSdMin ?? 0) / 6) / 10} ชม.)`, sleep.regularity.startsWith('แกว่ง') ? C.warn : C.accent))
  }
  const footer = warnings.map((x) => txt(x, { size: 'xs', color: C.warn }))
  return bubble('📊 รายงานสัปดาห์', `${dayLabel(w.from)} – ${dayLabel(w.to)}`, body, footer)
}

// ── สัปดาห์แข่ง ──
export function raceWeekFlex(info: RaceInfo, daysLeft: number, weather: RaceWeather | null, card?: PaceCard): Node {
  const tip = raceWeekTip(daysLeft, info)
  const body: Node[] = [
    box('baseline', [txt(daysLeft > 0 ? `${daysLeft}` : 'วันนี้', { size: '3xl', weight: 'bold', color: C.accent, flex: 0 }), txt(daysLeft > 0 ? ' วันก่อนแข่ง' : ' แข่งแล้ว ลุย!', { color: C.sub, flex: 0, margin: 'sm' })]),
    txt(`${dayLabel(info.date)} · ปล่อยตัว ${info.startTime} · ${info.distKm} กม.`, { color: C.sub, size: 'xs' }),
    sep(),
  ]
  if (weather) {
    body.push(txt('🌤 พยากรณ์ช่วงวิ่ง', { weight: 'bold', margin: 'md' }))
    body.push(kv('อุณหภูมิ', `${weather.tempC}°${weather.tempEndC != null ? ` → ${weather.tempEndC}°C` : 'C'}`))
    body.push(kv('ความชื้น', `${weather.humidity}%`))
    if (weather.rainPct != null) body.push(kv('โอกาสฝน', `${weather.rainPct}%`, weather.rainPct >= 50 ? C.warn : C.text))
    if (card?.heatPct) body.push(kv('ผลของความร้อน', `ช้าลง ~${card.heatPct}%`, card.heatPct >= 3 ? C.warn : C.text))
  } else if (info.climateTempC != null) {
    body.push(kv('อากาศปีก่อน ๆ', `~${info.climateTempC}°C · ชื้น ${info.climateHumidity ?? '-'}%`))
    if (daysLeft > 14) body.push(txt('พยากรณ์จริงจะมาเมื่อเหลือไม่เกิน 14 วัน', { size: 'xxs', color: C.sub }))
  }
  body.push(sep(), txt(`✅ ${tip.title}`, { weight: 'bold', margin: 'md' }))
  for (const t of tip.tips) body.push(txt(`• ${t}`, { size: 'xs', color: C.text, margin: 'xs' }))
  return bubble(`🏁 ${info.name}`, daysLeft > 0 ? 'โหมดสัปดาห์แข่ง' : 'วันแข่ง', body)
}

// ── การ์ดเพซ ──
export function paceCardFlex(info: RaceInfo, card: PaceCard): Node {
  const body: Node[] = [
    box('baseline', [txt(fmtHMS(card.targetSec), { size: '3xl', weight: 'bold', color: C.accent, flex: 0 }), txt(` · ${fmtMS(card.avgPaceSec)}/กม.`, { color: C.sub, flex: 0, margin: 'sm' })]),
    txt(`ปล่อยตัว ${card.startTime} · เพซสม่ำเสมอ`, { color: C.sub, size: 'xs' }),
    sep(),
    box('horizontal', [txt('กม.', { color: C.sub, size: 'xs', flex: 2 }), txt('เวลาสะสม', { color: C.sub, size: 'xs', flex: 4 }), txt('นาฬิกา', { color: C.sub, size: 'xs', flex: 3, align: 'end' })], { margin: 'md' }),
    ...card.splits.map((s) =>
      box('horizontal', [txt(`${s.km}`, { flex: 2, weight: 'bold' }), txt(fmtHMS(s.elapsedSec), { flex: 4 }), txt(fmtClock(s.clockSec), { flex: 3, align: 'end', color: C.sub })], { margin: 'sm' }),
    ),
  ]
  if (card.gels.length) {
    body.push(sep(), txt('⚡ เจล', { weight: 'bold', margin: 'md' }))
    for (const g of card.gels) body.push(txt(`• กม. ${g.km} (นาที ${Math.round(g.elapsedSec / 60)})${g.caffeine ? ' · คาเฟอีน' : ''}`, { size: 'xs' }))
  }
  if (card.heatPct && card.heatPct >= 2)
    body.push(txt(`🌡 ถ้าร้อนตามพยากรณ์ ควรเผื่อช้าลง ~${card.heatPct}% (≈ ${fmtHMS(card.targetSec * (1 + card.heatPct / 100))})`, { size: 'xs', color: C.warn, margin: 'md' }))
  return bubble(`⏱ การ์ดเพซ · ${info.name}`, `${info.distKm} กม. · เป้า ${fmtHMS(card.targetSec)}`, body)
}

// ── วิเคราะห์หลังแข่ง ──
export function reviewFlex(r: RaceReview, isRace: boolean, goalPaceSec?: number): Node {
  const maxS = Math.max(...r.kmSplits, 1)
  const minS = Math.min(...r.kmSplits, maxS)
  const span = Math.max(10, maxS - minS)
  const splitRows = r.kmSplits.slice(0, 45).map((s, i) => {
    const w = Math.round(((s - minS) / span) * 60 + 30) // 30–90
    const color = goalPaceSec ? (s <= goalPaceSec + 3 ? C.accent : s <= goalPaceSec + 12 ? C.warn : C.bad) : C.blue
    return box(
      'horizontal',
      [
        txt(`${i + 1}`, { size: 'xxs', color: C.sub, flex: 1 }),
        box('horizontal', [box('vertical', [], { flex: w, backgroundColor: color, height: '8px', cornerRadius: '2px' }), box('vertical', [], { flex: 100 - w, height: '8px' })], { flex: 7, offsetTop: '4px' }),
        txt(fmtMS(s), { size: 'xxs', align: 'end', flex: 2 }),
      ],
      { margin: 'xs' },
    )
  })
  const body: Node[] = [
    box('baseline', [txt(fmtHMS(r.finishSec), { size: '3xl', weight: 'bold', color: r.goalSec && r.finishSec <= r.goalSec ? C.accent : C.text, flex: 0 }), txt(` · ${r.distKm} กม.`, { color: C.sub, flex: 0, margin: 'sm' })]),
    txt(`${dayLabel(r.date)}${r.goalSec ? ` · เป้า ${fmtHMS(r.goalSec)}` : ''}${r.avgHr ? ` · HR เฉลี่ย ${Math.round(r.avgHr)}` : ''}`, { color: C.sub, size: 'xs' }),
    sep(),
    kv('ครึ่งแรก / ครึ่งหลัง', `${fmtHMS(r.firstHalfSec)} / ${fmtHMS(r.secondHalfSec)}`),
    kv('ต่างกัน', `${r.splitPct > 0 ? '+' : ''}${r.splitPct}%`, r.splitPct > 3 ? C.warn : C.accent),
    kv('เร็วสุด / ช้าสุด', `กม. ${r.fastestKm} / กม. ${r.slowestKm}`),
    sep(),
    txt('เพซรายกิโล', { weight: 'bold', margin: 'md', size: 'xs' }),
    ...splitRows,
    sep(),
    ...r.verdict.map((v) => txt(`• ${v}`, { size: 'xs', margin: 'xs' })),
  ]
  return bubble(isRace ? '🏅 วิเคราะห์ผลแข่ง' : '🔎 วิเคราะห์วิ่งล่าสุด', isRace ? r.name : `${r.name} (ยังไม่ถึงวันแข่ง — ใช้วิ่งล่าสุดแทน)`, body)
}

// ── รองเท้า ──
export function shoesFlex(s: ShoeStore, acts: IcuActivity[]): Node {
  const list = s.shoes.filter((x) => !x.retired)
  const body: Node[] = []
  if (!list.length) body.push(txt('ยังไม่มีรองเท้า\nพิมพ์ "รองเท้า เพิ่ม <ชื่อ> [กม.ที่วิ่งไปแล้ว]"\nเช่น รองเท้า เพิ่ม Pegasus 41 120', { color: C.sub, size: 'sm' }))
  for (const sh of list) {
    const km = shoeKm(sh, acts)
    const ratio = Math.min(1, km / s.limitKm)
    const color = ratio >= 1 ? C.bad : ratio >= 0.85 ? C.warn : C.accent
    body.push(
      box('horizontal', [txt(`${sh.activeSince ? '👟 ' : ''}${sh.name}`, { weight: sh.activeSince ? 'bold' : 'regular', flex: 6 }), txt(`${km} กม.`, { align: 'end', flex: 4, color })], { margin: 'md' }),
      box(
        'horizontal',
        [box('vertical', [], { flex: Math.max(1, Math.round(ratio * 100)), backgroundColor: color, height: '8px', cornerRadius: '3px' }), box('vertical', [], { flex: Math.max(1, 100 - Math.round(ratio * 100)), backgroundColor: C.track, height: '8px', cornerRadius: '3px' })],
        { margin: 'xs' },
      ),
    )
  }
  const retired = s.shoes.filter((x) => x.retired)
  if (retired.length) body.push(sep(), txt(`ปลดระวางแล้ว: ${retired.map((x) => `${x.name} (${x.km} กม.)`).join(', ')}`, { size: 'xxs', color: C.sub, margin: 'md' }))
  body.push(sep(), txt('คำสั่ง: รองเท้า เพิ่ม <ชื่อ> [กม.] · รองเท้า ใช้ <ชื่อ> · รองเท้า ปลด <ชื่อ>', { size: 'xxs', color: C.sub, margin: 'md' }))
  return bubble('👟 รองเท้า', `นับทุกการวิ่งให้คู่ที่ใช้อยู่ · ควรเปลี่ยนที่ ~${s.limitKm} กม.`, body)
}

// ── การ์ดการนอน ──
export function sleepFlex(st: SleepStats, advice: string[]): Node {
  const target = st.targetMin
  const max = Math.max(target + 60, ...st.nights7.map((n) => n.asleepMin))
  const rows = st.nights7.map((n) =>
    box(
      'horizontal',
      [
        txt(dayLabel(n.date), { color: C.sub, size: 'xs', flex: 3 }),
        bar(Math.min(n.asleepMin, target) / 60, target / 60, max / 60, n.asleepMin >= target - 30 ? C.accent : n.asleepMin >= 300 ? C.warn : C.bad),
        txt(`${dur(n.asleepMin).replace(' ชม.', 'ช').replace(' น.', 'น')}`, { size: 'xs', align: 'end', flex: 3 }),
      ],
      { margin: 'sm' },
    ),
  )
  const last = st.last
  const body: Node[] = [
    box('baseline', [txt(last ? dur(last.asleepMin) : '—', { size: 'xxl', weight: 'bold', color: last && last.asleepMin >= target - 30 ? C.accent : C.warn, flex: 0 }), txt(' ล่าสุด', { color: C.sub, flex: 0, margin: 'sm' })]),
    txt(last ? `${dayLabel(last.date)} · ${last.start}–${last.end}${last.inBedMin ? ` · หลับจริง ${Math.round((last.asleepMin / last.inBedMin) * 100)}%` : ''}${last.napMin ? ` · งีบ ${last.napMin} น.` : ''}` : 'ยังไม่มีข้อมูล', { color: C.sub, size: 'xs' }),
    sep(),
    kv('หนี้การนอน 7 วัน', dur(st.debtMin), st.debtMin >= 360 ? C.bad : st.debtMin >= 180 ? C.warn : C.accent),
    ...(st.avgMin != null ? [kv('เฉลี่ย/วัน', `${dur(st.avgMin)} · เป้า ${dur(target)}`)] : []),
    ...(st.regularity ? [kv('ความสม่ำเสมอ', `${st.regularity}${st.midMin != null ? ` · กลางการนอน ~${hm(st.midMin)}` : ''}`, st.regularity.startsWith('แกว่ง') ? C.warn : C.accent)] : []),
    ...(st.effPct != null ? [kv('หลับจริงเฉลี่ย', `${st.effPct}%`, st.effPct < 85 ? C.warn : C.text)] : []),
    sep(),
    txt('7 วันล่าสุด (แถบเทา = ขาดจากเป้า)', { size: 'xxs', color: C.sub, margin: 'md' }),
    ...rows,
    sep(),
    txt('💡 คำแนะนำ', { weight: 'bold', margin: 'md' }),
    ...advice.map((a) => txt(`• ${a}`, { size: 'xs', margin: 'xs' })),
  ]
  return bubble('😴 โค้ชการนอน', 'จาก Google Health · นับตามวันที่ตื่น', body)
}
