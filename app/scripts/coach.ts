// ─────────────────────────────────────────────────────────────
// งานโค้ชอัตโนมัติ (GitHub Actions)
//   night   (21:00): อ่านผลซ้อม + ค่าร่างกาย → ปรับตารางตามกฎ → เขียนสรุปลงปฏิทิน Intervals.icu → แจ้งเตือนมือถือ
//   morning (08:00): เช็ก HRV / HR พัก / การนอน → แจ้งเตือนเฉพาะวันที่ค่าไม่ดี
// secrets: INTERVALS_ATHLETE_ID, INTERVALS_API_KEY, (ไม่บังคับ) NTFY_TOPIC
// ⚠️ repo สาธารณะ → log ของงานนี้สาธารณะ ห้ามพิมพ์ข้อมูลสุขภาพ/คีย์ออก console
// ─────────────────────────────────────────────────────────────
import { IntervalsClient } from '../src/coach/intervals'
import { loadAndAnalyze, commitReport } from '../src/coach/runner'
import { battery, overallLight, lightDot } from '../src/coach/engine'
import { addDays } from '../src/engine/trainingEngine'
import { MENU, linePush, questionMessages, text } from '../src/coach/line'

const mode = process.argv[2] === 'morning' ? 'morning' : 'night'
const id = process.env.INTERVALS_ATHLETE_ID?.trim()
const key = process.env.INTERVALS_API_KEY?.trim()
const topic = process.env.NTFY_TOPIC?.trim()
const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim()
const lineUser = process.env.LINE_USER_ID?.trim()
const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10) // เวลาไทย

async function line(messages: Parameters<typeof linePush>[2]) {
  if (!lineToken || !lineUser) return
  await linePush(lineToken, lineUser, messages).catch((e) => console.log('line push failed', (e as Error).message.slice(0, 60)))
}

async function notify(title: string, body: string) {
  if (!topic) return
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
  if (today > addDays(cfg.to, 1)) {
    console.log('แผนจบแล้ว — ข้าม')
    return
  }
  if (mode === 'morning') {
    const w = await client.wellness(addDays(today, -8), today)
    const b = battery(w, today)
    const ov = overallLight(b)
    console.log(`morning: items=${b.length}`)
    if (ov === 'red' || ov === 'yellow') {
      const body = b.filter((x) => x.light !== 'green').map((x) => `${lightDot(x.light)} ${x.label} ${x.value} — ${x.why}`).join('\n')
      await notify(`${lightDot(ov)} ค่าร่างกายเช้านี้ควรระวัง`, body)
      await line([text(`${lightDot(ov)} ค่าร่างกายเช้านี้ควรระวัง\n${body}`, MENU)])
    }
    return
  }
  const data = await loadAndAnalyze(client, cfg, today)
  const r = await commitReport(client, cfg, data, today)
  console.log(`night: applied=${r.applied} questions=${data.report.questions.length} days=${data.report.days.length}`)
  const title = `${lightDot(data.report.overall)} โค้ชสรุป ${today.slice(5)}${data.report.questions.length ? ' ❓' : ''}`
  await notify(title, data.report.summary.slice(0, 3800))
  const fresh = await loadAndAnalyze(client, cfg, today)
  await line([text(`${title}\n\n${data.report.summary}`, MENU), ...questionMessages(fresh.openQuestions)].slice(0, 5))
}

main().catch((e) => {
  // ไม่พิมพ์รายละเอียดที่อาจมีข้อมูลส่วนตัว
  console.error('coach failed:', (e as Error).message.slice(0, 120))
  process.exit(1)
})
