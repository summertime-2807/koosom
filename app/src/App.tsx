import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CalendarRace, RacePlan, StoredRoute, Waypoint } from './types/race'
import { analyzeRoute } from './engine/gpxParser'
import { computePacing } from './engine/pacingEngine'
import { attachToRows, computeFueling } from './engine/fuelingEngine'
import { generateFlatRoute } from './engine/routeGen'
import { sampleWaypoints } from './data/sampleRoute'
import { getStorage } from './services/storage'
import { newPlan, defaultTargetSec } from './services/planFactory'
import { downloadFile } from './services/download'
import { fmtClock, fmtHMS, fmtPace, fmtThaiDate, parseHM, uid } from './lib/time'
import { Card, Stat, Toast } from './components/ui'
import RouteMap from './components/RouteMap'
import ProfileChart from './components/ProfileChart'
import GpxUpload from './components/GpxUpload'
import PacingPanel from './components/PacingPanel'
import WaypointEditor from './components/WaypointEditor'
import FuelEditor from './components/FuelEditor'
import SplitTable from './components/SplitTable'
import ExportPanel, { WristBand } from './components/ExportPanel'
import Archive from './components/Archive'
import RaceCalendar from './components/RaceCalendar'
import TrainingTab from './components/TrainingTab'
import { getRaceProfile, startTimeFor } from './data/raceProfiles'
import { RACE_CALENDAR, loadRemoteCalendar, mergeCalendar } from './data/raceCalendar'
import type { RemoteCalendar } from './data/raceCalendar'

type Tab = 'plan' | 'aid' | 'splits' | 'train' | 'export' | 'races' | 'archive'
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'plan', label: 'วางแผน', icon: '◎' },
  { id: 'aid', label: 'น้ำ & เจล', icon: '💧' },
  { id: 'splits', label: 'ตารางเพซ', icon: '☰' },
  { id: 'train', label: 'ซ้อม', icon: '📅' },
  { id: 'export', label: 'ส่งออก', icon: '⇪' },
  { id: 'races', label: 'งานวิ่ง', icon: '🏁' },
  { id: 'archive', label: 'คลังแผน', icon: '🗂' },
]
const tabFromHash = (): Tab => {
  const h = window.location.hash.replace('#', '') as Tab
  return TABS.some((t) => t.id === h) ? h : 'plan'
}

const storage = getStorage()

export default function App() {
  const [plan, setPlan] = useState<RacePlan | null>(null)
  const [plans, setPlans] = useState<RacePlan[]>([])
  const [customRaces, setCustomRaces] = useState<CalendarRace[]>([])
  const [tab, setTabState] = useState<Tab>(tabFromHash)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [remote, setRemote] = useState<RemoteCalendar | null>(null)
  const baseRaces = useMemo(() => mergeCalendar(RACE_CALENDAR, remote?.races), [remote])
  useEffect(() => {
    const ctl = new AbortController()
    loadRemoteCalendar(ctl.signal).then((r) => r && setRemote(r))
    return () => ctl.abort()
  }, [])
  const toastTimer = useRef<number | undefined>(undefined)

  const toast = useCallback((m: string) => {
    setToastMsg(m)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 2600)
  }, [])

  const setTab = (t: Tab) => {
    setTabState(t)
    try {
      history.replaceState(null, '', `#${t}`)
    } catch {
      /* sandboxed */
    }
    window.scrollTo({ top: 0 })
  }
  useEffect(() => {
    const on = () => setTabState(tabFromHash())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  // ── load ──
  useEffect(() => {
    ;(async () => {
      let list = await storage.listPlans()
      if (!list.length) {
        const p = newPlan()
        await storage.savePlan(p)
        list = await storage.listPlans()
      }
      const activeId = await storage.getActivePlanId()
      setPlans(list)
      setPlan(list.find((p) => p.id === activeId) ?? list[0])
      setCustomRaces(await storage.listCustomRaces())
    })()
  }, [])

  // ── autosave (debounce) ──
  useEffect(() => {
    if (!plan) return
    const t = window.setTimeout(async () => {
      await storage.savePlan(plan)
      await storage.setActivePlanId(plan.id)
      setPlans(await storage.listPlans())
    }, 400)
    return () => window.clearTimeout(t)
  }, [plan])

  const update = useCallback((p: Partial<RacePlan>) => setPlan((cur) => (cur ? { ...cur, ...p } : cur)), [])

  // ── derived ──
  const route = useMemo(() => (plan ? analyzeRoute(plan.route) : null), [plan?.route])
  const startClock = plan ? parseHM(plan.meta.startTime) || 0 : 0
  const pacing = useMemo(() => (plan && route ? computePacing(route.segments, plan.pacing, startClock) : null), [route, plan?.pacing, startClock])
  const fueling = useMemo(
    () => (plan && pacing ? computeFueling(pacing.rows, plan.fueling, plan.waypoints, startClock) : null),
    [pacing, plan?.fueling, plan?.waypoints, startClock],
  )
  const rows = useMemo(() => (plan && pacing && fueling ? attachToRows(pacing.rows, plan.waypoints, fueling.events) : []), [pacing, fueling, plan?.waypoints])

  if (!plan || !route || !pacing || !fueling) {
    return <div className="flex min-h-screen items-center justify-center text-zinc-500">กำลังโหลด…</div>
  }

  // ── actions ──
  function setRoute(r: StoredRoute, opts?: { useSampleWaypoints?: boolean }) {
    const analysis = analyzeRoute(r)
    const km = analysis.totalDistanceKm
    const wps: Waypoint[] = opts?.useSampleWaypoints ? sampleWaypoints() : plan!.waypoints.filter((w) => w.km <= km)
    update({
      route: r,
      waypoints: wps,
      meta: { ...plan!.meta, name: plan!.meta.name || r.name },
      pacing: Math.abs(km - route!.totalDistanceKm) > 2 ? { ...plan!.pacing, targetSec: defaultTargetSec(km) } : plan!.pacing,
    })
    toast(`โหลดเส้นทาง ${km.toFixed(2)} กม. · ขึ้น +${analysis.gainM.toFixed(0)} ม.`)
  }

  async function openPlan(id: string) {
    const p = await storage.getPlan(id)
    if (p) {
      setPlan(p)
      setTab('plan')
    }
  }

  function planFromRace(race: CalendarRace, km: number) {
    const name = `${race.name} ${km >= 42 ? '42.195K' : km >= 21 && km < 21.2 ? '21.1K' : `${km}K`}`
    const water: Waypoint[] = []
    for (let k = 2.5; k < km - 0.5; k += 2.5) water.push({ id: uid('wp'), km: k, type: 'water', label: 'จุดน้ำ (ประมาณ)' })
    const p = newPlan({ name, date: race.date, route: generateFlatRoute(km, `${race.name} (เส้นทางจำลอง)`), waypoints: water, km })
    p.meta.raceId = race.id
    p.meta.startTime = startTimeFor(getRaceProfile(race, race.date), km, p.meta.startTime)
    setPlan(p)
    setTab('plan')
    toast('สร้างแผนแล้ว — อัปโหลด GPX จริงของงานเพื่อคำนวณความชัน')
  }

  const hasHeatWarn = pacing.heat && pacing.heat.slowdownPct >= 3

  return (
    <>
      <div className="no-print min-h-screen pb-24 md:pb-10">
        {/* Header */}
        <header className="sticky top-0 z-[1100] border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{plan.meta.name || 'แผนวิ่งของฉัน'}</div>
              <div className="num truncate text-[11px] text-zinc-500">
                {fmtThaiDate(plan.meta.date)} · {route.totalDistanceKm.toFixed(2)} กม. · เป้า {fmtHMS(pacing.totalSec)} · {fmtPace(pacing.avgPaceSec)}/กม.
              </div>
            </div>
            <nav className="hidden gap-1 md:flex">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`rounded-lg px-3 py-1.5 text-sm ${tab === t.id ? 'bg-zinc-100 font-semibold text-zinc-950' : 'text-zinc-400 hover:text-zinc-100'}`}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-4">
          {tab === 'plan' && (
            <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
              <div className="order-2 space-y-4 lg:order-1">
                <PacingPanel
                  meta={plan.meta}
                  pacing={plan.pacing}
                  result={pacing}
                  distanceKm={route.totalDistanceKm}
                  onMeta={(meta) => update({ meta })}
                  onPacing={(p) => update({ pacing: p })}
                />
                <Card title="เส้นทาง (GPX)">
                  <GpxUpload onRoute={setRoute} onError={toast} />
                </Card>
              </div>
              <div className="order-1 space-y-4 lg:order-2">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="ระยะทาง" value={`${route.totalDistanceKm.toFixed(2)}`} sub="กม." />
                  <Stat label="ขึ้น / ลง" value={`+${route.gainM.toFixed(0)}`} sub={`−${route.lossM.toFixed(0)} ม.`} accent="text-red-300" />
                  <Stat label="เวลาเป้าหมาย" value={fmtHMS(pacing.totalSec)} sub={`เข้าเส้นชัย ~${fmtClock(rows.at(-1)?.clockSec ?? 0)}`} />
                  <Stat label="เจล" value={`${fueling.totalGels} ซอง`} sub={`${fueling.carbsPerHour.toFixed(0)} g/ชม.`} accent="text-gel" />
                </div>
                {hasHeatWarn && (
                  <div className="rounded-xl border border-orange-600/50 bg-orange-950/30 px-3 py-2 text-sm text-orange-200">
                    🌡 อากาศร้อนชื้น — เป้าที่สมจริงราว <b className="num">{fmtHMS(pacing.heat!.adjustedTargetSec)}</b> (ช้าลง ~{pacing.heat!.slowdownPct}%)
                  </div>
                )}
                <Card title="โปรไฟล์ความสูง & เพซ" right={<Legend />}>
                  <ProfileChart route={route} rows={rows} waypoints={plan.waypoints} gels={fueling.events} />
                  {!route.hasElevation && <p className="mt-2 text-xs text-amber-300">ไฟล์นี้ไม่มีข้อมูลความสูง — GAP จะไม่มีผล</p>}
                </Card>
                <Card title="แผนที่เส้นทาง" right={<span className="hidden truncate text-[11px] text-zinc-500 sm:inline">{route.name}</span>}>
                  <RouteMap route={route} waypoints={plan.waypoints} gels={fueling.events} />
                  <GradeLegend />
                </Card>
              </div>
            </div>
          )}

          {tab === 'aid' && (
            <div className="grid gap-4 lg:grid-cols-2">
              <WaypointEditor waypoints={plan.waypoints} totalKm={route.totalDistanceKm} gpxWaypoints={route.gpxWaypoints} onChange={(w) => update({ waypoints: w })} />
              <FuelEditor cfg={plan.fueling} summary={fueling} onChange={(f) => update({ fueling: f })} />
              <Card title="ตำแหน่งบนเส้นทาง" className="lg:col-span-2">
                <ProfileChart route={route} rows={rows} waypoints={plan.waypoints} gels={fueling.events} height={220} />
              </Card>
            </div>
          )}

          {tab === 'splits' && (
            <Card
              title="ตารางเพซรายกิโล"
              right={
                <span className="num text-xs text-zinc-500">
                  รวม {fmtHMS(rows.reduce((s, r) => s + r.splitSec, 0))} = เป้า {fmtHMS(plan.pacing.targetSec)} ✓
                </span>
              }
            >
              <SplitTable rows={rows} avgPaceSec={pacing.avgPaceSec} />
            </Card>
          )}

          {tab === 'train' && (
            <TrainingTab
              plan={plan}
              route={route}
              pacing={pacing}
              fueling={fueling}
              baseRaces={baseRaces}
              customRaces={customRaces}
              onTraining={(training) => update({ training })}
              onRaceLink={(raceId, startTime) => update({ meta: { ...plan.meta, raceId, startTime: startTime ?? plan.meta.startTime } })}
              toast={toast}
            />
          )}

          {tab === 'export' && <ExportPanel meta={plan.meta} route={route} pacing={pacing} rows={rows} fueling={fueling} waypoints={plan.waypoints} toast={toast} />}

          {tab === 'races' && (
            <RaceCalendar
              baseRaces={baseRaces}
              remoteUpdatedAt={remote?.updatedAt}
              customRaces={customRaces}
              onCustomRaces={async (r) => {
                setCustomRaces(r)
                await storage.saveCustomRaces(r)
              }}
              onPlan={planFromRace}
            />
          )}

          {tab === 'archive' && (
            <Archive
              plans={plans}
              current={plan}
              onOpen={openPlan}
              onNew={() => {
                setPlan(newPlan({ name: 'แผนใหม่' }))
                setTab('plan')
              }}
              onDuplicate={(p) => {
                const now = new Date().toISOString()
                setPlan({ ...structuredClone(p), id: uid('plan'), meta: { ...p.meta, name: `${p.meta.name} (สำเนา)` }, postRace: { shoes: '', actualFinish: '', notes: '' }, createdAt: now, updatedAt: now })
                toast('ทำสำเนาแล้ว')
              }}
              onDelete={async (id) => {
                await storage.deletePlan(id)
                const list = await storage.listPlans()
                setPlans(list)
                if (id === plan.id && list[0]) setPlan(list[0])
                toast('ลบแผนแล้ว')
              }}
              onPostRace={(postRace) => update({ postRace })}
              onExport={async () => {
                const data = await storage.exportAll()
                await downloadFile(`raceplan-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json')
              }}
              onImport={async (data, mode) => {
                try {
                  const r = await storage.importAll(data, mode)
                  const list = await storage.listPlans()
                  setPlans(list)
                  setCustomRaces(await storage.listCustomRaces())
                  if (list[0] && !list.some((p) => p.id === plan.id)) setPlan(list[0])
                  toast(`นำเข้า ${r.plans} แผน, ${r.races} งานวิ่ง`)
                } catch (e) {
                  toast((e as Error).message)
                }
              }}
              toast={toast}
            />
          )}
        </main>

        {/* Bottom nav (mobile) */}
        <nav className="fixed inset-x-0 bottom-0 z-[1100] grid grid-cols-7 border-t border-zinc-800 bg-zinc-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`flex flex-col items-center gap-0.5 py-2 text-[9.5px] ${tab === t.id ? 'text-zinc-50' : 'text-zinc-500'}`}>
              <span className={`text-base leading-none ${tab === t.id ? '' : 'opacity-60 grayscale'}`}>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      <div id="print-root">
        <WristBand meta={plan.meta} rows={rows} totalSec={pacing.totalSec} forPrint />
      </div>
      <Toast msg={toastMsg} />
    </>
  )
}

function Legend() {
  return (
    <div className="flex items-center gap-2 text-[10px] text-zinc-400">
      <span className="flex items-center gap-1">
        <i className="inline-block h-0.5 w-3 bg-zinc-100" />
        เพซ
      </span>
      <span className="flex items-center gap-1">
        <i className="inline-block h-2 w-3 bg-zinc-500/60" />
        ความสูง
      </span>
      <span className="text-water">┆น้ำ</span>
      <span className="text-gel">│เจล</span>
    </div>
  )
}

function GradeLegend() {
  const items: [string, string][] = [
    ['#22c55e', 'ลง ≥3%'],
    ['#4ade80', 'ลง'],
    ['#a1a1aa', 'ราบ'],
    ['#f87171', 'ขึ้น'],
    ['#ef4444', 'ขึ้น ≥3%'],
  ]
  return (
    <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-zinc-400">
      {items.map(([c, l]) => (
        <span key={l} className="flex items-center gap-1">
          <i className="inline-block h-1 w-4 rounded" style={{ background: c }} />
          {l}
        </span>
      ))}
      <span>· ตัวเลข = กม. · S/F = จุดสตาร์ท/เส้นชัย · วงกลมเหลือง = เจล</span>
    </div>
  )
}
