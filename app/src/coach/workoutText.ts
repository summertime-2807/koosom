// ─────────────────────────────────────────────────────────────
// แปลง workout ของแอป → ข้อความ workout ของ Intervals.icu (structured)
// Intervals.icu ส่งต่อเข้า Garmin Connect → Forerunner 165 เป็นขั้น ๆ พร้อมเป้าหมาย
// หัวใจ: Intervals ใช้ % LTHR → แปลงจาก bpm ที่ต้องการ และเขียน bpm ไว้ในชื่อขั้นให้อ่านง่าย
// ─────────────────────────────────────────────────────────────
import type { TrainingPaces, Workout } from '../types/race'
import type { IcuEvent } from './types'
import { EXT_PREFIX } from './intervals'
import { fmtPace } from '../lib/time'

export interface HrSetup {
  lthr: number
}

/** ช่วงหัวใจ (สัดส่วนของ LTHR) ต่อความหนัก */
export const HR_BANDS = {
  recovery: [0.7, 0.8],
  easy: [0.8, 0.88],
  long: [0.82, 0.89],
  marathon: [0.89, 0.93],
  tempo: [0.95, 1.0],
  hard: [0.97, 1.03],
} as const

export function bpmRange(lthr: number, band: keyof typeof HR_BANDS): [number, number] {
  const [a, b] = HR_BANDS[band]
  return [Math.round(lthr * a), Math.round(lthr * b)]
}

const pct = (lthr: number, band: keyof typeof HR_BANDS) => {
  const [a, b] = bpmRange(lthr, band)
  return { txt: `${Math.round((a / lthr) * 100)}-${Math.round((b / lthr) * 100)}% LTHR`, bpm: `หัวใจ ${a}–${b}` }
}

const paceTxt = (sec: number, spread = 5) => `${fmtPace(sec - spread)}-${fmtPace(sec + spread)}/km Pace`
const km = (n: number) => `${Math.max(0.1, Math.round(n * 10) / 10)}km`
const dur = (s: number) => (s % 60 === 0 ? `${s / 60}m` : s >= 60 ? `${Math.floor(s / 60)}m${s % 60}s` : `${s}s`)

/** ข้อความขั้นตอนสำหรับ Intervals.icu */
export function workoutSteps(w: Workout, paces: TrainingPaces, hr: HrSetup): string {
  const L = hr.lthr
  const easy = pct(L, 'easy')
  const rec = pct(L, 'recovery')
  const st = w.struct
  const lines: string[] = []
  if (!st || st.target === 'easy' || w.type === 'easy' || w.type === 'shakeout') {
    const b = w.type === 'shakeout' ? rec : easy
    lines.push(`- วิ่งง่าย ${b.bpm} ${km(w.km)} ${b.txt}`)
    if (/สไตรด์/.test(w.detail)) {
      lines.push('', 'สไตรด์ 4x', '- 20s 90-95% LTHR', '- 60s 70-80% LTHR')
    }
    return lines.join('\n')
  }
  if (st.target === 'long') {
    const b = pct(L, 'long')
    if (st.finishRpKm) {
      lines.push(`- วิ่งยาว ${b.bpm} ${km(w.km - st.finishRpKm)} ${b.txt}`)
      lines.push(`- เพซแข่ง ${km(st.finishRpKm)} ${paceTxt(paces.goal)}`)
    } else lines.push(`- วิ่งยาว ${b.bpm} ${km(w.km)} ${b.txt}`)
    return lines.join('\n')
  }
  const wu = st.wuKm ?? 2
  const cd = st.cdKm ?? 2
  lines.push('Warmup', `- วอร์ม ${easy.bpm} ${km(wu)} ${easy.txt}`, '')
  const target =
    st.target === 'interval'
      ? paceTxt(paces.interval)
      : st.target === 'tempo'
        ? paceTxt(paces.threshold)
        : st.target === 'marathon'
          ? paceTxt(paces.marathon)
          : st.target === 'race'
            ? paceTxt(paces.goal)
            : pct(L, 'hard').txt
  const label =
    st.target === 'hill' ? `ขึ้นเนิน ${pct(L, 'hard').bpm}` : st.target === 'tempo' ? `เทมโป ${pct(L, 'tempo').bpm}` : st.target === 'marathon' ? `เพซมาราธอน ${pct(L, 'marathon').bpm}` : st.target === 'race' ? 'เพซแข่ง' : 'เร็ว'
  if (st.reps) {
    lines.push(`Main Set ${st.reps}x`)
    lines.push(`- ${label} ${st.repKm ? km(st.repKm) : dur(st.repSec ?? 60)} ${target}`)
    lines.push(`- พัก ${rec.bpm} ${dur(st.recSec ?? 120)} ${rec.txt}`)
  } else if (st.blockKm) {
    lines.push('Main Set', `- ${label} ${km(st.blockKm)} ${target}`)
  } else if (st.blockMin) {
    lines.push('Main Set', `- ${label} ${st.blockMin}m ${target}`)
  }
  lines.push('', 'Cooldown', `- คูลดาวน์ ${easy.bpm} ${km(cd)} ${easy.txt}`)
  return lines.join('\n')
}

/** Workout ของแอป → event ของ Intervals.icu (มี external_id กันซ้ำ) */
export function toIcuEvent(w: Workout, paces: TrainingPaces, hr: HrSetup, planKey: string): Partial<IcuEvent> {
  const isRace = w.type === 'race'
  const head = [w.detail, w.tags?.length ? `#${w.tags.join(' #')}` : ''].filter(Boolean).join('\n')
  return {
    external_id: `${EXT_PREFIX}${planKey}-${w.date}`,
    category: isRace ? 'RACE_A' : 'WORKOUT',
    start_date_local: `${w.date}T00:00:00`,
    type: 'Run',
    name: isRace ? w.title.replace(' 🏁', '') : `${w.title} ${w.km} กม.`,
    description: isRace ? head : `${head}\n\n${workoutSteps(w, paces, hr)}`,
  }
}
