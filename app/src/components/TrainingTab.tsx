import { useEffect, useMemo, useRef, useState } from 'react'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { CalendarRace, FuelingSummary, PacingResult, RacePlan, RouteAnalysis, TrainingInput, TrainingState, WeatherYear, Workout, WorkoutType } from '../types/race'
import { Card, DurationInput, Field, NumInput, Segmented, Stat } from './ui'
import Markdown from './Markdown'
import { RACE_CALENDAR } from '../data/raceCalendar'
import { COURSE_TH, getRaceProfile, startTimeFor } from '../data/raceProfiles'
import { DOW_TH, PHASE_TH, computeTrainingPlan, daysBetween } from '../engine/trainingEngine'
import { fetchRaceWeather, summarizeWeather } from '../services/weatherHistory'
import { DEFAULT_GEMINI_MODEL, askClaude, askGemini, getClaudeSample, getGeminiSettings, setGeminiSettings } from '../services/ai'
import { buildAnalysisPrompt } from '../lib/aiPrompt'
import { copyText, downloadFile } from '../services/download'
import { fmtHMS, fmtPace, fmtThaiDate } from '../lib/time'

interface Props {
  plan: RacePlan
  route: RouteAnalysis
  pacing: PacingResult
  fueling: FuelingSummary
  customRaces: CalendarRace[]
  onTraining: (t: TrainingState) => void
  onRaceLink: (raceId: string | undefined, startTime?: string) => void
  toast: (m: string) => void
}

export const DEFAULT_TRAINING: TrainingInput = { weeklyKm: 25, longestRunKm: 12, runsPerWeek: 4, experience: 'regular' }

const TYPE_STYLE: Record<WorkoutType, string> = {
  rest: 'text-zinc-500 border-zinc-700',
  easy: 'text-zinc-300 border-zinc-600',
  long: 'text-sky-300 border-sky-700',
  tempo: 'text-orange-300 border-orange-700',
  interval: 'text-red-300 border-red-700',
  hill: 'text-rose-300 border-rose-700',
  'race-pace': 'text-amber-300 border-amber-600',
  shakeout: 'text-zinc-300 border-zinc-600',
  race: 'text-zinc-950 bg-zinc-100 border-zinc-100',
}
const TYPE_TH: Record<WorkoutType, string> = {
  rest: 'พัก',
  easy: 'ง่าย',
  long: 'ยาว',
  tempo: 'เทมโป',
  interval: 'อินเทอร์วัล',
  hill: 'เนิน',
  'race-pace': 'เพซแข่ง',
  shakeout: 'เบา',
  race: 'แข่ง',
}
const PHASE_COLOR = { base: '#52525b', build: '#a1a1aa', peak: '#fbbf24', taper: '#38bdf8', race: '#f4f4f5' }
const LEVEL = {
  ok: ['เป้าสมจริง', 'border-green-700/60 bg-green-950/30 text-green-200'],
  stretch: ['ท้าทายแต่เป็นไปได้', 'border-amber-600/60 bg-amber-950/30 text-amber-200'],
  risky: ['เสี่ยง', 'border-red-600/60 bg-red-950/30 text-red-200'],
  unknown: ['ยังประเมินไม่ได้', 'border-zinc-700 text-zinc-300'],
} as const

const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function TrainingTab({ plan, route, pacing, fueling, customRaces, onTraining, onRaceLink, toast }: Props) {
  const state: TrainingState = plan.training ?? { input: DEFAULT_TRAINING }
  const input = state.input
  const setInput = (p: Partial<TrainingInput>) => onTraining({ ...state, input: { ...input, ...p } })
  const allRaces = useMemo(() => [...RACE_CALENDAR, ...customRaces], [customRaces])
  const race = allRaces.find((r) => r.id === plan.meta.raceId)
  const profile = useMemo(() => getRaceProfile(race, plan.meta.date), [race, plan.meta.date])
  const distKm = route.totalDistanceKm
  const suggestedStart = startTimeFor(profile, distKm, plan.meta.startTime)
  const today = todayISO()

  const trainingPlan = useMemo(
    () =>
      computeTrainingPlan(
        input,
        {
          distKm,
          goalSec: plan.pacing.targetSec,
          raceDate: plan.meta.date,
          startTime: plan.meta.startTime,
          gainPerKm: route.gainM / Math.max(1, distKm),
          gelEveryMin: plan.fueling.mode === 'time' ? plan.fueling.interval : undefined,
        },
        profile,
        today,
      ),
    [input, distKm, plan.pacing.targetSec, plan.meta.date, plan.meta.startTime, route.gainM, plan.fueling.mode, plan.fueling.interval, profile, today],
  )

  // ── อากาศย้อนหลัง ──
  const [weather, setWeather] = useState<WeatherYear[]>([])
  const [wState, setWState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  useEffect(() => {
    const ctl = new AbortController()
    setWState('loading')
    fetchRaceWeather(profile, plan.meta.date, plan.meta.startTime, pacing.totalSec, ctl.signal)
      .then((w) => {
        setWeather(w)
        setWState(w.length ? 'ok' : 'error')
      })
      .catch(() => {
        if (!ctl.signal.aborted) {
          setWeather([])
          setWState('error')
        }
      })
    return () => ctl.abort()
  }, [profile, plan.meta.date, plan.meta.startTime, pacing.totalSec])
  const wsum = summarizeWeather(weather)

  // ── AI ──
  const [claudeOk, setClaudeOk] = useState(false)
  useEffect(() => {
    getClaudeSample().then((s) => setClaudeOk(!!s))
  }, [])
  const [provider, setProvider] = useState<'claude' | 'gemini'>(state.aiProvider ?? 'gemini')
  useEffect(() => {
    if (claudeOk && !state.aiProvider) setProvider('claude')
  }, [claudeOk, state.aiProvider])
  const [gem, setGem] = useState(getGeminiSettings)
  const [aiText, setAiText] = useState(state.aiAnalysis ?? '')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiErr, setAiErr] = useState('')
  const ctlRef = useRef<AbortController | null>(null)
  useEffect(() => setAiText(plan.training?.aiAnalysis ?? ''), [plan.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const prompt = useMemo(
    () =>
      buildAnalysisPrompt({
        raceName: plan.meta.name,
        race,
        raceDate: plan.meta.date,
        startTime: plan.meta.startTime,
        distKm,
        goalSec: plan.pacing.targetSec,
        profile,
        route,
        weather,
        input,
        plan: trainingPlan,
        fueling,
      }),
    [plan.meta, race, distKm, plan.pacing.targetSec, profile, route, weather, input, trainingPlan, fueling],
  )

  async function runAI() {
    setAiErr('')
    setAiBusy(true)
    setAiText('')
    const ctl = new AbortController()
    ctlRef.current = ctl
    try {
      let text: string
      if (provider === 'claude') text = await askClaude(prompt, setAiText, ctl.signal)
      else {
        if (!gem.key.trim()) throw new Error('ใส่ Gemini API key ก่อน (สร้างฟรีที่ aistudio.google.com)')
        text = await askGemini(prompt, gem.key.trim(), gem.model, ctl.signal)
      }
      setAiText(text)
      if (text) onTraining({ ...state, aiProvider: provider, aiAnalysis: text, aiAt: new Date().toISOString() })
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setAiErr((e as Error).message)
    } finally {
      setAiBusy(false)
    }
  }

  const fz = trainingPlan.feasibility
  const currentWeekIdx = trainingPlan.weeks.findIndex((w) => daysBetween(w.startDate, today) < 7)
  const [open, setOpen] = useState<Set<number>>(() => new Set([0, 1]))
  const toggle = (i: number) => setOpen((s) => (s.has(i) ? new Set([...s].filter((x) => x !== i)) : new Set([...s, i])))

  function csv() {
    const rows = [['Week', 'Phase', 'Date', 'Day', 'Type', 'Title', 'Km', 'Pace', 'Detail']]
    for (const w of trainingPlan.weeks)
      for (const x of w.workouts) rows.push([String(w.index), PHASE_TH[w.phase], x.date, DOW_TH[x.dow], TYPE_TH[x.type], x.title, String(x.km), x.pace ?? '', x.detail])
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
    return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\n')
  }

  if (trainingPlan.daysToRace < 0)
    return (
      <Card title="ตารางซ้อม">
        <p className="text-sm text-zinc-400">วันแข่งของแผนนี้ผ่านไปแล้ว — เปลี่ยนวันแข่งในแท็บวางแผน หรือบันทึกผลในคลังแผน</p>
      </Card>
    )

  return (
    <div className="grid gap-4 lg:grid-cols-[400px_1fr]">
      <div className="space-y-4">
        {/* ── สนาม ── */}
        <Card
          title="ข้อมูลสนาม"
          right={
            <span className={`chip ${profile.dataLevel === 'good' ? 'border-green-700 text-green-300' : profile.dataLevel === 'partial' ? 'border-amber-700 text-amber-300' : 'text-zinc-500'}`}>
              {profile.dataLevel === 'good' ? 'ข้อมูลครบ' : profile.dataLevel === 'partial' ? 'ข้อมูลบางส่วน' : 'ข้อมูลน้อย'}
            </span>
          }
        >
          <Field label="แผนนี้คืองานไหน">
            <select
              className="input"
              value={plan.meta.raceId ?? ''}
              onChange={(e) => {
                const r = allRaces.find((x) => x.id === e.target.value)
                onRaceLink(r?.id, r ? startTimeFor(getRaceProfile(r, plan.meta.date), distKm, plan.meta.startTime) : undefined)
              }}
            >
              <option value="">— ไม่ได้ผูกกับงานในปฏิทิน —</option>
              {allRaces.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.date ? ` · ${fmtThaiDate(r.date)}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Stat label="เส้นทาง" value={<span className="font-sans text-sm">{COURSE_TH[profile.course]}</span>} sub={`GPX +${route.gainM.toFixed(0)} ม.`} />
            <Stat label="ปล่อยตัว" value={plan.meta.startTime} sub={suggestedStart !== plan.meta.startTime ? `สนามนี้ ${suggestedStart}` : 'ตรงกับสนาม'} />
            <Stat label="เหลือ" value={trainingPlan.daysToRace} sub="วัน" />
          </div>
          {suggestedStart !== plan.meta.startTime && (
            <button className="btn mt-2 w-full text-xs" onClick={() => onRaceLink(plan.meta.raceId, suggestedStart)}>
              ใช้เวลาปล่อยตัวจริงของสนาม ({suggestedStart})
            </button>
          )}
          {profile.cutoffs && (
            <div className="mt-3 text-xs text-zinc-400">
              ⏱ ตัดตัว:{' '}
              {Object.entries(profile.cutoffs)
                .map(([k, v]) => `${k} กม. ${v}`)
                .join(' · ')}
            </div>
          )}
          <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-zinc-300 marker:text-zinc-600">
            {profile.courseNotes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          {profile.pastEditions.length > 0 && (
            <div className="mt-3">
              <div className="label">การจัดปีที่ผ่านมา</div>
              <ul className="space-y-1 text-xs">
                {profile.pastEditions.map((e) => (
                  <li key={e.year} className="flex gap-2">
                    <span className="num shrink-0 text-zinc-500">{e.year}</span>
                    <span className="text-zinc-300">{e.note}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {profile.stats.length > 0 && <div className="mt-2 text-xs text-zinc-500">{profile.stats.join(' · ')}</div>}
          {profile.sources.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {profile.sources.map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="chip text-zinc-400 hover:text-zinc-100">
                  {s.title} ↗
                </a>
              ))}
            </div>
          )}
        </Card>

        {/* ── อากาศ ── */}
        <Card title="อากาศจริงวันแข่งปีก่อน ๆ" right={<span className="text-[11px] text-zinc-500">ช่วง {plan.meta.startTime}–เข้าเส้นชัย</span>}>
          {wState === 'loading' && <p className="text-sm text-zinc-500">กำลังดึงข้อมูลจาก Open-Meteo…</p>}
          {wState === 'ok' && wsum && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="เฉลี่ยตอนปล่อยตัว" value={`${wsum.startTemp.toFixed(1)}°`} sub={`ชื้น ${wsum.rh.toFixed(0)}%`} />
                <Stat label="เฉลี่ยตอนจบ" value={`${wsum.endTemp.toFixed(1)}°`} sub={`ร้อนสุด ${wsum.hottestEnd.toFixed(1)}°`} accent="text-orange-300" />
                <Stat label="ฝนตก" value={`${wsum.rainyYears}/${weather.length}`} sub="ปี" accent="text-water" />
              </div>
              <table className="num mt-3 w-full text-xs">
                <thead className="text-zinc-500">
                  <tr>
                    <th className="text-left font-normal">วันที่</th>
                    <th className="text-right font-normal">เริ่ม</th>
                    <th className="text-right font-normal">จบ</th>
                    <th className="text-right font-normal">น้ำค้าง</th>
                    <th className="text-right font-normal">ฝน</th>
                  </tr>
                </thead>
                <tbody>
                  {weather.map((w) => (
                    <tr key={w.date} className="border-t border-zinc-800">
                      <td className="py-1">{fmtThaiDate(w.date)}</td>
                      <td className="text-right">
                        {w.startTempC.toFixed(0)}°/{w.startRh.toFixed(0)}%
                      </td>
                      <td className="text-right">
                        {w.endTempC.toFixed(0)}°/{w.endRh.toFixed(0)}%
                      </td>
                      <td className="text-right">{w.dewC.toFixed(0)}°</td>
                      <td className="text-right">{w.rainMm ? `${w.rainMm}มม.` : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {wState === 'error' && (
            <div className="text-sm text-zinc-400">
              <p>
                🌡 {profile.climate.note} — ประมาณ <b className="num">{profile.climate.tempC}°C</b> ชื้น <b className="num">{profile.climate.humidity}%</b>
              </p>
              <p className="mt-1 text-[11px] text-zinc-600">ดึงอากาศย้อนหลังรายปีไม่ได้ในหน้านี้ (ต้องเปิดแอปนอก Claude และต่ออินเทอร์เน็ต)</p>
            </div>
          )}
        </Card>

        {/* ── ความฟิต ── */}
        <Card title="ความฟิตตอนนี้">
          <div className="grid grid-cols-2 gap-3">
            <Field label="วิ่ง/สัปดาห์ (กม.)">
              <NumInput value={input.weeklyKm} min={0} onChange={(v) => setInput({ weeklyKm: Math.max(0, v ?? 0) })} />
            </Field>
            <Field label="วิ่งยาวสุดล่าสุด (กม.)">
              <NumInput value={input.longestRunKm} min={0} onChange={(v) => setInput({ longestRunKm: Math.max(0, v ?? 0) })} />
            </Field>
            <Field label="วิ่งกี่วัน/สัปดาห์" className="col-span-2">
              <Segmented
                value={String(input.runsPerWeek)}
                onChange={(v) => setInput({ runsPerWeek: Number(v) })}
                options={['3', '4', '5', '6'].map((n) => ({ value: n, label: `${n} วัน` }))}
              />
            </Field>
            <Field label="ประสบการณ์" className="col-span-2">
              <Segmented
                value={input.experience}
                onChange={(v) => setInput({ experience: v })}
                options={[
                  { value: 'new', label: 'มือใหม่' },
                  { value: 'regular', label: 'วิ่งประจำ' },
                  { value: 'experienced', label: 'ลงแข่งบ่อย' },
                ]}
              />
            </Field>
            <Field label="ผลล่าสุด: ระยะ">
              <select
                className="input"
                value={input.recentRaceKm ?? ''}
                onChange={(e) => setInput({ recentRaceKm: e.target.value ? Number(e.target.value) : undefined, recentRaceSec: e.target.value ? input.recentRaceSec ?? 3600 : undefined })}
              >
                <option value="">ไม่ระบุ</option>
                <option value="5">5K</option>
                <option value="10">10K</option>
                <option value="21.0975">ฮาล์ฟ</option>
                <option value="42.195">มาราธอน</option>
              </select>
            </Field>
            <Field label="เวลา">
              {input.recentRaceKm ? <DurationInput valueSec={input.recentRaceSec ?? 3600} onChange={(s) => setInput({ recentRaceSec: s })} /> : <input className="input" disabled placeholder="—" />}
            </Field>
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        {/* ── ประเมินเป้า ── */}
        <div className={`rounded-2xl border p-4 ${LEVEL[fz.level][1]}`}>
          <div className="flex items-center justify-between">
            <div className="font-semibold">
              🎯 {LEVEL[fz.level][0]} · เป้า <span className="num">{fmtHMS(plan.pacing.targetSec)}</span>
            </div>
            {fz.predictedSec && <span className="num text-xs opacity-80">คาด {fmtHMS(fz.predictedSec)}</span>}
          </div>
          <ul className="mt-1.5 space-y-0.5 text-xs opacity-90">
            {fz.messages.map((m) => (
              <li key={m}>• {m}</li>
            ))}
          </ul>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Stat label="เพซแข่ง" value={fmtPace(trainingPlan.paces.goal)} />
          <Stat label="วิ่งง่าย" value={<span className="text-base">{fmtPace(trainingPlan.paces.easy[0])}–{fmtPace(trainingPlan.paces.easy[1])}</span>} />
          <Stat label="เทมโป" value={fmtPace(trainingPlan.paces.threshold)} accent="text-orange-300" />
          <Stat label="อินเทอร์วัล" value={fmtPace(trainingPlan.paces.interval)} accent="text-red-300" />
          <Stat label="รวมทั้งแผน" value={`${trainingPlan.totalKm}`} sub={`กม. · พีค ${trainingPlan.peakKm}/สัปดาห์`} />
        </div>

        {trainingPlan.raceSpecific.length > 0 && (
          <Card title="ซ้อมเฉพาะสนามนี้">
            <ul className="space-y-1.5 text-sm text-zinc-300">
              {trainingPlan.raceSpecific.map((s) => (
                <li key={s} className="flex gap-2">
                  <span className="text-zinc-500">▸</span>
                  {s}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* ── ตาราง ── */}
        <Card
          title={`ตารางซ้อม ${trainingPlan.weeks.length} สัปดาห์`}
          right={
            <div className="flex gap-1.5">
              <button className="btn px-2 py-1 text-xs" onClick={() => setOpen(new Set(trainingPlan.weeks.map((_, i) => i)))}>
                เปิดทั้งหมด
              </button>
              <button className="btn px-2 py-1 text-xs" onClick={() => downloadFile(`training-${plan.meta.date}.csv`, csv(), 'text/csv')}>
                ⬇ CSV
              </button>
            </div>
          }
        >
          {trainingPlan.weeks.length > 2 && (
            <div className="mb-3 h-28">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trainingPlan.weeks.map((w) => ({ w: w.index, km: w.km, phase: w.phase }))} margin={{ top: 4, right: 0, bottom: 0, left: -24 }}>
                  <XAxis dataKey="w" tick={{ fill: '#71717a', fontSize: 10 }} stroke="#3f3f46" interval={0} />
                  <YAxis tick={{ fill: '#71717a', fontSize: 10 }} stroke="#3f3f46" />
                  <Tooltip
                    cursor={{ fill: '#27272a' }}
                    contentStyle={{ background: '#09090b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 12 }}
                    labelFormatter={(v) => `สัปดาห์ ${v}`}
                    formatter={(v) => [`${v} กม.`, 'ระยะ']}
                  />
                  <Bar dataKey="km" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                    {trainingPlan.weeks.map((w) => (
                      <Cell key={w.index} fill={PHASE_COLOR[w.phase]} fillOpacity={w.cutback ? 0.5 : 1} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="mb-2 flex flex-wrap gap-3 text-[11px] text-zinc-500">
            {(['base', 'build', 'peak', 'taper', 'race'] as const).map((p) => (
              <span key={p} className="flex items-center gap-1">
                <i className="inline-block h-2 w-2 rounded-sm" style={{ background: PHASE_COLOR[p] }} />
                {PHASE_TH[p]}
              </span>
            ))}
          </div>

          <div className="space-y-2">
            {trainingPlan.weeks.map((w, i) => (
              <div key={w.index} className={`overflow-hidden rounded-xl border ${i === currentWeekIdx ? 'border-zinc-400' : 'border-zinc-800'}`}>
                <button className="flex w-full items-center gap-3 bg-zinc-950/60 px-3 py-2 text-left" onClick={() => toggle(i)}>
                  <span className="h-8 w-1 rounded-full" style={{ background: PHASE_COLOR[w.phase] }} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      สัปดาห์ {w.index}
                      <span className="chip py-0 text-[10px] text-zinc-400">{PHASE_TH[w.phase]}</span>
                      {i === currentWeekIdx && <span className="chip border-zinc-300 py-0 text-[10px]">สัปดาห์นี้</span>}
                    </span>
                    <span className="block truncate text-[11px] text-zinc-500">
                      {fmtThaiDate(w.startDate)} · {w.focus}
                    </span>
                  </span>
                  <span className="num text-right">
                    <span className="block text-sm font-semibold">{w.km} กม.</span>
                    {w.longKm > 0 && <span className="block text-[11px] text-sky-300">ยาว {w.longKm}</span>}
                  </span>
                  <span className="text-zinc-600">{open.has(i) ? '▾' : '▸'}</span>
                </button>
                {open.has(i) && (
                  <ul className="divide-y divide-zinc-800/70">
                    {w.workouts.length === 0 && <li className="px-3 py-2 text-xs text-zinc-500">ไม่มีวันซ้อมที่เหลือในสัปดาห์นี้</li>}
                    {w.workouts.map((x) => (
                      <WorkoutRow key={x.date} w={x} past={x.date < today} isToday={x.date === today} />
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-zinc-600">วันที่ไม่มีในตาราง = พักหรือเดินเบา ๆ · ถ้าพลาดวันซ้อม อย่าวิ่งชดเชย ข้ามไปตามตารางต่อ</p>
        </Card>

        {/* ── AI ── */}
        <Card title="🤖 ให้ AI วิเคราะห์" right={state.aiAt && <span className="text-[11px] text-zinc-500">ล่าสุด {new Date(state.aiAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</span>}>
          <p className="mb-3 text-xs text-zinc-500">ส่งข้อมูลสนาม อากาศย้อนหลัง ความฟิต และตารางซ้อมด้านบน ให้ AI ประเมินเป้า ปรับตาราง และวางกลยุทธ์วันแข่ง</p>
          <Segmented
            value={provider}
            onChange={setProvider}
            options={[
              { value: 'claude', label: claudeOk ? 'Claude' : 'Claude (เฉพาะในแอป Claude)' },
              { value: 'gemini', label: 'Gemini' },
            ]}
          />
          {provider === 'gemini' && (
            <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
              <Field label="Gemini API key" hint={<>สร้างฟรีที่ aistudio.google.com/apikey · เก็บไว้ในเครื่องนี้เท่านั้น</>}>
                <input
                  className="input font-mono text-sm"
                  type="password"
                  autoComplete="off"
                  placeholder="AIza…"
                  value={gem.key}
                  onChange={(e) => {
                    const n = { ...gem, key: e.target.value }
                    setGem(n)
                    setGeminiSettings(n.key, n.model)
                  }}
                />
              </Field>
              <Field label="โมเดล">
                <input
                  className="input w-40 font-mono text-sm"
                  value={gem.model}
                  placeholder={DEFAULT_GEMINI_MODEL}
                  onChange={(e) => {
                    const n = { ...gem, model: e.target.value }
                    setGem(n)
                    setGeminiSettings(n.key, n.model)
                  }}
                />
              </Field>
            </div>
          )}
          {provider === 'claude' && !claudeOk && <p className="mt-2 text-xs text-amber-300">เปิดแอปนี้ในหน้า Claude เพื่อใช้ Claude — นอก Claude ให้ใช้ Gemini หรือกด “คัดลอกคำสั่ง” ไปถามในแชต</p>}

          <div className="mt-3 flex flex-wrap gap-2">
            {aiBusy ? (
              <button className="btn" onClick={() => ctlRef.current?.abort()}>
                ■ หยุด
              </button>
            ) : (
              <button className="btn-primary" disabled={provider === 'claude' && !claudeOk} onClick={runAI}>
                {aiText ? '↻ วิเคราะห์ใหม่' : 'วิเคราะห์ด้วย AI'}
              </button>
            )}
            <button className="btn" onClick={async () => toast((await copyText(prompt)) ? 'คัดลอกคำสั่งแล้ว — วางในแชต Gemini/Claude ได้เลย' : 'คัดลอกไม่สำเร็จ')}>
              📋 คัดลอกคำสั่ง
            </button>
          </div>
          {aiErr && <p className="mt-3 rounded-lg border border-red-800 bg-red-950/40 p-2 text-xs text-red-200">{aiErr}</p>}
          {aiBusy && !aiText && <p className="mt-3 animate-pulse text-sm text-zinc-500">กำลังวิเคราะห์… (อาจใช้เวลา 10–60 วินาที)</p>}
          {aiText && (
            <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
              <Markdown text={aiText} />
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function WorkoutRow({ w, past, isToday }: { w: Workout; past: boolean; isToday: boolean }) {
  return (
    <li className={`flex gap-3 px-3 py-2 ${past ? 'opacity-40' : ''} ${isToday ? 'bg-zinc-800/50' : ''}`}>
      <div className="w-10 shrink-0 text-center">
        <div className="text-[11px] text-zinc-500">{DOW_TH[w.dow]}</div>
        <div className="num text-sm font-semibold">{Number(w.date.slice(8))}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`chip py-0 text-[10px] font-semibold ${TYPE_STYLE[w.type]}`}>{TYPE_TH[w.type]}</span>
          <span className="text-sm font-medium">{w.title}</span>
        </div>
        <div className="mt-0.5 text-xs text-zinc-400">{w.detail}</div>
        {w.tags && w.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {w.tags.map((t) => (
              <span key={t} className="chip border-zinc-700 py-0 text-[10px] text-zinc-400">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="num shrink-0 text-right">
        <div className="text-sm font-semibold">{w.km} กม.</div>
        {w.pace && <div className="text-[11px] text-zinc-500">{w.pace}</div>}
      </div>
    </li>
  )
}
