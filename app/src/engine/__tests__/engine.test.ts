import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { analyzeRoute, gpxToStoredRoute, haversineM, parseGpx } from '../gpxParser'
import { apportion, computePacing, elapsedAtKm, gradeFactor, heatAdjustment, kmAtElapsed, strategyFactor } from '../pacingEngine'
import { computeFueling, DEFAULT_GELS } from '../fuelingEngine'
import { generateFlatRoute } from '../routeGen'
import type { FuelingConfig, PacingConfig, Waypoint } from '../../types/race'

const sample = readFileSync(new URL('../../data/sample-bkk-half.gpx', import.meta.url), 'utf8')
const route = analyzeRoute(gpxToStoredRoute(sample))
const base: PacingConfig = { targetSec: 2 * 3600 + 15 * 60, strategy: 'even', splitPct: 3, gapEnabled: true, gapStrength: 100 }

describe('gpxParser', () => {
  it('haversine ~111.2 km per degree lat', () => {
    expect(haversineM(0, 0, 1, 0)).toBeCloseTo(111195, -1)
  })
  it('parses sample: 21.1 km, 22 segments, bridges give gain', () => {
    expect(route.totalDistanceKm).toBeGreaterThan(21.0)
    expect(route.totalDistanceKm).toBeLessThan(21.2)
    expect(route.segments.length).toBe(22)
    expect(route.segments.at(-1)!.lengthKm).toBeCloseTo(0.0975, 1)
    expect(route.gainM).toBeGreaterThan(50)
    expect(route.gainM).toBeLessThan(120)
    expect(route.gpxWaypoints.length).toBe(4)
    const segSum = route.segments.reduce((s, x) => s + x.lengthKm, 0)
    expect(segSum).toBeCloseTo(route.totalDistanceKm, 6)
  })
  it('handles namespaced rtept & missing ele', () => {
    const xml = `<gpx:gpx xmlns:gpx="x"><gpx:rte><gpx:rtept lon="100.5" lat="13.7"/><gpx:rtept lat="13.71" lon="100.5"/></gpx:rte></gpx:gpx>`
    const r = parseGpx(xml)
    expect(r.pts.length).toBe(2)
    expect(r.hasElevation).toBe(false)
  })
  it('rejects non-gpx', () => {
    expect(() => parseGpx('<kml></kml>')).toThrow()
  })
})

describe('pacingEngine', () => {
  it('apportion sums exactly', () => {
    const w = [1, 1.0333, 0.97, 0.2, 1.11]
    expect(apportion(w, 8101).reduce((a, b) => a + b, 0)).toBe(8101)
  })
  it('grade factor: uphill slower, downhill faster, flat = 1', () => {
    expect(gradeFactor(0)).toBeCloseTo(1, 6)
    expect(gradeFactor(0.02)).toBeGreaterThan(1.05)
    expect(gradeFactor(-0.02)).toBeLessThan(0.98)
    expect(gradeFactor(-0.02)).toBeGreaterThan(0.95)
  })
  it('negative split: 2nd half avg 3% faster', () => {
    const f1 = (strategyFactor(0, 'negative', 3) + strategyFactor(0.5, 'negative', 3)) / 2
    const f2 = (strategyFactor(0.5, 'negative', 3) + strategyFactor(1, 'negative', 3)) / 2
    expect(f2 / f1).toBeCloseTo(0.97, 6)
  })
  for (const strategy of ['even', 'negative', 'positive'] as const) {
    for (const gap of [true, false]) {
      it(`sum of splits == target exactly (${strategy}, gap=${gap})`, () => {
        for (const t of [3599, 5400, 8100, 8101, 15523]) {
          const r = computePacing(route.segments, { ...base, strategy, gapEnabled: gap, targetSec: t }, 4.5 * 3600)
          expect(r.rows.reduce((s, x) => s + x.splitSec, 0)).toBe(t)
          expect(r.totalSec).toBe(t)
          expect(r.rows.at(-1)!.clockSec).toBe(4.5 * 3600 + t)
        }
      })
    }
  }
  it('GAP slows bridge-up km relative to flat', () => {
    const r = computePacing(route.segments, base, 0)
    const up = r.rows.reduce((a, b) => (b.gradePct > a.gradePct ? b : a))
    const flat = r.rows.reduce((a, b) => (Math.abs(b.gradePct) < Math.abs(a.gradePct) ? b : a))
    expect(up.paceSec).toBeGreaterThan(flat.paceSec)
  })
  it('elapsed/km interpolation round-trip', () => {
    const r = computePacing(route.segments, base, 0)
    for (const km of [0.5, 7.3, 15, 21]) expect(kmAtElapsed(r.rows, elapsedAtKm(r.rows, km))).toBeCloseTo(km, 6)
  })
  it('heat: 30°C/80% gives meaningful slowdown, 15°C/50% none', () => {
    expect(heatAdjustment(30, 80, 8100, 21.1).slowdownPct).toBeGreaterThan(4)
    expect(heatAdjustment(15, 50, 8100, 21.1).slowdownPct).toBe(0)
  })
})

describe('fuelingEngine', () => {
  const wps: Waypoint[] = [2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20].map((km, i) => ({ id: `w${i}`, km, type: 'water' }))
  const cfg: FuelingConfig = {
    mode: 'time', interval: 40, firstAt: 40, stopBeforeFinishKm: 3, gels: DEFAULT_GELS, caffeineSecondHalf: true,
    preStartGel: false, snapEnabled: true, snapThresholdKm: 1.5, snapOffsetM: 250,
  }
  const pacing = computePacing(route.segments, base, 4.5 * 3600)
  it('every 40 min for 2:15 -> 3 gels (3rd snaps back to km 17.25 before finish zone), all snapped 250m before water', () => {
    const f = computeFueling(pacing.rows, cfg, wps, 4.5 * 3600)
    expect(f.totalGels).toBe(3)
    for (const e of f.events) {
      expect(e.snappedToId).toBeDefined()
      const st = wps.find((w) => w.id === e.snappedToId)!
      expect(st.km - e.km).toBeCloseTo(0.25, 2)
    }
    expect(f.carbsPerHour).toBeCloseTo(75 / 2.25, 1)
    expect(f.events.at(-1)!.gel.caffeine).toBe(true)
    expect(f.events[0].gel.caffeine).toBe(false)
  })
  it('respects stopBeforeFinish and distance mode', () => {
    const f = computeFueling(pacing.rows, { ...cfg, mode: 'distance', interval: 5, firstAt: 5, snapEnabled: false }, wps, 0)
    expect(f.events.map((e) => e.km)).toEqual([5, 10, 15])
  })
  it('no snap when water too far', () => {
    const f = computeFueling(pacing.rows, { ...cfg, snapThresholdKm: 0.05 }, wps, 0)
    expect(f.events.every((e) => !e.snappedToId)).toBe(true)
  })
})

describe('fueling snap limit', () => {
  it('snap never pushes a gel into the no-gel finish zone', () => {
    const rows = computePacing(route.segments, base, 0).rows
    const wps: Waypoint[] = [17.5, 20].map((km, i) => ({ id: `z${i}`, km, type: 'water' }))
    const f = computeFueling(rows, { mode: 'time', interval: 30, firstAt: 120, stopBeforeFinishKm: 2, gels: DEFAULT_GELS, caffeineSecondHalf: false, preStartGel: false, snapEnabled: true, snapThresholdKm: 1.6, snapOffsetM: 250 }, wps, 0)
    expect(f.events.length).toBe(1)
    expect(f.events[0].km).toBeLessThanOrEqual(19.1)
  })
})

describe('routeGen', () => {
  it('flat route matches distance', () => {
    for (const km of [10, 21.1, 42.195]) {
      const r = analyzeRoute(generateFlatRoute(km, 'x'))
      expect(r.totalDistanceKm).toBeCloseTo(km, 2)
      expect(r.gainM).toBeCloseTo(0, 5)
    }
  })
})
