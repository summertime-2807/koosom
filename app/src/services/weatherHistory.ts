// ─────────────────────────────────────────────────────────────
// อากาศย้อนหลังวันแข่ง (จริง) จาก Open-Meteo Historical Weather API
// ฟรี ไม่ต้องใช้ key รองรับ CORS — เรียกจากเบราว์เซอร์ได้ตรง ๆ
// (ใน Claude artifact จะถูกบล็อกเพราะ CSP → ใช้ค่าอากาศจาก profile แทน)
// ─────────────────────────────────────────────────────────────
import type { RaceProfile, WeatherYear } from '../types/race'
import { parseHM } from '../lib/time'

const CACHE_KEY = 'rp.weather.v1'

function readCache(): Record<string, WeatherYear[]> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')
  } catch {
    return {}
  }
}
function writeCache(c: Record<string, WeatherYear[]>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c))
  } catch {
    /* ignore */
  }
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

/** วันที่ที่ใช้ดูอากาศย้อนหลัง: ใช้วันจัดจริงของปีก่อน ๆ ถ้ามี ไม่งั้นใช้วันเดียวกันของปีก่อน */
export function historyDates(profile: RaceProfile, raceDate: string, years = 5): { year: number; date: string }[] {
  const out: { year: number; date: string }[] = []
  const [, m, d] = raceDate.split('-').map(Number)
  const thisYear = Number(raceDate.slice(0, 4))
  const now = new Date()
  for (let y = thisYear - 1; y >= thisYear - years; y--) {
    const real = profile.pastEditions.find((e) => e.year === y && e.date && Number(e.date.slice(5, 7)) === m)
    const date = real?.date ?? iso(new Date(Date.UTC(y, m - 1, d)))
    if (new Date(date + 'T00:00:00Z').getTime() < now.getTime() - 7 * 864e5) out.push({ year: y, date })
  }
  return out
}

interface OpenMeteoHourly {
  hourly?: {
    time: string[]
    temperature_2m: number[]
    relative_humidity_2m: number[]
    dew_point_2m: number[]
    precipitation: number[]
    wind_speed_10m: number[]
  }
}

export async function fetchRaceWeather(
  profile: RaceProfile,
  raceDate: string,
  startTime: string,
  durationSec: number,
  signal?: AbortSignal,
): Promise<WeatherYear[]> {
  const dates = historyDates(profile, raceDate)
  const key = `${profile.lat.toFixed(2)},${profile.lon.toFixed(2)}|${startTime}|${Math.round(durationSec / 900)}|${dates.map((d) => d.date).join(',')}`
  const cache = readCache()
  if (cache[key]) return cache[key]

  const startH = Math.floor((parseHM(startTime) || 0) / 3600)
  const endH = startH + Math.ceil(durationSec / 3600)
  const results: WeatherYear[] = []
  for (const { year, date } of dates) {
    const end = new Date(Date.parse(date + 'T00:00:00Z') + 864e5)
    const url =
      `https://archive-api.open-meteo.com/v1/archive?latitude=${profile.lat}&longitude=${profile.lon}` +
      `&start_date=${date}&end_date=${iso(end)}&hourly=temperature_2m,relative_humidity_2m,dew_point_2m,precipitation,wind_speed_10m&timezone=Asia%2FBangkok`
    const res = await fetch(url, { signal })
    if (!res.ok) throw new Error(`Open-Meteo ${res.status}`)
    const j = (await res.json()) as OpenMeteoHourly
    const h = j.hourly
    if (!h) continue
    const idx = (hr: number) => Math.min(h.time.length - 1, hr)
    const s = idx(startH)
    const e = idx(endH)
    let rain = 0
    let wind = 0
    for (let i = s; i <= e; i++) {
      rain += h.precipitation[i] ?? 0
      wind = Math.max(wind, h.wind_speed_10m[i] ?? 0)
    }
    results.push({
      year,
      date,
      startTempC: h.temperature_2m[s],
      endTempC: h.temperature_2m[e],
      startRh: h.relative_humidity_2m[s],
      endRh: h.relative_humidity_2m[e],
      dewC: h.dew_point_2m[s],
      rainMm: Math.round(rain * 10) / 10,
      windKmh: Math.round(wind),
    })
  }
  cache[key] = results
  writeCache(cache)
  return results
}

export function summarizeWeather(ws: WeatherYear[]) {
  if (!ws.length) return null
  const avg = (f: (w: WeatherYear) => number) => ws.reduce((s, w) => s + f(w), 0) / ws.length
  return {
    startTemp: avg((w) => w.startTempC),
    endTemp: avg((w) => w.endTempC),
    rh: avg((w) => w.startRh),
    dew: avg((w) => w.dewC),
    rainyYears: ws.filter((w) => w.rainMm >= 1).length,
    hottestEnd: Math.max(...ws.map((w) => w.endTempC)),
  }
}
