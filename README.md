# แผนวิ่ง BYO-GPX

เปิดใช้งาน: https://summertime-2807.github.io/raceplan/

- `index.html` — แอปทั้งตัวในไฟล์เดียว (ที่ GitHub Pages เสิร์ฟ)
- `app/` — โค้ดเต็ม (React + Vite + TS + Tailwind): `cd app && npm install && npm run dev`
- อัปเดตเว็บ: `cd app && npm run build:single` แล้วคัดลอก `app/dist-single/index.html` ไปทับ `index.html`

## งานวิ่งอัปเดตอัตโนมัติ
- `.github/workflows/update-races.yml` รันทุกวัน 03:17 น. (เวลาไทย) → `scripts/fetch-races.mjs` ดึงงานจาก race.thai.run → เขียน `races.json`
- แอปโหลด `races.json` ตอนเปิด ถ้าโหลดไม่ได้จะใช้รายการชุดเริ่มต้นแทน
- สั่งรันเองได้ที่แท็บ Actions → "อัปเดตงานวิ่งจาก race.thai.run" → Run workflow
