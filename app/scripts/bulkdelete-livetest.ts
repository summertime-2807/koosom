// ทดสอบลบหลายรายการ (events/bulk-delete) กับ Intervals.icu จริง ในปี 2031 (ไม่กระทบตารางจริง) · พิมพ์เฉพาะสถานะ
import { IntervalsClient } from '../src/coach/intervals'

const id = process.env.INTERVALS_ATHLETE_ID!.trim()
const key = process.env.INTERVALS_API_KEY!.trim()
const ok = (c: boolean, m: string) => {
  console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`)
  if (!c) process.exitCode = 1
}

async function main() {
  const c = new IntervalsClient(id, key)
  const mine = async () => (await c.events('2031-01-04', '2031-01-08')).filter((e) => e.external_id?.startsWith('rp-zz-bulk-'))
  await c.upsertEvents([5, 6, 7].map((d) => ({ external_id: `rp-zz-bulk-${d}`, category: 'NOTE', start_date_local: `2031-01-0${d}T00:00:00`, name: 'ทดสอบลบ (คู่ซ้อม)', description: 'ทดสอบอัตโนมัติ' })))
  const before = await mine()
  ok(before.length === 3, `สร้าง ${before.length}/3`)
  // เรียก bulk-delete ตรง ๆ เพื่อยืนยันว่า endpoint ใช้ได้ (ไม่ใช่ fallback ลบทีละอัน)
  const res = await fetch(`https://intervals.icu/api/v1/athlete/${id}/events/bulk-delete`, {
    method: 'PUT',
    headers: { Authorization: 'Basic ' + Buffer.from(`API_KEY:${key}`).toString('base64'), 'Content-Type': 'application/json' },
    body: JSON.stringify(before.slice(0, 2).map((e) => ({ id: e.id }))),
  })
  ok(res.ok, `bulk-delete HTTP ${res.status}`)
  const mid = await mine()
  ok(mid.length === 1, `เหลือ ${mid.length} (ควรเหลือ 1)`)
  await c.deleteEvents(mid.map((e) => e.id))
  const after = await mine()
  ok(after.length === 0, `deleteEvents เหลือ ${after.length}`)
}
main().catch((e) => {
  console.error((e as Error).message)
  process.exit(1)
})
