// สร้างไฟล์ GPX ตัวอย่าง: ฮาล์ฟมาราธอน 21.1 กม. รอบเกาะรัตนโกสินทร์ (เส้นทางสมมติ ข้ามสะพาน 4 แห่ง)
// รัน: node scripts/genSample.mjs  -> src/data/sample-bkk-half.gpx และ public/sample-bkk-half.gpx
import { writeFileSync } from 'node:fs'

const anchors = [
  [13.7563, 100.4925], [13.7625, 100.4960], [13.7700, 100.4990], [13.7712, 100.4925],
  [13.7790, 100.4850], [13.7900, 100.4900], [13.7952, 100.5050], [13.7850, 100.5150],
  [13.7700, 100.5250], [13.7560, 100.5200], [13.7450, 100.5080], [13.7382, 100.4950],
  [13.7362, 100.4880], [13.7470, 100.4830], [13.7618, 100.4868], [13.7602, 100.4935], [13.7566, 100.4928],
]
// [anchorIndex (ช่วงข้ามแม่น้ำ A->A+1), ความสูงสะพาน m, ชื่อ]
const bridges = [[2, 20, 'สะพานพระราม 8'], [5, 14, 'สะพานกรุงธน'], [10, 9, 'สะพานพุทธ'], [13, 12, 'สะพานปิ่นเกล้า']]
const TARGET = 21097.5
const R = 6371008.8
const hv = (a, b) => {
  const t = Math.PI / 180
  const dLa = (b[0] - a[0]) * t, dLo = (b[1] - a[1]) * t
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * t) * Math.cos(b[0] * t) * Math.sin(dLo / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}
const len = (pts) => pts.slice(1).reduce((s, p, i) => s + hv(pts[i], p), 0)
const cLat = anchors.reduce((s, p) => s + p[0], 0) / anchors.length
const cLon = anchors.reduce((s, p) => s + p[1], 0) / anchors.length
// ขยายรอบจุดศูนย์กลางให้ระยะรวมพอดี 21.0975 กม. (วนแก้ 3 รอบ)
let scaled = anchors
for (let k = 0; k < 4; k++) {
  const f = TARGET / len(scaled)
  scaled = scaled.map(([la, lo]) => [cLat + (la - cLat) * f, cLon + (lo - cLon) * f])
}
// resample ทุก ~20 ม.
const out = []
const anchorD = [0]
let acc = 0
for (let i = 0; i < scaled.length - 1; i++) {
  const a = scaled[i], b = scaled[i + 1], d = hv(a, b)
  const n = Math.max(1, Math.round(d / 20))
  for (let j = 0; j < n; j++) {
    const t = j / n
    out.push({ lat: a[0] + (b[0] - a[0]) * t, lon: a[1] + (b[1] - a[1]) * t, d: acc + d * t })
  }
  acc += d
  anchorD.push(acc)
}
out.push({ lat: scaled.at(-1)[0], lon: scaled.at(-1)[1], d: acc })
// pseudo-random แบบ deterministic
let seed = 42
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
for (const p of out) {
  let e = 2.2 + 0.8 * Math.sin(p.d / 1700) + (rnd() - 0.5) * 1.2 // GPS jitter ±0.6 ม.
  for (const [ai, H] of bridges) {
    const c = (anchorD[ai] + anchorD[ai + 1]) / 2
    const h = Math.max((anchorD[ai + 1] - anchorD[ai]) / 2, 150) + 260
    if (Math.abs(p.d - c) < h) e += (H * (Math.cos((Math.PI * (p.d - c)) / h) + 1)) / 2
  }
  p.ele = e
}
const wpts = [
  ...bridges.map(([ai, , name]) => {
    const c = (anchorD[ai] + anchorD[ai + 1]) / 2
    const p = out.reduce((best, q) => (Math.abs(q.d - c) < Math.abs(best.d - c) ? q : best))
    return `  <wpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><name>${name}</name><type>hill</type></wpt>`
  }),
]
const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="raceplan-byo-gpx sample" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>ตัวอย่าง: ฮาล์ฟมาราธอนกรุงเทพ 21.1K (เส้นทางสมมติ)</name></metadata>
${wpts.join('\n')}
  <trk><name>ตัวอย่าง: ฮาล์ฟมาราธอนกรุงเทพ 21.1K (เส้นทางสมมติ)</name><trkseg>
${out.map((p) => `    <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><ele>${p.ele.toFixed(1)}</ele></trkpt>`).join('\n')}
  </trkseg></trk>
</gpx>
`
writeFileSync(new URL('../src/data/sample-bkk-half.gpx', import.meta.url), gpx)
writeFileSync(new URL('../public/sample-bkk-half.gpx', import.meta.url), gpx)
console.log('points', out.length, 'length m', acc.toFixed(1), 'bytes', gpx.length)
