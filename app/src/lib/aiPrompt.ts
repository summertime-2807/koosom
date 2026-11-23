import type { CalendarRace, RaceProfile, RouteAnalysis, TrainingInput, TrainingPlan, WeatherYear, FuelingSummary } from '../types/race'
import { fmtHMS, fmtPace } from './time'
import { COURSE_TH } from '../data/raceProfiles'
import { PHASE_TH } from '../engine/trainingEngine'

export interface PromptCtx {
  raceName: string
  race?: CalendarRace
  raceDate: string
  startTime: string
  distKm: number
  goalSec: number
  profile: RaceProfile
  route: RouteAnalysis
  weather: WeatherYear[]
  input: TrainingInput
  plan: TrainingPlan
  fueling: FuelingSummary
}

const EXP_TH = { new: 'มือใหม่ (เพิ่งเริ่ม/ยังไม่เคยวิ่งระยะนี้)', regular: 'วิ่งประจำ', experienced: 'มีประสบการณ์แข่งหลายสนาม' }

export function buildAnalysisPrompt(c: PromptCtx): string {
  const p = c.profile
  const lines: string[] = []
  lines.push('คุณคือโค้ชวิ่งระยะไกลที่เชี่ยวชาญการแข่งขันในประเทศไทยและสภาพอากาศร้อนชื้น')
  lines.push('วิเคราะห์ข้อมูลด้านล่าง แล้วตอบเป็นภาษาไทย กระชับ ตรงประเด็น ใช้ Markdown หัวข้อ ## และ bullet')
  lines.push('ห้ามแต่งข้อมูลสนามที่ไม่มีในข้อมูล ถ้าข้อมูลไม่พอให้บอกว่าควรเช็กอะไรเพิ่ม')
  lines.push('')
  lines.push('# สนาม')
  lines.push(`- ชื่อ: ${c.raceName}${c.race?.location ? ` (${c.race.location})` : ''}`)
  lines.push(`- วันแข่ง: ${c.raceDate} · ปล่อยตัว ${c.startTime} · ระยะ ${c.distKm.toFixed(2)} กม. · เหลือ ${c.plan.daysToRace} วัน`)
  lines.push(`- ลักษณะเส้นทาง: ${COURSE_TH[p.course]} · GPX ในแผน: ขึ้นรวม +${c.route.gainM.toFixed(0)} ม. ลง −${c.route.lossM.toFixed(0)} ม.${c.route.name.includes('จำลอง') ? ' (เป็นเส้นทางจำลองทางราบ ไม่ใช่ GPX จริง)' : ''}`)
  if (p.cutoffs) lines.push(`- เวลาตัดตัว: ${Object.entries(p.cutoffs).map(([k, v]) => `${k} กม. ${v}`).join(', ')}`)
  p.courseNotes.forEach((n) => lines.push(`- ${n}`))
  if (p.pastEditions.length) {
    lines.push('## การจัดปีที่ผ่านมา')
    p.pastEditions.forEach((e) => lines.push(`- ${e.year}${e.date ? ` (${e.date})` : ''}: ${e.note}`))
  }
  p.stats.forEach((s) => lines.push(`- สถิติ: ${s}`))
  lines.push('## อากาศ')
  if (c.weather.length) {
    lines.push('อากาศจริงช่วงเวลาแข่งในปีก่อน ๆ (Open-Meteo):')
    c.weather.forEach((w) =>
      lines.push(`- ${w.date}: เริ่ม ${w.startTempC.toFixed(1)}°C/${w.startRh.toFixed(0)}% → จบ ${w.endTempC.toFixed(1)}°C/${w.endRh.toFixed(0)}% · จุดน้ำค้าง ${w.dewC.toFixed(1)}°C · ฝน ${w.rainMm} มม. · ลมสูงสุด ${w.windKmh} กม./ชม.`),
    )
  } else lines.push(`- ${p.climate.note} (อุณหภูมิ ~${p.climate.tempC}°C ความชื้น ~${p.climate.humidity}%${p.climate.estimated ? ', ค่าประมาณ' : ''})`)
  lines.push('')
  lines.push('# นักวิ่ง')
  lines.push(`- ประสบการณ์: ${EXP_TH[c.input.experience]}`)
  lines.push(`- วิ่งตอนนี้ ~${c.input.weeklyKm} กม./สัปดาห์ · วิ่งยาวสุดล่าสุด ${c.input.longestRunKm} กม. · วิ่ง ${c.input.runsPerWeek} วัน/สัปดาห์`)
  if (c.input.recentRaceKm && c.input.recentRaceSec) lines.push(`- ผลล่าสุด: ${c.input.recentRaceKm} กม. ใน ${fmtHMS(c.input.recentRaceSec)}`)
  lines.push(`- เป้าหมาย: ${fmtHMS(c.goalSec)} (เพซ ${fmtPace(c.goalSec / c.distKm)}/กม.)`)
  if (c.plan.feasibility.predictedSec) lines.push(`- เวลาคาดการณ์จากผลล่าสุด (สูตร Riegel): ${fmtHMS(c.plan.feasibility.predictedSec)}`)
  lines.push(`- แผนเจลวันแข่ง: ${c.fueling.totalGels} ซอง · ${c.fueling.carbsPerHour.toFixed(0)} g คาร์บ/ชม.`)
  lines.push('')
  lines.push('# ตารางซ้อมที่ระบบสร้าง (สรุปรายสัปดาห์)')
  c.plan.weeks.forEach((w) => {
    const key = w.workouts.filter((x) => x.type !== 'easy').map((x) => `${x.title} ${x.km}กม.`).join(', ')
    lines.push(`- สัปดาห์ ${w.index} (${w.startDate}, ${PHASE_TH[w.phase]}${w.cutback ? ', พักฟื้น' : ''}): ${w.km} กม. · ${key}`)
  })
  lines.push(`- เพซซ้อม: ง่าย ${fmtPace(c.plan.paces.easy[0])}–${fmtPace(c.plan.paces.easy[1])} · เทมโป ${fmtPace(c.plan.paces.threshold)} · อินเทอร์วัล ${fmtPace(c.plan.paces.interval)}`)
  lines.push('')
  lines.push('# สิ่งที่ต้องการ (ตอบตามหัวข้อนี้)')
  lines.push('## 1. สนามนี้ยากตรงไหน — จากเส้นทาง อากาศย้อนหลัง และเวลาปล่อยตัว')
  lines.push('## 2. เป้าหมายสมจริงไหม — ให้ช่วงเวลาที่แนะนำ (A: ดีที่สุด / B: สมจริง / C: วันแย่)')
  lines.push('## 3. ปรับตารางซ้อมอย่างไร — ระบุสัปดาห์/session ที่ควรเพิ่ม-ลด-เปลี่ยน ไม่เกิน 6 ข้อ')
  lines.push('## 4. กลยุทธ์วันแข่ง — เพซแต่ละช่วง น้ำ/เจล/เกลือแร่ รับมืออากาศ')
  lines.push('## 5. ความเสี่ยงและสัญญาณเตือนที่ต้องระวัง')
  lines.push('ความยาวรวมไม่เกิน ~450 คำ')
  return lines.join('\n')
}
