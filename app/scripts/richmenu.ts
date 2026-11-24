// ─────────────────────────────────────────────────────────────
// ตั้งเมนูถาวร (Rich menu) ของ LINE OA คู่ซ้อม
// รูป: assets/richmenu.png (2500×843, 3×2 ปุ่ม) สร้างด้วย scripts/richmenu-image.py
// รันผ่าน GitHub Actions (.github/workflows/richmenu.yml) — ใช้ secret LINE_CHANNEL_ACCESS_TOKEN
// ─────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'

const token = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim()
const NAME = 'koosom-main'
const W = 2500
const H = 843
const CW = Math.floor(W / 3)
const CH = Math.floor(H / 2)

const buttons = [
  { label: 'วันนี้', text: 'วันนี้' },
  { label: 'สัปดาห์', text: 'สัปดาห์' },
  { label: 'สรุป', text: 'สรุป' },
  { label: 'ถามโค้ช', text: 'ถามโค้ช' },
  { label: 'รายงาน', text: 'รายงาน' },
  { label: 'เพิ่มเติม', text: 'เพิ่มเติม' },
]

async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } })
  const body = await res.text()
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url.replace(/richmenu\/[^/]+/, 'richmenu/…')} → ${res.status} ${body.slice(0, 200)}`)
  return (body ? JSON.parse(body) : {}) as T
}

async function main() {
  if (!token) {
    console.log('ยังไม่มี LINE_CHANNEL_ACCESS_TOKEN — ข้าม')
    return
  }
  const menu = {
    size: { width: W, height: H },
    selected: true,
    name: NAME,
    chatBarText: 'เมนูคู่ซ้อม',
    areas: buttons.map((b, i) => ({
      bounds: { x: (i % 3) * CW, y: Math.floor(i / 3) * CH, width: i % 3 === 2 ? W - 2 * CW : CW, height: i >= 3 ? H - CH : CH },
      action: { type: 'message', label: b.label, text: b.text },
    })),
  }
  await api('https://api.line.me/v2/bot/richmenu/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(menu) })
  const { richMenuId } = await api<{ richMenuId: string }>('https://api.line.me/v2/bot/richmenu', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(menu),
  })
  const png = readFileSync(new URL('../assets/richmenu.png', import.meta.url))
  await api(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png })
  await api(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, { method: 'POST' })
  // ลบเมนูเก่าชื่อเดียวกัน
  const { richmenus } = await api<{ richmenus: { richMenuId: string; name: string }[] }>('https://api.line.me/v2/bot/richmenu/list')
  let removed = 0
  for (const m of richmenus) {
    if (m.name === NAME && m.richMenuId !== richMenuId) {
      await api(`https://api.line.me/v2/bot/richmenu/${m.richMenuId}`, { method: 'DELETE' })
      removed++
    }
  }
  console.log(`rich menu ตั้งเป็นค่าเริ่มต้นแล้ว (ลบเมนูเก่า ${removed})`)
}

main().catch((e) => {
  console.error('richmenu failed:', (e as Error).message)
  process.exit(1)
})
