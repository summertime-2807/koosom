// ─────────────────────────────────────────────────────────────
// งานโค้ชอัตโนมัติของคู่ซ้อม (GitHub Actions)
//   night   (21:07): อ่านผลซ้อม + ค่าร่างกาย → ปรับตารางตามกฎ → เขียนสรุปลงปฏิทิน → ส่ง LINE
//                    + วันอาทิตย์: การ์ดรายงานสัปดาห์
//                    + วันแข่งถึง 2 วันหลังแข่ง: วิเคราะห์ผลแข่ง (ส่งครั้งเดียว)
//   morning (08:07): ซ้อมวันนี้ + แบตเตอรี่ร่างกาย (ข้ามถ้าเชื่อม Google Health — บอทส่ง "☀️ ตื่นแล้ว" หลังตื่นจริงแทน)
//                    + เหลือ ≤ 7 วันก่อนแข่ง: การ์ดสัปดาห์แข่ง (พยากรณ์อากาศ + สิ่งที่ต้องทำ)
//                    + 1 วันก่อนแข่งและวันแข่ง: การ์ดเพซ
// secrets: INTERVALS_ATHLETE_ID, INTERVALS_API_KEY, LINE_CHANNEL_ACCESS_TOKEN, LINE_USER_ID, (ไม่บังคับ) NTFY_TOPIC
// ⚠️ repo สาธารณะ → log ของงานนี้สาธารณะ ห้ามพิมพ์ข้อมูลสุขภาพ/คีย์ออก console
// ─────────────────────────────────────────────────────────────
import { IntervalsClient } from '../src/coach/intervals'
import { loadAndAnalyze, commitReport } from '../src/coach/runner'
import { battery, overallLight, lightDot } from '../src/coach/engine'
import { addDays, daysBetween, dowOf } from '../src/engine/trainingEngine'
import { MENU, MORE, dayLabel, flex, linePush, plannedFor, questionMessages, text, workoutLines } from '../src/coach/line'
import type { LineMessage } from '../src/coach/line'
import { REVIEW_PREFIX, findRaceActivity, analyzeRace, loadShoes, paceCard, raceInfo, raceWeather, shoeWarnings, shoesOldest, weeklyData } from '../src/coach/extras'
import { paceCardFlex, raceWeekFlex, reviewFlex, weeklyFlex } from '../src/coach/flex'
import { fmtHMS } from '../src/lib/time'
import { loadSleepStore } from '../src/coach/googleHealth'
import { sleepStats } from '../src/coach/sleepCoach'

const mode = process.argv[2] === 'morning' ? 'morning' : 'night'
const id = process.env.INTERVALS_ATHLETE_ID?.trim()
const key = process.env.INTERVALS_API_KEY?.trim()
const topic = process.env.NTFY_TOPIC?.trim()
const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim()
const lineUser = process.env.LINE_USER_ID?.trim()
const today = process.env.COACH_TODAY?.trim() || new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10) // เวลาไทย

const dry = process.env.COACH_DRY === '1'

async function line(messages: LineMessage[]) {
  if (!lineToken || !lineUser || !messages.length) return
  if (dry) {
    // ทดสอบ: ให้ LINE ตรวจรูปแบบข้อความโดยไม่ส่งจริง พิมพ์เฉพาะสถานะ
    const res = await fetch('https://api.line.me/v2/bot/message/validate/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lineToken}` },
      body: JSON.stringify({ messages: messages.slice(0, 5) }),
    })
    console.log(`dry-run ${today} ${mode}: ${messages.map((m) => (m.type === 'flex' ? 'flex' : 'text')).join('+')} → LINE validate ${res.status}${res.ok ? '' : ' ' + (await res.text()).slice(0, 200)}`)
    if (!res.ok) process.exitCode = 1
    return
  }
  await linePush(lineToken, lineUser, messages.slice(0, 5)).catch((e) => console.log('line push failed', (e as Error).message.slice(0, 60)))
}

async function notify(title: string, body: string) {
  if (!topic || dry) return
  await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}?title=${encodeURIComponent(title)}&tags=runner`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body,
  }).catch(() => undefined)
}

async function main() {
  if (!id || !key) {
    console.log('ยังไม่ได้ตั้งค่า INTERVALS_ATHLETE_ID / INTERVALS_API_KEY — ข้าม')
    return
  }
  const client = new IntervalsClient(id, key)
  const cfg = await client.loadConfig()
  if (!cfg) {
    console.log('ยังไม่มีค่าตั้งค่าโค้ช (กดบันทึกในแอปก่อน) — ข้าม')
    return
  }
  const end = cfg.raceDate && cfg.raceDate > cfg.to ? cfg.raceDate : cfg.to
  if (today > addDays(end, 3)) {
    console.log('แผนจบแล้ว — ข้าม')
    return
  }
  const info = raceInfo(cfg)
  const daysLeft = info ? daysBetween(today, info.date) : undefined

  if (mode === 'morning') {
    const msgs: LineMessage[] = []
    const w = await client.wellness(addDays(today, -8), today)
    const b = battery(w, today)
    const ov = overallLight(b)
    const events = await client.events(today, today)
    const todays = plannedFor(events, today)
    const lines: string[] = [`☀️ อรุณสวัสดิ์ · ${dayLabel(today)}`]
    if (todays.length) for (const e of todays) lines.push('', `📅 ${e.name}`, workoutLines(e))
    else lines.push('', 'วันนี้พัก / เดินเบา ๆ 🧘')
    lines.push('', `${lightDot(ov)} แบตเตอรี่ร่างกาย`)
    for (const x of b) lines.push(`${lightDot(x.light)} ${x.label} ${x.value}${x.light !== 'green' ? ` — ${x.why}` : ''}`)
    if (ov === 'red' && todays.length) lines.push('', 'ค่าร่างกายไม่ดี ถ้าวันนี้เป็นวันหนัก ลองลดเป็นวิ่งเบา หรือพิมพ์ถามโค้ชได้เลย')
    // ถ้าเชื่อม Google Health แล้ว บอทจะส่ง "☀️ ตื่นแล้ว" หลังตื่นจริงแทน (เวลานอนไม่ตายตัว) → ไม่ส่งซ้ำตอน 08:07
    const sleepStore = await loadSleepStore(client).catch(() => null)
    const wakeMode = !!sleepStore && Date.now() - Date.parse(sleepStore.updatedAt) < 2 * 86400e3
    // ไม่ส่งถ้าวันพักและร่างกายปกติ (ประหยัดโควตา push ของ LINE)
    if (!wakeMode && (todays.length || ov === 'red' || ov === 'yellow')) msgs.push(text(lines.join('\n'), MENU))
    if (ov === 'red' || ov === 'yellow') await notify(`${lightDot(ov)} ค่าร่างกายเช้านี้ควรระวัง`, b.filter((x) => x.light !== 'green').map((x) => `${x.label} ${x.value} — ${x.why}`).join('\n'))

    if (info && daysLeft != null && daysLeft >= 0 && daysLeft <= 7) {
      const weather = await raceWeather(info)
      const card = cfg.goalSec ? paceCard(info, cfg.goalSec, weather) : undefined
      msgs.push(flex(daysLeft ? `🏁 อีก ${daysLeft} วันถึง ${info.name}` : `🏁 วันนี้แข่ง ${info.name}!`, raceWeekFlex(info, daysLeft, weather, card), MORE))
      if (card && daysLeft <= 1) msgs.push(flex(`⏱ การ์ดเพซ ${fmtHMS(card.targetSec)}`, paceCardFlex(info, card), MORE))
    }
    console.log(`morning: messages=${msgs.length}`)
    await line(msgs)
    return
  }

  // ── night ──
  const data = await loadAndAnalyze(client, cfg, today)
  const r = dry ? { applied: 0 } : await commitReport(client, cfg, data, today)
  console.log(`night: applied=${r.applied} questions=${data.report.questions.length} days=${data.report.days.length}`)
  const title = `${lightDot(data.report.overall)} โค้ชสรุป ${today.slice(5)}${data.report.questions.length ? ' ❓' : ''}`
  await notify(title, data.report.summary.slice(0, 3800))
  const fresh = await loadAndAnalyze(client, cfg, today)
  const msgs: LineMessage[] = [text(`${title}\n\n${data.report.summary}`, MENU)]

  // วิเคราะห์ผลแข่ง (ครั้งเดียว)
  if (info && daysLeft != null && daysLeft <= 0 && daysLeft >= -2) {
    const acts = await client.activities(addDays(info.date, -1), today)
    const race = findRaceActivity(acts, cfg)
    if (race) {
      const { data: done } = await client.loadJson<{ activityId: string }>(`${REVIEW_PREFIX}${info.date}`, info.date)
      if (!done) {
        const review = analyzeRace(race, await client.activityStreams(race.id), cfg, true)
        if (!dry) await client.saveJson(`${REVIEW_PREFIX}${info.date}`, info.date, `🏅 ผลแข่ง ${fmtHMS(review.finishSec)}`, { activityId: race.id, finishSec: review.finishSec, splitPct: review.splitPct }, review.verdict.join('\n'))
        msgs.push(flex(`🏅 ผลแข่ง ${fmtHMS(review.finishSec)}`, reviewFlex(review, true, cfg.goalSec && cfg.distKm ? cfg.goalSec / cfg.distKm : undefined), MORE))
        console.log('night: race review sent')
      }
    }
  }

  // รายงานประจำสัปดาห์ (คืนวันอาทิตย์)
  if (dowOf(today) === 0) {
    const [acts, wellness, store] = await Promise.all([client.activities(addDays(today, -70), today), client.wellness(addDays(today, -21), today), loadShoes(client)])
    const shoeActs = store.shoes.length ? await client.activities(shoesOldest(store, today), today) : []
    const w = weeklyData(fresh.events, acts, wellness, cfg, today)
    const ss = await loadSleepStore(client).catch(() => null)
    const sst = ss ? sleepStats(ss.nights, today, cfg.sleepTargetMin) : undefined
    msgs.push(flex(`📊 สัปดาห์นี้ ${w.actualKm}/${w.plannedKm} กม.`, weeklyFlex(w, cfg.goalSec, shoeWarnings(store, shoeActs), sst), MENU))
  }

  msgs.push(...questionMessages(fresh.openQuestions))
  await line(msgs.slice(0, 5))
}

main().catch((e) => {
  // ไม่พิมพ์รายละเอียดที่อาจมีข้อมูลส่วนตัว
  console.error('coach failed:', (e as Error).message.slice(0, 120))
  process.exit(1)
})
