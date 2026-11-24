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
