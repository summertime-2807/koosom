// สร้างเส้นทางจำลอง (ทางราบ) สำหรับงานที่ยังไม่มีไฟล์ GPX
import type { StoredRoute } from '../types/race'
import { cumulativeDistances } from './gpxParser'

/** วงรีรอบจุดศูนย์กลาง (ค่าเริ่มต้น สนามหลวง) ระยะรวม = distanceKm, ความสูง 0 */
export function generateFlatRoute(distanceKm: number, name: string, center: [number, number] = [13.7563, 100.4925]): StoredRoute {
  const n = Math.max(40, Math.round(distanceKm * 40))
  const ratio = 0.6 // แกนรอง/แกนหลัก
  // เส้นรอบวงรีโดยประมาณ (Ramanujan) -> หาแกนหลัก a (m)
  const perim = (a: number) => {
    const b = a * ratio
    return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)))
  }
  const a = (distanceKm * 1000) / (perim(1))
  const mPerDegLat = 111320
  const mPerDegLon = 111320 * Math.cos((center[0] * Math.PI) / 180)
  const pts: [number, number, number][] = []
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * 2 * Math.PI
    const x = a * Math.sin(t)
    const y = a * ratio * (1 - Math.cos(t)) // เริ่มที่ศูนย์กลางด้านล่าง
    pts.push([center[0] + y / mPerDegLat, center[1] + x / mPerDegLon, 0])
  }
  // ปรับสเกลให้ระยะ Haversine ตรงเป้า
  let scaled = pts
  for (let k = 0; k < 3; k++) {
    const d = cumulativeDistances(scaled)
    const f = (distanceKm * 1000) / d[d.length - 1]
    scaled = scaled.map(([la, lo, e]) => [center[0] + (la - center[0]) * f, center[1] + (lo - center[1]) * f, e])
  }
  return { name, source: 'generated', pts: scaled }
}
