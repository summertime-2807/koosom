import { DEFAULT_GELS } from '../engine/fuelingEngine'
import { sampleRoute, sampleWaypoints } from '../data/sampleRoute'
import type { RacePlan, StoredRoute, Waypoint } from '../types/race'
import { uid } from '../lib/time'

/** เวลาเป้าหมายเริ่มต้นตามระยะ */
export function defaultTargetSec(km: number): number {
  if (km <= 11) return 60 * 60 // 10K 1:00:00
  if (km <= 22) return 2 * 3600 + 15 * 60 // 21K 2:15:00
  return 4 * 3600 + 45 * 60 // 42K 4:45:00
}

export function newPlan(opts: { name?: string; date?: string; route?: StoredRoute; waypoints?: Waypoint[]; km?: number } = {}): RacePlan {
  const route = opts.route ?? sampleRoute()
  const now = new Date().toISOString()
  const km = opts.km ?? 21.1
  const isSample = !opts.route
  return {
    id: uid('plan'),
    version: 1,
    meta: {
      name: opts.name ?? 'ฮาล์ฟมาราธอนตัวอย่าง',
      date: opts.date ?? new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10),
      startTime: km > 22 ? '03:00' : km > 11 ? '04:30' : '05:30',
    },
    route,
    waypoints: opts.waypoints ?? (isSample ? sampleWaypoints() : []),
    pacing: {
      targetSec: defaultTargetSec(km),
      strategy: 'even',
      splitPct: 2,
      gapEnabled: true,
      gapStrength: 100,
      tempC: 27,
      humidity: 80,
    },
    fueling: {
      mode: 'time',
      interval: 30,
      firstAt: 30,
      stopBeforeFinishKm: 2,
      gels: DEFAULT_GELS.map((g) => ({ ...g })),
      caffeineSecondHalf: true,
      preStartGel: false,
      snapEnabled: true,
      snapThresholdKm: 1.5,
      snapOffsetM: 250,
    },
    postRace: { shoes: '', actualFinish: '', notes: '' },
    createdAt: now,
    updatedAt: now,
  }
}
