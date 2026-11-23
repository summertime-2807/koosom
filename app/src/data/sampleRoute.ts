import sampleGpx from './sample-bkk-half.gpx?raw'
import { gpxToStoredRoute } from '../engine/gpxParser'
import type { StoredRoute, Waypoint } from '../types/race'

export const SAMPLE_GPX = sampleGpx

export function sampleRoute(): StoredRoute {
  return { ...gpxToStoredRoute(sampleGpx), source: 'sample' }
}

/** จุดให้น้ำตัวอย่างทุก ~2.5 กม. + สะพาน */
export function sampleWaypoints(): Waypoint[] {
  const water = [2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20].map((km, i) => ({
    id: `wp_s${i}`,
    km,
    type: (i % 2 === 1 ? 'electrolyte' : 'water') as Waypoint['type'],
    label: i % 2 === 1 ? 'น้ำ + เกลือแร่' : 'จุดให้น้ำ',
  }))
  return [...water, { id: 'wp_toilet', km: 10.2, type: 'toilet', label: 'ห้องน้ำ' }]
}
