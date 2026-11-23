// ดึงรายการงานวิ่งที่กำลังจะมาถึงจาก race.thai.run แล้วเขียนเป็น races.json
// รันโดย GitHub Actions วันละครั้ง (ดู .github/workflows/update-races.yml)
// ใช้ Node 20+ (มี fetch ในตัว) ไม่มี dependency
import { writeFileSync, readFileSync, existsSync } from 'node:fs'

const API = 'https://api.race.thai.run/graphql'
const QUERY = `query s($startDate: Date, $fun: Boolean, $mini: Boolean, $half: Boolean, $full: Boolean) {
  searchEvent(startDate: $startDate, fun: $fun, mini: $mini, half: $half, full: $full) {
    _id slug name { en th } startDate provinces isRegOpen regClosed isSoldOut isVirtual hidden testMode published website organizer { name }
  }
}`
const DIST = [
  ['fun', 5],
  ['mini', 10],
  ['half', 21.1],
  ['full', 42.195],
]

async function search(vars) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'raceplan-byo-gpx (personal race calendar; daily)' },
    body: JSON.stringify({ query: QUERY, variables: vars }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const j = await res.json()
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 300))
  return j.data?.searchEvent ?? []
}

const bkkDate = (iso) => new Date(Date.parse(iso) + 7 * 3600e3).toISOString().slice(0, 10)

const now = new Date()
const startDate = now.toISOString()
const horizon = Date.now() + 400 * 864e5
const byId = new Map()
const add = (e, km) => {
  if (!e?.slug || !e.startDate) return
  const t = Date.parse(e.startDate)
  if (!(t > Date.now() - 864e5 && t < horizon)) return
  if (!e.published || e.testMode || e.hidden || e.isVirtual) return
  const cur = byId.get(e._id) ?? { e, d: new Set() }
  if (km) cur.d.add(km)
  byId.set(e._id, cur)
}

// หมายเหตุ: ค้นแบบไม่ใส่ตัวกรองระยะ API จะ error จึงค้นทีละประเภทระยะแล้วรวมกัน
for (const [flag, km] of DIST) {
  for (const e of await search({ startDate, [flag]: true })) add(e, km)
  await new Promise((r) => setTimeout(r, 1500)) // สุภาพกับเซิร์ฟเวอร์
}

const races = [...byId.values()]
  .map(({ e, d }) => ({
    id: `tr_${e.slug}`,
    name: (e.name?.th || e.name?.en || e.slug).trim(),
    date: bkkDate(e.startDate),
    location: (e.provinces ?? []).join(', ') || undefined,
    organizer: e.organizer?.name || undefined,
    distancesKm: [...d].sort((a, b) => a - b),
    source: 'race.thai.run',
    url: `https://race.thai.run/${encodeURIComponent(e.slug)}`,
    regOpen: !!e.isRegOpen && !e.regClosed && !e.isSoldOut,
  }))
  .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))

if (races.length < 5) {
  console.error(`ได้แค่ ${races.length} งาน — ไม่เขียนทับไฟล์เดิม`)
  process.exit(1)
}

const out = { source: 'race.thai.run', updatedAt: now.toISOString(), count: races.length, races }
const prev = existsSync('races.json') ? JSON.parse(readFileSync('races.json', 'utf8')) : null
if (prev && JSON.stringify(prev.races) === JSON.stringify(races)) {
  console.log('ไม่มีงานใหม่/เปลี่ยนแปลง')
} else {
  writeFileSync('races.json', JSON.stringify(out, null, 1) + '\n')
  console.log(`เขียน races.json: ${races.length} งาน`)
}
