import type { SplitRow } from '../types/race'
import { fmtClock, fmtHMS, fmtPace } from './time'
import { WP_META } from './waypointMeta'

export function rowNotes(r: SplitRow): string {
  const wp = r.waypoints.map((w) => `${WP_META[w.type].icon}${w.label || WP_META[w.type].short}@${w.km.toFixed(1)}`)
  const gels = r.gels.map((g) => (g.preStart ? `เจลก่อนสตาร์ท` : `G${g.n} ${g.gel.name}${g.gel.caffeine ? '☕' : ''}@${g.km.toFixed(2)}`))
  return [...gels, ...wp].join(' · ')
}

const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

/** CSV (UTF-8 BOM เพื่อให้ Excel อ่านภาษาไทยได้) */
export function splitsToCsv(rows: SplitRow[]): string {
  const head = ['KM', 'Length_km', 'Gain_m', 'Loss_m', 'Grade_pct', 'Pace_min_km', 'Pace_sec_km', 'Split', 'Elapsed', 'Clock', 'Notes']
  const lines = rows.map((r) =>
    [
      r.km.toFixed(2),
      r.lengthKm.toFixed(3),
      r.gainM.toFixed(0),
      r.lossM.toFixed(0),
      r.gradePct.toFixed(1),
      fmtPace(r.paceSec),
      Math.round(r.paceSec),
      fmtHMS(r.splitSec),
      fmtHMS(r.elapsedSec),
      fmtClock(r.clockSec, true),
      rowNotes(r),
    ]
      .map((v) => esc(String(v)))
      .join(','),
  )
  return '﻿' + [head.join(','), ...lines].join('\n')
}

/** ตาราง TSV สั้น ๆ สำหรับคัดลอกไปตั้ง Garmin PacePro / นาฬิกา */
export function splitsToWatchText(rows: SplitRow[]): string {
  return ['กม.\tเพซ\tเวลาสะสม', ...rows.map((r) => `${r.km.toFixed(r.lengthKm < 1 ? 2 : 0)}\t${fmtPace(r.paceSec)}\t${fmtHMS(r.elapsedSec)}`)].join('\n')
}
