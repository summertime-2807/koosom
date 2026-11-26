// ผูก rich menu แบดให้ผู้ใช้โหมดแบดอีกครั้ง หลังสร้างเมนูใหม่ (เรียก worker แบบเซ็นด้วย channel secret)
import { createHmac } from 'node:crypto'

const url = process.env.WORKER_URL ?? 'https://raceplan-line-bot.sicasica03.workers.dev/'
const secret = process.env.LINE_CHANNEL_SECRET?.trim()
async function main() {
  if (!secret) return console.log('no secret — skip')
  const body = JSON.stringify({ relink: true })
  const sig = createHmac('sha256', secret).update(body).digest('base64')
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-line-signature': sig }, body })
  console.log('relink', res.status, await res.text())
}
main()
