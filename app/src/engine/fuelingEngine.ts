// ─────────────────────────────────────────────────────────────
// Fueling engine — ตารางเจลตามเวลา/ระยะ + Smart Water-Station Snap
// ─────────────────────────────────────────────────────────────
import type { FuelingConfig, FuelingSummary, GelEvent, GelItem, SplitRow, Waypoint } from '../types/race'
import { elapsedAtKm, kmAtElapsed } from './pacingEngine'

const DRINK_TYPES: Waypoint['type'][] = ['water', 'electrolyte']

export const DEFAULT_GELS: GelItem[] = [
  { id: 'gel_std', name: 'เจลมาตรฐาน', carbsG: 25, sodiumMg: 50, caffeine: false },
  { id: 'gel_caf', name: 'เจลคาเฟอีน', carbsG: 25, sodiumMg: 50, caffeine: true },
]

function pickGel(gels: GelItem[], slot: number, km: number, totalKm: number, caffeineSecondHalf: boolean): GelItem {
  if (!gels.length) return { id: 'none', name: 'เจล', carbsG: 25, sodiumMg: 0, caffeine: false }
  if (!caffeineSecondHalf) return gels[slot % gels.length]
  const firstHalf = km < totalKm / 2
  const pool = gels.filter((g) => g.caffeine === !firstHalf)
  const list = pool.length ? pool : gels
  return list[slot % list.length]
}

/**
 * หาจุดน้ำที่ใกล้ที่สุด (ภายใน threshold) แล้วเลื่อนไปกินก่อนถึงจุด offset เมตร
 * คืน undefined ถ้าไม่มีจุดน้ำในระยะ
 */
export function findSnap(
  km: number,
  stations: Waypoint[],
  thresholdKm: number,
  offsetM: number,
): { km: number; station: Waypoint } | undefined {
  let best: Waypoint | undefined
  let bestD = Infinity
  for (const s of stations) {
    const target = s.km - offsetM / 1000
    const d = Math.abs(target - km)
    if (d <= thresholdKm + 1e-9 && d < bestD) {
      best = s
      bestD = d
    }
  }
  if (!best) return undefined
  return { km: Math.max(0, best.km - offsetM / 1000), station: best }
}

export function computeFueling(
  rows: SplitRow[],
  cfg: FuelingConfig,
  waypoints: Waypoint[],
  startClockSec: number,
): FuelingSummary {
  const totalKm = rows.length ? rows[rows.length - 1].km : 0
  const totalSec = rows.length ? rows[rows.length - 1].elapsedSec : 0
  const lastAllowedKm = Math.max(0, totalKm - Math.max(0, cfg.stopBeforeFinishKm))
  const interval = Math.max(0.1, cfg.interval)
  const first = cfg.firstAt > 0 ? cfg.firstAt : interval

  // 1) จุดเจลตามตาราง (km)
  const nominalKm: number[] = []
  if (totalKm > 0) {
    if (cfg.mode === 'time') {
      for (let m = first; m * 60 < totalSec && nominalKm.length < 60; m += interval) {
        nominalKm.push(kmAtElapsed(rows, m * 60))
      }
    } else {
      for (let k = first; k < totalKm && nominalKm.length < 60; k += interval) nominalKm.push(k)
    }
  }

  // 2) snap เข้าหาจุดน้ำ
  const stations = waypoints.filter((w) => DRINK_TYPES.includes(w.type)).sort((a, b) => a.km - b.km)
  const usedStations = new Set<string>()
  const events: GelEvent[] = []
  let slot = 0

  if (cfg.preStartGel) {
    const gel = pickGel(cfg.gels.filter((g) => !g.caffeine).length ? cfg.gels.filter((g) => !g.caffeine) : cfg.gels, 0, 0, totalKm, false)
    events.push({ n: 0, km: 0, originalKm: 0, elapsedSec: -15 * 60, clockSec: startClockSec - 15 * 60, gel, preStart: true })
  }

  for (const k of nominalKm) {
    let km = k
    let snappedToId: string | undefined
    if (cfg.snapEnabled && stations.length) {
      const avail = stations.filter((s) => !usedStations.has(s.id) && s.km - cfg.snapOffsetM / 1000 <= lastAllowedKm + 1e-9)
      const snap = findSnap(k, avail, cfg.snapThresholdKm, cfg.snapOffsetM)
      if (snap) {
        km = snap.km
        snappedToId = snap.station.id
        usedStations.add(snap.station.id)
      }
    }
    if (km > lastAllowedKm + 1e-9) continue
    // กันเจลซ้อนกันใกล้เกินไป (< 1 กม.)
    const prev = events.filter((e) => !e.preStart).at(-1)
    if (prev && km - prev.km < 1) {
      if (snappedToId) usedStations.delete(snappedToId)
      km = k
      snappedToId = undefined
      if (prev && km - prev.km < 1) continue
      if (km > lastAllowedKm + 1e-9) continue
    }
    const elapsedSec = elapsedAtKm(rows, km)
    const gel = pickGel(cfg.gels, slot++, km, totalKm, cfg.caffeineSecondHalf)
    events.push({
      n: 0,
      km: Math.round(km * 100) / 100,
      originalKm: Math.round(k * 100) / 100,
      elapsedSec,
      clockSec: startClockSec + elapsedSec,
      gel,
      snappedToId,
    })
  }

  events.sort((a, b) => a.km - b.km || a.elapsedSec - b.elapsedSec)
  events.forEach((e, i) => (e.n = i + 1))

  const totalCarbsG = events.reduce((s, e) => s + e.gel.carbsG, 0)
  const raceCarbs = events.filter((e) => !e.preStart).reduce((s, e) => s + e.gel.carbsG, 0)
  return {
    events,
    totalGels: events.length,
    totalCarbsG,
    carbsPerHour: totalSec > 0 ? raceCarbs / (totalSec / 3600) : 0,
    totalSodiumMg: events.reduce((s, e) => s + e.gel.sodiumMg, 0),
    caffeineCount: events.filter((e) => e.gel.caffeine).length,
  }
}

/** ผูก waypoint และเจลเข้ากับแถวของตารางสปลิต (ไม่แก้ object เดิม) */
export function attachToRows(rows: SplitRow[], waypoints: Waypoint[], gels: GelEvent[]): SplitRow[] {
  const sortedWp = [...waypoints].sort((a, b) => a.km - b.km)
  let prevKm = 0
  return rows.map((r, i) => {
    const isLast = i === rows.length - 1
    const inRow = (km: number) => (km > prevKm - 1e-9 || (i === 0 && km <= 0)) && (km < r.km - 1e-9 || (isLast && km <= r.km + 1e-9))
    const out = {
      ...r,
      waypoints: sortedWp.filter((w) => inRow(w.km)),
      gels: gels.filter((g) => (g.preStart ? i === 0 : inRow(g.km))),
    }
    prevKm = r.km
    return out
  })
}
