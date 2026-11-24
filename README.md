# คู่ซ้อม (KooSom)

เปิดใช้งาน: https://summertime-2807.github.io/koosom/

- `index.html` — แอปทั้งตัวในไฟล์เดียว (ที่ GitHub Pages เสิร์ฟ)
- `app/` — โค้ดเต็ม (React + Vite + TS + Tailwind): `cd app && npm install && npm run dev`
- อัปเดตเว็บ: `cd app && npm run build:single` แล้วคัดลอก `app/dist-single/index.html` ไปทับ `index.html`

## งานวิ่งอัปเดตอัตโนมัติ
- `.github/workflows/update-races.yml` รันทุกวัน 03:17 น. (เวลาไทย) → `scripts/fetch-races.mjs` ดึงงานจาก race.thai.run → เขียน `races.json`
- แอปโหลด `races.json` ตอนเปิด ถ้าโหลดไม่ได้จะใช้รายการชุดเริ่มต้นแทน
- สั่งรันเองได้ที่แท็บ Actions → "อัปเดตงานวิ่งจาก race.thai.run" → Run workflow

## LINE bot (สองทาง)
- `app/worker/index.ts` — Cloudflare Worker รับข้อความจาก LINE (คำสั่ง: วันนี้ · สัปดาห์ · สรุป · คำถาม · ซิงก์ · เป้า · เจ็บ <อาการ> · id)
- `.github/workflows/line-bot.yml` — deploy Worker อัตโนมัติ (ต้องมี secret CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET, LINE_USER_ID)
- งานทุกคืนส่งสรุปเข้า LINE เมื่อมี LINE_CHANNEL_ACCESS_TOKEN + LINE_USER_ID

## LINE bot คู่ซ้อม (@754yhzoj)

เมนูถาวร: วันนี้ · สัปดาห์ · สรุป · ถามโค้ช · รายงาน · เพิ่มเติม

| คำสั่ง | ทำอะไร |
|---|---|
| วันนี้ / สัปดาห์ / สรุป | ซ้อมวันนี้-พรุ่งนี้ · 7 วันข้างหน้า · แบตเตอรี่ร่างกาย |
| รายงาน | การ์ดรายงานสัปดาห์ (ส่งเองทุกคืนวันอาทิตย์ด้วย) |
| แข่ง · การ์ดเพซ | โหมดสัปดาห์แข่ง (พยากรณ์อากาศ + สิ่งที่ต้องทำ) · เพซ/เวลาทุก 5 กม. + จุดกินเจล |
| ผลแข่ง | วิเคราะห์ split หลังแข่ง (ก่อนวันแข่งจะใช้วิ่งล่าสุดแทน) |
| รองเท้า [เพิ่ม/ใช้/ปลด] <ชื่อ> | นับระยะรองเท้า เตือนเมื่อใกล้ 700 กม. |
| เจ็บ <อาการ> · ซิงก์ · คำถาม · เป้า | บันทึกอาการ · ปรับตารางตอนนี้ · คำถามค้าง · ความพร้อม |
| ข้อความอื่น ๆ | โค้ช AI ตอบจากข้อมูลจริง (Workers AI ฟรี หรือ Gemini ถ้ามี GEMINI_API_KEY) |

อัตโนมัติ: 08:07 ส่งซ้อมวันนี้ + แบตเตอรี่ (ข้ามวันพักที่ร่างกายปกติ) · 7 วันก่อนแข่งส่งการ์ดสัปดาห์แข่งทุกเช้า · 21:07 สรุป/ปรับตาราง · คืนวันแข่งส่งวิเคราะห์ผล
