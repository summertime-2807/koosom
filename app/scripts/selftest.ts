// ทดสอบบอท LINE ทุกคำสั่งบนข้อมูลจริง (รันใน GitHub Actions) — พิมพ์เฉพาะสถานะ ไม่มีเนื้อหา
import { createHmac } from 'node:crypto'

const url = process.env.WORKER_URL ?? 'https://raceplan-line-bot.sicasica03.workers.dev/'
const secret = process.env.LINE_CHANNEL_SECRET?.trim()
const cmds = (process.env.CMDS ?? '__google,ติดงาน,การนอน,นอนกี่โมงดี,ตื่น 14:00,นอนตอนนี้,งีบ,เป้าการนอน,การนอน,วันนี้,สัปดาห์,สรุป,รายงาน,แข่ง,การ์ดเพซ,ผลแข่ง,รองเท้า,เพิ่มเติม,ถามโค้ช,เป้า,คำถาม,เมนู,พรุ่งนี้ควรซ้อมหนักไหม,รองเท้าคู่ไหนเหมาะกับวันแข่ง,เพซ easy ของผมควรเท่าไหร่,แบด:เมนู,แบด:เพิ่มเติม,แบด:ภาระ,แบด:กันเจ็บ,แบด:กันเจ็บ ไหล่,แบด:วอร์ม,แบด:คูลดาวน์,แบด:แข่ง,แบด:วันนี้,แบด:บันทึกเล่น,แบด:ตั้งค่าแบด,แบด:การนอน,แบด:ไหล่ตึงหลังตบควรพักไหม,ใหม่:สวัสดี,ใหม่:ลงทะเบียน ZZZZZZ,ผู้ใช้').split(',')

async function main() {
  if (!secret) throw new Error('no LINE_CHANNEL_SECRET')
  let bad = 0
  // รูปแบบพิเศษ: "แบด:<คำสั่ง>" = ทดสอบโหมดแบด (อ่านอย่างเดียว) · "ใหม่:<คำสั่ง>" = ผู้ใช้ที่ยังไม่ลงทะเบียน
  for (const raw of cmds) {
    const [mode, rest] = raw.includes(':') && /^(แบด|ใหม่):/.test(raw) ? (raw.split(/:(.*)/s) as [string, string]) : ['', raw]
    const cmd = rest
    const body = JSON.stringify({ selftest: cmd, ...(mode === 'แบด' ? { sport: 'badminton' } : {}), ...(mode === 'ใหม่' ? { uid: 'Uselftest000000000000000000000000' } : {}) })
    const sig = createHmac('sha256', secret).update(body).digest('base64')
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-line-signature': sig }, body })
    const j = (await res.json().catch(() => ({ http: res.status }))) as Record<string, unknown>
    const wantAi = /ไหม|เท่าไหร่|เหมาะ/.test(cmd) && mode !== 'ใหม่'
    const ok = cmd === '__google' ? !!j.kv : j.valid === 200 && !j.thrown && !j.aiFail && (!wantAi || j.ai === true)
    if (!ok) bad++
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${mode ? `[${mode}] ` : ''}${JSON.stringify(j)}`)
  }
  if (bad) process.exit(1)
}
main().catch((e) => {
  console.error((e as Error).message)
  process.exit(1)
})
