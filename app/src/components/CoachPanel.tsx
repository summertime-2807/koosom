import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RacePlan, TrainingPlan } from '../types/race'
import type { CoachConfig, DayRow, IcuAthlete } from '../coach/types'
import { IntervalsClient, EXT_PREFIX, runHrSettings } from '../coach/intervals'
import { loadAndAnalyze, commitReport, answerQuestion, injuryNote } from '../coach/runner'
import type { CoachData } from '../coach/runner'
import { toIcuEvent } from '../coach/workoutText'
import { planSlug } from '../coach/raceSetup'
import { lightDot } from '../coach/engine'
import { bpmRange } from '../coach/workoutText'
import { Card, Field, NumInput, Stat, Toggle } from './ui'
import { fmtHMS, fmtThaiDate } from '../lib/time'
import { DOW_TH, dowOf } from '../engine/trainingEngine'

interface Props {
  plan: RacePlan
  trainingPlan: TrainingPlan
  distKm: number
  toast: (m: string) => void
}

const K_ID = 'rp.icu.id'
const K_KEY = 'rp.icu.key'
const ls = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k) ?? ''
    } catch {
      return ''
    }
  },
  set: (k: string, v: string) => {
    try {
      if (v) localStorage.setItem(k, v)
      else localStorage.removeItem(k)
    } catch {
      /* ignore */
    }
  },
}
const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const slug = planSlug

const STATUS: Record<DayRow['status'], [string, string]> = {
  done: ['✅', 'ครบ'],
  partial: ['⚠️', 'ไม่ครบ'],
  missed: ['❌', 'ขาด'],
  extra: ['➕', 'นอกแผน'],
  planned: ['📅', 'แผน'],
  rest: ['·', 'พัก'],
}

export default function CoachPanel({ plan, trainingPlan, distKm, toast }: Props) {
  const today = todayISO()
  const [athleteId, setAthleteId] = useState(() => ls.get(K_ID))
  const [apiKey, setApiKey] = useState(() => ls.get(K_KEY))
  const client = useMemo(() => (athleteId && apiKey ? new IntervalsClient(athleteId.trim(), apiKey.trim()) : null), [athleteId, apiKey])
  const [athlete, setAthlete] = useState<IcuAthlete | null>(null)
  const [cfg, setCfg] = useState<CoachConfig | null>(null)
  const [data, setData] = useState<CoachData | null>(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [injury, setInjury] = useState('')
  const [replaceForeign, setReplaceForeign] = useState(false)

  const defaultCfg = useCallback(
    (a?: IcuAthlete | null): CoachConfig => {
      const hr = a ? runHrSettings(a) : {}
      return {
        version: 1,
        planName: plan.meta.name,
        from: today,
        to: plan.meta.date,
        raceDate: plan.meta.date,
        goalSec: plan.pacing.targetSec,
        distKm,
        lthr: hr.lthr ?? 165,
        maxHr: hr.maxHr ?? 185,
        autoAdjust: true,
      }
    },
    [plan.meta.name, plan.meta.date, plan.pacing.targetSec, distKm, today],
  )

  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(label)
    setErr('')
    try {
      return await fn()
    } catch (e) {
      const m = (e as Error).message
      setErr(/Failed to fetch|NetworkError|Load failed/i.test(m) ? 'เชื่อมต่อ Intervals.icu ไม่ได้ — ถ้าเปิดในหน้า Claude จะใช้ส่วนนี้ไม่ได้ ให้เปิดที่ลิงก์ github.io' : m)
    } finally {
      setBusy('')
    }
  }

  async function connect() {
    if (!client) return
    await run('กำลังเชื่อมต่อ…', async () => {
      ls.set(K_ID, athleteId.trim())
      ls.set(K_KEY, apiKey.trim())
      const a = await client.athlete()
      setAthlete(a)
      const c = (await client.loadConfig()) ?? defaultCfg(a)
      setCfg(c)
      setData(await loadAndAnalyze(client, c, today))
      toast(`เชื่อมต่อแล้ว: ${a.name ?? a.id}`)
    })
  }
  useEffect(() => {
    if (client && !athlete) connect()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function saveCfg(c: CoachConfig) {
    if (!client) return
    await run('กำลังบันทึก…', async () => {
      await client.saveConfig(c)
      setCfg(c)
      setData(await loadAndAnalyze(client, c, today))
      toast('บันทึกค่าตั้งค่าโค้ชแล้ว (งานอัตโนมัติใช้ค่านี้ด้วย)')
    })
  }

  // ── ส่งตารางจากแอปเข้า Garmin ──
  const futureWorkouts = trainingPlan.weeks.flatMap((w) => w.workouts).filter((w) => w.date >= today)
  const planKey = slug(plan.meta.name)
  const foreign = (data?.events ?? []).filter(
    (e) => e.category === 'WORKOUT' && e.start_date_local.slice(0, 10) >= today && e.start_date_local.slice(0, 10) <= plan.meta.date && !e.external_id?.startsWith(EXT_PREFIX),
  )
  async function pushPlan() {
    if (!client || !cfg) return
    await run('กำลังส่งเข้า Intervals.icu…', async () => {
      if (replaceForeign) for (const e of foreign) await client.deleteEvent(e.id)
      const evs = futureWorkouts.map((w) => toIcuEvent(w, trainingPlan.paces, { lthr: cfg.lthr }, planKey))
      for (let i = 0; i < evs.length; i += 50) await client.upsertEvents(evs.slice(i, i + 50))
      const c = { ...cfg, planName: plan.meta.name, from: today, to: plan.meta.date, raceDate: plan.meta.date, goalSec: plan.pacing.targetSec, distKm }
      await client.saveConfig(c)
      setCfg(c)
      setData(await loadAndAnalyze(client, c, today))
      setReplaceForeign(false)
      toast(`ส่ง ${evs.length} workout แล้ว — ซิงก์นาฬิกาเพื่อให้ขึ้นบน Forerunner`)
    })
  }

  async function syncNow() {
    if (!client || !cfg) return
    await run('กำลังซิงก์และปรับตาราง…', async () => {
      const d = await loadAndAnalyze(client, cfg, today)
      const r = await commitReport(client, cfg, d, today)
      setData(await loadAndAnalyze(client, cfg, today))
      toast(r.applied ? `ปรับตาราง ${r.applied} รายการ 🔧` : 'ซิงก์แล้ว ไม่มีอะไรต้องปรับ')
    })
  }

  async function answer(noteDate: string, qid: string, yes: boolean) {
    if (!client || !cfg || !data) return
    await run('กำลังบันทึกคำตอบ…', async () => {
      await answerQuestion(client, data.notes, noteDate, qid, yes)
      setData(await loadAndAnalyze(client, cfg, today))
      toast(yes ? 'ปรับตารางตามที่เสนอแล้ว' : 'คงตารางเดิม')
    })
  }

  async function reportInjury() {
    if (!client || !injury.trim()) return
    await run('กำลังบันทึก…', async () => {
      await client.upsertEvents([injuryNote(today, injury.trim())])
      setInjury('')
      if (cfg) setData(await loadAndAnalyze(client, cfg, today))
      toast('บันทึกอาการแล้ว — คืนนี้โค้ชจะถามก่อนปรับ')
    })
  }

  const rep = data?.report
  const questions = [...(data?.openQuestions ?? []), ...(rep?.questions ?? []).map((q) => ({ ...q, noteDate: today, pending: true as const }))]
  const shownDays = rep?.days.filter((d) => d.planned || d.actual.length) ?? []

  return (
    <div className="space-y-4">
      {/* ── เชื่อมต่อ ── */}
      <Card
        title="เชื่อมต่อ Intervals.icu → Garmin"
        right={athlete ? <span className="chip border-green-700 text-green-300">● {athlete.name ?? athlete.id}</span> : <span className="chip text-zinc-500">ยังไม่เชื่อม</span>}
      >
        {!athlete && (
          <ol className="mb-3 list-decimal space-y-1 pl-5 text-xs text-zinc-400">
            <li>สมัคร/ล็อกอิน intervals.icu (ฟรี) แล้วเชื่อม Garmin Connect ที่ Settings → Connections</li>
            <li>ติ๊ก <b>Upload planned workouts</b>, Download activities และ Download wellness</li>
            <li>Settings → Developer Settings → คัดลอก <b>Athlete ID</b> และ <b>API Key</b> มาใส่ด้านล่าง</li>
          </ol>
        )}
        <div className="grid grid-cols-[1fr_1.4fr] gap-2">
          <Field label="Athlete ID">
            <input className="input font-mono text-sm" placeholder="i123456" value={athleteId} onChange={(e) => setAthleteId(e.target.value)} />
          </Field>
          <Field label="API Key">
            <input className="input font-mono text-sm" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          </Field>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button className="btn-primary" disabled={!client || !!busy} onClick={connect}>
            {athlete ? 'เชื่อมใหม่' : 'เชื่อมต่อ'}
          </button>
          {athlete && (
            <button
              className="btn-ghost text-xs text-zinc-500"
              onClick={() => {
                ls.set(K_KEY, '')
                setApiKey('')
                setAthlete(null)
                setData(null)
              }}
            >
              ลบคีย์ออกจากเครื่องนี้
            </button>
          )}
        </div>
        <p className="mt-2 text-[11px] text-zinc-600">คีย์เก็บในเบราว์เซอร์เครื่องนี้เท่านั้น ไม่ถูกส่งไปที่อื่นนอกจาก intervals.icu</p>
        {busy && <p className="mt-2 animate-pulse text-sm text-zinc-400">{busy}</p>}
        {err && <p className="mt-2 rounded-lg border border-red-800 bg-red-950/40 p-2 text-xs text-red-200">{err}</p>}
      </Card>

      {athlete && cfg && (
        <>
          {/* ── แบตเตอรี่ ── */}
          {rep && (
            <Card title={`${lightDot(rep.overall)} แบตเตอรี่วันนี้`} right={<span className="text-[11px] text-zinc-500">{fmtThaiDate(today)}</span>}>
              {rep.battery.length === 0 && <p className="text-sm text-zinc-500">ยังไม่มีข้อมูล HRV / HR พัก / การนอน — ซิงก์นาฬิกา แล้วรอ Intervals.icu ดึงจาก Garmin</p>}
              <ul className="space-y-2">
                {rep.battery.map((b) => (
                  <li key={b.key} className="flex gap-3">
                    <span className="text-lg leading-none">{lightDot(b.light)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium">{b.label}</span>
                        <span className="num text-sm">{b.value}</span>
                      </div>
                      <div className="text-xs text-zinc-400">{b.why}</div>
                    </div>
                  </li>
                ))}
              </ul>
              {rep.readiness.vdot ? (
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <Stat label={distKm > 30 ? 'ความพร้อมมาราธอน' : 'ความพร้อม'} value={`${rep.readiness.shapePct}%`} accent={rep.readiness.shapePct >= 80 ? 'text-green-300' : rep.readiness.shapePct >= 60 ? 'text-amber-300' : 'text-red-300'} />
                  <Stat label="เวลาคาดการณ์" value={fmtHMS(rep.readiness.predictedSec!)} sub={cfg.goalSec ? `เป้า ${fmtHMS(cfg.goalSec)}` : undefined} />
                  <Stat label="VDOT" value={rep.readiness.vdot} sub={`${rep.readiness.weeklyKmAvg} กม./สัปดาห์`} />
                </div>
              ) : null}
              {rep.readiness.vdot && (
                <p className="mt-2 text-[11px] text-zinc-600">
                  ประเมินแบบ Runalyze: ควรวิ่ง ~{rep.readiness.requiredWeeklyKm} กม./สัปดาห์ และยาวสุด ~{rep.readiness.requiredLongKm} กม. · VDOT จากวิ่งที่เร็วที่สุด 60 วัน (ค่าประมาณ)
                </p>
              )}
            </Card>
          )}

          {/* ── คำถาม ── */}
          {questions.length > 0 && (
            <Card title="❓ ขอความเห็น">
              <ul className="space-y-3">
                {questions.map((q) => (
                  <li key={q.id} className="rounded-xl border border-amber-700/50 bg-amber-950/20 p-3">
                    <p className="text-sm">{q.text}</p>
                    {q.proposal?.length ? <ul className="mt-1 text-xs text-zinc-400">{q.proposal.map((p) => <li key={p.eventId}>🔧 {p.date.slice(5)}: {p.note}</li>)}</ul> : null}
                    {'pending' in q ? (
                      <p className="mt-2 text-[11px] text-zinc-500">กด “ซิงก์ & ปรับตาราง” เพื่อบันทึกคำถามนี้ก่อนตอบ</p>
                    ) : (
                      <div className="mt-2 flex gap-2">
                        {q.proposal?.length ? (
                          <button className="btn-primary px-3 py-1.5 text-xs" disabled={!!busy} onClick={() => answer(q.noteDate, q.id, true)}>
                            ปรับตามที่เสนอ
                          </button>
                        ) : null}
                        <button className="btn px-3 py-1.5 text-xs" disabled={!!busy} onClick={() => answer(q.noteDate, q.id, false)}>
                          {q.proposal?.length ? 'คงตารางเดิม' : 'รับทราบ'}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* ── แผนเทียบจริง ── */}
          <Card
            title="แผน vs วิ่งจริง"
            right={
              <button className="btn px-3 py-1.5 text-xs" disabled={!!busy} onClick={syncNow}>
                ↻ ซิงก์ & ปรับตาราง
              </button>
            }
          >
            {rep && rep.adjustments.length > 0 && (
              <ul className="mb-3 space-y-1 text-xs text-zinc-300">
                {rep.adjustments.map((a, i) => (
                  <li key={i}>
                    🔧 {a.note}
                    {a.eventId > 0 && !cfg.autoAdjust && <span className="text-zinc-500"> (ปิดปรับอัตโนมัติอยู่)</span>}
                  </li>
                ))}
              </ul>
            )}
            {shownDays.length === 0 && <p className="text-sm text-zinc-500">ยังไม่มีแผนในช่วงนี้ — ส่งตารางจากแอป หรือกำหนดช่วงของแผนที่มีอยู่ด้านล่าง</p>}
            <ul className="divide-y divide-zinc-800/70">
              {shownDays.map((d) => (
                <li key={d.date} className={`flex items-center gap-3 py-2 ${d.date === today ? 'bg-zinc-800/40' : ''}`}>
                  <div className="w-10 shrink-0 text-center">
                    <div className="text-[11px] text-zinc-500">{DOW_TH[dowOf(d.date)]}</div>
                    <div className="num text-sm font-semibold">{Number(d.date.slice(8))}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{d.planned?.name ?? 'นอกแผน'}</div>
                    {/🔧/.test(d.planned?.description ?? '') && <div className="truncate text-[11px] text-amber-300">{(d.planned!.description ?? '').split('\n')[0]}</div>}
                  </div>
                  <div className="num shrink-0 text-right text-xs">
                    <div>
                      {STATUS[d.status][0]} {STATUS[d.status][1]}
                    </div>
                    {d.actual.length > 0 && <div className="text-zinc-400">{d.actualKm} กม.</div>}
                  </div>
                </li>
              ))}
            </ul>
            {rep?.weekly && <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-zinc-950 p-3 text-xs text-zinc-300">{rep.weekly}</pre>}
          </Card>

          {/* ── ส่งตาราง ── */}
          <Card title="ส่งตารางซ้อมของแผนนี้เข้า Garmin">
            <p className="text-sm text-zinc-300">
              {futureWorkouts.length} workout ตั้งแต่วันนี้ถึง {fmtThaiDate(plan.meta.date)} · หัวใจโซนง่าย {bpmRange(cfg.lthr, 'easy').join('–')} bpm (LTHR {cfg.lthr})
            </p>
            {foreign.length > 0 && (
              <div className="mt-2 rounded-lg border border-amber-700/50 bg-amber-950/20 p-2 text-xs text-amber-200">
                ในช่วงนี้มี workout เดิมใน Intervals.icu อยู่ {foreign.length} รายการ (เช่นตาราง “ซ้อมสู่โตเกียว”) ถ้าส่งเพิ่มจะมี 2 ตารางซ้อนกัน
                <label className="mt-1 flex items-center gap-2">
                  <input type="checkbox" checked={replaceForeign} onChange={(e) => setReplaceForeign(e.target.checked)} />
                  ลบ {foreign.length} รายการเดิมก่อนส่ง (ลบถาวร กู้คืนไม่ได้)
                </label>
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn-primary" disabled={!!busy || !futureWorkouts.length} onClick={pushPlan}>
                ⌚ ส่งเข้า Garmin ({futureWorkouts.length})
              </button>
            </div>
            <p className="mt-2 text-[11px] text-zinc-600">ส่งซ้ำได้ — workout เดิมจะถูกอัปเดต ไม่ขึ้นซ้ำ · หลังส่ง ซิงก์ Forerunner 165 ในแอป Garmin Connect</p>
          </Card>

          {/* ── ตั้งค่า ── */}
          <Card title="ตั้งค่าโค้ช (ใช้ร่วมกับงานอัตโนมัติทุกคืน)">
            <div className="grid grid-cols-2 gap-3">
              <Field label="ชื่อแผน" className="col-span-2">
                <input className="input" value={cfg.planName} onChange={(e) => setCfg({ ...cfg, planName: e.target.value })} />
              </Field>
              <Field label="ดูแลตั้งแต่">
                <input className="input" type="date" value={cfg.from} onChange={(e) => setCfg({ ...cfg, from: e.target.value })} />
              </Field>
              <Field label="ถึงวันแข่ง">
                <input className="input" type="date" value={cfg.to} onChange={(e) => setCfg({ ...cfg, to: e.target.value, raceDate: e.target.value })} />
              </Field>
              <Field label="LTHR (bpm)" hint="ดึงจาก Intervals.icu ถ้าตั้งไว้">
                <NumInput value={cfg.lthr} onChange={(v) => setCfg({ ...cfg, lthr: v ?? cfg.lthr })} />
              </Field>
              <Field label="HR สูงสุด (bpm)">
                <NumInput value={cfg.maxHr} onChange={(v) => setCfg({ ...cfg, maxHr: v ?? cfg.maxHr })} />
              </Field>
            </div>
            <div className="mt-3">
              <Toggle checked={cfg.autoAdjust} onChange={(v) => setCfg({ ...cfg, autoAdjust: v })} label="ปรับตารางอัตโนมัติตามกฎ" sub="ขาดลองรัน → ตัดทิ้ง + สัปดาห์หน้าไม่เพิ่มระยะ · เรื่องอื่นถามก่อน" />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn-primary" disabled={!!busy} onClick={() => saveCfg(cfg)}>
                บันทึก
              </button>
              <button className="btn text-xs" disabled={!!busy} onClick={() => saveCfg({ ...defaultCfg(athlete), lthr: cfg.lthr, maxHr: cfg.maxHr, autoAdjust: cfg.autoAdjust })}>
                ใช้ค่าจากแผนนี้
              </button>
            </div>
            <p className="mt-2 text-[11px] text-zinc-600">ถ้าจะให้โค้ชดูแลตาราง “ซ้อมสู่โตเกียว” ที่อยู่ใน Intervals.icu แล้ว ให้ตั้งช่วง 21 พ.ย. 2569 – 7 มี.ค. 2570 แล้วบันทึก โดยไม่ต้องกดส่งตาราง</p>
          </Card>

          {/* ── อาการเจ็บ ── */}
          <Card title="🩹 แจ้งอาการเจ็บ / ตึง">
            <div className="flex gap-2">
              <input className="input" placeholder="เช่น น่องซ้ายตึงหลังวิ่ง" value={injury} onChange={(e) => setInjury(e.target.value)} />
              <button className="btn shrink-0" disabled={!injury.trim() || !!busy} onClick={reportInjury}>
                บันทึก
              </button>
            </div>
            <p className="mt-2 text-[11px] text-zinc-600">ระบบไม่กรอกช่องนี้เอง — เมื่อแจ้ง โค้ชจะถามก่อนปรับวันหนักใน 3 วันข้างหน้า</p>
          </Card>
        </>
      )}
    </div>
  )
}
