import type { WaypointType } from '../types/race'

export const WP_META: Record<WaypointType, { th: string; short: string; color: string; icon: string }> = {
  water: { th: 'จุดให้น้ำ', short: 'น้ำ', color: '#38bdf8', icon: '💧' },
  electrolyte: { th: 'น้ำ + เกลือแร่', short: 'เกลือแร่', color: '#22d3ee', icon: '⚡' },
  food: { th: 'จุดอาหาร', short: 'อาหาร', color: '#a78bfa', icon: '🍌' },
  toilet: { th: 'ห้องน้ำ', short: 'ห้องน้ำ', color: '#a1a1aa', icon: '🚻' },
  uturn: { th: 'จุดกลับตัว', short: 'กลับตัว', color: '#f472b6', icon: '↩︎' },
  hill: { th: 'เนิน / สะพาน', short: 'เนิน', color: '#f87171', icon: '⛰' },
}

export const WP_TYPES = Object.keys(WP_META) as WaypointType[]

export const GEL_COLOR = '#fbbf24'

/** สีตามความชัน (%) */
export function gradeColor(pct: number): string {
  if (pct >= 3) return '#ef4444'
  if (pct >= 1) return '#f87171'
  if (pct >= 0.4) return '#fca5a5'
  if (pct <= -3) return '#22c55e'
  if (pct <= -1) return '#4ade80'
  if (pct <= -0.4) return '#86efac'
  return '#a1a1aa'
}
