// ─────────────────────────────────────────────────────────────
// หน้าลงทะเบียนผู้ใช้ (เปิดจากลิงก์ที่บอทส่งให้หลังใส่รหัสเชิญ)
// เก็บความยินยอม PDPA + ตรวจคีย์ Intervals ก่อนบันทึก
// ─────────────────────────────────────────────────────────────
import { IntervalsClient, runHrSettings } from '../src/coach/intervals'
import type { CoachConfig } from '../src/coach/types'
import type { Sport, UserEnv } from '../src/coach/users'
import { readInvite, readRegisterToken, saveUser, useInvite } from '../src/coach/users'
import { addDays } from '../src/engine/trainingEngine'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const shell = (title: string, body: string) =>
  new Response(
    `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:24px 18px;line-height:1.6}
.card{max-width:520px;margin:0 auto}
h1{font-size:1.35rem;color:#34d399;margin:0 0 4px}
label{display:block;margin:16px 0 6px;font-weight:600}
input[type=text],input[type=password]{width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #334155;background:#1e293b;color:#f1f5f9;font-size:16px}
.opt{display:flex;gap:10px;align-items:flex-start;margin:8px 0;font-weight:400}
.opt input{margin-top:5px;width:18px;height:18px}
.muted{color:#94a3b8;font-size:.9rem}
.box{background:#1e293b;border-radius:12px;padding:12px 14px;margin:14px 0;font-size:.92rem}
button{width:100%;margin-top:20px;padding:14px;border:0;border-radius:12px;background:#34d399;color:#0f172a;font-size:17px;font-weight:700}
a{color:#38bdf8}
</style></head><body><div class="card">${body}</div></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  )

export function registerForm(token: string, sport: Sport, error = ''): Response {
  return shell(
    'ลงทะเบียนคู่ซ้อม',
    `<h1>ลงทะเบียน คู่ซ้อม (เบต้า)</h1>
<p class="muted">ใช้เวลา 2 นาที · ทำครั้งเดียว</p>
${error ? `<div class="box" style="border:1px solid #f87171">⚠️ ${esc(error)}</div>` : ''}
<form method="post" action="/register">
<input type="hidden" name="t" value="${esc(token)}">
<label>ชื่อเล่น</label>
<input type="text" name="name" maxlength="30" required placeholder="เช่น แอน">
<label>กีฬาหลัก</label>
<div class="opt"><input type="radio" name="sport" value="badminton" id="s1" ${sport === 'badminton' ? 'checked' : ''}><label for="s1" style="margin:0;font-weight:400">🏸 แบดมินตัน</label></div>
<div class="opt"><input type="radio" name="sport" value="run" id="s2" ${sport === 'run' ? 'checked' : ''}><label for="s2" style="margin:0;font-weight:400">🏃 วิ่ง</label></div>
<div class="box">
<b>เชื่อม Intervals.icu</b> (ที่เก็บข้อมูลจากนาฬิกา)<br>
1. เข้า <a href="https://intervals.icu" target="_blank">intervals.icu</a> → สมัคร/ล็อกอิน<br>
2. Settings → เลื่อนลงหา <b>Developer Settings</b><br>
3. คัดลอก <b>Athlete ID</b> (ขึ้นต้นด้วย i) และกด <b>Generate</b> API key แล้วคัดลอก
</div>
<label>Athlete ID</label>
<input type="text" name="athleteId" required pattern="i?[0-9]+" placeholder="i123456" autocomplete="off">
<label>API key</label>
<input type="password" name="apiKey" required minlength="10" autocomplete="off">
<label>ข้อความอัตโนมัติ</label>
<div class="opt"><input type="checkbox" name="push" value="1" id="p"><label for="p" style="margin:0;font-weight:400">ส่งข้อความหาฉันเองตอนตื่น/สรุปตอนค่ำ (ถ้าไม่เลือก ยังกดดูทุกอย่างจากเมนูได้)</label></div>
<div class="box">
<b>ความยินยอมเรื่องข้อมูลส่วนบุคคล (PDPA)</b><br>
คู่ซ้อมจะอ่าน <b>ข้อมูลสุขภาพ</b> ของคุณจาก Intervals.icu ได้แก่ ผลการออกกำลังกาย อัตราการเต้นหัวใจ HRV และการนอน รวมถึงอาการเจ็บที่คุณแจ้ง เพื่อทำตารางฝึกและคำแนะนำให้คุณคนเดียว<br>
• ไม่ขาย ไม่ส่งต่อให้บุคคลอื่น ไม่ใช้โฆษณา<br>
• ข้อความที่คุณถามโค้ช AI จะถูกส่งไปประมวลผลที่ผู้ให้บริการ AI พร้อมข้อมูลสรุปที่จำเป็น<br>
• คีย์ Intervals เก็บแบบเข้ารหัส · ขอลบบัญชีได้ทุกเมื่อโดยพิมพ์ <b>ลบบัญชี</b> ใน LINE<br>
<a href="https://summertime-2807.github.io/koosom/privacy.html" target="_blank">อ่านนโยบายความเป็นส่วนตัว</a>
</div>
<div class="opt"><input type="checkbox" name="consent" value="1" id="c" required><label for="c" style="margin:0;font-weight:400">ฉันยินยอมให้คู่ซ้อมใช้ข้อมูลสุขภาพตามที่ระบุข้างต้น</label></div>
<button type="submit">ลงทะเบียน</button>
</form>`,
  )
}

export const donePage = (name: string, sport: Sport) =>
  shell('ลงทะเบียนสำเร็จ', `<h1>✅ ยินดีต้อนรับ ${esc(name)}!</h1><p>ลงทะเบียนเรียบร้อย กลับไปที่ LINE แชท <b>คู่ซ้อม</b> แล้วพิมพ์ <b>${sport === 'badminton' ? 'ตั้งค่าแบด' : 'เมนู'}</b> เพื่อเริ่มได้เลย</p>`)

export const errorPage = (title: string, msg: string) => shell(title, `<h1>${esc(title)}</h1><p>${esc(msg)}</p><p class="muted">กลับไปที่ LINE แล้วพิมพ์ <b>ลงทะเบียน</b> เพื่อขอลิงก์ใหม่</p>`)

/** สร้างค่าตั้งค่าโค้ชเริ่มต้น (ถ้ายังไม่มี) เพื่อให้คำสั่งพื้นฐาน/โค้ชการนอนใช้ได้ทันที */
async function ensureConfig(client: IntervalsClient, sport: Sport) {
  if (await client.loadConfig()) return
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
  let lthr = 165
  let maxHr = 190
  try {
    const hr = runHrSettings(await client.athlete())
    lthr = hr.lthr ?? lthr
    maxHr = hr.maxHr ?? maxHr
  } catch {
    /* ใช้ค่าเริ่มต้น */
  }
  const cfg: CoachConfig = {
    version: 1,
    planName: sport === 'badminton' ? 'แบดมินตัน' : 'ยังไม่มีแผน',
    from: today,
    to: addDays(today, 365),
    lthr,
    maxHr,
    autoAdjust: false,
    sleepTargetMin: 450,
  }
  await client.saveConfig(cfg)
}

/** POST /register */
export async function handleRegister(req: Request, env: UserEnv, onDone: (uid: string, name: string, sport: Sport) => Promise<void>): Promise<Response> {
  const f = await req.formData()
  const token = String(f.get('t') ?? '')
  const tk = await readRegisterToken(env, token)
  if (!tk) return errorPage('ลิงก์หมดอายุ', 'ลิงก์ลงทะเบียนใช้ได้ 30 นาที')
  const inv = await readInvite(env, tk.code)
  if (!inv) return errorPage('รหัสเชิญหมดอายุ', 'ขอรหัสเชิญใหม่จากเจ้าของ (รหัสใช้ได้ 3 วัน และใช้ได้ครั้งเดียว)')
  const sport: Sport = f.get('sport') === 'run' ? 'run' : 'badminton'
  const name = String(f.get('name') ?? '').trim().slice(0, 30)
  let athleteId = String(f.get('athleteId') ?? '').trim()
  const apiKey = String(f.get('apiKey') ?? '').trim()
  if (!f.get('consent')) return registerForm(token, sport, 'ต้องกดยินยอมก่อนลงทะเบียน')
  if (!name) return registerForm(token, sport, 'ใส่ชื่อเล่นด้วย')
  if (/^\d+$/.test(athleteId)) athleteId = `i${athleteId}`
  const client = new IntervalsClient(athleteId, apiKey)
  try {
    await client.athlete()
  } catch {
    return registerForm(token, sport, 'เชื่อม Intervals ไม่ได้ — ตรวจ Athlete ID และ API key อีกครั้ง')
  }
  await ensureConfig(client, sport).catch(() => undefined)
  const now = new Date().toISOString()
  await saveUser(env, { uid: tk.uid, name, athleteId, apiKey, sport, push: !!f.get('push'), consentAt: now, createdAt: now, invitedBy: inv.by })
  await useInvite(env, tk.code)
  await onDone(tk.uid, name, sport).catch(() => undefined)
  return donePage(name, sport)
}
