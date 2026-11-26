// ─────────────────────────────────────────────────────────────
// ตั้งเมนูถาวร (Rich menu) ของ LINE OA คู่ซ้อม
// รูป: assets/richmenu.png (2500×843, 4×2 ปุ่ม) สร้างด้วย scripts/richmenu-image.py
// รันผ่าน GitHub Actions (.github/workflows/richmenu.yml) — ใช้ secret LINE_CHANNEL_ACCESS_TOKEN
// ─────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'

const token = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim()
const W = 2500
const H = 843
const COLS = 4
const CW = Math.floor(W / COLS)
const CH = Math.floor(H / 2)

const MENUS = [
  {
    name: 'koosom-main',
    image: '../assets/richmenu.png',
    isDefault: true,
    buttons: ['วันนี้', 'สัปดาห์', 'สรุป', 'ซิงก์', 'ถามโค้ช', 'รายงาน', 'ติดงาน', 'เพิ่มเติม'],
  },
  {
    name: 'koosom-badminton',
    image: '../assets/richmenu-badminton.png',
    isDefault: false,
    buttons: ['วันนี้', 'สัปดาห์', 'บันทึกเล่น', 'ภาระ', 'กันเจ็บ', 'การนอน', 'ถามโค้ช', 'เพิ่มเติม'],
  },
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
  const { richmenus } = await api<{ richmenus: { richMenuId: string; name: string }[] }>('https://api.line.me/v2/bot/richmenu/list')
  for (const M of MENUS) {
    const menu = {
      size: { width: W, height: H },
      selected: true,
      name: M.name,
      chatBarText: 'เมนูคู่ซ้อม',
      areas: M.buttons.map((b, i) => ({
        bounds: { x: (i % COLS) * CW, y: Math.floor(i / COLS) * CH, width: i % COLS === COLS - 1 ? W - (COLS - 1) * CW : CW, height: i >= COLS ? H - CH : CH },
        action: { type: 'message', label: b, text: b },
      })),
    }
    await api('https://api.line.me/v2/bot/richmenu/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(menu) })
    const { richMenuId } = await api<{ richMenuId: string }>('https://api.line.me/v2/bot/richmenu', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(menu) })
    const png = readFileSync(new URL(M.image, import.meta.url))
    await api(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png })
    if (M.isDefault) await api(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, { method: 'POST' })
    for (const old of richmenus.filter((m) => m.name === M.name)) await api(`https://api.line.me/v2/bot/richmenu/${old.richMenuId}`, { method: 'DELETE' })
    console.log(`${M.name}: สร้างใหม่แล้ว${M.isDefault ? ' (ค่าเริ่มต้น)' : ''}`)
  }
}

main().catch((e) => {
  console.error('richmenu failed:', (e as Error).message)
  process.exit(1)
})
