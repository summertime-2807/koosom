# คู่ซ้อม (KooSom) — แผนวิ่ง & โค้ช

แอปวางแผนเพซ/ความชัน/เจล สำหรับ 10K · ฮาล์ฟ · มาราธอน — อัปโหลด GPX ของงานใดก็ได้ ทำงานในเครื่อง 100% ไม่ใช้ API key

## เริ่มใช้งาน
```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests ของ engine (vitest)
npm run build        # dist/ (deploy ขึ้น Vercel/Netlify/GitHub Pages ได้เลย)
npm run build:single # dist-single/index.html ไฟล์เดียว เปิดออฟไลน์ได้
```

## โครงสร้าง
```
src/
  types/race.ts            ← interfaces หลักทั้งหมด
  engine/
    gpxParser.ts           ← parse GPX (trkpt/rtept/wpt), Haversine, smoothing, ตัดช่วง 1 กม.
    pacingEngine.ts        ← split strategy + GAP (Minetti) + heat + normalize เวลาเป๊ะ (largest remainder)
    fuelingEngine.ts       ← ตารางเจล เวลา/ระยะ + Smart Water-Station Snap
    routeGen.ts            ← เส้นทางราบจำลอง (เมื่อยังไม่มี GPX)
    __tests__/engine.test.ts
  services/
    storage.ts             ← RaceStorage interface + LocalStorage impl (สลับเป็น Supabase ได้ใน getStorage())
    download.ts            ← ดาวน์โหลดไฟล์ / คัดลอก
    planFactory.ts         ← ค่าเริ่มต้นของแผน
  data/
    sample-bkk-half.gpx    ← GPX ตัวอย่าง 21.1K ข้ามสะพาน 4 แห่ง (สร้างจาก scripts/genSample.mjs)
    raceCalendar.ts        ← ปฏิทินงานวิ่ง (snapshot จาก race.thai.run / FrontRunnr / ahotu)
  components/              ← UI (Map, Chart, Editors, SplitTable, Export, Archive, Calendar)
```

## หมายเหตุ
- race.thai.run เป็นเว็บแบบ SPA ไม่มี API สาธารณะ และเบราว์เซอร์ดึงข้ามโดเมนไม่ได้ (CORS) — ปฏิทินจึงเป็นข้อมูลชุดเริ่มต้น + เพิ่มงานเองได้ ถ้าจะ sync อัตโนมัติ ต้องทำ backend/cron (เช่น Supabase Edge Function) มาดึงแทน
- อัปเดตปฏิทิน: แก้ `src/data/raceCalendar.ts`
