// ─────────────────────────────────────────────────────────────
// Pacing engine — Split strategy + Grade-Adjusted Pace + exact normalization
// ผลรวมเวลาทุกช่วง = เวลาเป้าหมาย พอดีทุกวินาที (largest-remainder rounding)
// ─────────────────────────────────────────────────────────────
import type { HeatAdjustment, PacingConfig, PacingResult, Segment, SplitRow } from '../types/race'

/**
 * ตัวคูณเพซจากความชัน (grade เป็นเศษส่วน เช่น 0.03 = 3%)
 * ฐานจากสมการต้นทุนพลังงานการวิ่งของ Minetti et al. (2002)
 *   C(i) = 155.4i⁵ − 30.4i⁴ − 43.3i³ + 46.3i² + 19.5i + 3.6  (J/kg/m)
 * แต่ลดทอนลงให้เหมาะกับการวิ่งแข่งบนถนน (ขาขึ้น ×0.6, ขาลง ×0.45)
 * → ขึ้นเนิน 1% ≈ ช้าลง ~3.3%, ลงเนิน 1% ≈ เร็วขึ้น ~1.6%
 */
export function gradeFactor(grade: number, strength = 1): number {
  const i = Math.max(-0.15, Math.min(0.15, grade))
  const c = 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6
  const raw = c / 3.6 - 1
  const damp = raw >= 0 ? 0.6 : 0.45
  return Math.max(0.5, 1 + raw * damp * strength)
}

/**
 * ตัวคูณจากกลยุทธ์ split ที่ตำแหน่ง f (0–1 ของระยะทาง) — เพซเปลี่ยนแบบเส้นตรง
 * pace(f) = 1 + k(0.5 − f) โดย k ถูกเลือกให้ เพซเฉลี่ยครึ่งหลัง / ครึ่งแรก = 1 − p
 *   → k = 4p / (2 − p)
 * negative: p > 0 (ครึ่งหลังเร็วกว่า), positive: p < 0
 */
export function strategyFactor(f: number, strategy: PacingConfig['strategy'], splitPct: number): number {
  if (strategy === 'even' || !splitPct) return 1
  const p = (strategy === 'negative' ? 1 : -1) * Math.abs(splitPct) / 100
  const k = (4 * p) / (2 - p)
  return 1 + k * (0.5 - f)
}

/**
 * แบ่งจำนวนเต็ม total ตามน้ำหนักทศนิยม โดยผลรวม = total พอดี
 * (Hamilton / largest-remainder method)
 */
export function apportion(weights: number[], total: number): number[] {
  const sumW = weights.reduce((a, b) => a + b, 0)
  if (sumW <= 0) return weights.map(() => 0)
  const exact = weights.map((w) => (w / sumW) * total)
  const floors = exact.map(Math.floor)
  let remaining = total - floors.reduce((a, b) => a + b, 0)
  const order = exact.map((e, i) => ({ i, r: e - floors[i] })).sort((a, b) => b.r - a.r || a.i - b.i)
  for (let j = 0; j < order.length && remaining > 0; j++, remaining--) floors[order[j].i]++
  return floors
}

/**
 * ประเมินผลกระทบความร้อน (ดัชนี Temp°F + Dew point°F)
 * อิงตารางแนวทางที่นักวิ่งใช้กันแพร่หลาย:
 *  ≤100: ไม่กระทบ | 101–110: 0–0.5% | 111–120: 0.5–1% | 121–130: 1–2% | 131–140: 2–3%
 *  141–150: 3–4.5% | 151–160: 4.5–6% | 161–170: 6–8% | 171–180: 8–10% | >180: ไม่แนะนำให้วิ่งเร็ว
 */
export function heatAdjustment(tempC: number, humidity: number, targetSec: number, distanceKm: number): HeatAdjustment {
  const rh = Math.max(1, Math.min(100, humidity))
  // Magnus formula
  const a = 17.625
  const b = 243.04
  const gamma = Math.log(rh / 100) + (a * tempC) / (b + tempC)
  const dewPointC = (b * gamma) / (a - gamma)
  const toF = (c: number) => (c * 9) / 5 + 32
  const index = toF(tempC) + toF(dewPointC)

  const table: [number, number][] = [
    [100, 0], [110, 0.25], [120, 0.75], [130, 1.5], [140, 2.5], [150, 3.75], [160, 5.25], [170, 7], [180, 9],
  ]
  let slowdownPct = 11
  for (const [lim, pct] of table) {
    if (index <= lim) {
      slowdownPct = pct
      break
    }
  }
  const level: HeatAdjustment['level'] =
    slowdownPct === 0 ? 'none' : slowdownPct <= 1 ? 'low' : slowdownPct <= 3 ? 'moderate' : slowdownPct <= 6 ? 'high' : 'extreme'
  const adjustedTargetSec = Math.round(targetSec * (1 + slowdownPct / 100))
  return {
    index: Math.round(index),
    dewPointC: Math.round(dewPointC * 10) / 10,
    slowdownPct,
    level,
    adjustedTargetSec,
    adjustedPaceSec: adjustedTargetSec / distanceKm,
  }
}

/**
 * คำนวณแผนเพซรายกิโล
 * @param startClockSec เวลาปล่อยตัว (วินาทีนับจากเที่ยงคืน)
 */
export function computePacing(segments: Segment[], cfg: PacingConfig, startClockSec: number): PacingResult {
  const totalKm = segments.reduce((s, x) => s + x.lengthKm, 0)
  const target = Math.max(1, Math.round(cfg.targetSec))
  const strength = (cfg.gapStrength ?? 100) / 100

  const weights = segments.map((seg) => {
    const mid = (seg.startKm + seg.endKm) / 2
    const f = totalKm > 0 ? mid / totalKm : 0
    const sf = strategyFactor(f, cfg.strategy, cfg.splitPct)
    const gf = cfg.gapEnabled ? gradeFactor(seg.gradePct / 100, strength) : 1
    return seg.lengthKm * sf * gf
  })
  const splits = apportion(weights, target)

  let elapsed = 0
  const rows: SplitRow[] = segments.map((seg, i) => {
    elapsed += splits[i]
    return {
      index: i,
      km: seg.endKm,
      lengthKm: seg.lengthKm,
      gainM: seg.gainM,
      lossM: seg.lossM,
      gradePct: seg.gradePct,
      paceSec: seg.lengthKm > 0 ? splits[i] / seg.lengthKm : 0,
      splitSec: splits[i],
      elapsedSec: elapsed,
      clockSec: startClockSec + elapsed,
      waypoints: [],
      gels: [],
    }
  })

  const result: PacingResult = { rows, totalSec: elapsed, avgPaceSec: totalKm > 0 ? elapsed / totalKm : 0 }
  if (cfg.tempC != null && cfg.humidity != null && Number.isFinite(cfg.tempC) && Number.isFinite(cfg.humidity)) {
    result.heat = heatAdjustment(cfg.tempC, cfg.humidity, target, totalKm)
  }
  return result
}

/** เวลาสะสม (วินาที) ณ ระยะ km — interpolate ภายในช่วง */
export function elapsedAtKm(rows: SplitRow[], km: number): number {
  if (km <= 0) return 0
  let prevKm = 0
  let prevT = 0
  for (const r of rows) {
    if (km <= r.km + 1e-9) {
      const t = r.km === prevKm ? 0 : (km - prevKm) / (r.km - prevKm)
      return prevT + t * r.splitSec
    }
    prevKm = r.km
    prevT = r.elapsedSec
  }
  return prevT
}

/** ระยะ (km) ณ เวลาสะสม sec */
export function kmAtElapsed(rows: SplitRow[], sec: number): number {
  if (sec <= 0) return 0
  let prevKm = 0
  let prevT = 0
  for (const r of rows) {
    if (sec <= r.elapsedSec) {
      const t = r.splitSec === 0 ? 0 : (sec - prevT) / r.splitSec
      return prevKm + t * (r.km - prevKm)
    }
    prevKm = r.km
    prevT = r.elapsedSec
  }
  return prevKm
}

/** สปลิตที่ระยะเป้าหมายใด ๆ (เช่นทุก 5K) */
export function milestoneSplits(rows: SplitRow[], everyKm = 5): { km: number; elapsedSec: number }[] {
  const total = rows.length ? rows[rows.length - 1].km : 0
  const out: { km: number; elapsedSec: number }[] = []
  for (let k = everyKm; k < total - 0.05; k += everyKm) out.push({ km: k, elapsedSec: elapsedAtKm(rows, k) })
  if (rows.length) out.push({ km: total, elapsedSec: rows[rows.length - 1].elapsedSec })
  return out
}
