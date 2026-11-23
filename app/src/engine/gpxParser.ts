// ─────────────────────────────────────────────────────────────
// GPX parser & route engine — pure TS, ไม่พึ่ง DOM (ทดสอบใน Node ได้)
// ─────────────────────────────────────────────────────────────
import type { RouteAnalysis, Segment, StoredRoute, TrackPoint } from '../types/race'

const R_EARTH = 6371008.8 // m

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180
  const dLat = (lat2 - lat1) * toRad
  const dLon = (lon2 - lon1) * toRad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)))
}

export interface RawGpx {
  name: string
  pts: [number, number, number][]
  hasElevation: boolean
  wpts: { name: string; lat: number; lon: number }[]
}

function attr(tag: string, name: string): number {
  const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`).exec(tag)
  return m ? Number(m[1]) : NaN
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()
}

/**
 * แยก trkpt (หรือ rtept ถ้าไม่มี trkpt) + wpt ออกจาก GPX XML
 * รองรับ namespace prefix เช่น <gpx:trkpt>
 */
export function parseGpx(xml: string): RawGpx {
  if (!/<(\w+:)?gpx[\s>]/i.test(xml)) throw new Error('ไฟล์นี้ไม่ใช่ GPX')

  const pointRe = (tag: string) =>
    new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${tag}>)`, 'gi')
  const eleRe = /<(?:\w+:)?ele>\s*([-+0-9.eE]+)\s*<\/(?:\w+:)?ele>/i
  const nameRe = /<(?:\w+:)?name>([\s\S]*?)<\/(?:\w+:)?name>/i

  const collect = (tag: string) => {
    const out: [number, number, number][] = []
    let eleCount = 0
    for (const m of xml.matchAll(pointRe(tag))) {
      const lat = attr(m[1], 'lat')
      const lon = attr(m[1], 'lon')
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
      const em = m[2] ? eleRe.exec(m[2]) : null
      const ele = em ? Number(em[1]) : NaN
      if (Number.isFinite(ele)) eleCount++
      out.push([lat, lon, ele])
    }
    return { out, eleCount }
  }

  let { out: pts, eleCount } = collect('trkpt')
  if (pts.length < 2) ({ out: pts, eleCount } = collect('rtept'))
  if (pts.length < 2) throw new Error('ไม่พบจุดเส้นทาง (trkpt/rtept) ในไฟล์ GPX')

  // เติมค่า ele ที่หายไปด้วยค่าก่อนหน้า/ถัดไป
  const hasElevation = eleCount >= pts.length * 0.5
  let last = pts.find((p) => Number.isFinite(p[2]))?.[2] ?? 0
  for (const p of pts) {
    if (!Number.isFinite(p[2]) || !hasElevation) p[2] = hasElevation ? last : 0
    last = p[2]
  }

  // ชื่อเส้นทาง: <trk><name> ก่อน แล้วค่อย <metadata><name>
  const trk = /<(?:\w+:)?trk\b[\s\S]*?>([\s\S]*?)<(?:\w+:)?trkseg/i.exec(xml)
  const meta = /<(?:\w+:)?metadata\b[\s\S]*?>([\s\S]*?)<\/(?:\w+:)?metadata>/i.exec(xml)
  const nm = (trk && nameRe.exec(trk[1])) || (meta && nameRe.exec(meta[1]))
  const name = nm ? decodeXml(nm[1]) : ''

  const wpts: RawGpx['wpts'] = []
  for (const m of xml.matchAll(pointRe('wpt'))) {
    const lat = attr(m[1], 'lat')
    const lon = attr(m[1], 'lon')
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const n = m[2] ? nameRe.exec(m[2]) : null
    wpts.push({ name: n ? decodeXml(n[1]) : 'จุด', lat, lon })
  }
  return { name, pts, hasElevation, wpts }
}

/** สะสมระยะทาง (m) */
export function cumulativeDistances(pts: [number, number, number][]): number[] {
  const d = [0]
  for (let i = 1; i < pts.length; i++) {
    d.push(d[i - 1] + haversineM(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]))
  }
  return d
}

/**
 * ลดจุดให้ห่างกันอย่างน้อย minSpacingM (เก็บจุดแรก/สุดท้ายเสมอ) — ใช้ก่อนบันทึกลง storage
 * ไม่เปลี่ยนระยะรวมอย่างมีนัยสำคัญเพราะ GPS ระยะใกล้มักเป็นเส้นตรง
 */
export function downsample(pts: [number, number, number][], minSpacingM = 8): [number, number, number][] {
  if (pts.length <= 2) return pts.slice()
  const out: [number, number, number][] = [pts[0]]
  let acc = 0
  for (let i = 1; i < pts.length - 1; i++) {
    acc += haversineM(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1])
    if (acc >= minSpacingM) {
      out.push(pts[i])
      acc = 0
    }
  }
  out.push(pts[pts.length - 1])
  return out.map(([a, b, c]) => [round(a, 6), round(b, 6), round(c, 1)])
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d

/**
 * กรองความสูงด้วย moving average ตามระยะทาง (±halfWindowM)
 * ใช้ two-pointer → O(n)
 */
export function smoothElevation(dist: number[], ele: number[], halfWindowM = 40): number[] {
  const n = ele.length
  const out = new Array<number>(n)
  let lo = 0
  let hi = 0
  let sum = 0
  for (let i = 0; i < n; i++) {
    while (hi < n && dist[hi] <= dist[i] + halfWindowM) sum += ele[hi++]
    while (dist[lo] < dist[i] - halfWindowM) sum -= ele[lo++]
    out[i] = sum / (hi - lo)
  }
  return out
}

/** ความสูงแบบ interpolate ที่ระยะ d (m) */
export function eleAt(points: TrackPoint[], dM: number): number {
  if (dM <= 0) return points[0].eleSmooth
  const last = points[points.length - 1]
  if (dM >= last.distM) return last.eleSmooth
  let lo = 0
  let hi = points.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (points[mid].distM <= dM) lo = mid
    else hi = mid
  }
  const a = points[lo]
  const b = points[hi]
  const t = b.distM === a.distM ? 0 : (dM - a.distM) / (b.distM - a.distM)
  return a.eleSmooth + (b.eleSmooth - a.eleSmooth) * t
}

/** lat/lon ที่ระยะ d (m) — ใช้วาง km marker บนแผนที่ */
export function latLonAt(points: TrackPoint[], dM: number): [number, number] {
  if (dM <= 0) return [points[0].lat, points[0].lon]
  const last = points[points.length - 1]
  if (dM >= last.distM) return [last.lat, last.lon]
  let lo = 0
  let hi = points.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (points[mid].distM <= dM) lo = mid
    else hi = mid
  }
  const a = points[lo]
  const b = points[hi]
  const t = b.distM === a.distM ? 0 : (dM - a.distM) / (b.distM - a.distM)
  return [a.lat + (b.lat - a.lat) * t, a.lon + (b.lon - a.lon) * t]
}

/** ตัดเป็นช่วง 1 กม. + ช่วงสุดท้ายเศษ (ถ้าเศษ < 20 ม. จะรวมเข้ากับช่วงก่อนหน้า) */
export function buildSegments(points: TrackPoint[], segmentM = 1000): Segment[] {
  const total = points[points.length - 1].distM
  const bounds: number[] = [0]
  for (let d = segmentM; d < total; d += segmentM) bounds.push(d)
  if (total - bounds[bounds.length - 1] < 20 && bounds.length > 1) bounds.pop()
  bounds.push(total)

  const segs: Segment[] = []
  let pi = 0
  for (let s = 0; s < bounds.length - 1; s++) {
    const a = bounds[s]
    const b = bounds[s + 1]
    const eleStart = eleAt(points, a)
    const eleEnd = eleAt(points, b)
    let prev = eleStart
    let gain = 0
    let loss = 0
    while (pi < points.length && points[pi].distM <= a) pi++
    let j = pi
    while (j < points.length && points[j].distM < b) {
      const diff = points[j].eleSmooth - prev
      if (diff > 0) gain += diff
      else loss -= diff
      prev = points[j].eleSmooth
      j++
    }
    const diff = eleEnd - prev
    if (diff > 0) gain += diff
    else loss -= diff
    const lengthM = b - a
    segs.push({
      index: s,
      startKm: a / 1000,
      endKm: b / 1000,
      lengthKm: lengthM / 1000,
      eleStart,
      eleEnd,
      gainM: gain,
      lossM: loss,
      gradePct: lengthM > 0 ? ((eleEnd - eleStart) / lengthM) * 100 : 0,
    })
  }
  return segs
}

/** แปลง StoredRoute -> RouteAnalysis (ระยะสะสม, กรองความสูง, ช่วง 1 กม.) */
export function analyzeRoute(route: StoredRoute): RouteAnalysis {
  const pts = route.pts
  if (pts.length < 2) throw new Error('เส้นทางต้องมีอย่างน้อย 2 จุด')
  const dist = cumulativeDistances(pts)
  const ele = pts.map((p) => p[2])
  const hasElevation = ele.some((e) => e !== ele[0])
  const smooth = smoothElevation(dist, ele)
  const points: TrackPoint[] = pts.map((p, i) => ({
    lat: p[0],
    lon: p[1],
    ele: p[2],
    eleSmooth: smooth[i],
    distM: dist[i],
  }))
  const segments = buildSegments(points)
  const gainM = segments.reduce((s, x) => s + x.gainM, 0)
  const lossM = segments.reduce((s, x) => s + x.lossM, 0)
  let minEle = Infinity
  let maxEle = -Infinity
  for (const p of points) {
    minEle = Math.min(minEle, p.eleSmooth)
    maxEle = Math.max(maxEle, p.eleSmooth)
  }
  return {
    name: route.name,
    points,
    totalDistanceKm: dist[dist.length - 1] / 1000,
    gainM,
    lossM,
    minEle,
    maxEle,
    hasElevation,
    segments,
    gpxWaypoints: route.gpxWaypoints ?? [],
  }
}

/** หาระยะ (km) ของจุดบนเส้นทางที่ใกล้ lat/lon ที่สุด */
export function projectToKm(pts: [number, number, number][], dist: number[], lat: number, lon: number): number {
  let best = Infinity
  let bestI = 0
  for (let i = 0; i < pts.length; i++) {
    const d = haversineM(lat, lon, pts[i][0], pts[i][1])
    if (d < best) {
      best = d
      bestI = i
    }
  }
  return dist[bestI] / 1000
}

/** GPX XML -> StoredRoute พร้อมบันทึก */
export function gpxToStoredRoute(xml: string, fallbackName = 'เส้นทางของฉัน'): StoredRoute {
  const raw = parseGpx(xml)
  const pts = downsample(raw.pts)
  const dist = cumulativeDistances(pts)
  const gpxWaypoints = raw.wpts.map((w) => ({ name: w.name, km: round(projectToKm(pts, dist, w.lat, w.lon), 2) }))
  return { name: raw.name || fallbackName, source: 'upload', pts, gpxWaypoints }
}
